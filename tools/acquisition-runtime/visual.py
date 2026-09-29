"""Private, offline CPU candidate retrieval. Never confirms a printing.

Uses the same geometry and frozen encoder/index as the catalog evaluation.
Public references/models/indexes are persistent read-only mounts. The only
private input is a bounded photo frame on stdin; no database or network access.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import time
from collections import OrderedDict

sys.path.insert(0, '/eval')
import cv2
import numpy as np
from PIL import Image, ImageOps
from baseline import geometry
from catalog_index import load_published_index
from catalog_references import sha256
from image_encoder import Encoder
from visual_compare import features, match

INDEX = Path('/visual/index/index.json')
if '--manifest' in sys.argv:
    name = sys.argv[sys.argv.index('--manifest') + 1]
    if not re.fullmatch(r'(index|manifest-[a-f0-9]{64})\.json', name):
        raise ValueError('Invalid immutable manifest name')
    INDEX = INDEX.with_name(name)
MODELS = Path('/visual/models')
REFERENCES = Path('/visual/references')
MAX_BYTES = 10 * 1024 * 1024
_runtime = None
_reference_features = OrderedDict()


def descriptor():
    before = sha256(INDEX)
    index, _, matrix = load_published_index(INDEX)
    del matrix
    if sha256(INDEX) != before:
        raise ValueError('Index changed during validation')
    # The full loader subsequently verifies the immutable generation's files.
    # A partial download is never a production-query index.
    if not index.get('downloadComplete') or index.get('referenceCount', 0) < 1:
        raise ValueError('Complete published visual index required')
    details = {
        'version': 'visual-cpu-candidates-v1', 'execution': 'CPU',
        'indexSha256': before, 'encoder': index['encoder'],
        'referenceCount': index['referenceCount'],
        'unavailableCount': index['unavailableCount'],
        'catalogSha256': index['source']['catalogSha256'],
        'codeSha256': sha256(Path(__file__)),
        'geometrySha256': sha256(Path('/eval/baseline.py')),
        'loaderSha256': sha256(Path('/eval/catalog_index.py')),
        'geometricSha256': sha256(Path('/eval/visual_compare.py')),
        'geometricFaces': 40,
        'opencv': cv2.__version__, 'rotations': [0, 90, 180, 270],
    }
    archive = INDEX.with_name(f'manifest-{before}.json')
    immutable = archive.name if archive.is_file() and sha256(archive) == before else INDEX.name
    return {**details, 'manifest': immutable, 'digest': hashlib.sha256(json.dumps(
        details, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def normalized_encoder(value):
    result = dict(value)
    for key in ('torch', 'torchvision'):
        result[key] = result[key].split('+', 1)[0]
    return result


def runtime(desc):
    global _runtime
    if _runtime is None:
        index, records, matrix = load_published_index(INDEX)
        if sha256(INDEX) != desc['indexSha256']:
            raise ValueError('Visual index generation changed; reopen worker')
        encoder = Encoder(index['encoder']['name'], MODELS, 'cpu', threads=1)
        if normalized_encoder(index['encoder']) != normalized_encoder(encoder.identity):
            raise ValueError('Query encoder differs from indexed encoder')
        _runtime = encoder, records, matrix
    return _runtime


def recognize(data, desc):
    if not 0 < len(data) <= MAX_BYTES:
        raise ValueError('Invalid photo size')
    started = time.monotonic()
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in ('JPEG', 'PNG', 'WEBP') or source.width * source.height > 36000000:
            raise ValueError('Unsupported photo')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Single image required')
        original = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
    crop, evidence = geometry(original)
    base = crop if crop is not None else original
    encoder, records, matrix = runtime(desc)
    images = [Image.fromarray(cv2.cvtColor(np.ascontiguousarray(
        np.rot90(base, k)), cv2.COLOR_BGR2RGB)) for k in range(4)]
    similarities = matrix @ encoder.embed(images).T
    rotations = np.argmax(similarities, axis=1)
    distances = 1 - np.max(similarities, axis=1)
    def candidate(i):
        row = records[i]
        return {
            'scryfallId': row['cardId'], 'referenceId': row['referenceId'],
            'name': row['name'], 'setCode': row['setCode'],
            'collectorNumber': row['collectorNumber'],
            'distance': float(distances[i]), 'rotationDegrees': int(rotations[i]) * 90,
        }
    seen, candidates = set(), []
    ordered = np.argsort(distances, kind='stable')
    for value in ordered:
        i = int(value)
        row = records[i]
        if row['cardId'] in seen:
            continue
        seen.add(row['cardId'])
        candidates.append(candidate(i))
        if len(candidates) == 12:
            break
    query = features(original, 2000)
    scored = []
    for value in ordered[:40]:
        i = int(value)
        row = records[i]
        if i not in _reference_features:
            path = (REFERENCES / row['file']).resolve()
            if not path.is_relative_to(REFERENCES.resolve()) or sha256(path) != row['sha256']:
                raise ValueError('Public reference path/digest mismatch')
            with Image.open(path) as source:
                reference = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
            _reference_features[i] = features(reference, 1000)
            if len(_reference_features) > 128:
                _reference_features.popitem(last=False)
        _reference_features.move_to_end(i)
        scored.append((match(query, _reference_features[i]), i))
    seen, geometric = set(), []
    for inliers, i in sorted(scored, key=lambda pair: (-pair[0], distances[pair[1]], records[pair[1]]['referenceId'])):
        if records[i]['cardId'] in seen:
            continue
        seen.add(records[i]['cardId'])
        geometric.append({**candidate(i), 'inliers': int(inliers)})
        if len(geometric) == 12:
            break
    return {
        'version': 1, 'descriptor': desc['digest'],
        'photoDigest': hashlib.sha256(data).hexdigest(),
        'referenceCount': desc['referenceCount'],
        'unavailableCount': desc['unavailableCount'],
        'geometry': evidence, 'inputRegion': 'CARD' if crop is not None else 'WHOLE_PHOTO',
        'candidates': candidates,
        'geometricCandidates': geometric,
        'milliseconds': round((time.monotonic() - started) * 1000),
        'automaticAcceptance': False,
    }


def main():
    desc = descriptor()
    if '--describe' in sys.argv:
        print(json.dumps(desc))
        return
    if '--stream' not in sys.argv:
        print(json.dumps(recognize(sys.stdin.buffer.read(MAX_BYTES + 1), desc)))
        return
    while True:
        header = sys.stdin.buffer.read(4)
        if not header:
            return
        if len(header) != 4:
            raise ValueError('Incomplete photo frame')
        length = int.from_bytes(header, 'big')
        if not 0 < length <= MAX_BYTES:
            raise ValueError('Photo frame exceeds bounds')
        data = sys.stdin.buffer.read(length)
        if len(data) != length:
            raise ValueError('Incomplete photo frame')
        print(json.dumps(recognize(data, desc)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Private visual retrieval attempt failed', file=sys.stderr)
        raise SystemExit(1)
