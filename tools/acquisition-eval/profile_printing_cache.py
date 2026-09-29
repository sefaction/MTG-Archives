"""Read-only public-reference cache qualification; no photos, DB or network."""
import hashlib
import json
import resource
import sys
import time
from pathlib import Path
sys.path[:0]=['/app/tools/acquisition-runtime','/eval']
from printing_worker import descriptor
from printing import PrintingRuntime

def fingerprint(entry):
    image,state,features=entry
    digest=hashlib.sha256()
    for value in (image,features[0],features[3]):
        if value is not None:
            digest.update(str((value.shape,str(value.dtype))).encode())
            digest.update(value.tobytes())
    digest.update(json.dumps([(k.pt,k.size,k.angle,k.response,k.octave,k.class_id) for k in features[2]],separators=(',',':')).encode())
    return {'sha256':digest.hexdigest(),'stamp':state}

def array_bytes(entry):
    arrays=[entry[0],entry[2][0],entry[2][3]]
    return sum(v.nbytes for i,v in enumerate(arrays) if v is not None and all(v is not earlier for earlier in arrays[:i]))

started=time.monotonic()
desc=descriptor()
records=json.loads(desc['file'].read_text())
runtime=PrintingRuntime(records,Path('/visual/references'))
identities=sorted(runtime.records)[:48]
before=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
rows=[]
for identity in identities:
    entry=runtime.reference(identity)
    rows.append({'referenceId':identity,**fingerprint(entry),'arrayBytes':array_bytes(entry)})
retained=sum(array_bytes(e) for e in runtime.cache.values())
count=len(runtime.cache)
after=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
repeat=[{'referenceId':identity,**fingerprint(runtime.reference(identity))} for identity in identities[:5]]
if any(row['sha256']!=again['sha256'] or row['stamp']!=again['stamp'] for row,again in zip(rows,repeat)):
    raise RuntimeError('Re-read changed reference/features/state')
print(json.dumps({'version':1,'scope':'PUBLIC_REFERENCE_ARRAY_CACHE_NOT_PHOTO_THROUGHPUT',
 'runtimeDescriptor':desc['digest'],'referenceManifestSha256':desc['details']['referencesSha256'],
 'references':len(records),'selectedReferences':len(rows),'elapsedMilliseconds':round((time.monotonic()-started)*1000),
 'peakRssBeforeKiB':before,'peakRssAfterKiB':after,'retainedArrayBytes':retained,'retainedReferences':count,
 'repeatFeaturesPreserved':True,'cases':rows}))
