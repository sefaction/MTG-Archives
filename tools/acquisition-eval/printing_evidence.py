"""Experimental reference-guided registration and localized stamp evidence.

This module does not choose a card or authorize Inventory/automatic confirmation.
Its caller supplies a candidate reference. Matching artwork establishes alignment,
not exact printing. Failed matching or unreadable pixels never imply no stamp.
"""
import cv2
import numpy as np

VERSION = 'registered-printing-evidence-dev4'
SIZE = (1000, 1397)
STAMP_SEARCH = (15, 1260, 100, 1375)
STAMP_CORE = (35, 1303, 74, 1353)


def region(image, bounds):
    x1, y1, x2, y2 = bounds
    return image[y1:y2, x1:x2]


def gray(image):
    return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image


def registration_features(photo, is_reference=False):
    """Same SIFT input used by registration; reusable within a bounded job."""
    cv2.setNumThreads(1)
    scale = 1. if is_reference else min(1., 1800 / max(photo.shape[:2]))
    image = cv2.resize(photo, SIZE) if is_reference else cv2.resize(photo, None, fx=scale, fy=scale)
    keypoints, descriptors = cv2.SIFT_create(nfeatures=2500).detectAndCompute(gray(image), None)
    return image, scale, keypoints, descriptors


def register(photo, reference, query_features=None, reference_features=None):
    """Align the whole printed card using distributed SIFT/RANSAC evidence."""
    cv2.setNumThreads(1)
    reference, _, rk, rd = reference_features if reference_features is not None else registration_features(reference, True)
    query, scale, qk, qd = query_features if query_features is not None else registration_features(photo)
    failure = lambda reason, **extra: (None, {'status': 'UNREADABLE', 'reason': reason, **extra})
    if rd is None or qd is None or min(len(rd), len(qd)) < 16:
        return failure('INSUFFICIENT_FEATURES')
    pairs = cv2.BFMatcher().knnMatch(rd, qd, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < .70*p[1].distance]
    if len(good) < 16:
        return failure('INSUFFICIENT_MATCHES', matches=len(good))
    src = np.float32([rk[m.queryIdx].pt for m in good])
    dst = np.float32([qk[m.trainIdx].pt for m in good])
    cv2.setRNGSeed(20260928)
    matrix, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.)
    if matrix is None or mask is None or not np.isfinite(matrix).all():
        return failure('NO_VALID_TRANSFORM')
    keep = mask.ravel().astype(bool)
    count = int(keep.sum())
    support = abs(cv2.contourArea(cv2.convexHull(src[keep]))) / (SIZE[0]*SIZE[1]) if count >= 3 else 0
    metrics = {'matches': len(good), 'inliers': count, 'supportFraction': float(support)}
    if count < 16 or count / len(good) < .35 or support < .25:
        return failure('WEAK_OR_LOCALIZED_SUPPORT', **metrics)
    corners = np.float32([[0, 0], [999, 0], [999, 1396], [0, 1396]])
    projected = cv2.perspectiveTransform(corners[None], matrix)[0]
    if not np.isfinite(projected).all() or not cv2.isContourConvex(projected):
        return failure('INVALID_CARD_OUTLINE', **metrics)
    # Preserve orientation and reject mirror/reflection fits.
    if cv2.contourArea(projected, oriented=True) <= 0:
        return failure('MIRRORED_OUTLINE', **metrics)
    error = np.linalg.norm(cv2.perspectiveTransform(src[keep][None], matrix)[0]-dst[keep], axis=1)
    metrics['medianReprojectionPixels'] = float(np.median(error))
    metrics['quad'] = (projected / scale).tolist()
    metrics['sourceCardWidth'] = float(min(np.linalg.norm(projected[1]-projected[0]), np.linalg.norm(projected[2]-projected[3])) / scale)
    # White padding never counts as observed pixels. Retain a separate visibility
    # mask so clipped borders/stamp zones are explicitly unreadable.
    inverse = np.linalg.inv(matrix)
    warped = cv2.warpPerspective(query, inverse, SIZE)
    visibility = cv2.warpPerspective(np.full(query.shape[:2], 255, np.uint8), inverse, SIZE)
    metrics['stampVisible'] = bool(np.min(region(visibility, STAMP_SEARCH)) >= 254)
    metrics['footerVisible'] = bool(np.min(region(visibility, (100, 1230, 860, 1375))) >= 254)
    return warped, {'status': 'ALIGNED', **metrics}


def template_score(image, template):
    search = gray(region(image, STAMP_SEARCH))
    best = {'score': -1., 'box': None}
    templates = template if isinstance(template, (list, tuple)) else [template]
    for index, item in enumerate(templates):
        for factor in (.75, .875, 1., 1.125, 1.25):
            resized = cv2.resize(item, None, fx=factor, fy=factor)
            h, w = resized.shape
            if h > search.shape[0] or w > search.shape[1] or np.std(resized) < 5:
                continue
            scores = cv2.matchTemplate(search, resized, cv2.TM_CCOEFF_NORMED)
            _, value, _, point = cv2.minMaxLoc(scores)
            if value > best['score']:
                best = {'score': float(value), 'templateIndex': index, 'box': [point[0]+STAMP_SEARCH[0], point[1]+STAMP_SEARCH[1], w, h]}
    return best


def stamp_evidence(warped, alignment, template, reference, reference_stamp_state='UNKNOWN'):
    result = {'status': 'UNREADABLE', 'reason': 'ALIGNMENT_UNAVAILABLE', 'version': VERSION}
    if warped is None or alignment.get('status') != 'ALIGNED':
        return result
    if not alignment['stampVisible'] or not alignment.get('footerVisible', False) or alignment['sourceCardWidth'] < 500:
        return {**result, 'reason': 'STAMP_CLIPPED_OR_TOO_SMALL'}
    match = template_score(warped, template)
    footer = gray(warped)[1240:1360, 110:850]
    sharpness = float(cv2.Laplacian(footer, cv2.CV_32F).var())
    core = gray(region(warped, STAMP_CORE))
    contrast = float(np.percentile(core, 95)-np.percentile(core, 10))
    result.update({'template': match, 'footerSharpness': sharpness, 'coreContrast': contrast})
    if sharpness < 25:
        return {**result, 'reason': 'FOOTER_BLURRED'}
    if match['score'] >= .78 and contrast >= 45:
        return {**result, 'status': 'PRESENT', 'reason': 'LOCAL_SYMBOL_SHAPE'}
    if reference_stamp_state != 'ABSENT':
        return {**result, 'reason': 'NO_VERIFIED_UNSTAMPED_REFERENCE'}
    # Absence needs positive evidence that a visible, readable region agrees
    # with an unstamped reference, including any printed footer text. A low
    # template score alone is inadequate. Both mean and upper-tail residuals
    # prevent a small bright/obscured area being diluted by the black border.
    ref = cv2.resize(reference, SIZE)
    refcore = gray(region(ref, STAMP_CORE))
    refmatch = template_score(ref, template)
    # Refine tiny registration and lighting differences using adjacent printing,
    # excluding the stamp area. Never fit these nuisance variables on the symbol:
    # doing so could explain away the very mark we are trying to distinguish.
    refgray, querygray = gray(ref), gray(warped)
    target = refgray[1250:1360, 120:500]
    search = querygray[1244:1366, 114:506]
    if np.std(target) < 10 or np.std(search) < 10:
        return {**result, 'reason': 'NO_LOCAL_PRINTING_SUPPORT'}
    _, correlation, _, offset = cv2.minMaxLoc(cv2.matchTemplate(search, target, cv2.TM_CCOEFF_NORMED))
    dx, dy = offset[0]-6, offset[1]-6
    result['localPrintingCorrelation'] = float(correlation)
    result['localOffset'] = [dx, dy]
    if correlation < .8:
        return {**result, 'reason': 'LOCAL_PRINTING_DIFFERS'}
    observed = querygray[1250+dy:1360+dy, 120+dx:500+dx].astype(np.float32)
    centered = observed-observed.mean()
    gain = float(np.sum(centered*(target.astype(np.float32)-target.mean())) / max(float(np.sum(centered**2)), 1))
    bias = float(target.mean()-gain*observed.mean())
    if not .5 <= gain <= 2.5 or abs(bias) > 100:
        return {**result, 'reason': 'LOCAL_LIGHTING_UNCERTAIN'}
    alignedcore = querygray[1303+dy:1353+dy, 35+dx:74+dx].astype(np.float32)
    difference = np.abs(alignedcore*gain+bias-refcore.astype(np.float32))
    residual = float(np.mean(difference))
    result['referenceResidual'] = residual
    result['referenceResidual95'] = float(np.percentile(difference, 95))
    if (match['score'] < .45 and refmatch['score'] < .45
            and np.median(core) < 100 and np.median(refcore) < 100
            and residual < 12 and result['referenceResidual95'] < 35):
        return {**result, 'status': 'ABSENT', 'reason': 'VISIBLE_REGION_AGREES_WITH_REFERENCE'}
    return {**result, 'reason': 'LOCAL_EVIDENCE_INCONCLUSIVE'}


def candidate_relation(observed, reference_state):
    if observed == 'UNREADABLE' or reference_state == 'UNKNOWN':
        return 'UNRESOLVED'
    return 'AGREES_WITH_STAMP_STATE' if observed == reference_state else 'CONTRADICTS_STAMP_STATE'


def shared_stamp_evidence(candidates):
    """Transfer an observation only between the same visible physical outlines.

    Runtime and offline diagnostics share this policy; no label is consulted.
    Conflicting positive/negative observations make every relation unresolved.
    """
    sources = [c for c in candidates if c['stamp']['status'] in ('PRESENT', 'ABSENT')]
    states = {c['stamp']['status'] for c in sources}
    observed = next(iter(states)) if len(states) == 1 else 'UNREADABLE'
    for candidate in candidates:
        candidate['localRelation'] = candidate['relation']
        if observed == 'UNREADABLE':
            candidate['relation'] = 'UNRESOLVED'
            continue
        alignment = candidate['alignment']
        if (candidate['relation'] != 'UNRESOLVED' or alignment.get('status') != 'ALIGNED' or
                not alignment.get('stampVisible') or not alignment.get('footerVisible') or
                alignment.get('sourceCardWidth', 0) < 500 or 'quad' not in alignment):
            continue
        supporting = []
        for source in sources:
            support = source['alignment']
            if 'quad' not in support:
                continue
            discrepancy = float(np.max(np.linalg.norm(np.asarray(alignment['quad']) -
                np.asarray(support['quad']), axis=1)))
            if discrepancy <= .01 * min(alignment['sourceCardWidth'], support['sourceCardWidth']):
                supporting.append(source['referenceId'])
        if supporting:
            candidate['relation'] = candidate_relation(observed, candidate['referenceStampState'])
            candidate['sharedObservationSources'] = supporting
    return observed, len(states) > 1
