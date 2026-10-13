"""Reusable scanner layout from a trustworthy outline and observed printed anchors.

No printing IDs, card names, expected labels or invented border pixels participate.
A result is an inferred outline, never a measured physical boundary.
"""
import math
import re
import cv2
import numpy as np
from reference_card_region import scanner_rectangle

POLICY = 'scanner-layout-anchor-v1'
MARKER_POLICY = 'scanner-layout-marker-v2'
MARKER = re.compile(r'^\s*([A-Z0-9]{2,8})(?:\s*[·•*]\s*(ZHS|ZHT|EN|FR|DE|IT|ES|PT|JA|KO|RU)(?=\b|[A-Z])|\s+(ZHS|ZHT|EN|FR|DE|IT|ES|PT|JA|KO|RU)\b)', re.I)
TRUSTED_METHODS = {'manual-card-region-v1', 'scanner-card-edges', 'scanner-white-card-edges'}
CANONICAL = np.float32([[0, 0], [999, 0], [999, 1396], [0, 1396]])


def _checked_quad(quad, width, height):
    points = np.asarray(quad, np.float64)
    if points.shape != (4, 2) or not np.isfinite(points).all():
        raise ValueError('Invalid scanner layout corners')
    if np.any(points < 0) or np.any(points[:, 0] > width-1) or np.any(points[:, 1] > height-1):
        raise ValueError('Scanner layout exceeds observed pixels')
    if not cv2.isContourConvex(points.astype(np.float32)) or not scanner_rectangle(points.tolist()):
        raise ValueError('Scanner layout is not a rectangle')
    lengths = np.linalg.norm(points - np.roll(points, -1, axis=0), axis=1)
    if min(lengths) < 500 or not .68 <= lengths[0]/lengths[1] <= .75:
        raise ValueError('Unsupported scanner card dimensions')
    return points


def _anchor_point(line):
    if not isinstance(line, dict) or type(line.get('score')) not in (int, float) or not math.isfinite(line['score']) or not .75 <= line['score'] <= 1:
        return None
    try:
        polygon = np.asarray(line.get('polygon', []), np.float64)
    except (ValueError, TypeError):
        return None
    if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
        return None
    if np.any(polygon < 0) or np.any(polygon[:, 0] > 999) or np.any(polygon[:, 1] > 1396):
        return None
    return [float(polygon[:, 0].min()), float(polygon[:, 1].max())]


def printed_anchors(observation):
    """Positions only: names and collector values are not stored in a layout."""
    collectors = {}
    lines = observation.get('identifierLines', []) + observation.get('footerLines', []) + observation.get('lines', [])
    for line in lines:
        point = _anchor_point(line)
        text = line.get('text', '') if isinstance(line, dict) else ''
        if not point or point[1] < 1270 or point[0] > 400 or not isinstance(text, str):
            continue
        rarity = re.match(r'^\s*[CUMRLT]\s*(\d{1,5}[a-z★†]?)(?![\w★†])', text, re.I)
        fraction = re.match(r'^\s*(\d{1,5}[a-z★†]?)\s*/\s*\d{2,5}\b', text, re.I)
        match = rarity or fraction
        if not match or re.search(r'wizards|copyright|©|\b(19|20)\d{2}\s*[-–]', text, re.I):
            continue
        key = match[1].lower().lstrip('0') or '0'
        previous = collectors.get(key)
        if previous is None or line['score'] > previous[0]:
            collectors[key] = (line['score'], point)
    if len(collectors) != 1:
        return None
    result = {'COLLECTOR': next(iter(collectors.values()))[1]}
    titles = []
    for line in observation.get('lines', []):
        point = _anchor_point(line)
        text = line.get('text', '') if isinstance(line, dict) else ''
        if point and point[1] <= 250 and point[0] < 800 and isinstance(text, str) and len(text.strip()) >= 3:
            titles.append(point)
    if titles:
        result['TITLE'] = min(titles, key=lambda point: (point[1], point[0]))
    return result


def marker_anchors(observation):
    markers = {}
    for line in observation.get('identifierLines', []) + observation.get('footerLines', []) + observation.get('lines', []):
        point = _anchor_point(line)
        text = line.get('text', '') if isinstance(line, dict) else ''
        if not point or point[1] < 1270 or point[0] > 400 or not isinstance(text, str) or re.search(r'wizards|copyright|©|\b(19|20)\d{2}\s*[-–]', text, re.I):
            continue
        match = MARKER.match(text)
        if match is None:
            continue
        key = (match[1].upper(), (match[2] or match[3]).upper())
        if key not in markers or line['score'] > markers[key][0]:
            markers[key] = (line['score'], point)
    titles = []
    for line in observation.get('lines', []):
        point = _anchor_point(line)
        text = line.get('text', '') if isinstance(line, dict) else ''
        if point and point[1] <= 250 and point[0] < 800 and isinstance(text, str) and len(text.strip()) >= 3:
            titles.append(point)
    if len(markers) != 1 or not titles:
        return None
    return {'SET_LANGUAGE': next(iter(markers.values()))[1], 'TITLE': min(titles, key=lambda p: (p[1], p[0]))}


def make_scanner_layout(image, geometry, observations, photo_digest, input_kind='CARD_SCAN'):
    if input_kind != 'CARD_SCAN' or geometry.get('status') != 'PROPOSED' or geometry.get('method') not in TRUSTED_METHODS or geometry.get('framing') == 'CLIPPED':
        return None
    if not isinstance(photo_digest, str) or not re.fullmatch('[a-f0-9]{64}', photo_digest):
        raise ValueError('Layout source digest required')
    height, width = image.shape[:2]
    quad = _checked_quad(geometry.get('quad', []), width, height)
    if geometry.get('method') == 'manual-card-region-v1':
        from baseline import geometry as detect_geometry
        _, direct = detect_geometry(image, 'CARD_SCAN')
        if direct.get('framing') == 'CLIPPED':
            return None
    candidates = [(o, printed_anchors(o)) for o in observations if o.get('rotationDegrees') in (0, 180)]
    candidates = [(o, anchors) for o, anchors in candidates if anchors is not None]
    version, policy = 1, POLICY
    if not candidates:
        candidates = [(o, marker_anchors(o)) for o in observations if o.get('rotationDegrees') in (0, 180)]
        candidates = [(o, anchors) for o, anchors in candidates if anchors is not None]
        version, policy = 2, MARKER_POLICY
    if len(candidates) != 1:
        return None
    _, anchors = candidates[0]
    return {'version': version, 'policy': policy, 'sourceDigest': photo_digest,
            'sourceMethod': geometry['method'], 'frame': {'width': width, 'height': height},
            'region': {'version': 1, 'quad': (quad/[width-1, height-1]).tolist()},
            'anchors': [{'kind': kind, 'point': [point[0]/999, point[1]/1396]} for kind, point in anchors.items()]}


def infer_scanner_layout(image, direct, observations, profile, input_kind='CARD_SCAN', *, observation_quad=None):
    marker_profile = isinstance(profile, dict) and type(profile.get('version')) is int and profile.get('version') == 2 and profile.get('policy') == MARKER_POLICY
    policy = MARKER_POLICY if marker_profile else POLICY
    kinds = ('SET_LANGUAGE', 'TITLE') if marker_profile else ('COLLECTOR', 'TITLE')
    def reject(reason):
        return {'status': 'REJECTED', 'reason': reason, 'policy': policy}
    if input_kind != 'CARD_SCAN':
        return reject('SCANNER_ONLY')
    if direct.get('framing') == 'CLIPPED':
        return reject('PHYSICAL_CLIPPING')
    if direct.get('status') != 'PROPOSED' or direct.get('method') != 'declared-card-scan':
        return reject('DIRECT_GEOMETRY_AUTHORITATIVE')
    height, width = image.shape[:2]
    if not isinstance(profile, dict):
        return reject('INVALID_PROFILE')
    if not marker_profile and (profile.get('policy') != POLICY or type(profile.get('version')) is not int or profile.get('version') != 1):
        return reject('UNSUPPORTED_POLICY')
    source_frame = profile.get('frame', {})
    source_width, source_height = source_frame.get('width'), source_frame.get('height')
    # Same scanner pixel scale; small vertical auto-crop changes do not resize
    # the physical card. Two anchors must corroborate any changed frame.
    if (type(source_width) is not int or type(source_height) is not int
            or source_width != width or source_height < 2
            or abs(height-source_height) > .02*source_height):
        return reject('FRAME_MISMATCH')
    changed_frame = height != source_height
    try:
        if profile.get('sourceMethod') not in TRUSTED_METHODS or not re.fullmatch('[a-f0-9]{64}', profile.get('sourceDigest', '')):
            raise ValueError('Invalid calibration source')
        base = _checked_quad(np.asarray(profile['region']['quad'])*[source_width-1, source_height-1], width, height)
        current = np.asarray(direct['quad'], np.float32)
        if current.shape != (4, 2) or not np.isfinite(current).all():
            raise ValueError('Invalid current frame')
        expected = {a['kind']: np.asarray(a['point'], np.float64)*[999, 1396] for a in profile['anchors']}
        if len(expected) != len(profile['anchors']) or not 1 <= len(expected) <= 2 or (set(expected) != {'SET_LANGUAGE', 'TITLE'} if marker_profile else 'COLLECTOR' not in expected or set(expected)-{'COLLECTOR', 'TITLE'}) or any(p.shape != (2,) or not np.isfinite(p).all() or np.any(p < 0) or np.any(p > [999, 1396]) for p in expected.values()):
            raise ValueError('Invalid layout anchors')
        if any((p[0] >= 800 or p[1] > 250) if kind == 'TITLE' else (p[0] > 400 or p[1] < 1270) for kind, p in expected.items()):
            raise ValueError('Calibration anchor outside its printed region')
        template_map = cv2.getPerspectiveTransform(CANONICAL, base.astype(np.float32))
        if observation_quad is not None:
            guide = _checked_quad(observation_quad, width, height)
            if np.max(np.abs(guide-base)) > .001:
                raise ValueError('Guide differs from calibrated source placement')
            current_observation = guide
        else:
            current_observation = current
        observed_map = cv2.getPerspectiveTransform(CANONICAL, current_observation.astype(np.float32))
    except (KeyError, TypeError, ValueError, cv2.error):
        return reject('INVALID_PROFILE')
    proposals = []
    for observation in observations:
        degrees = observation.get('rotationDegrees')
        anchors = (marker_anchors(observation) if marker_profile else printed_anchors(observation)) if degrees in (0, 180) else None
        if anchors is None or ((changed_frame or observation_quad is not None) and ('TITLE' not in anchors or 'TITLE' not in expected)):
            continue
        offsets = []
        for kind in kinds:
            if kind not in expected or kind not in anchors:
                continue
            pair = np.float32([expected[kind], anchors[kind]])
            if degrees == 180:
                pair = np.float32([999, 1396])-pair
            predicted = cv2.perspectiveTransform(pair[:1][None], template_map)[0, 0]
            observed = cv2.perspectiveTransform(pair[1:][None], observed_map)[0, 0]
            offsets.append(observed-predicted)
        offset = np.mean(offsets, axis=0)
        if any(np.linalg.norm(item-offset) > .004*math.hypot(width, height) for item in offsets):
            continue
        if abs(offset[0]) > .015*width or abs(offset[1]) > .015*height:
            continue
        inferred = base+offset
        try:
            _checked_quad(inferred, width, height)
        except ValueError:
            continue
        if np.max(np.min(np.linalg.norm(inferred[:, None]-current[None], axis=2), axis=1)) <= 2:
            continue
        proposals.append({'status': 'PROPOSED', 'policy': policy, 'boundaryVerified': False,
            'region': {'version': 1, 'quad': (inferred/[width-1, height-1]).tolist()},
            'rotationDegrees': degrees, 'observedAnchors': list(kind for kind in kinds if kind in expected and kind in anchors),
            'offsetPixels': offset.tolist(), 'sourceDigest': profile.get('sourceDigest'),
            **({'anchorSpace':'LAYOUT_SEARCH'} if observation_quad is not None else {})})
    if len(proposals) != 1:
        return reject('ANCHORS_UNAVAILABLE_OR_AMBIGUOUS')
    return proposals[0]



def scanner_layout_search_region(image, direct, profile, input_kind='CARD_SCAN'):
    """A search placement, never measured edges or an inferred result by itself."""
    eligibility = infer_scanner_layout(image, direct, [], profile, input_kind)
    if eligibility.get('reason') != 'ANCHORS_UNAVAILABLE_OR_AMBIGUOUS':
        return None
    required = {'SET_LANGUAGE','TITLE'} if profile['version'] == 2 else {'COLLECTOR','TITLE'}
    if {a['kind'] for a in profile['anchors']} != required:
        return None
    height,width = image.shape[:2]
    points = np.asarray(profile['region']['quad'],np.float64)*[profile['frame']['width']-1,profile['frame']['height']-1]
    return {'version':1,'quad':(points/[width-1,height-1]).tolist()}
