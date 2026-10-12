"""Model-free runtime regressions; public templates are not required here."""
import sys
from pathlib import Path
import unittest
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
from printing_evidence import register, registration_features
from printing import PrintingRuntime
from baseline import geometry


class RuntimeTests(unittest.TestCase):
    def test_reference_features_anchor_an_outline_when_white_edges_are_invisible(self):
        rng = np.random.default_rng(20261011)
        reference = np.full((1397, 1000, 3), 255, np.uint8)
        reference[35:-35, 35:-35] = rng.integers(0,256,(1327,930,3),dtype=np.uint8)
        photo = cv2.copyMakeBorder(reference,60,80,80,100,cv2.BORDER_CONSTANT,value=(255,)*3)
        # The physical white border and white backing are indistinguishable.
        # Printed features still locate the reference-coordinate outer rectangle.
        self.assertEqual(geometry(photo,'CARD_SCAN')[1]['method'],'declared-card-scan')
        identity = 'cfe4a22f-c945-42f4-8b3a-ac3a03ffa015'
        runtime = PrintingRuntime.__new__(PrintingRuntime)
        runtime.records = {identity+':0': {'cardId':identity}}
        runtime.templates = []
        runtime.reference = lambda _: (reference,'UNKNOWN',registration_features(reference,True))
        result = runtime.observe(photo,[{'scryfallId':identity,'referenceId':identity+':0'}])
        alignment = result['candidates'][0]['alignment']
        self.assertEqual(alignment['status'],'ALIGNED')
        np.testing.assert_allclose(alignment['quad'],[[80,60],[1079,60],[1079,1456],[80,1456]],atol=1)
        self.assertFalse(result['automaticAcceptance'])
        self.assertEqual(result['observedStamp'],'UNREADABLE')

    def test_feature_reuse_preserves_registration(self):
        rng = np.random.default_rng(20260928)
        image = rng.integers(0, 256, (1397, 1000, 3), dtype=np.uint8)
        photo = cv2.rotate(image, cv2.ROTATE_180)
        uncached, first = register(photo, image)
        cached, second = register(photo, image, registration_features(photo), registration_features(image, True))
        self.assertEqual(first['status'], 'ALIGNED')
        self.assertEqual(first, second)
        np.testing.assert_array_equal(uncached, cached)
        masked, third, visibility = register(photo, image, return_visibility=True)
        self.assertEqual(first, third)
        np.testing.assert_array_equal(uncached, masked)
        self.assertEqual(visibility.shape, masked.shape[:2])
        failed = register(np.zeros_like(photo), image, return_visibility=True)
        self.assertIsNone(failed[0])
        self.assertEqual(failed[1]['status'], 'UNREADABLE')
        self.assertIsNone(failed[2])

    def test_missing_public_reference_is_explicit_and_cannot_prove_absence(self):
        runtime = PrintingRuntime.__new__(PrintingRuntime)
        runtime.records = {}
        identity = 'cfe4a22f-c945-42f4-8b3a-ac3a03ffa015'
        result = runtime.observe(np.zeros((1397, 1000, 3), dtype=np.uint8),
            [{'scryfallId': identity, 'referenceId': identity + ':0'}])
        self.assertEqual(result['observedStamp'], 'UNREADABLE')
        self.assertEqual(result['candidates'][0]['relation'], 'UNRESOLVED')
        self.assertEqual(result['candidates'][0]['stamp']['reason'], 'REFERENCE_UNAVAILABLE')
        self.assertFalse(result['automaticAcceptance'])


if __name__ == '__main__':
    unittest.main()
