"""Offline audit adapter: count calls around unchanged native runtime functions."""
import argparse, contextlib, io, json, struct, sys, time
from collections import Counter
from pathlib import Path
sys.path.insert(0, '/app/tools/acquisition-runtime')
sys.path.insert(0, '/eval')
parser=argparse.ArgumentParser()
parser.add_argument('--stage', choices=['ocr','visual','printing'], required=True)
args=parser.parse_args()
counts=Counter()
def counted(module, name, key, measure=None):
 original=getattr(module,name)
 def wrapped(*values, **options):
  counts[key]+=measure(values) if measure else 1
  return original(*values,**options)
 setattr(module,name,wrapped)
if args.stage=='ocr':
 sys.argv.append('--stream')
 import recognize as native
 import baseline
 counted(baseline,'geometry','geometryCalls')
 original_engine=native.ocr_engine
 def engine():
  ocr=original_engine()
  if not getattr(ocr,'_audit_wrapped',False):
   original_predict=ocr.predict
   def predict(*a,**kw):
    counts['ocrPredictions']+=1
    return original_predict(*a,**kw)
   ocr.predict=predict
   ocr._audit_wrapped=True
  return ocr
 native.ocr_engine=engine
elif args.stage=='visual':
 import visual as native
 counted(native,'geometry','geometryCalls')
 counted(native,'features','siftFeatureCalls')
 counted(native,'match','geometricMatches')
 counted(native.Encoder,'embed','embeddingImages',lambda a:len(a[1]))
else:
 import printing_worker as native
 import printing
 counted(printing,'register','printingRegistrations')
 counted(printing,'registration_features','registrationFeatureCalls')
 counted(printing,'stamp_evidence','stampChecks')
 original_ref=printing.PrintingRuntime.reference
 def reference(self,identity):
  counts['referenceCacheHits' if identity in self.cache else 'referenceCacheMisses']+=1
  return original_ref(self,identity)
 printing.PrintingRuntime.reference=reference
startup=time.monotonic()
desc=native.descriptor()
startup_ms=round((time.monotonic()-startup)*1000)
protocol=sys.__stdout__
def exact(n):
 data=bytearray()
 while len(data)<n:
  part=sys.stdin.buffer.read(n-len(data))
  if not part:raise ValueError('Truncated audit frame')
  data.extend(part)
 return bytes(data)
while True:
 header=sys.stdin.buffer.read(4)
 if not header:break
 if len(header)!=4:raise ValueError('Truncated audit header')
 length=struct.unpack('>I',header)[0]
 if not 0<length<=10*1024*1024+65536:raise ValueError('Bound exceeded')
 frame=exact(length);counts.clear();started=time.monotonic()
 if args.stage=='ocr':
  class Capture:
   buffer=''
   final=None
   def write(self,text):
    self.buffer+=text
    while '\n' in self.buffer:
     line,self.buffer=self.buffer.split('\n',1)
     value=json.loads(line)
     if value.get('progress'):
      value['audit']={'counts':dict(counts),'probeMilliseconds':round((time.monotonic()-started)*1000)}
      print(json.dumps(value,separators=(',',':')),file=protocol,flush=True)
     else:self.final=value
   def flush(self):pass
  capture=Capture();sys.__stdout__=capture
  try:native.recognize(frame,desc)
  finally:sys.__stdout__=protocol;sys.stdout=protocol
  result=capture.final
  if result is None:raise ValueError("No final OCR evidence")
 elif args.stage=='visual':
  result=native.recognize(frame,desc)
  counts['fullIndexSearches']+=1
 else:result=native.request(frame,desc)
 result['audit']={'counts':dict(counts),'probeMilliseconds':round((time.monotonic()-started)*1000),'descriptorStartupMilliseconds':startup_ms}
 print(json.dumps(result,separators=(',',':')),file=protocol,flush=True)
