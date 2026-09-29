"""Bounded public-reference maintenance. No photos, database or Inventory access.

Prepare a separate resumable catalog generation, reuse verified public bytes and
features, and publish only complete indexes. The prior generation remains usable.
All state belongs in persistent mounts. A loop is opt-in; production is unchanged.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import tempfile
import time
import urllib.parse

from catalog_index import (archive_index, canonical, load_published_index, normalized_encoder,
                           open_index, pending_rows, publish, reuse_features, save_batch)
from catalog_references import (download_pending, open_plan, reuse_images,
                                reference_receipt, sha256, verified_reference, writer_lock)
from catalog_snapshot import snapshot

MAX_CATALOG = 512 * 1024 * 1024
HEADERS = {'User-Agent': 'MTG-Archives/1.0 (+https://github.com/sefaction/MTG-Archives)',
           'Accept': 'application/json'}
stopped = False


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(suffix='.partial', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(canonical(value))
            stream.flush()
            os.fsync(stream.fileno())
        Path(temporary).chmod(0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def bulk_metadata():
    connection = http.client.HTTPSConnection('api.scryfall.com', timeout=45)
    try:
        connection.request('GET', '/bulk-data/default_cards', headers=HEADERS)
        response = connection.getresponse()
        data = response.read(256 * 1024 + 1)
        if response.status != 200 or len(data) > 256 * 1024:
            raise ValueError('Public bulk metadata unavailable')
        return validate_metadata(json.loads(data))
    finally:
        connection.close()


def validate_metadata(value):
    url = urllib.parse.urlsplit(value.get('jsonl_download_uri', ''))
    size = value.get('compressed_size')
    if (value.get('type') != 'default_cards' or url.scheme != 'https' or
            url.hostname != 'data.scryfall.io' or url.port is not None or
            url.username or url.password or url.fragment or url.query or
            not url.path.startswith('/default-cards/') or not url.path.endswith('.jsonl.gz') or
            isinstance(size, bool) or not isinstance(size, int) or not 0 < size <= MAX_CATALOG or
            not isinstance(value.get('updated_at'), str) or len(value['updated_at']) > 80):
        raise ValueError('Unexpected public bulk metadata')
    return {key: value[key] for key in ('type', 'updated_at', 'jsonl_download_uri', 'compressed_size')}


def download_catalog(state, metadata):
    # URI/version/size name a resumable immutable source. No provider filename
    # becomes an arbitrary filesystem path. Partial transfer is never consumed.
    key = hashlib.sha256(canonical(metadata).encode()).hexdigest()
    target = state / f'catalog-{key}.jsonl.gz'
    if target.exists():
        if target.stat().st_size != metadata['compressed_size']:
            raise ValueError('Stored bulk source size differs')
        return target
    url = urllib.parse.urlsplit(metadata['jsonl_download_uri'])
    connection = http.client.HTTPSConnection(url.hostname, timeout=45)
    fd, temporary = tempfile.mkstemp(suffix='.partial', dir=state)
    try:
        connection.request('GET', url.path, headers=HEADERS)
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError('Public bulk source unavailable')
        size = 0
        with os.fdopen(fd, 'wb') as output:
            fd = None
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                size += len(block)
                if size > metadata['compressed_size']:
                    raise ValueError('Bulk source exceeds bound')
                output.write(block)
            if size != metadata['compressed_size']:
                raise ValueError('Incomplete bulk source')
            output.flush()
            os.fsync(output.fileno())
        Path(temporary).chmod(0o644)
        os.replace(temporary, target)
        atomic_json(target.with_suffix('.metadata.json'), metadata)
        return target
    finally:
        if fd is not None:
            os.close(fd)
        connection.close()
        if os.path.exists(temporary):
            os.unlink(temporary)


def release_completed_work(index, state, generation, feature_root, baseline):
    """Bound only generated caches; retain public image bytes and the baseline.

    Current plus two recent published manifests stay loadable. Old results and
    all reference images remain; obsolete jobs use the current worker version.
    Never recursively delete a directory or touch unknown files.
    """
    baseline_file = state / 'baseline-manifest.json'
    if not baseline_file.exists():
        atomic_json(baseline_file, {'manifest': baseline.name})
    baseline_name = json.loads(baseline_file.read_text())['manifest']
    if not re.fullmatch(r'manifest-[a-f0-9]{64}\.json', baseline_name):
        raise ValueError('Invalid maintenance baseline')
    archives = sorted(index.glob('manifest-*.json'), key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
    current = f'manifest-{sha256(index / "index.json")}.json'
    keep = {p.name for p in archives[:3]} | {baseline_name, current}
    protected = set()
    manifests = []
    for archive in archives:
        if not re.fullmatch(r'manifest-[a-f0-9]{64}\.json', archive.name):
            continue
        if sha256(archive) != archive.stem.removeprefix('manifest-'):
            raise ValueError('Immutable archive changed during cleanup')
        value = json.loads(archive.read_text())
        paths = []
        for name in ('vectors.npy', 'references.json'):
            relative = Path(value['files'][name]['path'])
            if len(relative.parts) != 2 or not relative.parts[0].startswith('generation-') or relative.parts[1] != name:
                raise ValueError('Generated index cleanup path unexpected')
            target = (index / relative).resolve()
            if not target.is_relative_to(index.resolve()):
                raise ValueError('Generated index cleanup path escapes root')
            paths.append(target)
        manifests.append((archive.name, paths))
        if archive.name in keep:
            protected.update(paths)
    retired = 0
    for name, paths in manifests:
        if name in keep:
            continue
        for target in paths:
            if target not in protected and target.exists():
                try:
                    target.unlink()
                    retired += 1
                except PermissionError:
                    # An open Windows mapping may defer reclamation to next pass.
                    pass
    released = 0
    for root, names in ((feature_root, ('features.sqlite', 'features.sqlite-wal', 'features.sqlite-shm')),
                        (generation, ('references.sqlite', 'references.sqlite-wal', 'references.sqlite-shm',
                                      'snapshot.json', 'runtime-snapshot.json', 'progress.json'))):
        for name in names:
            target = (root / name).resolve()
            if not target.is_relative_to(root.resolve()):
                raise ValueError('Generated work cleanup path escapes root')
            if target.exists():
                released += target.stat().st_size
                target.unlink()
    # Reuse files are transient verified public metadata, not runtime inputs.
    for file in state.glob('reuse-*.json'):
        if re.fullmatch(r'reuse-[a-f0-9]{64}\.json', file.name) and file.resolve().parent == state.resolve():
            file.unlink()
    sources = sorted(state.glob('catalog-*.jsonl.gz'), key=lambda p: p.stat().st_mtime_ns, reverse=True)
    for file in sources[2:]:
        if re.fullmatch(r'catalog-[a-f0-9]{64}\.jsonl\.gz', file.name) and file.resolve().parent == state.resolve():
            file.unlink()
            metadata = file.with_suffix('.metadata.json')
            if metadata.exists() and metadata.resolve().parent == state.resolve():
                metadata.unlink()
    return {'retiredIndexFiles': retired, 'releasedWorkBytes': released}


def refresh(catalog, references, index, models, state, encoder_name='dinov2', encoder_factory=None):
    """One serialized pass. Failures cannot replace the active index manifest."""
    started = time.monotonic()
    for directory in (references, index, state):
        directory.mkdir(parents=True, exist_ok=True)
    source_hash = sha256(catalog)
    active = index / 'index.json'
    with writer_lock(state), writer_lock(index):
        previous, old = None, None
        if active.exists():
            old, records, matrix = load_published_index(active)
            del records, matrix
            previous = archive_index(index)
        if encoder_factory is None:
            def encoder_factory():
                from image_encoder import Encoder
                return Encoder(encoder_name, models, 'cpu', threads=1)
        # Keep model memory out of reference preparation. Full-size adoption
        # already needs bounded public metadata and file buffers.
        encoder = encoder_factory() if old and old['source']['catalogSha256'] == source_hash else None
        if (encoder and normalized_encoder(old['encoder']) == normalized_encoder(encoder.identity)):
            return {'version': 1, 'event': 'reference-refresh-unchanged', 'catalogSha256': source_hash,
                    'referenceCount': old['referenceCount'], 'unavailableCount': old['unavailableCount'],
                    'published': False, 'seconds': round(time.monotonic() - started, 3)}

        generation = references / 'generations' / source_hash
        (generation / 'images').mkdir(parents=True, exist_ok=True)
        generation.chmod(0o755)
        generation.parent.chmod(0o755)
        with writer_lock(generation):
            db, source = open_plan(generation, catalog)
            try:
                # Only retry on a later maintenance pass, not in a hot loop.
                db.execute("UPDATE refs SET state='PENDING',error=NULL WHERE state='FAILED'")
                db.commit()
                old_snapshot = None
                if previous:
                    _, old_records, matrix = load_published_index(previous)
                    del matrix
                    old_snapshot = state / f'reuse-{sha256(previous)}.json'
                    atomic_json(old_snapshot, {'references': old_records})
                    del old_records
                reused_images = reuse_images(db, generation, old_snapshot, references, share=True)
                downloaded = download_pending(db, generation, source)
                snapshot_file = generation / 'snapshot.json'
                exported = snapshot(generation, snapshot_file)
            finally:
                db.close()
        if not exported['downloadComplete']:
            raise ValueError('Partial reference generation cannot be activated')
        value = json.loads(snapshot_file.read_text(encoding='utf-8'))
        prefix = generation.relative_to(references).as_posix()
        for row in value['references']:
            row['file'] = row.pop('sharedFile', None) or f"{prefix}/{row['file']}"
            if 'verifiedStat' not in row:
                # Resume older producer versions without inventing a receipt.
                file = (references / row['file']).resolve()
                if not file.is_relative_to(references.resolve()):
                    raise ValueError('Reference receipt path escapes root')
                verified_reference(file, row)
                row['verifiedStat'] = reference_receipt(file, row['sha256'])
        # Keep the local downloader snapshot separate from runtime-rooted paths.
        atomic_json(generation / 'runtime-snapshot.json', value)
        encoder = encoder or encoder_factory()
        encoder_hash = hashlib.sha256(canonical(encoder.identity).encode()).hexdigest()
        feature_root = state / f'features-{source_hash}-{encoder_hash}'
        feature_root.mkdir(exist_ok=True)
        db = open_index(feature_root, source, encoder.identity, encoder.dimension)
        completed, rows, images = 0, [], []
        try:
            reused_vectors = reuse_features(db, value['references'], references, previous,
                                           encoder.identity, encoder.dimension)
            from PIL import Image, ImageOps
            for row, path in pending_rows(db, value['references'], references, encoder.dimension):
                with Image.open(path) as image:
                    if image.width * image.height > 36000000:
                        raise ValueError('Reference image exceeds bound')
                    images.append(ImageOps.exif_transpose(image).convert('RGB'))
                rows.append(row)
                if len(rows) == 8:
                    save_batch(db, rows, encoder.embed(images), encoder.dimension)
                    completed += len(rows)
                    print(json.dumps({'event': 'reference-features', 'newReferences': completed}), flush=True)
                    rows, images = [], []
            if rows:
                save_batch(db, rows, encoder.embed(images), encoder.dimension)
                completed += len(rows)
            # Source immutability is checked again before atomic publication.
            if sha256(catalog) != source_hash:
                raise ValueError('Bulk source changed during maintenance')
            manifest = publish(db, value, index, encoder.dimension)
        finally:
            db.close()
        try:
            cleanup = release_completed_work(index, state, generation, feature_root,
                                             previous or archive_index(index))
        except (OSError, ValueError, KeyError):
            # Publication is already complete. Cleanup failure cannot turn a
            # valid index into a false claim that the pointer was unchanged.
            cleanup = {'cleanupDeferred': True}
        result = {'version': 1, 'event': 'reference-refresh-complete', 'catalogSha256': source_hash,
                  'referenceCount': manifest['referenceCount'], 'unavailableCount': manifest['unavailableCount'],
                  'reusedImages': reused_images, 'downloadedImages': downloaded,
                  'reusedVectors': reused_vectors, 'newVectors': completed,
                  'published': True, 'seconds': round(time.monotonic() - started, 3), **cleanup}
        atomic_json(state / 'last-success.json', result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('references', 'index', 'models', 'state'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--catalog', type=Path, help='Explicit frozen source for local verification')
    parser.add_argument('--encoder', choices=('vgg16', 'dinov2'), default='dinov2')
    parser.add_argument('--loop', action='store_true')
    parser.add_argument('--interval-hours', type=float, default=24)
    args = parser.parse_args()
    if not 1 <= args.interval_hours <= 168:
        parser.error('Maintenance interval must be 1–168 hours')
    args.state.mkdir(parents=True, exist_ok=True)
    global stopped
    def stop(_signal, _frame):
        global stopped
        stopped = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    reported_due = None
    while not stopped:
        attempt = args.state / 'last-attempt.json'
        last = json.loads(attempt.read_text()).get('time', 0) if attempt.exists() else 0
        due = last + args.interval_hours * 3600
        if args.loop and reported_due != due:
            print(json.dumps({'event': 'reference-maintenance-scheduled', 'intervalHours': args.interval_hours,
                              'nextAttemptAt': datetime.fromtimestamp(max(due, time.time()), timezone.utc).isoformat()}), flush=True)
            reported_due = due
        if args.loop and time.time() < due:
            time.sleep(min(10, due - time.time()))
            continue
        pointer = args.index / 'index.json'
        before = sha256(pointer) if pointer.exists() else None
        try:
            catalog = args.catalog or download_catalog(args.state, bulk_metadata())
            result = refresh(catalog, args.references.resolve(), args.index.resolve(),
                             args.models, args.state.resolve(), args.encoder)
            print(json.dumps(result), flush=True)
        except Exception as error:
            print(json.dumps({'event': 'reference-refresh-failed', 'error': type(error).__name__,
                              'indexNotReplaced': (sha256(pointer) if pointer.exists() else None) == before}), flush=True)
            if not args.loop:
                raise
        finally:
            atomic_json(attempt, {'time': time.time()})
        if not args.loop:
            return


if __name__ == '__main__':
    main()
