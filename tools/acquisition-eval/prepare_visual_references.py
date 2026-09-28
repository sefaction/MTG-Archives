"""Prepare a bounded public reference pool; private photos are never opened.

All printings of labelled card names plus 256 deterministic unrelated distractors.
This is a diagnostic pool, not a claim of full-catalog retrieval performance.
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
from pathlib import Path
import threading
import time
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf8'))
    hasher = hashlib.sha256()
    with args.catalog.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            hasher.update(block)
    digest = hasher.hexdigest()
    if digest != manifest['catalogCompressedSha256']:
        raise ValueError('Catalog digest differs from labelled corpus')
    names = {entry['name'] for entry in manifest['entries']}
    references, distractors = [], []
    with gzip.open(args.catalog, 'rt', encoding='utf8') as stream:
        for line in stream:
            card = json.loads(line)
            if card.get('digital'):
                continue
            if card['name'] in names:
                references.append(card)
            elif card.get('image_uris', {}).get('normal'):
                distractors.append(card)
    distractors.sort(key=lambda card: hashlib.sha256(
        ('visual-eval-v1:' + card['id']).encode()).hexdigest())
    references += distractors[:256]
    if not 1 <= len(references) <= 5000:
        raise ValueError('Diagnostic reference pool exceeds 5000 images')
    expected = {entry['scryfallId'] for entry in manifest['entries']}
    if not expected.issubset({card['id'] for card in references}):
        raise ValueError('Expected printing missing from reference catalog')
    images = args.output / 'reference-images'
    images.mkdir(parents=True, exist_ok=True)
    lock, last = threading.Lock(), [0.0]

    def fetch(card):
        uri = card.get('image_uris', {}).get('normal') or next((
            face.get('image_uris', {}).get('normal') for face in card.get('card_faces', [])
            if face.get('image_uris', {}).get('normal')), None)
        if not uri or urllib.parse.urlparse(uri).hostname != 'cards.scryfall.io':
            raise ValueError('Unexpected reference origin or missing image')
        path = images / (card['id'] + '.jpg')
        if not path.exists():
            with lock:
                time.sleep(max(0, .12 - (time.monotonic() - last[0])))
                last[0] = time.monotonic()
            request = urllib.request.Request(uri, headers={
                'User-Agent': 'MTG-Archives-Local-Evaluation/1.0', 'Accept': 'image/jpeg'})
            with urllib.request.urlopen(request, timeout=45) as response:
                if urllib.parse.urlparse(response.url).hostname != 'cards.scryfall.io':
                    raise ValueError('Unexpected image redirect')
                data = response.read(5 * 1024 * 1024 + 1)
            if len(data) > 5 * 1024 * 1024 or not data.startswith(b'\xff\xd8'):
                raise ValueError('Invalid reference image')
            partial = path.with_suffix('.partial')
            partial.write_bytes(data)
            partial.replace(path)
        return {
            'id': card['id'], 'name': card['name'], 'setCode': card['set'],
            'collectorNumber': card['collector_number'], 'lang': card['lang'],
            'illustrationId': card.get('illustration_id'),
            'file': 'reference-images/' + path.name, 'url': uri,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        }

    results, errors = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(fetch, card): card for card in references}
        for future in concurrent.futures.as_completed(pending):
            try:
                results.append(future.result())
            except Exception as error:
                errors.append({'id': pending[future]['id'], 'error': type(error).__name__})
            if (len(results) + len(errors)) % 100 == 0:
                print('references', len(results), 'errors', len(errors), 'of', len(references), flush=True)
    results.sort(key=lambda card: card['id'])
    report = {
        'scope': 'All catalog printings of corpus names plus 256 seeded unrelated distractors; not full-catalog accuracy.',
        'references': results, 'errors': errors,
    }
    (args.output / 'reference-index.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    if errors:
        raise SystemExit('Reference preparation incomplete; rerun to retry missing images')
    print('Complete', len(results), flush=True)


if __name__ == '__main__':
    main()
