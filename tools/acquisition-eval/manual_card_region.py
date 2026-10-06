"""Explicit user-selected single-card geometry; never detection/count authority.

Coordinates refer to the EXIF-normalized original, not a preview or an existing
detector crop. Invalid input fails; it never silently invokes automatic geometry.
"""
import math

import cv2
import numpy as np

from baseline import order_quad


def _checked_manual_region(image, region):
    if (not isinstance(image, np.ndarray) or image.ndim != 3 or image.shape[2] != 3
            or image.dtype != np.uint8 or min(image.shape[:2]) < 2
            or image.shape[0] * image.shape[1] > 36000000):
        raise ValueError('Invalid source image')
    if (not isinstance(region, dict) or set(region) != {'version', 'quad'}
            or type(region['version']) is not int or region['version'] != 1):
        raise ValueError('Invalid manual region version')
    quad = region['quad']
    if not isinstance(quad, list) or len(quad) != 4:
        raise ValueError('Four manual corners required')
    for point in quad:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError('Invalid manual corner')
        for value in point:
            if (type(value) not in (int, float) or not 0 <= value <= 1
                    or not math.isfinite(value)):
                raise ValueError('Manual corner outside source image')
    height, width = image.shape[:2]
    pixels = np.asarray(quad, dtype=np.float64) * [width - 1, height - 1]
    contour = pixels.astype(np.float32)
    # Require a cyclic convex boundary. Sorting a crossed/mistaken selection
    # into a plausible crop would hide an operator error.
    if not cv2.isContourConvex(contour):
        raise ValueError('Manual corners must form a convex boundary')
    edges = np.linalg.norm(pixels - np.roll(pixels, -1, axis=0), axis=1)
    if float(edges.min()) < 32 or abs(cv2.contourArea(contour)) < 4096:
        raise ValueError('Manual card region too small')
    ordered = order_quad(contour)
    return ordered


def manual_card_source(image, region):
    """Mask/crop a printing query at original resolution; never upsample it.

    Printing's source-resolution guards must not see the canonical 1000x1397
    derivative as if it were original evidence. Return the original-frame offset
    so a caller can restore any reported alignment coordinates.
    """
    ordered = _checked_manual_region(image, region)
    height, width = image.shape[:2]
    low = np.floor(ordered.min(axis=0)).astype(int)
    high = np.ceil(ordered.max(axis=0)).astype(int) + 1
    x0, y0 = max(0, low[0]), max(0, low[1])
    x1, y1 = min(width, high[0]), min(height, high[1])
    source = image[y0:y1, x0:x1].copy()
    mask = np.zeros(source.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, np.rint(ordered - [x0, y0]).astype(np.int32), 255)
    source[mask == 0] = 127
    return source, (int(x0), int(y0))


def manual_card_region(image, region):
    ordered = _checked_manual_region(image, region)
    height, width = image.shape[:2]
    transform = cv2.getPerspectiveTransform(ordered, np.float32(
        [[0, 0], [999, 0], [999, 1396], [0, 1396]]))
    if not np.isfinite(transform).all():
        raise ValueError('Invalid manual region transform')
    crop = cv2.warpPerspective(image, transform, (1000, 1397))
    return crop, {'status': 'PROPOSED', 'method': 'manual-card-region-v1',
                  'quad': ordered.tolist(), 'confidence': None,
                  'sourceFrame': {'width': width, 'height': height},
                  'manualRegion': {'version': 1, 'quad': [list(p) for p in region['quad']]},
                  'boundaryVerified': False}
