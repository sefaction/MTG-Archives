"""Resumable full default-catalog image preparation. No private photo input.

Uses bulk metadata, then public image GETs only. SQLite records every face and
unavailable reference; an incomplete download never becomes a complete library.
The images, database and reports belong in persistent data, outside Git/images.
"""
import argparse
import concurrent.futures
from contextlib import contextmanager
import gzip
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import urllib.parse
import uuid

VERSION = 1
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def sha256(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def image_url(value):
    if not isinstance(value, str):
        raise ValueError('Missing reference URL')
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'https' or parsed.hostname != 'cards.scryfall.io'
            or parsed.port is not None or parsed.username or parsed.password
            or parsed.fragment or not parsed.path.endswith('.jpg')):
        raise ValueError('Unexpected public image origin or format')
    return parsed


def references(card):
    """All image-bearing faces, not one face or one printing per name."""
    if card.get('digital'):
        return []
    card_id = str(uuid.UUID(card['id']))
    top = card.get('image_uris', {}).get('normal')
    faces = [card] if top else (card.get('card_faces') or [card])
    result = []
    for face_index, face in enumerate(faces):
        uri = face.get('image_uris', {}).get('normal')
        unavailable = ('MISSING_IMAGE' if not uri else
                       'PLACEHOLDER_IMAGE' if card.get('image_status') in ('placeholder', 'missing') else None)
        if uri:
            image_url(uri)
        result.append({
            'referenceId': f'{card_id}:{face_index}', 'cardId': card_id,
            'face': face_index, 'name': card['name'],
            'faceName': face.get('name', card['name']),
            'setCode': card['set'], 'collectorNumber': card['collector_number'],
            'lang': card['lang'], 'imageStatus': card.get('image_status'),
            'illustrationId': face.get('illustration_id'),
            'url': uri, 'unavailable': unavailable,
            'file': f'images/{card_id}-{face_index}.jpg',
        })
    return result


@contextmanager
def writer_lock(root):
    """OS lock releases on crash; a stale lock filename never blocks resume."""
    with (root / 'writer.lock').open('a+b') as stream:
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def open_plan(root, catalog):
    digest = sha256(catalog)
    db = sqlite3.connect(root / 'references.sqlite')
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.execute('''CREATE TABLE IF NOT EXISTS refs (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, state TEXT NOT NULL,
        digest TEXT, bytes INTEGER, error TEXT)''')
    previous = db.execute("SELECT value FROM metadata WHERE key='source'").fetchone()
    if previous:
        source = json.loads(previous[0])
        if source['catalogSha256'] != digest or source['version'] != VERSION:
            db.close()
            raise ValueError('Use a separate directory for a different catalog/version')
        return db, source
    try:
        cards, seen = 0, set()
        with db, gzip.open(catalog, 'rt', encoding='utf-8') as stream:
            for line in stream:
                if len(line) > 1024 * 1024:
                    raise ValueError('Catalog record exceeds bound')
                card = json.loads(line)
                if card['id'] in seen:
                    raise ValueError('Duplicate catalog card identity')
                seen.add(card['id'])
                rows = references(card)
                if rows:
                    cards += 1
                for row in rows:
                    db.execute('INSERT INTO refs(id,data,state,error) VALUES(?,?,?,?)',
                               (row['referenceId'], json.dumps(row, sort_keys=True),
                                'UNAVAILABLE' if row['unavailable'] else 'PENDING', row['unavailable']))
            if not cards:
                raise ValueError('Empty reference catalog')
            source = {'version': VERSION, 'catalogSha256': digest,
                      'catalogRecords': len(seen), 'paperCards': cards,
                      'coverage': 'All non-digital records and image faces in supplied default_cards snapshot; not all languages.'}
            db.execute('INSERT INTO metadata VALUES(?,?)', ('source', json.dumps(source)))
    except BaseException:
        db.close()
        raise
    return db, source


def validate_image(data):
    from PIL import Image
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError('Reference image exceeds byte bound')
    with Image.open(io.BytesIO(data)) as image:
        if image.format != 'JPEG' or image.width * image.height > 36000000:
            raise ValueError('Unexpected reference image format/size')
        image.verify()


def atomic_image(root, row, data):
    validate_image(data)
    target = root / row['file']
    fd, temporary = tempfile.mkstemp(dir=root / 'images', suffix='.partial')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return hashlib.sha256(data).hexdigest(), len(data)


def reuse_images(db, root, index_path):
    if not index_path:
        return 0
    index = json.loads(index_path.read_text(encoding='utf-8'))
    if index.get('errors'):
        raise ValueError('Cannot reuse an incomplete diagnostic index')
    by_url = {row['url']: row for row in index['references']}
    reused = 0
    for identity, raw in db.execute("SELECT id,data FROM refs WHERE state='PENDING'").fetchall():
        row = json.loads(raw)
        previous = by_url.get(row['url'])
        if not previous:
            continue
        path = (index_path.parent / previous['file']).resolve()
        if not path.is_relative_to(index_path.parent.resolve()) or path.is_symlink():
            raise ValueError('Reference cache path escapes its directory')
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != previous['sha256']:
            raise ValueError('Existing public reference digest mismatch')
        digest, size = atomic_image(root, row, data)
        db.execute("UPDATE refs SET state='READY',digest=?,bytes=?,error=NULL WHERE id=?", (digest, size, identity))
        reused += 1
        if reused % 100 == 0:
            db.commit()
    db.commit()
    return reused


class Downloader:
    def __init__(self, rate):
        self.interval = 1 / rate
        self.lock = threading.Lock()
        self.last = 0
        self.stop = threading.Event()
        self.local = threading.local()

    def fetch(self, row):
        url = image_url(row['url'])
        last_error = 'NETWORK'
        for attempt in range(3):
            with self.lock:
                if self.stop.is_set():
                    raise RuntimeError('DOWNLOAD_HALTED')
                time.sleep(max(0, self.last + self.interval - time.monotonic()))
                self.last = time.monotonic()
            try:
                if not getattr(self.local, 'connection', None):
                    self.local.connection = http.client.HTTPSConnection(url.hostname, timeout=45)
                connection = self.local.connection
                connection.request('GET', urllib.parse.urlunsplit(('', '', url.path, url.query, '')),
                                   headers={'User-Agent': 'MTG-Archives/1.0 (+https://github.com/sefaction/MTG-Archives)',
                                            'Accept': 'image/jpeg'})
                response = connection.getresponse()
                status = response.status
                data = response.read(MAX_IMAGE_BYTES + 1)
                if status in (401, 403, 429):
                    # Stop the entire invocation; never power through a block.
                    self.stop.set()
                    raise RuntimeError(f'HTTP_{status}_STOP_RETRY_AFTER_{response.getheader("Retry-After", "unspecified")}')
                if status != 200:
                    raise RuntimeError(f'HTTP_{status}')
                validate_image(data)
                return data
            except (OSError, http.client.HTTPException, ValueError, RuntimeError) as error:
                last_error = str(error) if isinstance(error, RuntimeError) else type(error).__name__
                if getattr(self.local, 'connection', None):
                    self.local.connection.close()
                    self.local.connection = None
                if self.stop.is_set() or last_error.startswith(('HTTP_3', 'HTTP_4')):
                    raise RuntimeError(last_error) from None
                if attempt < 2:
                    time.sleep(2 ** attempt)
        raise RuntimeError(last_error)


def report(db, root, source):
    counts = dict(db.execute('SELECT state,COUNT(*) FROM refs GROUP BY state'))
    result = {**source, 'counts': counts,
              'downloadComplete': not any(counts.get(s, 0) for s in ('PENDING', 'FAILED')),
              'allReferencesAvailable': not any(counts.get(s, 0) for s in ('PENDING', 'FAILED', 'UNAVAILABLE'))}
    temporary = root / 'progress.partial.json'
    temporary.write_text(json.dumps(result, indent=2), encoding='utf-8')
    temporary.replace(root / 'progress.json')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--reuse-index', type=Path)
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--starts-per-second', type=float, default=16)
    parser.add_argument('--limit', type=int, default=0, help='Bound this invocation; zero attempts all pending faces')
    parser.add_argument('--retry-failed', action='store_true')
    parser.add_argument('--plan-only', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.workers <= 16 or not 0 < args.starts_per_second <= 30 or args.limit < 0:
        parser.error('Invalid concurrency/rate/limit')
    root = args.output.resolve()
    (root / 'images').mkdir(parents=True, exist_ok=True)
    with writer_lock(root):
        db, source = open_plan(root, args.catalog)
        try:
            if args.retry_failed:
                db.execute("UPDATE refs SET state='PENDING',error=NULL WHERE state='FAILED'")
                db.commit()
            print(json.dumps(report(db, root, source)), flush=True)
            if args.plan_only:
                return
            print('Reused', reuse_images(db, root, args.reuse_index), flush=True)
            rows = db.execute("SELECT id,data FROM refs WHERE state='PENDING' ORDER BY id").fetchall()
            if args.limit:
                rows = rows[:args.limit]
            pending = iter(rows)
            downloader = Downloader(args.starts_per_second)
            completed = 0
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
                active = {}

                def submit():
                    if downloader.stop.is_set():
                        return
                    for identity, raw in pending:
                        row = json.loads(raw)
                        active[pool.submit(downloader.fetch, row)] = (identity, row)
                        return

                for _ in range(args.workers):
                    submit()
                while active:
                    done, _ = concurrent.futures.wait(active, return_when=concurrent.futures.FIRST_COMPLETED)
                    for future in done:
                        identity, row = active.pop(future)
                        try:
                            digest, size = atomic_image(root, row, future.result())
                            db.execute("UPDATE refs SET state='READY',digest=?,bytes=?,error=NULL WHERE id=?", (digest, size, identity))
                        except (OSError, ValueError, RuntimeError) as error:
                            message = str(error)[:200]
                            if message != 'DOWNLOAD_HALTED':
                                db.execute("UPDATE refs SET state='FAILED',error=? WHERE id=?", (message, identity))
                                print('Reference error', identity, message, flush=True)
                        db.commit()
                        completed += 1
                        if completed % 100 == 0:
                            print(json.dumps(report(db, root, source)), flush=True)
                        submit()
            result = report(db, root, source)
            print(json.dumps(result), flush=True)
            if downloader.stop.is_set() or result['counts'].get('FAILED'):
                raise SystemExit('Reference download incomplete; inspect persisted errors before retry')
        finally:
            db.close()


if __name__ == '__main__':
    main()
