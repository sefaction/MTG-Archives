"""Whole-photo name hints and optional observed scanner footer positions."""
import time
import cv2
import numpy as np
from reading_direction import grouped_text


def scanner_source(lines, shape, resized_shape):
    """Keep actual lower-left OCR boxes; no inferred card edge or extra OCR."""
    height, width = shape[:2]
    if not .62 <= width / height <= .80:
        return None
    sx, sy = width / resized_shape[1], height / resized_shape[0]
    observed = []
    for line in lines:
        points = np.asarray(line['polygon'], dtype=float)
        if points.shape != (4, 2) or not np.isfinite(points).all():
            continue
        points = points * [sx, sy]
        left, top = points.min(axis=0)
        right, bottom = points.max(axis=0)
        if (0 <= left < right <= width * .60 and height * .80 <= top < bottom <= height
                and bottom - top <= height * .025 and len(line['text']) <= 200):
            observed.append({'text': line['text'], 'polygon': points.tolist()})
    if not observed or len(observed) > 12:
        return None
    return {'scope': 'SCANNER_SOURCE_PIXELS', 'width': width, 'height': height,
            'boundaryVerified': False, 'lines': observed}


def whole_photo_text(image, ocr, *, clock=time.monotonic, on_reading=None, input_kind='PHOTO'):
    started = clock()
    scale = min(1, 1600 / max(image.shape[:2]))
    small = cv2.resize(image, None, fx=scale, fy=scale)
    turns = (0, 2, 1, 3) if image.shape[0] >= image.shape[1] else (1, 3, 0, 2)
    readings = []
    partial = False
    for turn in turns:
        if clock() - started >= 25:
            partial = True
            break
        lines = []
        truncated = False
        oriented = np.rot90(small, -turn).copy()
        for prediction in ocr.predict(oriented):
            for text, polygon in zip(prediction['rec_texts'], prediction['rec_polys']):
                if len(lines) >= 50:
                    truncated = True
                    break
                if len(str(text)) > 2000:
                    truncated = True
                lines.append({'text': str(text)[:2000], 'polygon': np.asarray(polygon).tolist()})
        source_complete = not truncated
        words = grouped_text(lines)
        truncated = truncated or len(words) > 12 or any(len(word) > 200 for word in words)
        reading = {'rotationDegrees': turn * 90,
                   'text': [word[:200] for word in words[:12]], 'truncated': truncated}
        if input_kind == 'CARD_SCAN' and source_complete:
            shape = image.shape if turn % 2 == 0 else (image.shape[1], image.shape[0])
            source = scanner_source(lines, shape, oriented.shape)
            if source is not None:
                reading['scannerSource'] = source
        readings.append(reading)
        if on_reading is not None:
            on_reading(reading)
        partial = partial or truncated
    return {'version': 1, 'scope': 'WHOLE_PHOTO',
            'status': 'PARTIAL' if partial else 'COMPLETE', 'readings': readings}
