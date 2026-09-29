"""Resumable offline full-catalog indexing, with transactional feature batches.

Public reference snapshots may grow while a download runs. Partial indexes stay
explicitly partial. Embeddings and publication are bound to source/model hashes;
interruption cannot publish a truncated matrix. Does not alter the app runtime.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import numpy as np
from catalog_references import sha256, writer_lock


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def load_published_index(path, allow_partial=False):
    manifest = json.loads(path.read_text(encoding='utf-8'))
    if not manifest['downloadComplete'] and not allow_partial:
        raise ValueError('Full catalog download required; partial smoke checks must be explicit')
    paths = {}
    for name, item in manifest['files'].items():
        target = (path.parent / item['path']).resolve()
        if not target.is_relative_to(path.parent.resolve()) or sha256(target) != item['sha256']:
            raise ValueError('Index file path/digest mismatch')
        paths[name] = target
    matrix = np.load(paths['vectors.npy'], mmap_mode='r', allow_pickle=False)
    records = json.loads(paths['references.json'].read_text(encoding='utf-8'))
    if matrix.shape != (len(records), manifest['dimension']) or len(records) != manifest['referenceCount']:
        raise ValueError('Index matrix/reference shape mismatch')
    if matrix.dtype != np.dtype('<f4') or not np.isfinite(matrix).all():
        raise ValueError('Invalid index features')
    return manifest, records, matrix


def open_index(root, source, encoder, dimension):
    db = sqlite3.connect(root / 'features.sqlite')
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('''CREATE TABLE IF NOT EXISTS features (
        id TEXT PRIMARY KEY, reference TEXT NOT NULL, vector BLOB NOT NULL, digest TEXT NOT NULL)''')
    identity = canonical({'source': source, 'encoder': encoder, 'dimension': dimension, 'format': 1})
    row = db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
    if row and row[0] != identity:
        db.close()
        raise ValueError('Index source/model changed; use a separate output directory')
    with db:
        db.execute('INSERT OR IGNORE INTO metadata VALUES(?,?)', ('identity', identity))
    return db


def validate_vector(data, dimension, digest):
    if len(data) != dimension * 4 or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Cached feature digest/size mismatch')
    value = np.frombuffer(data, dtype='<f4')
    if not np.isfinite(value).all() or abs(float(np.linalg.norm(value)) - 1) > .001:
        raise ValueError('Invalid normalized features')
    return value


def pending_rows(db, references, root, dimension):
    seen = set()
    for row in references:
        identity = row['referenceId']
        if identity in seen:
            raise ValueError('Duplicate reference identity')
        seen.add(identity)
        path = (root / row['file']).resolve()
        if not path.is_relative_to(root.resolve()) or sha256(path) != row['sha256']:
            raise ValueError('Reference path/digest mismatch')
        existing = db.execute('SELECT reference,vector,digest FROM features WHERE id=?', (identity,)).fetchone()
        if existing:
            if existing[0] != canonical(row):
                raise ValueError('Reference changed within frozen snapshot')
            validate_vector(existing[1], dimension, existing[2])
        else:
            yield row, path


def save_batch(db, rows, vectors, dimension):
    if vectors.shape != (len(rows), dimension):
        raise ValueError('Unexpected feature batch shape')
    with db:
        for row, vector in zip(rows, vectors):
            data = np.asarray(vector, dtype='<f4').tobytes()
            digest = hashlib.sha256(data).hexdigest()
            validate_vector(data, dimension, digest)
            db.execute('INSERT INTO features VALUES(?,?,?,?)', (row['referenceId'], canonical(row), data, digest))


def publish(db, snapshot, output, dimension):
    """Publish one immutable generation, then atomically switch its manifest."""
    count = db.execute('SELECT COUNT(*) FROM features').fetchone()[0]
    expected = len(snapshot['references'])
    if count != expected or expected == 0:
        raise ValueError('Index does not cover snapshot')
    ids = {row['referenceId']: canonical(row) for row in snapshot['references']}
    # A private temporary generation is never referenced by the manifest.
    stage = Path(tempfile.mkdtemp(prefix='generation-', dir=output))
    matrix = np.lib.format.open_memmap(stage / 'vectors.npy', mode='w+', dtype='<f4', shape=(count, dimension))
    records = []
    try:
        for index, (identity, raw, data, digest) in enumerate(db.execute('SELECT id,reference,vector,digest FROM features ORDER BY id')):
            if ids.get(identity) != raw:
                raise ValueError('Cached reference not in snapshot')
            matrix[index] = validate_vector(data, dimension, digest)
            records.append(json.loads(raw))
        matrix.flush()
    finally:
        del matrix
    (stage / 'references.json').write_text(canonical(records), encoding='utf-8')
    # Public index assets must be readable by the restricted query process.
    # Keep the unpublished directory private until all generation bytes exist.
    for name in ('vectors.npy', 'references.json'):
        (stage / name).chmod(0o644)
    stage.chmod(0o755)
    identity = json.loads(db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()[0])
    manifest = {**identity, 'referenceCount': count, 'counts': snapshot['counts'],
                'downloadComplete': snapshot['downloadComplete'],
                'allReferencesAvailable': snapshot['downloadComplete'] and not snapshot['counts'].get('UNAVAILABLE'),
                'unavailableCount': len(snapshot['unavailable']),
                'files': {name: {'path': f'{stage.name}/{name}', 'sha256': sha256(stage / name)}
                          for name in ('vectors.npy', 'references.json')}}
    temporary = output / 'index.partial.json'
    temporary.write_text(canonical(manifest), encoding='utf-8')
    temporary.chmod(0o644)
    os.replace(temporary, output / 'index.json')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--encoder', choices=('vgg16', 'dinov2'), required=True)
    parser.add_argument('--device', choices=('cpu', 'cuda'), default='cpu')
    parser.add_argument('--batch-size', type=int, default=16)
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.batch_size <= 64 or args.limit < 0:
        parser.error('Invalid batch size/limit')
    from image_encoder import Encoder, decode
    snapshot = json.loads(args.snapshot.read_text(encoding='utf-8'))
    args.output.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with writer_lock(args.output):
        encoder = Encoder(args.encoder, args.models, args.device)
        db = open_index(args.output, snapshot['source'], encoder.identity, encoder.dimension)
        completed, rows, images = 0, [], []
        try:
            for row, path in pending_rows(db, snapshot['references'], args.references, encoder.dimension):
                rows.append(row)
                images.append(decode(path))
                if len(rows) == args.batch_size or (args.limit and completed + len(rows) == args.limit):
                    save_batch(db, rows, encoder.embed(images), encoder.dimension)
                    completed += len(rows)
                    rows, images = [], []
                    if completed % (args.batch_size * 20) == 0:
                        print(json.dumps({'newReferences': completed, 'seconds': round(time.monotonic() - started, 2)}), flush=True)
                    if args.limit and completed >= args.limit:
                        break
            if rows:
                save_batch(db, rows, encoder.embed(images), encoder.dimension)
                completed += len(rows)
            count = db.execute('SELECT COUNT(*) FROM features').fetchone()[0]
            manifest = publish(db, snapshot, args.output, encoder.dimension) if count == len(snapshot['references']) else None
            print(json.dumps({'newReferences': completed, 'totalReferences': count,
                              'seconds': round(time.monotonic() - started, 2),
                              'device': args.device, 'published': manifest is not None,
                              'downloadComplete': manifest['downloadComplete'] if manifest else False}), flush=True)
        finally:
            db.close()


if __name__ == '__main__':
    main()
