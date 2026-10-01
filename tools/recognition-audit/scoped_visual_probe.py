"""Experimental name/partial-ID scope around the unchanged visual algorithm.
Only observed catalog identities are supplied by the parent; never truth labels.
"""
from collections import Counter, OrderedDict
import hashlib, json, struct, sys, time, uuid
sys.path.insert(0,'/app/tools/acquisition-runtime')
sys.path.insert(0,'/eval')
import visual as native
counts=Counter()
def count(module,name,key,measure=None):
 original=getattr(module,name)
 def wrapped(*a,**kw):
  counts[key]+=measure(a) if measure else 1
  return original(*a,**kw)
 setattr(module,name,wrapped)
count(native,'geometry','geometryCalls')
count(native,'features','siftFeatureCalls')
count(native,'match','geometricMatches')
count(native.Encoder,'embed','embeddingImages',lambda a:len(a[1]))
desc=native.descriptor()
base_runtime=native.runtime
full_runtime=None

def scoped(frame):
 global full_runtime
 started=time.monotonic()
 if len(frame)<5:raise ValueError('Scope frame truncated')
 n=struct.unpack('>I',frame[:4])[0]
 if not 0<n<=60000:
  result=native.recognize(frame,desc);counts['fullIndexSearches']+=1
  return {**result,'audit':{'counts':dict(counts),'scopeFaces':desc['referenceCount']}}
 if len(frame)<=4+n:raise ValueError('Scope metadata invalid')
 metadata=json.loads(frame[4:4+n]);ids=metadata.get('candidateScryfallIds');kind=metadata.get('inputKind')
 if set(metadata)=={'inputKind'}:
  result=native.recognize(frame,desc);counts['fullIndexSearches']+=1
  return {**result,'audit':{'counts':dict(counts),'scopeFaces':desc['referenceCount']}}
 if set(metadata)!={'candidateScryfallIds','inputKind'} or kind not in ['PHOTO','CARD_SCAN'] or not isinstance(ids,list) or not 1<=len(ids)<=1000 or len(ids)!=len(set(ids)) or any(str(uuid.UUID(i))!=i for i in ids):raise ValueError('Scope evidence invalid')
 data=frame[4+n:]
 if full_runtime is None:full_runtime=base_runtime(desc)
 encoder,records,matrix=full_runtime
 wanted=set(ids);selected=[i for i,r in enumerate(records) if r['cardId'] in wanted]
 if not selected:
  return {'version':1,'descriptor':desc['digest'],'photoDigest':hashlib.sha256(data).hexdigest(),'candidates':[],'geometricCandidates':[],'automaticAcceptance':False,'scopeStatus':'NO_SUPPORTED_REFERENCES','milliseconds':round((time.monotonic()-started)*1000),'audit':{'counts':dict(counts),'scopeIdentities':len(ids),'scopeFaces':0}}
 # Reuse actual global reference-feature identities while indexing the scoped matrix.
 old_features=native._reference_features
 native._reference_features=OrderedDict((j,old_features[i]) for j,i in enumerate(selected) if i in old_features)
 native.runtime=lambda ignored:(encoder,[records[i] for i in selected],matrix[selected])
 hint=json.dumps({'inputKind':kind}).encode()
 try:result=native.recognize(struct.pack('>I',len(hint))+hint+data,desc)
 finally:
  for j,features in native._reference_features.items():
   i=selected[j];old_features[i]=features;old_features.move_to_end(i)
  while len(old_features)>128:old_features.popitem(last=False)
  native._reference_features=old_features;native.runtime=base_runtime
 counts['scopedIndexSearches']+=1
 return {**result,'milliseconds':round((time.monotonic()-started)*1000),'scopeStatus':'SCOPED','audit':{'counts':dict(counts),'scopeIdentities':len(ids),'scopeFaces':len(selected)}}

def exact(n):
 data=bytearray()
 while len(data)<n:
  part=sys.stdin.buffer.read(n-len(data))
  if not part:raise ValueError('Truncated scope frame')
  data.extend(part)
 return bytes(data)
while True:
 header=sys.stdin.buffer.read(4)
 if not header:break
 if len(header)!=4:raise ValueError('Truncated scope header')
 length=struct.unpack('>I',header)[0]
 if not 0<length<=10*1024*1024+65536:raise ValueError('Scope photo bound exceeded')
 counts.clear();result=scoped(exact(length));print(json.dumps(result,separators=(',',':')),flush=True)
