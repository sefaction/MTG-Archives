"""Model-free runtime regressions; public templates are not required here."""
import sys
from pathlib import Path
import unittest
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
from printing_evidence import register, registration_features
from printing import PrintingRuntime


class RuntimeTests(unittest.TestCase):
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
