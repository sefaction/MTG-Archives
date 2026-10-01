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
    def test_declared_scan_preserves_white_borders_and_footer_without_contour_detection(self):
        from unittest.mock import patch
        image = tight_scan()
        image[:12] = image[-12:] = 255
        image[:, :12] = image[:, -12:] = 255
        self.assertFalse(preserve_full_frame(image))
        for turns in range(4):
            source = np.rot90(image, turns).copy()
            with patch('baseline.preserve_full_frame', side_effect=AssertionError('heuristic called')):
                crop, evidence = geometry(source, 'CARD_SCAN')
            h, w = source.shape[:2]
            self.assertEqual(evidence['method'], 'declared-card-scan')
            self.assertEqual(set(map(tuple, evidence['quad'])), {(0,0),(w-1,0),(w-1,h-1),(0,h-1)})
            self.assertEqual(crop.shape, (1397, 1000, 3))
            self.assertGreater(max(np.count_nonzero(crop[-110:] > 230), np.count_nonzero(crop[:110] > 230)),100)

    def test_small_scanner_strip_is_removed_without_touching_border_or_footer(self):
        card = tight_scan()
        # The footer already exists; padding alone moves it above the fixed zone.
        source = np.full((945, 630, 3), 255, dtype=np.uint8)
        source[:880] = card
        for turns in range(4):
            image = np.rot90(source, turns).copy()
            before = image.copy()
            crop, evidence = geometry(image, 'CARD_SCAN')
            self.assertEqual(evidence['method'], 'scanner-background-trim')
            # Every retained corner is outside the physical card, never its
            # internal printed frame, which ends at row 810.
            mask = np.zeros(source.shape[:2], np.uint8)
            mask[:881] = 1
            ys, xs = np.where(np.rot90(mask, turns))
            self.assertEqual(set(map(tuple, evidence['quad'])),
                             {(xs.min(), ys.min()), (xs.max(), ys.min()),
                              (xs.max(), ys.max()), (xs.min(), ys.max())})
            np.testing.assert_array_equal(image, before)
            # Fixed footer zone; direction resolution may turn the card 180.
            prepared = crop if turns % 2 == 0 else np.rot90(crop, 2)
            # Choose the direction with the known lower identifier pixels.
            if np.count_nonzero(prepared[-127:] > 230) < 100:
                prepared = np.rot90(prepared, 2)
            self.assertGreater(np.count_nonzero(prepared[1270:] > 230), 100)
            self.assertLess(np.mean(prepared[-30:] > 230), .15)

    def test_ambiguous_white_borders_and_broad_padding_keep_full_scan(self):
        card = tight_scan()
        white_border = cv2.copyMakeBorder(card, 40, 40, 40, 40,
                                        cv2.BORDER_CONSTANT, value=(255, 255, 255))
        broad = cv2.copyMakeBorder(card, 0, 140, 0, 0,
                                  cv2.BORDER_CONSTANT, value=(255, 255, 255))
        light_border = card.copy()
        light_border[-10:] = 190  # No clear dark physical border at the seam.
        uncertain = cv2.copyMakeBorder(light_border, 0, 65, 0, 0,
                                      cv2.BORDER_CONSTANT, value=(255, 255, 255))
        for source in (white_border, broad, uncertain,
                       np.full((945, 630, 3), 255, np.uint8), card):
            for turns in range(4):
                image = np.rot90(source, turns).copy()
                crop, evidence = geometry(image, 'CARD_SCAN')
                h, w = image.shape[:2]
                self.assertEqual(evidence['method'], 'declared-card-scan')
                self.assertEqual(set(map(tuple, evidence['quad'])),
                                 {(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)})

    def test_photo_never_uses_scanner_background_trim(self):
        from unittest.mock import patch
        image = cv2.copyMakeBorder(tight_scan(), 0, 65, 0, 0,
                                   cv2.BORDER_CONSTANT, value=(255, 255, 255))
        with patch('baseline.scanner_background_quad', side_effect=AssertionError('scan trim called')):
            _, evidence = geometry(image, 'PHOTO')
        self.assertNotEqual(evidence.get('method'), 'scanner-background-trim')

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
