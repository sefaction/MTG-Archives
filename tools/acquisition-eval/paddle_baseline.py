"""Optional CPU challenger. Bootstrap models without mounting private photos first."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import resource
import time

import cv2
import numpy as np
from PIL import Image, ImageOps
from paddleocr import PaddleOCR
from baseline import geometry

parser = argparse.ArgumentParser()
parser.add_argument('--bootstrap', action='store_true')
parser.add_argument('--input', type=Path)
parser.add_argument('--output', type=Path)
parser.add_argument('--regions', action='store_true')
args = parser.parse_args()
started = time.monotonic()
local_models = {} if args.bootstrap else {
    'text_detection_model_dir':'/models/official_models/PP-OCRv5_mobile_det',
    'text_recognition_model_dir':'/models/official_models/en_PP-OCRv5_mobile_rec',
}
ocr = PaddleOCR(text_detection_model_name='PP-OCRv5_mobile_det',
                text_recognition_model_name='en_PP-OCRv5_mobile_rec',
                use_doc_orientation_classify=False, use_doc_unwarping=False,
                use_textline_orientation=False, device='cpu', cpu_threads=1,
                enable_mkldnn=False, **local_models)
startup = round((time.monotonic()-started)*1000)
if args.bootstrap:
    print(json.dumps({'bootstrap': True, 'startupMilliseconds': startup}))
    raise SystemExit(0)
if not args.input or not args.output or args.input.resolve() == args.output.resolve():
    raise ValueError('Separate input and output required')
paths = sorted(args.input.glob('*.jpg'))
if not paths:
    raise ValueError('Requested private corpus is missing')
args.output.mkdir(parents=True, exist_ok=True)
results = []
for path in paths:
    start = time.monotonic()
    with Image.open(path) as source:
        if source.width*source.height>36000000 or path.stat().st_size>10*1024*1024:
            raise ValueError('Input exceeds bounds')
        image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')),cv2.COLOR_RGB2BGR)
    crop, evidence = geometry(image)
    if crop is None:
        crop = cv2.resize(image, None, fx=1600/max(image.shape[:2]), fy=1600/max(image.shape[:2]))
    ocr_image = crop
    if args.regions and evidence['status'] == 'PROPOSED':
        # Keep high-resolution title/footer evidence, omit art/rules OCR work.
        ocr_image = np.concatenate([crop[:250], np.full((20,1000,3),255,np.uint8),crop[1210:]],axis=0)
    predictions = list(ocr.predict(ocr_image))
    lines = []
    for prediction in predictions:
        for text, score, polygon in zip(prediction['rec_texts'], prediction['rec_scores'], prediction['rec_polys']):
            polygon = np.asarray(polygon).copy()
            if args.regions and evidence['status'] == 'PROPOSED' and polygon[:,1].min() >= 270:
                polygon[:,1] += 940
            lines.append({'text':str(text),'score':float(score),'polygon':polygon.tolist()})
    result = {'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
              'geometry':evidence,'lines':lines,'milliseconds':round((time.monotonic()-start)*1000),
              'automaticAcceptance':False}
    results.append(result)
    print(json.dumps({'file':path.name,'milliseconds':result['milliseconds'],'lines':len(lines)}),flush=True)
models = {str(p.relative_to('/models')):hashlib.sha256(p.read_bytes()).hexdigest()
          for p in Path('/models/official_models').rglob('*') if p.is_file() and '.cache' not in p.parts}
report = {'split':'development-only','execution':'CPU','cpuThreads':1,'regionsOnly':args.regions,'opencvRuntime':cv2.__version__,'startupMilliseconds':startup,
          'versions':{name:importlib.metadata.version(name) for name in ['paddlepaddle','paddleocr','paddlex','opencv-python-headless']},
          'codeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'geometryCodeSha256':hashlib.sha256(Path('/eval/baseline.py').read_bytes()).hexdigest(),
          'models':models,'peakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'results':results}
(args.output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
