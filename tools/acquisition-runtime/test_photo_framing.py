"""Incomplete declared scans must not retry artwork contours or OCR zones."""
import contextlib
import io
import json
import struct
import sys
import types
import unittest
from unittest.mock import patch

from PIL import Image
import recognize


class ScanFramingTest(unittest.TestCase):
    def test_incomplete_scan_has_no_quarter_turn_photo_fallback_or_fixed_zone_read(self):
        source = io.BytesIO()
        Image.new('RGB', (63, 88), (180, 180, 180)).save(source, format='PNG')
        metadata = json.dumps({'inputKind': 'CARD_SCAN'}).encode()
        frame = struct.pack('>I', len(metadata)) + metadata + source.getvalue()
        calls = []
        def geometry(image, kind='PHOTO'):
            calls.append(kind)
            if kind != 'CARD_SCAN':
                raise AssertionError('Clipped scan retried as ordinary photo')
            return None, {'status': 'NEEDS_CROP', 'framing': 'CLIPPED'}
        output = io.StringIO()
        with patch.dict(sys.modules, {'baseline': types.SimpleNamespace(geometry=geometry)}), \
                patch.object(sys, '__stdout__', output), \
                patch.object(recognize, 'ocr_engine', side_effect=AssertionError('OCR zones attempted')), \
                contextlib.redirect_stdout(io.StringIO()):
            recognize.recognize(frame, {'digest': 'a'*64})
        result = json.loads(output.getvalue())
        self.assertEqual(calls, ['CARD_SCAN'])
        self.assertEqual(result['geometry'], {'status': 'NEEDS_CROP', 'framing': 'CLIPPED'})
        self.assertEqual(result['orientations'], [])
        self.assertEqual(result['text'], {'title': [], 'footer': []})
        self.assertNotIn('readingZones', result)
        self.assertFalse(result['automaticAcceptance'])


if __name__ == '__main__':
    unittest.main()
