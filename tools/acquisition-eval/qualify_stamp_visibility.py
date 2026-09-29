"""Replay preserved, actual runtime candidate sets through the printing backend.

Private inputs supply original bytes, immutable prior native observations, and
labels for scoring only. Labels never select a reference or enter observe().
This is development stage qualification, not new retrieval/held-out accuracy.
"""
import argparse
import hashlib
import json
import importlib.util
from pathlib import Path
import sys
import time
import cv2
import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
import printing
from printing import PrintingRuntime
from printing_evidence import VERSION


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('inputs', 'photos', 'snapshot', 'references', 'output', 'baseline-runtime', 'baseline-policy'):
        parser.add_argument('--'+name, required=True, type=Path)
    args = parser.parse_args()
    inputs = json.loads(args.inputs.read_text())
    snapshot = json.loads(args.snapshot.read_text())
    if not snapshot['downloadComplete']:
        raise ValueError('Reference snapshot incomplete')
    runtime = PrintingRuntime(snapshot['references'], args.references,
        Path(__file__).with_name('stamp-reference-labels.json'))
    policy = load_module('baseline_printing_evidence', args.baseline_policy)
    baseline_module = load_module('baseline_printing_runtime', args.baseline_runtime)
    for name in ('register', 'registration_features', 'stamp_evidence', 'candidate_relation', 'shared_stamp_evidence'):
        setattr(baseline_module, name, getattr(policy, name))
    baseline = baseline_module.PrintingRuntime(snapshot['references'], args.references,
        Path(__file__).with_name('stamp-reference-labels.json'))
    rows = []
    identities = {'inputsSha256':digest(args.inputs), 'snapshotSha256':digest(args.snapshot),
        'codeSha256':digest(Path(__file__).with_name('printing_evidence.py')),
        'runtimeSha256':digest(Path(printing.__file__)),
        'baselineRuntimeSha256':digest(args.baseline_runtime), 'baselinePolicySha256':digest(args.baseline_policy)}
    if args.output.exists():
        saved = json.loads(args.output.read_text())
        if any(saved.get(k) != v for k,v in identities.items()):
            raise ValueError('Resumable replay inputs/code differ')
        rows = saved['results']
        if [r['sample'] for r in rows] != [e['sample'] for e in inputs['entries'][:len(rows)]]:
            raise ValueError('Resumable replay prefix differs')
    started = time.monotonic()
    for entry in inputs['entries'][len(rows):]:
        relative = Path(entry['file'])
        path = (args.photos / relative).resolve()
        if not path.is_relative_to(args.photos.resolve()) or digest(path) != entry['sha256']:
            raise ValueError('Private original path/digest differs')
        with Image.open(path) as image:
            photo = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(image).convert('RGB')), cv2.COLOR_RGB2BGR)
        candidates = [{'scryfallId':c['scryfallId'], 'referenceId':c['referenceId']} for c in entry['before']['candidates']]
        begin = time.monotonic()
        before = baseline.observe(photo, candidates)
        if before['observedStamp'] != entry['before']['observedStamp']:
            raise ValueError('Fresh baseline differs from preserved stamp outcome')
        after = runtime.observe(photo, candidates)
        # Exclude only the visibility flag, whose semantics this batch changes.
        for old, new in zip(before['candidates'], after['candidates']):
            old_fit = {k:v for k,v in old['alignment'].items() if k != 'stampVisible'}
            new_fit = {k:v for k,v in new['alignment'].items() if k != 'stampVisible'}
            if old_fit != new_fit:
                mismatch = {'sample':entry['sample'], 'referenceId':old['referenceId'],
                    'before':old_fit, 'after':new_fit}
                args.output.with_name('registration-mismatch.json').write_text(json.dumps(mismatch,indent=2)+'\n')
                raise ValueError('Registration changed beyond stamp visibility; private mismatch retained')
        row = {'sample':entry['sample'], 'sha256':entry['sha256'],
            'label':entry['stamp'], 'before':before['observedStamp'], 'after':after['observedStamp'],
            'conflicting':after['conflictingObservations'], 'automaticAcceptance':after['automaticAcceptance'],
            'elapsedMs':round((time.monotonic()-begin)*1000), 'native':after}
        rows.append(row)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        report = {'version':1, 'method':VERSION, 'scope':'PRESERVED_DEVELOPMENT_ACTUAL_CANDIDATES_NOT_HELD_OUT',
            **identities,
            'registrationComparison':'EXACT_FRESH_BASELINE_FIELDS_EXCEPT_STAMP_VISIBILITY',
            'elapsedMs':round((time.monotonic()-started)*1000), 'completed':len(rows),
            'total':len(inputs['entries']), 'results':rows}
        temporary = args.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(report, indent=2)+'\n')
        temporary.replace(args.output)
        print(json.dumps({k:v for k,v in row.items() if k!='native'}), flush=True)


if __name__ == '__main__':
    main()
