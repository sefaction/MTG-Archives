import json
import struct
import unittest
from photo_input import decode_photo_input, MAX_PHOTO


class PhotoInputTest(unittest.TestCase):
    def test_manual_hint_keeps_original_identity_and_requires_opted_in_decoder(self):
        raw = bytes.fromhex('ffd8ffe00000')
        region = {'version': 1, 'quad': [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]}
        for kind in ('PHOTO', 'CARD_SCAN'):
            meta = json.dumps({'inputKind': kind, 'manualRegion': region}).encode()
            frame = struct.pack('>I', len(meta)) + meta + raw
            self.assertEqual(decode_photo_input(frame, return_region=True), (raw, kind, region))
            self.assertEqual(decode_photo_input(frame, return_task=True, return_region=True), (raw, kind, None, region))
            with self.assertRaises(ValueError):
                decode_photo_input(frame)
        self.assertEqual(decode_photo_input(raw, return_task=True, return_region=True), (raw, 'PHOTO', None, None))

    def test_invalid_manual_hint_has_no_raw_or_whole_photo_fallback(self):
        good = {'version': 1, 'quad': [[0, 0], [1, 0], [1, 1], [0, 1]]}
        for region in (None, {}, {**good, 'version': True}, {**good, 'path': 'untrusted'},
                       {**good, 'quad': [[0, 0], [1, 1], [1, 0], [0, 1]]},
                       {**good, 'quad': [[0, 0], [1, 0], [1, 0], [0, 1]]},
                       {**good, 'quad': [[0, 0], [1, 0], [float('nan'), 1], [0, 1]]}):
            meta = json.dumps({'inputKind': 'PHOTO', 'manualRegion': region}).encode()
            with self.assertRaises(ValueError):
                decode_photo_input(struct.pack('>I', len(meta)) + meta + b'image', return_region=True)
        meta = json.dumps({'inputKind': 'PHOTO', 'manualRegion': good, 'recognitionTask': 'WHOLE_PHOTO_TEXT'}).encode()
        with self.assertRaises(ValueError):
            decode_photo_input(struct.pack('>I', len(meta)) + meta + b'image', return_task=True, return_region=True)

    def test_ocr_only_task_is_explicit_and_keeps_original_bytes(self):
        raw=b'original photo'
        for kind in ('PHOTO','CARD_SCAN'):
            meta=json.dumps({'inputKind':kind,'recognitionTask':'WHOLE_PHOTO_TEXT'}).encode()
            frame=struct.pack('>I',len(meta))+meta+raw
            self.assertEqual(decode_photo_input(frame,return_task=True),(raw,kind,'WHOLE_PHOTO_TEXT'))
            with self.assertRaises(ValueError):
                decode_photo_input(frame)
        meta=json.dumps({'inputKind':'PHOTO','recognitionTask':'UNKNOWN'}).encode()
        with self.assertRaises(ValueError):
            decode_photo_input(struct.pack('>I',len(meta))+meta+raw,return_task=True)

    def test_source_hints_preserve_original_bytes(self):
        raw = bytes.fromhex('ffd8ffe00000')
        self.assertEqual(decode_photo_input(raw), (raw, 'PHOTO'))
        meta = json.dumps({'inputKind': 'CARD_SCAN'}).encode()
        self.assertEqual(decode_photo_input(struct.pack('>I', len(meta)) + meta + raw), (raw, 'CARD_SCAN'))

    def test_invalid_or_oversized_metadata_and_images_fail(self):
        for meta in ({'inputKind': 'UNKNOWN'}, {'inputKind': 'CARD_SCAN', 'path': 'private'}, []):
            raw = json.dumps(meta).encode()
            with self.assertRaises(ValueError):
                decode_photo_input(struct.pack('>I',len(raw)) + raw + b'image')
        with self.assertRaises(ValueError):
            decode_photo_input(b'')
        with self.assertRaises(ValueError):
            decode_photo_input(b'x' * (MAX_PHOTO+1))


if __name__ == '__main__':
    unittest.main()
