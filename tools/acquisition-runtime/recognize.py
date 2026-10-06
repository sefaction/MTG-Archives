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

from model_store import model_root
from reading_direction import (reading_text, reading_zones, restore_reading_polygon,
                               TITLE_BOTTOM, FOOTER_TOP, STRIP_GAP)
from photo_input import decode_photo_input
from photo_text import whole_photo_text

ROOT = model_root()
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
               'storeCode': hashlib.sha256(Path(__file__).with_name('model_store.py').read_bytes()).hexdigest(),
               'readingCode': hashlib.sha256(Path(__file__).with_name('reading_direction.py').read_bytes()).hexdigest(),
               'inputCode': hashlib.sha256(Path(__file__).with_name('photo_input.py').read_bytes()).hexdigest(),
               'photoTextCode': hashlib.sha256(Path(__file__).with_name('photo_text.py').read_bytes()).hexdigest(),
               'manualRegionCode': hashlib.sha256(Path('/eval/manual_card_region.py').read_bytes()).hexdigest(),
               'geometry': hashlib.sha256(Path('/eval/baseline.py').read_bytes()).hexdigest()}
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'version': 1, 'digest': digest, 'execution': 'CPU', **payload}


def ocr_engine():
    global _ocr
    if _ocr is None:
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(text_detection_model_name=MODEL_NAMES[0],
                   text_recognition_model_name=MODEL_NAMES[1],
                   text_detection_model_dir=str(ROOT / MODEL_NAMES[0]),
                   text_recognition_model_dir=str(ROOT / MODEL_NAMES[1]),
                   use_doc_orientation_classify=False, use_doc_unwarping=False,
                   use_textline_orientation=False, device='cpu', cpu_threads=1,
                   enable_mkldnn=False)
    return _ocr


def recognize(data, desc):
    data, input_kind, task, manual_region = decode_photo_input(data, return_task=True, return_region=True)
    if not data or len(data) > 10 * 1024 * 1024:
        raise ValueError('Photo exceeds bounds')
    started = time.monotonic()
    # Third-party informational prints go to stderr, never the JSON protocol.
    protocol = sys.__stdout__
    sys.stdout = sys.stderr
    import cv2
    import numpy as np
    from PIL import Image, ImageOps
    sys.path.insert(0, '/eval')
    from baseline import geometry
    with Image.open(io.BytesIO(data)) as source:
        if source.format not in ('JPEG', 'PNG', 'WEBP') or source.width * source.height > 36000000:
            raise ValueError('Unsupported photo')
        if getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Single image required')
        image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
    if task == 'WHOLE_PHOTO_TEXT':
        def completed_reading(reading):
            print(json.dumps({'progress': True, 'descriptor': desc['digest'],
                  'photoDigest': hashlib.sha256(data).hexdigest(), 'recognitionTask': task,
                  'photoText': {'version': 1, 'scope': 'WHOLE_PHOTO',
                                'status': 'PARTIAL', 'readings': [reading]}}), file=protocol, flush=True)
        photo_text = whole_photo_text(image, ocr_engine(),
                                     on_reading=completed_reading if '--stream' in sys.argv else None)
        print(json.dumps({'version': 1, 'descriptor': desc['digest'], 'descriptorDetails': desc,
              'photoDigest': hashlib.sha256(data).hexdigest(), 'recognitionTask': task,
              'geometry': {'status': 'NOT_ATTEMPTED'},
              'text': {'title': [], 'footer': []}, 'lines': [], 'orientations': [],
              'photoText': photo_text, 'milliseconds': round((time.monotonic()-started)*1000),
              'automaticAcceptance': False}), file=protocol, flush=True)
        return
    if manual_region is not None:
        from manual_card_region import manual_card_region
        crop, geometry_evidence = manual_card_region(image, manual_region)
    else:
        crop, geometry_evidence = geometry(image, input_kind)
    if manual_region is None and crop is None and input_kind != 'CARD_SCAN':
        # Contour proposals can change when a near-edge card is sampled after
        # resize. Try bounded quarter turns before asking for a new crop, while
        # keeping any accepted polygon in the original EXIF-normalized frame.
        height, width = image.shape[:2]
        for turns in (1, 2, 3):
            candidate, evidence = geometry(np.rot90(image, -turns).copy())
            if candidate is None:
                continue
            def original_point(point):
                x, y = point
                if turns == 1:
                    return [y, height - 1 - x]
                if turns == 2:
                    return [width - 1 - x, height - 1 - y]
                return [width - 1 - y, x]
            crop = candidate
            geometry_evidence = {**evidence, 'quad': [original_point(p) for p in evidence['quad']],
                                 'inputQuarterTurns': turns}
            break
    proposed = geometry_evidence['status'] == 'PROPOSED'
    if not proposed:
        # No supported crop means no fabricated title/footer coordinates.
        print(json.dumps({'version': 1, 'descriptor': desc['digest'], 'descriptorDetails': desc,
              'photoDigest': hashlib.sha256(data).hexdigest(), 'geometry': geometry_evidence,
              'text': {'title': [], 'footer': []}, 'lines': [], 'orientations': [],
              'milliseconds': round((time.monotonic()-started)*1000),
              'automaticAcceptance': False}), file=protocol, flush=True)
        return
    ocr = ocr_engine()
    # Geometry puts the short edge across the top, leaving two possible reading
    # directions. Keep their evidence separate; the catalog resolver handles
    # agreement/ambiguity. A high OCR score alone does not establish direction.
    orientations = []
    for degrees, oriented in ((0, crop), (180, cv2.rotate(crop, cv2.ROTATE_180))):
        regions = np.concatenate([oriented[:TITLE_BOTTOM],
                                  np.full((STRIP_GAP, 1000, 3), 255, np.uint8),
                                  oriented[FOOTER_TOP:]], axis=0)
        lines = []
        for prediction in ocr.predict(regions):
            for text, score, polygon in zip(prediction['rec_texts'], prediction['rec_scores'], prediction['rec_polys']):
                polygon = restore_reading_polygon(np.asarray(polygon).tolist())
                if polygon is None:
                    continue
                if len(str(text)) > 2000 or len(lines) >= 100:
                    raise ValueError('OCR evidence exceeds bounds')
                lines.append({'text': str(text), 'score': float(score), 'polygon': polygon})
        text = reading_text(lines)
        orientations.append({'rotationDegrees': degrees, 'text': text, 'lines': lines})
    print(json.dumps({'version': 1, 'descriptor': desc['digest'], 'descriptorDetails': desc,
          'photoDigest': hashlib.sha256(data).hexdigest(), 'geometry': geometry_evidence,
          'text': orientations[0]['text'], 'lines': orientations[0]['lines'],
          'readingZones': reading_zones(),
          'orientations': orientations,
          'milliseconds': round((time.monotonic()-started)*1000),
          'automaticAcceptance': False}), file=protocol, flush=True)


def main():
    desc = descriptor()
    if '--describe' in sys.argv:
        print(json.dumps(desc))
        return
    if '--stream' not in sys.argv:
        recognize(sys.stdin.buffer.read(10 * 1024 * 1024 + 1025), desc)
        return
    while True:
        header = sys.stdin.buffer.read(4)
        if not header:
            return
        if len(header) != 4:
            raise ValueError('Incomplete photo frame')
        length = int.from_bytes(header, 'big')
        if not 0 < length <= 10 * 1024 * 1024 + 1024:
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
