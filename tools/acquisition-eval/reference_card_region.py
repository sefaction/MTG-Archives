"""Review-only inferred geometry; recheck actual pixels for physical clipping."""
from baseline import geometry
from manual_card_region import manual_card_region, _checked_manual_region
import math


def scanner_rectangle(quad):
    """Rotation is allowed; camera-like projective deformation is unsupported.

    Source pixel coordinates, matching scannerReferenceRectangle in TypeScript.
    Conservative fitting bounds do not establish a physical-edge probability.
    """
    if len(quad) != 4 or any(len(p) != 2 or not all(math.isfinite(n) for n in p) for p in quad):
        return False
    edges = [(quad[(i+1)%4][0]-p[0], quad[(i+1)%4][1]-p[1]) for i, p in enumerate(quad)]
    lengths = [math.hypot(x, y) for x, y in edges]
    if any(not math.isfinite(n) or n <= 0 for n in lengths):
        return False
    for i, (x, y) in enumerate(edges):
        a, b = edges[(i+1)%4]
        if abs(x*a+y*b)/(lengths[i]*lengths[(i+1)%4]) > .05:
            return False
        c, d = edges[(i+2)%4]
        if abs(x*d-y*c)/(lengths[i]*lengths[(i+2)%4]) > .05:
            return False
        if abs(lengths[i]-lengths[(i+2)%4])/max(lengths[i], lengths[(i+2)%4]) > .05:
            return False
    return True


def reference_card_region(image, region):
    _, direct = geometry(image, 'CARD_SCAN')
    if direct.get('framing') == 'CLIPPED':
        raise ValueError('Reference outline cannot recover physically clipped pixels')
    if direct.get('method') != 'declared-card-scan':
        raise ValueError('Direct scanner geometry is authoritative')
    if not scanner_rectangle(_checked_manual_region(image, region)):
        raise ValueError('Reference outline is not a scanner rectangle')
    crop, evidence = manual_card_region(image, region)
    return crop, {
        'status': 'PROPOSED', 'method': 'reference-anchor-region-v1',
        'quad': evidence['quad'], 'confidence': None,
        'sourceFrame': evidence['sourceFrame'], 'referenceRegion': region,
        'primaryGeometry': direct, 'boundaryVerified': False,
    }
