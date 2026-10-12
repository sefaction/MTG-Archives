"""Review-only inferred geometry; recheck actual pixels for physical clipping."""
from baseline import geometry
from manual_card_region import manual_card_region


def reference_card_region(image, region):
    _, direct = geometry(image, 'CARD_SCAN')
    if direct.get('framing') == 'CLIPPED':
        raise ValueError('Reference outline cannot recover physically clipped pixels')
    crop, evidence = manual_card_region(image, region)
    if direct.get('method') != 'declared-card-scan':
        raise ValueError('Direct scanner geometry is authoritative')
    return crop, {
        'status': 'PROPOSED', 'method': 'reference-anchor-region-v1',
        'quad': evidence['quad'], 'confidence': None,
        'sourceFrame': evidence['sourceFrame'], 'referenceRegion': region,
        'primaryGeometry': direct, 'boundaryVerified': False,
    }
