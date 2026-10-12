"""Native hint and pixel guards without model or expected-printing inference."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import types
import unittest
from unittest.mock import patch
import cv2
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-eval'))
from baseline import geometry
from photo_input import decode_photo_input
from reference_card_region import reference_card_region, scanner_rectangle
from test_geometry import tight_scan
import recognize

def source():
    rng = np.random.default_rng(20261011)
    card = np.full((1397, 1000, 3), 255, np.uint8)
    card[35:-35, 35:-35] = rng.integers(0, 256, (1327, 930, 3), dtype=np.uint8)
    return cv2.copyMakeBorder(card, 60, 80, 80, 100, cv2.BORDER_CONSTANT, value=(255,)*3)

def region():
    return {'version': 1, 'quad': [[80/1179, 60/1536], [1079/1179, 60/1536],
                                 [1079/1179, 1456/1536], [80/1179, 1456/1536]]}

def encoded(image):
    out = io.BytesIO()
    Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).save(out, format='PNG')
    return out.getvalue()

def framed(data, metadata):
    hint = json.dumps(metadata).encode()
    return struct.pack('>I', len(hint)) + hint + data

class ReferenceRegionTests(unittest.TestCase):
    def test_scanner_rectangle_prior_preserves_rotation_and_rejects_projective_hint(self):
        good = np.array([[80, 60], [1079, 60], [1079, 1456], [80, 1456]], float)
        for scale in (.5, 1, 1.6):
            for angle in (0, 15, 90, 180, 270):
                radians = np.deg2rad(angle)
                rotation = np.array([[np.cos(radians), -np.sin(radians)], [np.sin(radians), np.cos(radians)]])
                self.assertTrue(scanner_rectangle((good-good.mean(axis=0)) @ rotation.T * scale + 2000))
        bad = [[220,60],[1079,60],[939,1456],[80,1456]]
        self.assertFalse(scanner_rectangle(bad))
        hint = {'version':1,'quad':[[x/1179,y/1536] for x,y in bad]}
        with self.assertRaisesRegex(ValueError, 'not a scanner rectangle'):
            reference_card_region(source(), hint)

    def test_distinct_scanner_only_hint_and_exact_original_digest(self):
        data = encoded(source())
        packet = framed(data, {'inputKind': 'CARD_SCAN', 'referenceRegion': region()})
        self.assertEqual(decode_photo_input(packet, return_reference=True), (data, 'CARD_SCAN', region()))
        for kind in ('PHOTO', 'unexpected'):
            with self.assertRaises(ValueError):
                decode_photo_input(framed(data, {'inputKind': kind, 'referenceRegion': region()}), return_reference=True)
        with self.assertRaises(ValueError):
            decode_photo_input(packet)
        with self.assertRaises(ValueError):
            decode_photo_input(framed(data, {'inputKind': 'CARD_SCAN', 'referenceRegion': region(),
                                           'manualRegion': region()}), return_reference=True, return_region=True)

    def test_reference_geometry_is_not_operator_or_measured_geometry(self):
        image = source()
        self.assertEqual(geometry(image, 'CARD_SCAN')[1]['method'], 'declared-card-scan')
        crop, result = reference_card_region(image, region())
        self.assertEqual(crop.shape, (1397, 1000, 3))
        self.assertEqual(result['method'], 'reference-anchor-region-v1')
        self.assertEqual(result['referenceRegion'], region())
        self.assertNotIn('manualRegion', result)
        self.assertFalse(result['boundaryVerified'])
        self.assertEqual(result['primaryGeometry']['method'], 'declared-card-scan')

    def test_actual_clipped_rim_vetoes_an_in_frame_reference_in_all_quarter_turns(self):
        backing = cv2.copyMakeBorder(tight_scan(), 50, 70, 60, 80,
                                     cv2.BORDER_CONSTANT, value=(220,)*3)
        inside = {'version': 1, 'quad': [[.1, .1], [.9, .1], [.9, .9], [.1, .9]]}
        for clipped in (backing[55:], backing[:-75], backing[:, 65:], backing[:, :-85]):
            for turns in range(4):
                photo = np.rot90(clipped, turns).copy()
                self.assertEqual(geometry(photo, 'CARD_SCAN')[1].get('framing'), 'CLIPPED')
                with self.assertRaisesRegex(ValueError, 'physically clipped'):
                    reference_card_region(photo, inside)

    def test_real_native_entry_uses_bounded_title_footer_reads_and_separate_geometry(self):
        data = encoded(source())
        seen = []
        engine = types.SimpleNamespace(predict=lambda image: seen.append(image.copy()) or [])
        output = io.StringIO()
        with patch.object(recognize, 'ocr_engine', return_value=engine), patch.object(sys, '__stdout__', output), contextlib.redirect_stdout(io.StringIO()):
            recognize.recognize(framed(data, {'inputKind': 'CARD_SCAN', 'referenceRegion': region()}), {'digest': 'a'*64})
        value = json.loads(output.getvalue())
        self.assertEqual(value['photoDigest'], hashlib.sha256(data).hexdigest())
        self.assertEqual(value['geometry']['method'], 'reference-anchor-region-v1')
        self.assertNotIn('manualRegion', value['geometry'])
        self.assertFalse(value['automaticAcceptance'])
        self.assertEqual([x.shape[:2] for x in seen], [(457, 1000), (127, 1000)] * 2)

if __name__ == '__main__':
    unittest.main()
