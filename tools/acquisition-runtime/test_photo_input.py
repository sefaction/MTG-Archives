import json
import struct
import unittest
from photo_input import decode_photo_input, MAX_PHOTO


class PhotoInputTest(unittest.TestCase):
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
