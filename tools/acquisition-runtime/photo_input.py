"""Bounded source hints; preserve original bytes/digest and legacy raw callers."""
import json
import math
import struct

MAX_PHOTO = 10 * 1024 * 1024


def validate_manual_region(region):
    if (not isinstance(region, dict) or set(region) != {'version', 'quad'}
            or type(region['version']) is not int or region['version'] != 1
            or not isinstance(region['quad'], list) or len(region['quad']) != 4):
        raise ValueError('Invalid manual region')
    for point in region['quad']:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError('Invalid manual corner')
        for value in point:
            if (type(value) not in (int, float) or not 0 <= value <= 1
                    or not math.isfinite(value)):
                raise ValueError('Invalid manual corner')
    turns = []
    quad = region['quad']
    for i, a in enumerate(quad):
        b, c = quad[(i + 1) % 4], quad[(i + 2) % 4]
        turns.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    if not (all(turn > 1e-10 for turn in turns) or all(turn < -1e-10 for turn in turns)):
        raise ValueError('Invalid manual boundary')
    return region


def decode_photo_input(frame, *, return_task=False, return_region=False):
    kind, data, task, region = 'PHOTO', frame, None, None
    if len(frame) >= 4:
        length = struct.unpack('>I', frame[:4])[0]
        if 0 < length <= 1020:
            if len(frame) <= 4 + length:
                raise ValueError('Incomplete image hint')
            metadata = json.loads(frame[4:4 + length])
            if not isinstance(metadata, dict) or set(metadata) not in (
                    {'inputKind'}, {'inputKind', 'recognitionTask'}, {'inputKind', 'manualRegion'}):
                raise ValueError('Invalid image hint')
            task = metadata.get('recognitionTask')
            if ('recognitionTask' in metadata and
                    (task != 'WHOLE_PHOTO_TEXT' or not return_task)):
                raise ValueError('Invalid recognition task')
            if 'manualRegion' in metadata:
                if not return_region:
                    raise ValueError('Manual region support required')
                region = validate_manual_region(metadata['manualRegion'])
            kind, data = metadata['inputKind'], frame[4 + length:]
    if kind not in ('PHOTO', 'CARD_SCAN') or not 0 < len(data) <= MAX_PHOTO:
        raise ValueError('Invalid image input')
    result = (data, kind)
    if return_task:
        result += (task,)
    if return_region:
        result += (region,)
    return result
