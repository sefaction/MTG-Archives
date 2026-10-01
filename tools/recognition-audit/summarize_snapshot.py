"""Summarize a private read-only application snapshot without publishing scans.

Historical worker timings are diagnostics, not controlled paired benchmark results.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import statistics


def quantile(values, p):
    values = sorted(values)
    return values[min(len(values)-1, int((len(values)-1)*p))] if values else None


def summarize(snapshot):
    if snapshot.get('readOnly') is not True:
        raise ValueError('Read-only snapshot provenance required')
    stages = defaultdict(list)
    for job in snapshot['jobMeta']:
        if job['status'] == 'COMPLETE':
            stages[job['stage']].append(job)
    outputs = {item['id']: item.get('output') for item in snapshot['newest']}
    summary = {}
    for stage, jobs in sorted(stages.items()):
        inputs = set()
        signatures = Counter()
        timing = []
        for job in jobs:
            inp = job['input']
            inputs.add((job['artifactId'], job['candidateId'], job['candidateRevision']))
            # Catalog job IDs are scheduling lineage, not new image/model evidence.
            evidence = {k:v for k,v in inp.items() if not k.endswith('JobId')}
            signature = (job['artifactId'], job['candidateId'], job['candidateRevision'],
                         json.dumps(evidence,sort_keys=True,separators=(',',':')))
            signatures[signature] += 1
            output = outputs.get(job['id'])
            if not isinstance(output,dict):
                continue
            native = output.get('printingNative') if 'printing' in stage else output.get('visual') if 'visual' in stage else output.get('native') if stage == 'photo-recognition-v1' else None
            value = native.get('milliseconds') if isinstance(native,dict) else None
            if isinstance(value,(int,float)) and value >= 0:
                timing.append(value)
        summary[stage] = dict(completed=len(jobs),uniqueImageCandidateRevisions=len(inputs),
            distinctSchedulingInputSignatures=len(signatures),
            repeatedSchedulingInputExcludingLineageIds=sum(n-1 for n in signatures.values()),
            latestNativeTimings=dict(n=len(timing),medianMs=statistics.median(timing) if timing else None,
                p95Ms=quantile(timing,.95),maxMs=max(timing) if timing else None))
    digests = Counter(p['digest'] for p in snapshot['photos'])
    return dict(version=1,scope='Historical live snapshot; not benchmark accuracy or paired alternative timing',
        exportedAt=snapshot['exportedAt'],photos=len(snapshot['photos']),uniqueOriginalDigests=len(digests),
        reviewed=sum(c['review'] is not None for c in snapshot['candidates']),
        reviewSources=dict(Counter(c['review']['source'] for c in snapshot['candidates'] if c['review'])),
        stages=summary, preservation=snapshot['invariants'])


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot',type=Path)
    parser.add_argument('output',type=Path)
    args=parser.parse_args()
    raw=args.snapshot.read_bytes()
    snapshot=json.loads(raw.decode('utf-8-sig'))
    summary=summarize(snapshot)
    summary['snapshotSha256']=hashlib.sha256(raw).hexdigest()
    args.output.write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:v for k,v in summary.items() if k not in ('preservation',)},indent=2))