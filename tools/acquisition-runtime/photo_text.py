"""Unlocalized whole-photo text, used only for review candidate search."""
import time
import cv2
import numpy as np
from reading_direction import grouped_text


def whole_photo_text(image, ocr, *, clock=time.monotonic):
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
        for prediction in ocr.predict(np.rot90(small, -turn).copy()):
            for text, polygon in zip(prediction['rec_texts'], prediction['rec_polys']):
                if len(lines) >= 50:
                    truncated = True
                    break
                if len(str(text)) > 2000:
                    truncated = True
                lines.append({'text': str(text)[:2000], 'polygon': np.asarray(polygon).tolist()})
        words = grouped_text(lines)
        truncated = truncated or len(words) > 12 or any(len(word) > 200 for word in words)
        readings.append({'rotationDegrees': turn * 90,
                         'text': [word[:200] for word in words[:12]], 'truncated': truncated})
        partial = partial or truncated
    return {'version': 1, 'scope': 'WHOLE_PHOTO',
            'status': 'PARTIAL' if partial else 'COMPLETE', 'readings': readings}
