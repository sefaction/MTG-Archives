"""Geometry regressions using synthetic pixels, without models or private cards."""
import unittest
import cv2
import numpy as np
from baseline import geometry, preserve_full_frame, scanner_card_edges


def tight_scan():
    image = np.zeros((880, 630, 3), dtype=np.uint8)
    # Internal printed frame ends above the identifier strip.
    cv2.rectangle(image, (25, 20), (605, 810), (190, 190, 190), -1)
    cv2.rectangle(image, (35, 40), (595, 430), (90, 130, 170), -1)
    cv2.putText(image, 'NEO EN 039', (30, 850), cv2.FONT_HERSHEY_SIMPLEX,
                .7, (255, 255, 255), 2)
    return image


class GeometryTest(unittest.TestCase):
    def test_scanner_shadow_requires_a_strong_transition_and_bounded_edge_noise(self):
        source = cv2.copyMakeBorder(tight_scan(), 50, 70, 60, 80,
                                   cv2.BORDER_CONSTANT, value=(124,)*3)
        source[50:930, 45:60] = 92  # Shaded white backing beside a black rim.
        self.assertEqual(scanner_card_edges(source)[1], 'ALIGNED')
        weak = source.copy()
        weak[50:930, 60:68] = 65
        self.assertEqual(scanner_card_edges(weak), (None, None))
        # A 600-DPI-like edge can vary by a few pixels, but a bent outline is
        # not a straight card edge. Enclosing every point alone is insufficient.
        large = cv2.resize(source, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        for amplitude, expected in ((1, 'ALIGNED'), (12, None)):
            noisy = large.copy()
            for x in range(120, 1380):
                edge = 1859 + round(amplitude*np.sin((x-120)/45))
                noisy[1840:edge+1, x] = 0
                noisy[edge+1:1890, x] = 124
            self.assertEqual(scanner_card_edges(noisy)[1], expected)

    def test_light_scanner_margin_is_fitted_to_the_physical_dark_rim(self):
        card = tight_scan()
        source = cv2.copyMakeBorder(card, 50, 70, 60, 80, cv2.BORDER_CONSTANT,
                                   value=(220, 220, 220))
        expected = np.array([[58, 48], [691, 48], [691, 931], [58, 931]], np.float32)
        for turns in range(4):
            image = np.rot90(source, turns).copy()
            before = image.copy()
            crop, evidence = geometry(image, 'CARD_SCAN')
            self.assertEqual(evidence['method'], 'scanner-card-edges')
            self.assertEqual(evidence['framing'], 'ALIGNED')
            quad = np.asarray(evidence['quad'])
            # A one/two-pixel outward allowance preserves antialiased border
            # pixels, while the canonical reading frame has <3px margin.
            target = expected.copy()
            current_height, current_width = source.shape[:2]
            for _ in range(turns):
                target = np.column_stack((target[:, 1], current_width-1-target[:, 0]))
                current_height, current_width = current_width, current_height
            self.assertLessEqual(max(min(np.linalg.norm(p-q) for q in target) for p in quad), .01)
            self.assertEqual(crop.shape, (1397, 1000, 3))
            np.testing.assert_array_equal(image, before)
            self.assertGreater(max(np.count_nonzero(crop[-110:] > 230),
                                   np.count_nonzero(crop[:110] > 230)), 100)

    def test_clipped_dark_rim_never_falls_back_to_an_inner_card_frame(self):
        source = cv2.copyMakeBorder(tight_scan(), 50, 70, 60, 80,
                                   cv2.BORDER_CONSTANT, value=(220, 220, 220))
        for image in (source[55:], source[:-75], source[:, 65:], source[:, :-85]):
            for turns in range(4):
                crop, evidence = geometry(np.rot90(image, turns).copy(), 'CARD_SCAN')
                self.assertIsNone(crop)
                self.assertEqual(evidence, {'status': 'NEEDS_CROP', 'framing': 'CLIPPED'})

    def test_ambiguous_white_border_does_not_select_the_inner_black_rim(self):
        card = tight_scan()
        card[:22] = card[-22:] = 255
        card[:, :22] = card[:, -22:] = 255
        for background in (180, 220, 235, 240, 255):
            source = cv2.copyMakeBorder(card, 50, 70, 60, 80,
                                       cv2.BORDER_CONSTANT, value=(background,)*3)
            self.assertEqual(scanner_card_edges(source), (None, None))
            crop, evidence = geometry(source, 'CARD_SCAN')
            self.assertEqual(evidence['method'], 'declared-card-scan')

    def test_rotated_rounded_card_keeps_the_entire_physical_border(self):
        source = np.full((1040, 800, 3), 180, np.uint8)
        silhouette = np.zeros(source.shape[:2], np.uint8)
        cv2.rectangle(silhouette, (85, 65), (714, 944), 255, -1)
        # A rounded physical outline; the printed inner frame is unrelated.
        for x, y in ((85, 65), (714, 65), (714, 944), (85, 944)):
            cv2.rectangle(silhouette, (x-15, y-15), (x+15, y+15), 0, -1)
            cv2.circle(silhouette, (x+(15 if x==85 else -15),
                                    y+(15 if y==65 else -15)), 15, 255, -1)
        source[silhouette != 0] = 0
        source[110:900, 125:675] = 190
        cv2.putText(source, 'NEO EN 039', (120, 918), cv2.FONT_HERSHEY_SIMPLEX,
                    .7, (255, 255, 255), 2)
        for degrees in (-4, -1, 0, 1, 4):
            transform = cv2.getRotationMatrix2D((400, 520), degrees, 1)
            image = cv2.warpAffine(source, transform, (800, 1040),
                                   borderValue=(180,)*3)
            physical = cv2.warpAffine(silhouette, transform, (800, 1040))
            crop, evidence = geometry(image, 'CARD_SCAN')
            self.assertEqual(evidence['method'], 'scanner-card-edges')
            polygon = np.rint(evidence['quad']).astype(np.int32)
            retained = np.zeros(source.shape[:2], np.uint8)
            cv2.fillConvexPoly(retained, polygon, 255)
            self.assertEqual(np.count_nonzero((physical > 0) & (retained == 0)), 0)
            self.assertGreater(np.count_nonzero(crop[-110:] > 230), 100)

    def test_low_contrast_and_multiple_cards_do_not_claim_aligned_edges(self):
        for value in (0, 80, 255):
            source = cv2.copyMakeBorder(tight_scan(), 50, 70, 60, 80,
                                       cv2.BORDER_CONSTANT, value=(value,)*3)
            self.assertEqual(scanner_card_edges(source), (None, None))
        source = np.full((1100, 1450, 3), 180, np.uint8)
        source[70:950, 40:670] = tight_scan()
        source[100:980, 740:1370] = tight_scan()
        self.assertEqual(scanner_card_edges(source), (None, None))

    def test_shaded_background_still_identifies_observed_clipping(self):
        source = cv2.copyMakeBorder(tight_scan(), 0, 70, 60, 80,
                                   cv2.BORDER_CONSTANT, value=(124,)*3)
        crop, evidence = geometry(source, 'CARD_SCAN')
        self.assertIsNone(crop)
        self.assertEqual(evidence['framing'], 'CLIPPED')

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
