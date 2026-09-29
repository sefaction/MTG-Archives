"""Evaluate printing evidence on candidates selected by actual retrieval.

Labels score outcomes afterward; they never select a registration reference.
This remains an offline diagnostic, not an automatic-confirmation policy.
"""
import argparse
import json
from pathlib import Path
import time
import uuid

import cv2
import numpy as np

from catalog_references import sha256
from catalog_index import load_published_index
from diagnose_printing import decode
from printing_evidence import SIZE, VERSION, register, stamp_evidence, candidate_relation, shared_stamp_evidence


def selected_candidates(report, manifest, method, manifest_digest):
    if report['version']['manifestSha256'] != manifest_digest:
        raise ValueError('Retrieval and scoring manifests differ')
    rows = {}
    for row in report['results']:
        if row['file'] in rows:
            raise ValueError('Duplicate retrieval photo')
        top = row['methods'][method]['top']
        if len(top) > 24:
            raise ValueError('Candidate count exceeds bound')
        seen = set()
        for candidate in top:
            identity = candidate['referenceId']
            card_id, face = identity.rsplit(':', 1)
            if str(uuid.UUID(card_id)) != card_id or not face.isdigit() or candidate['cardId'] != card_id:
                raise ValueError('Invalid retrieved reference identity')
            if identity in seen:
                raise ValueError('Duplicate retrieved reference')
            seen.add(identity)
        # Consume only retrieval's ordered candidates. Expected IDs and names in
        # the report/manifest are intentionally not read here.
        rows[row['file']] = top
    if set(rows) != {entry['file'] for entry in manifest['entries']}:
        raise ValueError('Retrieval photo coverage differs from manifest')
    return rows


def selected_ocr_candidates(report, manifest, snapshot, manifest_digest):
    if (report['manifestSha256'] != manifest_digest or
            report['catalogDigest'] != snapshot['source']['catalogSha256'] or
            report['catalogDigest'] != manifest['catalogCompressedSha256']):
        raise ValueError('OCR retrieval and reference provenance differ')
    faces = {}
    for row in snapshot['references'] + snapshot['unavailable']:
        faces.setdefault(row['cardId'], []).append(row['referenceId'])
    rows = {}
    source_by_file = {row['file']:row for row in report['results']}
    if len(source_by_file) != len(report['results']):
        raise ValueError('Duplicate OCR retrieval photo')
    for entry in manifest['entries']:
        sample = source_by_file.get(entry['file'])
        if sample is None or sample['sha256'] != entry['sha256']:
            raise ValueError('OCR photo coverage/digest differs')
        top = []
        seen = set()
        # Uses resolver proposals, never the expected printing/name/stamp.
        for proposal in sample['result']['proposals']:
            card_id = proposal['card']['id']
            for identity in sorted(faces.get(card_id, [])):
                if identity not in seen:
                    seen.add(identity)
                    top.append({'cardId':card_id, 'referenceId':identity})
        if len(top) > 24:
            raise ValueError('OCR candidate faces exceed bound')
        rows[entry['file']] = top
    if set(source_by_file) != set(rows):
        raise ValueError('OCR retrieval photo coverage differs')
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('manifest', 'photos', 'references', 'snapshot', 'retrieval', 'output'):
        parser.add_argument('--'+name, type=Path, required=True)
    parser.add_argument('--index', type=Path)
    parser.add_argument('--method', choices=('visual', 'visual_then_sift', 'ocr'), default='visual')
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf8'))
    retrieval = json.loads(args.retrieval.read_text(encoding='utf8'))
    snapshot = json.loads(args.snapshot.read_text(encoding='utf8'))
    if not snapshot['downloadComplete']:
        raise ValueError('Reference snapshot incomplete')
    indexed = None
    if args.method == 'ocr':
        selected = selected_ocr_candidates(retrieval, manifest, snapshot, sha256(args.manifest))
    else:
        if not retrieval['downloadComplete'] or args.index is None:
            raise ValueError('Complete visual retrieval index required')
        if sha256(args.index) != retrieval['version']['indexSha256']:
            raise ValueError('Retrieval index changed')
        index, indexed_rows, _ = load_published_index(args.index)
        indexed = {row['referenceId']: row for row in indexed_rows}
        if index['source'] != snapshot['source']:
            raise ValueError('Retrieval and reference catalogs differ')
        selected = selected_candidates(retrieval, manifest, args.method, sha256(args.manifest))
    references = {row['referenceId']: row for row in snapshot['references']}
    annotations_path = Path(__file__).with_name('stamp-reference-labels.json')
    provenance = {'manifestSha256':sha256(args.manifest), 'snapshotSha256':sha256(args.snapshot),
        'retrievalSha256':sha256(args.retrieval), 'codeSha256':sha256(Path(__file__)),
        'printingCodeSha256':sha256(Path(__file__).with_name('printing_evidence.py')),
        'referenceLabelsSha256':sha256(annotations_path)}
    annotations = {row['referenceId']: row for row in json.loads(annotations_path.read_text())['entries']}
    cached = {}

    def reference(identity):
        if identity not in cached:
            row = references.get(identity)
            if row is None:
                raise ValueError('Retrieved reference missing from snapshot')
            if indexed is not None and indexed.get(identity) != row:
                raise ValueError('Retrieved reference changed since indexing')
            path = (args.references / row['file']).resolve()
            if not path.is_relative_to(args.references.resolve()) or sha256(path) != row['sha256']:
                raise ValueError('Reference integrity failure')
            annotation = annotations.get(identity)
            state = annotation['stamp'] if annotation and annotation['sha256'] == row['sha256'] else 'UNKNOWN'
            cached[identity] = (decode(path), state)
        return cached[identity]

    templates = []
    template_ids = ['58f0a2f9-5c5e-4477-ae7e-a52cf5778962:0', 'cfe4a22f-c945-42f4-8b3a-ac3a03ffa015:0']
    for identity in template_ids:
        image, state = reference(identity)
        if state != 'PRESENT':
            raise ValueError('Verified public stamp template unavailable')
        templates.append(cv2.cvtColor(cv2.resize(image, SIZE), cv2.COLOR_BGR2GRAY)[1293:1362, 30:80])

    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for entry in manifest['entries']:
        started = time.monotonic()
        photo_path = (args.photos / entry['file']).resolve()
        if not photo_path.is_relative_to(args.photos.resolve()) or sha256(photo_path) != entry['sha256']:
            raise ValueError('Private input path/digest mismatch')
        photo = decode(photo_path)
        candidates = []
        for rank, candidate in enumerate(selected[entry['file']], 1):
            identity = candidate['referenceId']
            if identity not in references:
                candidates.append({'rank': rank, 'cardId': candidate['cardId'], 'referenceId': identity,
                    'referenceStampState': 'UNKNOWN', 'alignment': {'status':'UNREADABLE'},
                    'stamp': {'status':'UNREADABLE','reason':'REFERENCE_UNAVAILABLE'}, 'relation':'UNRESOLVED'})
                continue
            image, reference_state = reference(identity)
            warped, alignment = register(photo, image)
            evidence = stamp_evidence(warped, alignment, templates, image, reference_state)
            candidates.append({'rank': rank, 'cardId': candidate['cardId'], 'referenceId': identity,
                'referenceStampState': reference_state, 'alignment': alignment, 'stamp': evidence,
                'relation': candidate_relation(evidence['status'], reference_state)})
        # Ground truth is first consulted here, after references/evidence were
        # selected and evaluated. Agreement is never exact-printing confidence.
        observed, conflicting = shared_stamp_evidence(candidates)
        row = {'file': entry['file'], 'sha256': entry['sha256'], 'candidates': candidates,
            'observedStamp': observed, 'conflictingObservations': conflicting,
            'expectedStamp': entry.get('stamp', 'UNLABELLED'),
            'expectedPrintingRetrieved': any(c['cardId'] == entry['scryfallId'] for c in candidates),
            'expectedPrintingContradicted': any(c['cardId'] == entry['scryfallId'] and
                c['relation'] == 'CONTRADICTS_STAMP_STATE' for c in candidates),
            'automaticAcceptance': False, 'elapsedMs': round((time.monotonic()-started)*1000)}
        results.append(row)
        report = {'method': VERSION, 'candidateSource': args.method, 'referenceCount': len(references),
            'downloadComplete': True, **provenance, 'results': results,
            'scope': 'Actual retrieved candidates; development samples; no automatic exact-print decision.'}
        temporary = args.output / 'report.partial.json'
        temporary.write_text(json.dumps(report, indent=2), encoding='utf8')
        temporary.replace(args.output / 'report.json')
        print(json.dumps({k: row[k] for k in ('file', 'observedStamp', 'conflictingObservations',
            'expectedPrintingRetrieved', 'expectedPrintingContradicted', 'elapsedMs')}), flush=True)


if __name__ == '__main__':
    main()
