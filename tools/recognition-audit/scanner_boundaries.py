"""Private scanner boundary truth and scoring; labels never enter inference."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

VERSION = 'scanner-boundary-audit-v1'
STATUSES = {'PENDING', 'VISIBLE', 'CLIPPED', 'UNCERTAIN'}
MEASURED = {'scanner-card-edges', 'scanner-white-card-edges'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def invalid(value):
        raise ValueError('Nonfinite JSON value: '+value)
    return json.loads(path.read_text(encoding='utf-8-sig'), parse_constant=invalid)


def quad(points, width, height):
    if not isinstance(points, list) or len(points) != 4 or any(not isinstance(p, list) or len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) for v in p) for p in points):
        raise ValueError('Four finite source-pixel corners required')
    q = np.array(points, np.float32)
    if np.any(q < 0) or np.any(q[:, 0] > width-1) or np.any(q[:, 1] > height-1) or not cv2.isContourConvex(q) or cv2.contourArea(q, oriented=True) <= 1:
        raise ValueError('Convex clockwise in-bounds polygon required')
    return q


def validate_truth(truth, photos=None):
    if truth.get('version') != VERSION or not isinstance(truth.get('entries'), list) or not truth['entries']:
        raise ValueError('Nonempty boundary manifest required')
    files, hashes, identities = set(), set(), set()
    for e in truth['entries']:
        name, identity, sha = e.get('file'), e.get('sampleId'), e.get('sha256')
        if not isinstance(name, str) or not name or '/' in name or '\\' in name or ':' in name or name in ('.', '..') or not isinstance(identity, str) or not identity or not isinstance(sha, str) or len(sha) != 64 or any(c not in '0123456789abcdef' for c in sha):
            raise ValueError('Invalid source identity')
        if name in files or sha in hashes or identity in identities:
            raise ValueError('Duplicate file, original or sample identity')
        files.add(name); hashes.add(sha); identities.add(identity)
        w, h = e.get('width'), e.get('height')
        if type(w) is not int or type(h) is not int or min(w, h) < 2 or w*h > 40000000:
            raise ValueError('Invalid source dimensions')
        boundary = e.get('boundary', {})
        status = boundary.get('status')
        if status not in STATUSES:
            raise ValueError('Invalid boundary label status')
        if status == 'VISIBLE':
            quad(boundary.get('quad'), w, h)
        elif boundary.get('quad') is not None:
            raise ValueError('Unobserved boundary must not contain invented corners')
        if status != 'PENDING' and (not isinstance(boundary.get('reviewer'), str) or not boundary['reviewer'].strip() or not isinstance(boundary.get('reviewedAt'), str) or not boundary['reviewedAt'].strip()):
            raise ValueError('Reviewed labels require reviewer and time')
        ids = e.get('expectedScryfallIds')
        if ids is not None and (not isinstance(ids, list) or any(not isinstance(i, str) or not i for i in ids) or len(ids) != len(set(ids))):
            raise ValueError('Invalid independently supplied printing IDs')
        group = e.get('physicalGroup')
        if group is not None and (not isinstance(group, str) or not group.strip()):
            raise ValueError('Invalid physical-copy group')
        if e.get('split') not in ('DEVELOPMENT', 'VALIDATION'):
            raise ValueError('Explicit evaluation split required')
        if photos is not None:
            p = photos / name
            if p.is_symlink() or not p.is_file() or digest(p.read_bytes()) != sha:
                raise ValueError('Original missing or changed: '+name)
            with Image.open(p) as source:
                size = ImageOps.exif_transpose(source).size
            if size != (w, h):
                raise ValueError('Original dimensions changed: '+name)
    return truth


def initialize(photos):
    entries = []
    for p in sorted(photos.iterdir()):
        if p.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp') or not p.is_file():
            continue
        if p.is_symlink():
            raise ValueError('Original symlinks unsupported')
        with Image.open(p) as source:
            w, h = ImageOps.exif_transpose(source).size
        entries.append({'sampleId': p.name, 'file': p.name, 'sha256': digest(p.read_bytes()), 'width': w, 'height': h,
                        'split': 'DEVELOPMENT', 'physicalGroup': None, 'expectedScryfallIds': None,
                        'boundary': {'status': 'PENDING', 'quad': None, 'reviewer': None, 'reviewedAt': None}})
    return validate_truth({'version': VERSION, 'scope': 'Original-pixel manual labels; development until independence is established.', 'entries': entries})


def observations(report):
    if isinstance(report.get('samples'), list):
        return [{'sampleId': r.get('file'), 'sha256': r.get('sha256'), 'variant': 'GEOMETRY',
                 'width': r.get('width'), 'height': r.get('height'), 'geometry': r.get('geometry'), 'printingIds': None,
                 'scannerLayout': None} for r in report['samples']]
    if isinstance(report.get('rounds'), list):
        rows = []
        for r in report['rounds']:
            native = r.get('nativeOCR') or {}
            proposals = (r.get('result') or {}).get('proposals')
            ids = None if proposals is None else [p['card']['id'] for p in proposals]
            if native.get('photoDigest') is not None and native['photoDigest'] != r.get('sha256'):
                raise ValueError('Native OCR original differs from report row')
            rows.append({'sampleId': r.get('sampleId'), 'sha256': r.get('sha256'), 'variant': r.get('variant'),
                         'geometry': native.get('geometry'), 'printingIds': ids, 'scannerLayout': native.get('scannerLayout')})
        return rows
    raise ValueError('Geometry samples or paired native rounds required')


def boundary_metrics(predicted, expected, width, height):
    a, b = quad(predicted, width, height), quad(expected, width, height)
    # Boundary accuracy is independent of the OCR's choice of first corner.
    errors = min((np.linalg.norm(a-np.roll(b, shift, axis=0), axis=1) for shift in range(4)), key=lambda e: float(np.max(e)))
    area_a, area_b = cv2.contourArea(a), cv2.contourArea(b)
    intersection, _ = cv2.intersectConvexConvex(a, b)
    return {'maximumCornerErrorPixels': float(np.max(errors)), 'meanCornerErrorPixels': float(np.mean(errors)),
            'intersectionOverUnion': float(intersection/(area_a+area_b-intersection)), 'observedCardCoverage': float(intersection/area_b)}


def assess_geometry(geometry, label, w, h, tolerance):
    if label['status'] in ('PENDING', 'UNCERTAIN'):
        return {'outcome': label['status'], 'method': (geometry or {}).get('method')}
    g = geometry or {}
    if label['status'] == 'CLIPPED':
        return {'outcome': 'CLIPPING_REFUSED' if g.get('framing') == 'CLIPPED' and g.get('status') != 'PROPOSED' else 'CLIPPING_NOT_REFUSED', 'method': g.get('method')}
    if g.get('status') != 'PROPOSED':
        return {'outcome': 'UNAVAILABLE', 'method': g.get('method')}
    try:
        metrics = boundary_metrics(g.get('quad'), label['quad'], w, h)
    except ValueError:
        return {'outcome': 'INVALID_GEOMETRY', 'method': g.get('method')}
    return {'outcome': 'WITHIN_TOLERANCE' if metrics['maximumCornerErrorPixels'] <= tolerance else 'OUTSIDE_TOLERANCE',
            'method': g.get('method'), 'boundarySource': 'MEASURED' if g.get('method') in MEASURED else 'DECLARED_OR_OTHER', **metrics}


def score(truth, report, tolerance=5.):
    validate_truth(truth)
    if type(tolerance) not in (int, float) or not math.isfinite(tolerance) or tolerance <= 0:
        raise ValueError('Positive explicit corner tolerance required')
    entries = {e['sampleId']: e for e in truth['entries']}
    rows, seen, variants = [], set(), set()
    for observed in observations(report):
        identity, variant = observed['sampleId'], observed['variant']
        if identity not in entries or not isinstance(variant, str) or not variant or (identity, variant) in seen:
            raise ValueError('Unknown or repeated observation identity/variant')
        seen.add((identity, variant)); variants.add(variant)
        e = entries[identity]
        if observed['sha256'] != e['sha256'] or ('width' in observed and (observed['width'], observed['height']) != (e['width'], e['height'])):
            raise ValueError('Observation original/frame differs from truth')
        result = assess_geometry(observed['geometry'], e['boundary'], e['width'], e['height'], tolerance)
        ids, expected = observed['printingIds'], e['expectedScryfallIds']
        exact = None if expected is None or len(expected) != 1 or ids is None else bool(ids and ids[0] in expected)
        rank = None if not expected or ids is None else next((i+1 for i, identity in enumerate(ids) if identity in expected), None)
        row = {'sampleId': e['sampleId'], 'sha256': e['sha256'], 'variant': variant, 'boundary': result, 'exactFirst': exact, 'exactRank': rank}
        layout = observed['scannerLayout'] or {}
        inference = layout.get('inference') or {}
        if inference.get('status') == 'PROPOSED':
            # An inferred region is normalized to ORIGINAL pixels, never the OCR crop.
            region = inference.get('region') or {}
            try:
                points = region['quad']
                if not isinstance(points, list) or len(points) != 4 or any(not isinstance(p, list) or len(p) != 2 or any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in p) for p in points):
                    raise ValueError('Invalid normalized inference')
                pixels = [[x*(e['width']-1), y*(e['height']-1)] for x, y in points]
                row['inferredBoundary'] = assess_geometry({'status': 'PROPOSED', 'method': 'INFERRED', 'quad': pixels}, e['boundary'], e['width'], e['height'], tolerance)
            except (ValueError, KeyError):
                row['inferredBoundary'] = {'outcome': 'INVALID_GEOMETRY', 'method': 'INFERRED'}
        rows.append(row)
    if not variants:
        raise ValueError('Nonempty observations required')
    for variant in sorted(variants):
        for identity in entries:
            if (identity, variant) not in seen:
                rows.append({'sampleId': identity, 'sha256': entries[identity]['sha256'], 'variant': variant,
                             'boundary': {'outcome': 'MISSING_OBSERVATION'}, 'exactFirst': None, 'exactRank': None})
    summaries = {}
    for variant in sorted(variants):
        selected = [r for r in rows if r['variant'] == variant]
        visible = [r for r in selected if entries[r['sampleId']]['boundary']['status'] == 'VISIBLE']
        labelled_printings = [r for r in selected if entries[r['sampleId']]['expectedScryfallIds'] is not None and len(entries[r['sampleId']]['expectedScryfallIds']) == 1]
        joint = [r for r in visible if r in labelled_printings]
        summaries[variant] = {'samples': len(selected), 'visibleBoundaryLabels': len(visible),
            'pendingBoundaryLabels': sum(entries[r['sampleId']]['boundary']['status'] == 'PENDING' for r in selected),
            'uncertainBoundaryLabels': sum(entries[r['sampleId']]['boundary']['status'] == 'UNCERTAIN' for r in selected),
            'clippedBoundaryLabels': sum(entries[r['sampleId']]['boundary']['status'] == 'CLIPPED' for r in selected),
            'withinCornerTolerance': sum(r['boundary']['outcome'] == 'WITHIN_TOLERANCE' for r in visible),
            'boundarySuccessFraction': None if not visible else sum(r['boundary']['outcome'] == 'WITHIN_TOLERANCE' for r in visible)/len(visible),
            'missingObservations': sum(r['boundary']['outcome'] == 'MISSING_OBSERVATION' for r in selected),
            'clippingRefused': sum(r['boundary']['outcome'] == 'CLIPPING_REFUSED' for r in selected),
            'measuredWithinTolerance': sum(r['boundary']['outcome'] == 'WITHIN_TOLERANCE' and r['boundary'].get('boundarySource') == 'MEASURED' for r in visible),
            'inferredWithinTolerance': sum(r.get('inferredBoundary', {}).get('outcome') == 'WITHIN_TOLERANCE' for r in visible),
            'labelledExactPrintings': len(labelled_printings),
            'ambiguousPrintingLabels': sum(bool(entries[r['sampleId']]['expectedScryfallIds']) and len(entries[r['sampleId']]['expectedScryfallIds']) > 1 for r in selected),
            'bothBoundaryAndPrintingLabelled': len(joint),
            'bothBoundaryAndPrintingCorrect': sum(r['exactFirst'] is True and r['boundary']['outcome'] == 'WITHIN_TOLERANCE' for r in joint),
            'exactFirstFraction': None if not labelled_printings else sum(r['exactFirst'] is True for r in labelled_printings)/len(labelled_printings), 'printingPredictionsAvailable': sum(r['exactFirst'] is not None for r in labelled_printings),
            'exactFirst': sum(r['exactFirst'] is True for r in labelled_printings),
            'correctPrintingOutsideBoundaryTolerance': sum(r['exactFirst'] is True and r['boundary']['outcome'] != 'WITHIN_TOLERANCE' for r in visible)}
    return {'version': VERSION, 'cornerTolerancePixels': tolerance, 'independentPopulationAccuracy': False,
            'physicalGroupsKnown': len({e.get('physicalGroup') for e in truth['entries'] if e.get('physicalGroup')}),
            'physicalGroupUnknownSamples': sum(e.get('physicalGroup') is None for e in truth['entries']),
            'summaries': summaries, 'rows': rows,
            'limits': ['Manually supplied labels require review; no automatic truth from recognition', 'Development and correlated physical copies cannot establish99% unseen accuracy', 'All labelled visible boundaries remain in the denominator, including missing/refused predictions', 'Printing correctness never proves the physical boundary; estimated outlines are scored separately']}


def save_new(path, data):
    with path.open('x', encoding='utf-8') as target:
        target.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prepare = commands.add_parser('prepare')
    prepare.add_argument('--photos', type=Path, required=True)
    prepare.add_argument('--output', type=Path, required=True)
    evaluate = commands.add_parser('score')
    for name in ('photos', 'truth', 'observations', 'output'):
        evaluate.add_argument('--'+name, type=Path, required=True)
    evaluate.add_argument('--corner-tolerance', type=float, default=5.)
    args = parser.parse_args()
    if args.command == 'prepare':
        truth = initialize(args.photos)
        page = args.output.with_suffix('.html')
        if args.output.exists() or page.exists():
            raise ValueError('Dedicated new output paths required')
        template = Path(__file__).with_name('scanner_boundary_labeler.html').read_text(encoding='utf-8')
        content = template.replace('__BOUNDARY_MANIFEST__', json.dumps(truth).replace('<', chr(92)+'u003c'))
        save_new(args.output, json.dumps(truth, indent=2)+'\n')
        save_new(page, content)
        print(json.dumps({'prepared': len(truth['entries']), 'labelsPending': len(truth['entries']), 'manifest': str(args.output), 'labeler': str(page)}))
    else:
        truth = validate_truth(read_json(args.truth), args.photos)
        result = score(truth, read_json(args.observations), args.corner_tolerance)
        result['truthSha256'] = digest(args.truth.read_bytes())
        result['observationsSha256'] = digest(args.observations.read_bytes())
        result['scorerSha256'] = digest(Path(__file__).read_bytes())
        save_new(args.output, json.dumps(result, indent=2, allow_nan=False)+'\n')
        print(json.dumps(result['summaries']))


if __name__ == '__main__':
    main()
