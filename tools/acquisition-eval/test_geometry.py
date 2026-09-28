"""Geometry regressions using synthetic pixels, without models or private cards."""
import unittest
import cv2
import numpy as np
from baseline import geometry, preserve_full_frame


def tight_scan():
    image = np.zeros((880, 630, 3), dtype=np.uint8)
    # Internal printed frame ends above the identifier strip.
    cv2.rectangle(image, (25, 20), (605, 810), (190, 190, 190), -1)
    cv2.rectangle(image, (35, 40), (595, 430), (90, 130, 170), -1)
    cv2.putText(image, 'NEO EN 039', (30, 850), cv2.FONT_HERSHEY_SIMPLEX,
                .7, (255, 255, 255), 2)
    return image


class GeometryTest(unittest.TestCase):
    def test_tight_scan_preserves_all_edges_and_footer_in_every_quarter_turn(self):
        image = tight_scan()
        for turns in range(4):
            source = np.rot90(image, turns).copy()
            crop, evidence = geometry(source)
            h, w = source.shape[:2]
            self.assertEqual(evidence['method'], 'full-frame')
            self.assertEqual(set(map(tuple, evidence['quad'])),
                             {(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)})
            self.assertEqual(crop.shape, (1397, 1000, 3))
            # Footer may be at either end before direction resolution.
            self.assertGreater(max(np.count_nonzero(crop[-110:] > 230),
                                   np.count_nonzero(crop[:110] > 230)), 100)

    def test_card_aspect_ratio_alone_does_not_bypass_detection(self):
        image = tight_scan()
        image[:12] = 180
        self.assertFalse(preserve_full_frame(image))

    def test_small_card_on_dark_background_keeps_ordinary_crop(self):
        source = tight_scan()
        image = np.zeros((1200, 900, 3), dtype=np.uint8)
        image[150:1030, 130:760] = source
        crop, evidence = geometry(image)
        self.assertIsNotNone(crop)
        self.assertEqual(evidence['method'], 'contours')

    def test_wrong_frame_shape_and_blank_image_are_not_scan_evidence(self):
        image = np.zeros((900, 900, 3), dtype=np.uint8)
        self.assertFalse(preserve_full_frame(image))
        crop, evidence = geometry(np.zeros((880, 630, 3), dtype=np.uint8))
        self.assertIsNone(crop)
        self.assertEqual(evidence['status'], 'NEEDS_CROP')


if __name__ == '__main__':
    unittest.main()
