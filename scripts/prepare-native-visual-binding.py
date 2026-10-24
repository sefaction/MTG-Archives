"""Opt-in synthetic assets through the real reference/index producers.

Only public-image transport is substituted with deterministic fixture JPEGs.
Coverage flags, reference validation, embeddings and publication are production
code. Inference uses the actual content-locked CPU encoder, never label vectors.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import uuid

ROOT = Path('/visual')
sys.path.insert(0, '/eval')


def allowed():
    if os.environ.get('MTG_NATIVE_VISUAL_VERSION_FIXTURE') != '1' or os.getuid() != 0:
        raise ValueError('Explicit root-owned disposable visual fixture only')


def activate(name):
    allowed()
    if name not in ('partial', 'a', 'b'):
        raise ValueError('Unknown fixture generation')
    source = ROOT / f'index-{name}'
    target = ROOT / 'index'
    target.mkdir(exist_ok=True)
    # Copy exact producer outputs, retaining every immutable prior generation.
    for item in source.iterdir():
        if item.is_dir() and item.name.startswith('generation-'):
            if not (target / item.name).exists():
                shutil.copytree(item, target / item.name)
        elif item.name.startswith('manifest-') and item.suffix == '.json':
            data = item.read_bytes()
            if (target / item.name).exists() and (target / item.name).read_bytes() != data:
                raise ValueError('Immutable fixture manifest changed')
            (target / item.name).write_bytes(data)
    temporary = target / 'index.partial.json'
    temporary.write_bytes((source / 'index.json').read_bytes())
    temporary.replace(target / 'index.json')


def prepare():
    allowed()
    from PIL import Image, ImageDraw
    import numpy as np
    import catalog_references as refs
    from catalog_snapshot import snapshot
    import catalog_index as index
    from image_encoder import Encoder, decode, WEIGHTS

    ROOT.mkdir(exist_ok=True)
    if (ROOT / 'fixture.json').exists() or (ROOT / 'references').exists():
        raise ValueError('Reconcile existing fixture; never overwrite it')
    cards, pixels = [], {}
    for n in range(6):
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f'mtg-archives-native-visual-binding-{n}'))
        card = {'id': identity, 'name': f'Synthetic visual binding {n}', 'set': 'tst',
                'collector_number': str(n + 1), 'lang': 'en', 'image_status': 'highres_scan', 'digital': n == 5}
        faces = []
        for face in range(2 if n == 4 else 1):
            image = Image.new('RGB', (500, 700), (30 + n * 35, 180 - n * 25, 55 + face * 120))
            draw = ImageDraw.Draw(image)
            draw.rectangle((10, 10, 489, 689), outline='black', width=6)
            rng = np.random.default_rng(1000 + n * 10 + face)
            for _ in range(180):
                x, y = rng.integers(30, 440), rng.integers(80, 600)
                color = tuple(int(v) for v in rng.integers(0, 256, 3))
                draw.rectangle((int(x), int(y), int(x) + 20, int(y) + 25), fill=color, outline='white')
            draw.text((25, 30), card['name'] + f' face {face}', fill='white')
            encoded = io.BytesIO()
            image.save(encoded, format='JPEG', quality=95)
            image.close()
            uri = f'https://cards.scryfall.io/normal/front/{identity}-{face}.jpg'
            pixels[uri] = encoded.getvalue()
            faces.append({'name': card['name'] + f' face {face}', 'image_uris': {'normal': uri}})
        if n == 4:
            card['card_faces'] = faces
        else:
            card['image_uris'] = faces[0]['image_uris']
        cards.append(card)

    def catalog(name, values):
        output = ROOT / f'catalog-{name}.jsonl.gz'
        with output.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as compressed:
            for value in values:
                compressed.write((json.dumps(value, sort_keys=True) + '\n').encode())
        return output

    reference_root = ROOT / 'references'
    (reference_root / 'images').mkdir(parents=True)
    db, source = refs.open_plan(reference_root, catalog('a', cards))
    original_fetch = refs.Downloader.fetch
    # No network/third-party photograph: the production downloader still
    # validates, syncs and records every returned synthetic JPEG and face.
    def fixture_fetch(_self, row):
        refs.image_url(row['url'])
        return pixels[row['url']]
    refs.Downloader.fetch = fixture_fetch
    try:
        refs.download_pending(db, reference_root, source, workers=1, rate=1, limit=1)
        partial_snapshot = ROOT / 'snapshot-partial.json'
        partial = snapshot(reference_root, partial_snapshot)
        assert partial['downloadComplete'] is False and partial['counts'] == {'PENDING': 5, 'READY': 1}
        refs.download_pending(db, reference_root, source, workers=1, rate=1)
    finally:
        refs.Downloader.fetch = original_fetch
        db.close()
    complete_snapshot = ROOT / 'snapshot-a.json'
    complete = snapshot(reference_root, complete_snapshot)
    assert complete['downloadComplete'] is True and complete['counts'] == {'READY': 6}

    encoder = Encoder('vgg16', ROOT / 'models', 'cpu', threads=1)
    assert encoder.identity['weightsSha256'] == WEIGHTS['vgg16'][1]

    def build(name, snapshot_path, references, previous=None):
        value = json.loads(snapshot_path.read_text())
        output = ROOT / f'index-{name}'
        output.mkdir()
        with index.writer_lock(output):
            features = index.open_index(output, value['source'], encoder.identity, encoder.dimension)
            try:
                reused = index.reuse_features(features, value['references'], references,
                                              previous, encoder.identity, encoder.dimension)
                for row, file in index.pending_rows(features, value['references'], references, encoder.dimension):
                    image = decode(file)
                    try:
                        index.save_batch(features, [row], encoder.embed([image]), encoder.dimension)
                    finally:
                        image.close()
                manifest = index.publish(features, value, output, encoder.dimension)
            finally:
                features.close()
        return {'manifest': manifest, 'sha256': refs.sha256(output / 'index.json'), 'reused': reused}

    partial_index = build('partial', partial_snapshot, reference_root)
    assert partial_index['manifest']['downloadComplete'] is False
    try:
        index.load_published_index(ROOT / 'index-partial/index.json')
    except ValueError as error:
        assert 'Full catalog download required' in str(error)
    else:
        raise AssertionError('Partial reference coverage was accepted')
    a = build('a', complete_snapshot, reference_root)
    assert a['manifest']['referenceCount'] == 6 and a['manifest']['allReferencesAvailable'] is True

    changed_cards = [dict(card) for card in cards]
    changed_cards[3]['name'] = 'Synthetic revised metadata'
    reference_b = ROOT / 'references-b'
    (reference_b / 'images').mkdir(parents=True)
    db, _ = refs.open_plan(reference_b, catalog('b', changed_cards))
    try:
        assert refs.reuse_images(db, reference_b, complete_snapshot, reference_root) == 6
    finally:
        db.close()
    snapshot_b = ROOT / 'snapshot-b.json'
    complete_b = snapshot(reference_b, snapshot_b)
    assert complete_b['downloadComplete'] is True and complete_b['counts'] == {'READY': 6}
    b = build('b', snapshot_b, reference_b, ROOT / 'index-a/index.json')
    assert b['reused'] == 6 and b['sha256'] != a['sha256']
    assert b['manifest']['encoder'] == a['manifest']['encoder']
    assert b['manifest']['source']['catalogSha256'] != a['manifest']['source']['catalogSha256']

    # The one-byte damaged specimen is detached; the locked mounted original
    # and every genuine index/reference remain unchanged.
    relative, expected = WEIGHTS['vgg16']
    original = ROOT / 'models' / relative
    damaged = ROOT / 'models-bad' / relative
    damaged.parent.mkdir(parents=True)
    shutil.copyfile(original, damaged)
    with damaged.open('r+b') as stream:
        stream.seek(80)
        byte = stream.read(1)
        stream.seek(80)
        stream.write(bytes([byte[0] ^ 1]))
    assert refs.sha256(original) == expected and refs.sha256(damaged) != expected
    try:
        Encoder('vgg16', ROOT / 'models-bad', 'cpu', threads=1)
    except ValueError as error:
        assert str(error) == 'Model weight digest mismatch'
    else:
        raise AssertionError('Damaged model was accepted')
    result = {'version': 1, 'scope': 'complete disposable synthetic catalogue, not installation/full-catalogue accuracy',
              'cards': cards, 'partial': partial_index, 'a': a, 'b': b,
              'encoder': encoder.identity, 'partialRefused': True, 'damagedModelRefused': True,
              'damagedModelSha256': refs.sha256(damaged), 'damagedModelBytes': damaged.stat().st_size,
              'queries': [str(reference_root / f'images/{card["id"]}-0.jpg') for card in cards[:2]]}
    (ROOT / 'fixture.json').write_text(json.dumps(result, sort_keys=True))
    activate('partial')
    print(json.dumps({'prepared': True, 'catalogRecords': len(cards), 'paperCards': 5,
                      'references': 6, 'partialRefused': True, 'damagedModelRefused': True,
                      'modelSha256': expected, 'indexA': a['sha256'], 'indexB': b['sha256']}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--activate', choices=('partial', 'a', 'b'))
    args = parser.parse_args()
    activate(args.activate) if args.activate else prepare()
