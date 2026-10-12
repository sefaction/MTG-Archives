"""Read-only replay of saved observed candidates; labels enter scoring only."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import time

import cv2
import numpy as np
from PIL import Image, ImageOps
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
from printing import PrintingRuntime
from printing_evidence import register, registration_features
from printing_details import printing_detail_evidence


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def contained(root, relative):
    result = (root / relative).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError('Input escaped its supplied root')
    return result


def candidate_cost(rows):
    # Frozen diagnostic rule, not an application policy or calibrated threshold.
    # Require every detail window and artwork-derived lighting support.
    if len(rows) != 5 or any(r['status'] != 'MEASURED' or 'colorResidual' not in r for r in rows):
        return None
    return round(sum(r['colorResidual'] for r in rows)/len(rows), 6)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('manifest','observations','originals','index','references','output'):
        parser.add_argument('--'+flag, type=Path, required=True)
    args = parser.parse_args()
    for directory in (args.observations,args.originals,args.references):
        if not directory.is_dir():
            raise ValueError('Required read-only input directory missing')
    args.output.mkdir(parents=True,exist_ok=True)
    manifest_hash = digest(args.manifest)
    manifest = json.loads(args.manifest.read_text())
    index_hash = digest(args.index)
    index = json.loads(args.index.read_text())
    if index.get('format') != 1 or not index.get('downloadComplete'):
        raise ValueError('Completed immutable reference manifest required')
    record_entry = index['files']['references.json']
    records_file = contained(args.index.parent,record_entry['path'])
    if digest(records_file) != record_entry['sha256']:
        raise ValueError('Reference manifest integrity changed')
    records = json.loads(records_file.read_text())
    if len(records) != index['referenceCount']:
        raise ValueError('Reference count changed')
    runtime = PrintingRuntime(records,args.references)
    results = []
    started = time.monotonic()
    entries = [r for r in manifest['entries'] if r.get('category','PLAYABLE') == 'PLAYABLE'
               and r.get('labelStatus','IDENTIFIED') == 'IDENTIFIED']
    if not entries:
        raise ValueError('No labelled playable development inputs')
    cv2.setNumThreads(1)
    for number, entry in enumerate(entries):
        photo_path = contained(args.originals,entry['file'])
        if digest(photo_path) != entry['sha256']:
            raise ValueError('Original digest changed')
        observation_file = contained(args.observations,entry['file']+'.json')
        observation = json.loads(observation_file.read_text())
        saved = observation['output']
        if saved['printingNative']['photoDigest'] != entry['sha256']:
            raise ValueError('Saved observation original differs')
        candidates = saved['printingNative']['candidates']
        if len(candidates) > 24 or len(set(c['referenceId'] for c in candidates)) != len(candidates):
            raise ValueError('Saved candidates exceed bounds or repeat')
        # Truth is not passed into runtime.reference/register/detail measurement.
        with Image.open(photo_path) as source:
            photo = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')),cv2.COLOR_RGB2BGR)
        query_features = registration_features(photo)
        details = []
        for candidate in candidates:
            identity = candidate['referenceId']
            if identity not in runtime.records:
                details.append({'scryfallId':candidate['scryfallId'],'referenceId':identity,
                                'status':'REFERENCE_UNAVAILABLE','cost':None})
                continue
            if runtime.records[identity]['cardId'] != candidate['scryfallId']:
                raise ValueError('Saved reference identity differs')
            reference, _, reference_features = runtime.reference(identity)
            warped, alignment, visibility = register(photo,reference,query_features,reference_features,
                                                       return_visibility=True)
            evidence = printing_detail_evidence(warped,alignment,reference,visibility)
            details.append({'scryfallId':candidate['scryfallId'],'referenceId':identity,
                            'alignment':alignment['status'],'details':evidence,
                            'cost':candidate_cost(evidence['regions'])})
        local_ids = {c['id']:c['scryfallId'] for c in observation['proposedCards'] if c.get('scryfallId')}
        ordered = [local_ids.get(p['card']['id']) for p in saved['proposals']['proposals']]
        if any(i is None for i in ordered):
            raise ValueError('Proposal identity mapping incomplete')
        by_card = {}
        for row in details:
            if row['cost'] is not None:
                by_card[row['scryfallId']] = min(by_card.get(row['scryfallId'],float('inf')),row['cost'])
        # This diagnostic exposes unsafe rankings as failures rather than
        # silently selecting whichever regional rule matches the labels.
        ranked = sorted(ordered,key=lambda i:by_card.get(i,float('inf')))
        expected = entry['scryfallId']
        results.append({'file':entry['file'],'sha256':entry['sha256'],
                        'allProposalsCompared':bool(ordered) and all(i in by_card for i in ordered),
                        'uncomparedProposals':sum(i not in by_card for i in ordered),
                        'baselineCorrect':bool(ordered and ordered[0] == expected),
                        'diagnosticCorrect':bool(ranked and ranked[0] == expected),
                        'expectedOffered':expected in ordered,'expectedScryfallId':expected,
                        'baselineOrder':ordered,'diagnosticOrder':ranked,'candidates':details,
                        'observationSha256':digest(observation_file)})
        if digest(photo_path) != entry['sha256']:
            raise ValueError('Original changed during inference')
        progress={'complete':False,'completed':number+1,'total':len(entries),'elapsedSeconds':round(time.monotonic()-started,2)}
        (args.output/'progress.json').write_text(json.dumps(progress))
        if (number+1)%10 == 0:
            print(json.dumps(progress),flush=True)
    if digest(args.manifest) != manifest_hash or digest(args.index) != index_hash or digest(records_file) != record_entry['sha256']:
        raise ValueError('Frozen inputs changed during replay')
    summary={'complete':True,'samples':len(results),'sourceEntries':len(manifest['entries']),
             'developmentOnly':True,'physicalCopyIndependence':'UNKNOWN','automaticAcceptance':False,
             'baselineCorrect':sum(r['baselineCorrect'] for r in results),
             'diagnosticCorrect':sum(r['diagnosticCorrect'] for r in results),
             'pairedGains':sum(not r['baselineCorrect'] and r['diagnosticCorrect'] for r in results),
             'pairedLosses':sum(r['baselineCorrect'] and not r['diagnosticCorrect'] for r in results),
             'allProposalsCompared':sum(r['allProposalsCompared'] for r in results),
             'uncomparedProposalChanges':sum(r['baselineOrder'] != r['diagnosticOrder'] and not r['allProposalsCompared'] for r in results),
             'diagnosticPolicy':'REJECTED_UNCALIBRATED_GLOBAL_RESIDUAL',
             'expectedOffered':sum(r['expectedOffered'] for r in results),
             'measuredFaces':sum(c.get('cost') is not None for r in results for c in r['candidates']),
             'elapsedSeconds':round(time.monotonic()-started,3),
             'manifestSha256':manifest_hash,'indexSha256':index_hash,'referencesSha256':record_entry['sha256'],
             'detailCodeSha256':digest(Path(__file__).with_name('printing_details.py')),
             'registrationCodeSha256':digest(Path(__file__).with_name('printing_evidence.py'))}
    (args.output/'results.json').write_text(json.dumps({'summary':summary,'results':results},indent=2))
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary),flush=True)


if __name__ == '__main__':
    main()
