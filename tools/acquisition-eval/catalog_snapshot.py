"""Export a consistent download snapshot for offline index builders.

Run on the downloader's host. Readers never open the live SQLite WAL through a
cross-platform Docker mount. The resulting JSON and public images are read-only
inputs; incomplete coverage is preserved explicitly.
"""
import argparse
import json
from pathlib import Path
import sqlite3
from catalog_references import sha256


def snapshot(root, output):
    db = sqlite3.connect((root / 'references.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        db.execute('BEGIN')
        source = json.loads(db.execute("SELECT value FROM metadata WHERE key='source'").fetchone()[0])
        counts = dict(db.execute('SELECT state,COUNT(*) FROM refs GROUP BY state'))
        rows = []
        for raw, digest, size in db.execute("SELECT data,digest,bytes FROM refs WHERE state='READY' ORDER BY id"):
            rows.append({**json.loads(raw), 'sha256': digest, 'bytes': size})
        unavailable = [json.loads(row[0]) for row in db.execute("SELECT data FROM refs WHERE state='UNAVAILABLE' ORDER BY id")]
        result = {'source': source, 'counts': counts, 'references': rows,
                  'unavailable': unavailable,
                  'downloadComplete': not any(counts.get(s, 0) for s in ('PENDING', 'FAILED'))}
    finally:
        db.close()
    temporary = output.with_suffix('.partial.json')
    temporary.write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    temporary.replace(output)
    return {'snapshotSha256': sha256(output), 'counts': counts, 'downloadComplete': result['downloadComplete']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(snapshot(args.references, args.output)))
