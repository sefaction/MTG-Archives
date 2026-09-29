"""Bounded source hints; preserve original bytes/digest and legacy raw callers."""
import json
import struct

MAX_PHOTO = 10 * 1024 * 1024


def decode_photo_input(frame, *, return_task=False):
    kind, data, task = 'PHOTO', frame, None
    if len(frame) >= 4:
        length = struct.unpack('>I', frame[:4])[0]
        if 0 < length <= 1020:
            if len(frame) <= 4 + length:
                raise ValueError('Incomplete image hint')
            metadata = json.loads(frame[4:4 + length])
            if not isinstance(metadata, dict) or set(metadata) not in (
                    {'inputKind'}, {'inputKind', 'recognitionTask'}):
                raise ValueError('Invalid image hint')
            task = metadata.get('recognitionTask')
            if ('recognitionTask' in metadata and
                    (task != 'WHOLE_PHOTO_TEXT' or not return_task)):
                raise ValueError('Invalid recognition task')
            kind, data = metadata['inputKind'], frame[4 + length:]
    if kind not in ('PHOTO', 'CARD_SCAN') or not 0 < len(data) <= MAX_PHOTO:
        raise ValueError('Invalid image input')
    return (data, kind, task) if return_task else (data, kind)
