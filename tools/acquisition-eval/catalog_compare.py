"""Offline visual retrieval against an integrity-checked catalog index.

Full coverage is required by default. Partial-library smoke checks require an
explicit flag and stay labelled partial. Ground truth is used only for scoring,
never to choose reference cards, crops, rotations or candidates. No auto-accept.
"""
import argparse
import json
from pathlib import Path
import resource
import time
import cv2
import numpy as np
from PIL import Image
from baseline import geometry
from catalog_references import sha256
from catalog_index import load_published_index
from image_encoder import Encoder, decode
from visual_compare import features, match


def printing_order(face_order, records):
    seen, result = set(), []
    for index in face_order:
        card_id = records[index]['cardId']
        if card_id not in seen:
            result.append(int(index))
            seen.add(card_id)
    return result


def compatible_encoder(reference, query):
    # CPU and CUDA wheel build tags may differ; record both exact identities in
    # the report. Weights, code, transforms and framework release must match.
    def normalized(value):
        result = dict(value)
        for key in ('torch', 'torchvision'):
            result[key] = result[key].split('+', 1)[0]
        return result
    return normalized(reference) == normalized(query)


def score(order, records, entry, distances):
    rank = next((i + 1 for i, index in enumerate(order) if records[index]['cardId'] == entry['scryfallId']), None)
    return {'exactRank': rank, 'nameCorrect': records[order[0]]['name'] == entry['name'],
            'top': [{**{key: records[i][key] for key in ('cardId', 'referenceId', 'name', 'setCode', 'collectorNumber')},
                     'cosineDistance': float(distances[i])} for i in order[:12]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, required=True)
    parser.add_argument('--references', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--photos', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--device', choices=('cpu', 'cuda'), default='cpu')
    parser.add_argument('--allow-partial', action='store_true')
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    index, records, matrix = load_published_index(args.index, args.allow_partial)
    encoder = Encoder(index['encoder']['name'], args.models, args.device, threads=1)
    if not compatible_encoder(index['encoder'], encoder.identity):
        raise ValueError('Query encoder differs from reference encoder')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    args.output.mkdir(parents=True, exist_ok=True)
    results, cached_features = [], {}
    for entry in manifest['entries'][:args.limit or None]:
        path = (args.photos / entry['file']).resolve()
        if not path.is_relative_to(args.photos.resolve()) or sha256(path) != entry['sha256']:
            raise ValueError('Photo path/digest mismatch')
        start = time.monotonic()
        original = cv2.cvtColor(np.asarray(decode(path)), cv2.COLOR_RGB2BGR)
        crop, evidence = geometry(original)
        base = crop if crop is not None else original
        # Four rotations also cover upside-down inputs and failed localization.
        images = [Image.fromarray(cv2.cvtColor(np.ascontiguousarray(np.rot90(base, k)), cv2.COLOR_BGR2RGB)) for k in range(4)]
        embeddings = encoder.embed(images)
        distances = 1 - np.max(matrix @ embeddings.T, axis=1)
        order = printing_order(np.argsort(distances, kind='stable'), records)
        retrieval_ms = round((time.monotonic() - start) * 1000)
        qfeatures = features(original, 2000)
        scored = []
        # Rerank the actual retrieved faces. Preserve alternate faces of a card.
        candidate_faces = np.argsort(distances, kind='stable')[:40]
        for i in candidate_faces:
            i = int(i)
            row = records[i]
            if i not in cached_features:
                reference = (args.references / row['file']).resolve()
                if not reference.is_relative_to(args.references.resolve()) or sha256(reference) != row['sha256']:
                    raise ValueError('Reference image path/digest mismatch')
                cached_features[i] = features(cv2.cvtColor(np.asarray(decode(reference)), cv2.COLOR_RGB2BGR), 1000)
            scored.append((match(qfeatures, cached_features[i]), i))
        sift_order = printing_order([i for _, i in sorted(scored, key=lambda pair: (-pair[0], distances[pair[1]], records[pair[1]]['referenceId']))], records)
        result = {'file': entry['file'], 'expected': entry['scryfallId'],
                  'expectedInIndex': any(r['cardId'] == entry['scryfallId'] for r in records),
                  'geometry': evidence, 'methods': {'visual': score(order, records, entry, distances),
                                                   'visual_then_sift': score(sift_order, records, entry, distances)},
                  'siftInliers': {records[i]['referenceId']: count for count, i in scored},
                  'retrievalMilliseconds': retrieval_ms, 'totalMilliseconds': round((time.monotonic() - start) * 1000),
                  'automaticAcceptance': False}
        results.append(result)
        report = {'version': {'indexSha256': sha256(args.index), 'manifestSha256': sha256(args.manifest),
                              'codeSha256': sha256(Path(__file__)), 'geometrySha256': sha256(Path(__file__).with_name('baseline.py')),
                              'siftSha256': sha256(Path(__file__).with_name('visual_compare.py')),
                              'opencv': cv2.__version__, 'encoder': index['encoder'], 'queryEncoder': encoder.identity},
                  'device': args.device, 'referenceCount': len(records), 'downloadComplete': index['downloadComplete'],
                  'unavailableCount': index['unavailableCount'], 'split': manifest.get('scope', 'development-only'),
                  'peakRssKiB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, 'results': results}
        temporary = args.output / 'report.partial.json'
        temporary.write_text(json.dumps(report, indent=2), encoding='utf-8')
        temporary.replace(args.output / 'report.json')
        print(entry['file'], {name: data['exactRank'] for name, data in result['methods'].items()},
              'ms', result['totalMilliseconds'], flush=True)
    print(json.dumps({name: {'exactTop1': sum(r['methods'][name]['exactRank'] == 1 for r in results),
                            'exactTop12': sum(r['methods'][name]['exactRank'] is not None and r['methods'][name]['exactRank'] <= 12 for r in results)}
                      for name in ('visual', 'visual_then_sift')}), flush=True)


if __name__ == '__main__':
    main()
