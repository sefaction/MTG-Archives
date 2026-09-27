"""One bounded private-photo CPU attempt; stdin bytes, stdout JSON evidence.

The parent kills this whole process on timeout/abort. No database, file output,
remote model fallback, printing decision, or Inventory authority lives here.
"""
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path('/models/official_models')
MODEL_NAMES = ('PP-OCRv5_mobile_det', 'en_PP-OCRv5_mobile_rec')
_ocr = None


def descriptor():
    files = {}
    for name in MODEL_NAMES:
        directory = ROOT / name
        if not directory.is_dir():
            raise ValueError('Required offline model unavailable')
        for p in sorted(directory.rglob('*')):
            if p.is_symlink():
                raise ValueError('Model symlinks are not supported')
            if p.is_file() and '.cache' not in p.parts:
                files[str(p.relative_to(ROOT))] = hashlib.sha256(p.read_bytes()).hexdigest()
        if not (directory / 'inference.pdiparams').is_file():
            raise ValueError('Required offline weights unavailable')
    payload = {'models': files,
               'runtime': {name: importlib.metadata.version(name) for name in
                           ('paddlepaddle', 'paddleocr', 'paddlex', 'numpy', 'pillow', 'opencv-contrib-python')},
               'code': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'geometry': hashlib.sha256(Path('/eval/baseline.py').read_bytes()).hexdigest()}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'version': 1, 'digest': digest, 'execution': 'CPU', **payload}


def recognize(data, desc):
    global _ocr
    if not data or len(data) > 10 * 1024 * 1024:
        raise ValueError('Photo exceeds bounds')
    started = time.monotonic()
    # Third-party informational prints go to stderr, never the JSON protocol.
    protocol = sys.__stdout__
    sys.stdout = sys.stderr
    import cv2
    import numpy as np
    from PIL import Image, ImageOps
    from paddleocr import PaddleOCR
    sys.path.insert(0, '/eval')
    from baseline import geometry
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in ('JPEG', 'PNG', 'WEBP') or source.width * source.height > 36000000:
            raise ValueError('Unsupported photo')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Single image required')
        image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
    crop, geometry_evidence = geometry(image)
    proposed = geometry_evidence['status'] == 'PROPOSED'
    if not proposed:
        # No supported crop means no fabricated title/footer coordinates.
        print(json.dumps({'version': 1, 'descriptor': desc['digest'], 'descriptorDetails': desc,
              'photoDigest': hashlib.sha256(data).hexdigest(), 'geometry': geometry_evidence,
              'text': {'title': [], 'footer': []}, 'lines': [],
              'milliseconds': round((time.monotonic()-started)*1000),
              'automaticAcceptance': False}), file=protocol, flush=True)
        return
    if _ocr is None:
        _ocr = PaddleOCR(text_detection_model_name=MODEL_NAMES[0],
                   text_recognition_model_name=MODEL_NAMES[1],
                   text_detection_model_dir=str(ROOT / MODEL_NAMES[0]),
                   text_recognition_model_dir=str(ROOT / MODEL_NAMES[1]),
                   use_doc_orientation_classify=False, use_doc_unwarping=False,
                   use_textline_orientation=False, device='cpu', cpu_threads=1,
                   enable_mkldnn=False)
    regions = np.concatenate([crop[:250], np.full((20, 1000, 3), 255, np.uint8), crop[1210:]], axis=0)
    lines = []
    for prediction in _ocr.predict(regions):
        for text, score, polygon in zip(prediction['rec_texts'], prediction['rec_scores'], prediction['rec_polys']):
            polygon = np.asarray(polygon).copy()
            if polygon[:, 1].min() >= 270:
                polygon[:, 1] += 940
            if len(str(text)) > 2000 or len(lines) >= 100:
                raise ValueError('OCR evidence exceeds bounds')
            lines.append({'text': str(text), 'score': float(score), 'polygon': polygon.tolist()})
    text = {'title': [line['text'] for line in lines if max(p[1] for p in line['polygon']) < 260],
            'footer': [line['text'] for line in lines if min(p[1] for p in line['polygon']) > 1220]}
    print(json.dumps({'version': 1, 'descriptor': desc['digest'], 'descriptorDetails': desc,
          'photoDigest': hashlib.sha256(data).hexdigest(), 'geometry': geometry_evidence,
          'text': text, 'lines': lines,
          'milliseconds': round((time.monotonic()-started)*1000),
          'automaticAcceptance': False}), file=protocol, flush=True)


def main():
    desc = descriptor()
    if '--describe' in sys.argv:
        print(json.dumps(desc))
        return
    if '--stream' not in sys.argv:
        recognize(sys.stdin.buffer.read(10 * 1024 * 1024 + 1), desc)
        return
    while True:
        header = sys.stdin.buffer.read(4)
        if not header:
            return
        if len(header) != 4:
            raise ValueError('Incomplete photo frame')
        length = int.from_bytes(header, 'big')
        if not 0 < length <= 10 * 1024 * 1024:
            raise ValueError('Photo frame exceeds bounds')
        data = sys.stdin.buffer.read(length)
        if len(data) != length:
            raise ValueError('Incomplete photo frame')
        recognize(data, desc)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not print private OCR/body/path data to Docker logs.
        print('Private recognition attempt failed', file=sys.stderr)
        raise SystemExit(1)
