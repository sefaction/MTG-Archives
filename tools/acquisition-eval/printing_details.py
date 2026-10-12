"""Reference-aligned printing detail measurements, independent of stamp policy.

Reference selection belongs to the caller's observed proposals. These measurements
are not calibrated printing probabilities and cannot authorize stock/acceptance.
Lighting is fitted on artwork, never on the detail being compared.
"""
import cv2
import numpy as np
from printing_evidence import SIZE

VERSION = 'registered-printing-details-v1'
# Bounded standard-card comparison windows, not semantic symbol recognition.
REGIONS = {
    'TYPE_LINE': (80, 745, 950, 885),
    'SET_SYMBOL_AREA': (790, 745, 960, 900),
    'FOOTER': (110, 1230, 910, 1375),
    'LEFT_FRAME': (8, 260, 85, 1210),
    'RIGHT_FRAME': (915, 260, 992, 1210),
}
ARTWORK = (160, 300, 840, 690)
LOCAL_SHIFT = 4


def patch(image, bounds):
    x0, y0, x1, y1 = bounds
    return image[y0:y1, x0:x1]


def _lighting(query, reference, visibility):
    observed = patch(query, ARTWORK).astype(np.float32)
    expected = patch(reference, ARTWORK).astype(np.float32)
    if np.min(patch(visibility, ARTWORK)) < 254:
        return None
    gains, biases = [], []
    for channel in range(3):
        x, y = observed[:, :, channel], expected[:, :, channel]
        if min(float(x.std()), float(y.std())) < 10:
            return None
        centered = x-x.mean()
        gain = float(np.sum(centered*(y-y.mean())) / np.sum(centered**2))
        bias = float(y.mean()-gain*x.mean())
        if not .5 <= gain <= 2 or abs(bias) > 90:
            return None
        gains.append(gain)
        biases.append(bias)
    corrected = np.clip(observed*np.array(gains)+np.array(biases), 0, 255)
    # Poor artwork agreement cannot supply a nuisance fit for the other regions.
    if float(np.mean(np.abs(corrected-expected))) > 25:
        return None
    return np.array(gains), np.array(biases)


def printing_detail_evidence(warped, alignment, reference, visibility):
    failure = lambda reason: {'version': VERSION, 'regions': [
        {'region': name, 'bounds': list(bounds), 'status': 'UNREADABLE', 'reason': reason}
        for name, bounds in REGIONS.items()]}
    if warped is None or alignment.get('status') != 'ALIGNED':
        return failure('ALIGNMENT_UNAVAILABLE')
    if (warped.shape != (SIZE[1], SIZE[0], 3) or visibility is None or
            visibility.shape != warped.shape[:2]):
        return failure('VISIBILITY_UNAVAILABLE')
    if alignment.get('sourceCardWidth', 0) < 500:
        return failure('SOURCE_TOO_SMALL')
    ref = cv2.resize(reference, SIZE)
    query_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    lighting = _lighting(warped, ref, visibility)
    rows = []
    for name, bounds in REGIONS.items():
        row = {'region': name, 'bounds': list(bounds), 'status': 'UNREADABLE'}
        x0, y0, x1, y1 = bounds
        search_bounds = (x0-LOCAL_SHIFT, y0-LOCAL_SHIFT, x1+LOCAL_SHIFT, y1+LOCAL_SHIFT)
        # Every tested displacement must be observed. Warped padding is not ink.
        if np.min(patch(visibility, search_bounds)) < 254:
            rows.append({**row, 'reason': 'REGION_CLIPPED'})
            continue
        observed, expected = patch(query_gray, bounds), patch(ref_gray, bounds)
        sharpness = float(cv2.Laplacian(observed, cv2.CV_32F).var())
        reference_sharpness = float(cv2.Laplacian(expected, cv2.CV_32F).var())
        row.update({'sourceSharpness': round(sharpness, 4),
                    'referenceSharpness': round(reference_sharpness, 4)})
        # Blank reference windows have no geometric local-offset evidence; a
        # color comparison still reports observable border/treatment differences.
        textured = min(float(observed.std()), float(expected.std())) >= 5
        dx, dy, correlation = 0, 0, None
        if textured:
            scores = cv2.matchTemplate(patch(query_gray, search_bounds), expected,
                                       cv2.TM_CCOEFF_NORMED)
            _, value, _, offset = cv2.minMaxLoc(scores)
            if np.isfinite(value):
                dx, dy = offset[0]-LOCAL_SHIFT, offset[1]-LOCAL_SHIFT
                correlation = round(float(np.clip(value, -1, 1)), 6)
        row['localOffset'] = [dx, dy]
        if correlation is not None:
            row['correlation'] = correlation
        if textured and sharpness < 25:
            rows.append({**row, 'reason': 'DETAIL_BLURRED'})
            continue
        shifted = patch(warped, (x0+dx, y0+dy, x1+dx, y1+dy)).astype(np.float32)
        if lighting is not None:
            gains, biases = lighting
            difference = np.abs(np.clip(shifted*gains+biases, 0, 255)-patch(ref, bounds))
            row['colorResidual'] = round(float(difference.mean()), 4)
            row['colorResidual95'] = round(float(np.percentile(difference, 95)), 4)
        if correlation is None and lighting is None:
            rows.append({**row, 'reason': 'NO_LOCAL_DETAIL_OR_LIGHTING_SUPPORT'})
            continue
        rows.append({**row, 'status': 'MEASURED', 'reason': 'VISIBLE_REFERENCE_COMPARISON'})
    return {'version': VERSION, 'regions': rows}
