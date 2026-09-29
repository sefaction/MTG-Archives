"""Bounded source hints; preserve original bytes/digest and legacy raw callers."""
import json
import struct

MAX_PHOTO = 10 * 1024 * 1024


def decode_photo_input(frame):
    kind, data = 'PHOTO', frame
    if len(frame) >= 4:
        length = struct.unpack('>I', frame[:4])[0]
        if 0 < length <= 1020:
            if len(frame) <= 4 + length:
                raise ValueError('Incomplete image hint')
            metadata = json.loads(frame[4:4 + length])
            if not isinstance(metadata, dict) or set(metadata) != {'inputKind'}:
                raise ValueError('Invalid image hint')
            kind, data = metadata['inputKind'], frame[4 + length:]
    if kind not in ('PHOTO', 'CARD_SCAN') or not 0 < len(data) <= MAX_PHOTO:
        raise ValueError('Invalid image input')
    return data, kind
