"""Prepare two genuine locked public templates through normal index producers.

No stamp annotation, native result, feature vector or completeness flag is
substituted. The photos are controlled padded copies of public reference art,
so this is development integration evidence, never held-out optical accuracy.
"""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, '/eval')
sys.path.insert(0, '/app/tools/acquisition-runtime')


def main():
    if os.getuid() != 0 or os.environ.get('MTG_NATIVE_PRINTING_FIXTURE') != '1':
        raise ValueError('Explicit root-owned isolated printing fixture required')
    from PIL import Image, ImageOps
    import catalog_references as refs
    from catalog_snapshot import snapshot
    import catalog_index as index
    from image_encoder import Encoder, decode
    from printing import LABELS, TEMPLATES
    from expansion_symbols import ASSETS, symbol_asset_root, verified_assets

    source = Path('/source-references')
    root = Path('/visual')
    root.mkdir(exist_ok=True)
    if (root / 'integration.json').exists() or (root / 'references').exists():
        raise ValueError('Reconcile existing fixture rather than overwrite it')
    annotations = {row['referenceId']: row for row in json.loads(LABELS.read_text())['entries']}
    cache, cards, receipts = [], [], []
    for reference in TEMPLATES:
        identity, face = reference.split(':')
        assert face == '0' and annotations[reference]['stamp'] == 'PRESENT'
        card = json.loads((source / (identity + '.json')).read_text())
        assert card['id'] == identity and not card['digital']
        [row] = refs.references(card)
        assert row['referenceId'] == reference
        image = source / (identity + '-0.jpg')
        digest = refs.sha256(image)
        assert digest == annotations[reference]['sha256'], 'Keep the existing template hash/annotation lock'
        cache.append({**row, 'file': image.name, 'sha256': digest})
        cards.append(card)
        receipts.append({'referenceId': reference, 'sha256': digest, 'bytes': image.stat().st_size})
    cached = root / 'cached-public-images.json'
    cached.write_text(json.dumps({'references': cache}))
    references = root / 'references'
    (references / 'images').mkdir(parents=True)
    db, catalogue = refs.open_plan(references, source / 'catalog.jsonl.gz')
    try:
        assert refs.report(db, references, catalogue)['counts'] == {'PENDING': 2}
        assert refs.reuse_images(db, references, cached, source) == 2
        progress = refs.report(db, references, catalogue)
        assert progress['downloadComplete'] and progress['counts'] == {'READY': 2}
    finally:
        db.close()
    snapshot_path = root / 'snapshot.json'
    assert snapshot(references, snapshot_path)['downloadComplete'] is True
    frozen = json.loads(snapshot_path.read_text())
    encoder = Encoder('vgg16', root / 'models', 'cpu', threads=1)
    output = root / 'index'
    output.mkdir()
    with index.writer_lock(output):
        features = index.open_index(output, frozen['source'], encoder.identity, encoder.dimension)
        try:
            for row, path in index.pending_rows(features, frozen['references'], references, encoder.dimension):
                image = decode(path)
                try:
                    index.save_batch(features, [row], encoder.embed([image]), encoder.dimension)
                finally:
                    image.close()
            manifest = index.publish(features, frozen, output, encoder.dimension)
        finally:
            features.close()
    verified, rows, matrix = index.load_published_index(output / 'index.json')
    assert verified['downloadComplete'] and verified['referenceCount'] == 2 and len(rows) == 2
    del matrix
    verified_assets(symbol_asset_root())
    inputs = {row['id']: row for row in json.loads((source / 'input-receipts.json').read_text())}
    queries = []
    for n, row in enumerate(cache):
        entry = inputs[cards[n]['id']]
        assert entry['file'] == cards[n]['id'] + '-input.jpg'
        assert entry['url'] == cards[n]['image_uris']['large']
        refs.image_url(entry['url'])
        source_photo = source / entry['file']
        assert refs.sha256(source_photo) == entry['sha256']
        refs.validate_image(source_photo.read_bytes())
        with Image.open(source_photo) as image:
            assert image.width >= 500, 'Use genuine adequate-resolution input, preserving the normal printing guard'
            photo = ImageOps.expand(image.convert('RGB'), border=80, fill='#808080')
        target = root / f'query-{n}.jpg'
        try:
            photo.save(target, format='JPEG', quality=97)
        finally:
            photo.close()
        queries.append({'path': str(target), 'sha256': refs.sha256(target), 'target': cards[n]['id'], 'bytes': target.stat().st_size,
                        'publicSource': entry})
    report = {'version': 1, 'scope': 'two locked public templates and controlled padded photos; integration, not optical accuracy',
              'templates': receipts, 'cards': cards, 'queries': queries, 'manifest': manifest,
              'indexSha256': refs.sha256(output / 'index.json'), 'encoder': encoder.identity,
              'annotationsSha256': refs.sha256(LABELS), 'symbolAssets': ASSETS}
    (root / 'integration.json').write_text(json.dumps(report, sort_keys=True))
    print(json.dumps({'prepared': True, 'references': len(rows), 'downloadComplete': True,
                      'indexSha256': report['indexSha256'], 'annotationsSha256': report['annotationsSha256'],
                      'symbolAssets': ASSETS, 'queries': queries}), flush=True)


if __name__ == '__main__':
    main()
