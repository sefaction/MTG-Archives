"""Manual repair geometry with labelled synthetic border/title/footer pixels."""
import copy
import unittest

import cv2
import numpy as np

from manual_card_region import manual_card_region, manual_card_source


def normalized(quad, image):
    height, width = image.shape[:2]
    return {'version': 1, 'quad': (np.asarray(quad) / [width - 1, height - 1]).tolist()}


class ManualCardRegionTest(unittest.TestCase):
    def test_printing_mask_excludes_neighbours_outside_the_selected_polygon(self):
        image = np.full((700, 700, 3), (0, 0, 255), dtype=np.uint8)
        before = image.copy()
        source, offset = manual_card_source(image, normalized(
            [[350, 70], [620, 350], [350, 630], [80, 350]], image))
        self.assertEqual(offset, (80, 70))
        self.assertEqual(source.shape, (561, 541, 3))
        np.testing.assert_array_equal(source[0, 0], [127, 127, 127])
        np.testing.assert_array_equal(source[280, 270], [0, 0, 255])
        np.testing.assert_array_equal(image, before)

    def test_printing_source_retains_original_resolution_instead_of_canonical_upsampling(self):
        image = np.full((1300, 1100, 3), 220, dtype=np.uint8)
        card = np.zeros((880, 630, 3), dtype=np.uint8)
        card[20:70, 30:600] = (0, 0, 255)
        card[815:860, 30:600] = (0, 255, 0)
        image[100:980, 90:720] = card
        before = image.copy()
        source, offset = manual_card_source(image, normalized(
            [[90, 100], [719, 100], [719, 979], [90, 979]], image))
        self.assertEqual(offset, (90, 100))
        self.assertEqual(source.shape, card.shape)
        np.testing.assert_array_equal(source, card)
        np.testing.assert_array_equal(image, before)
        # An explicit tiny low-resolution original remains tiny for the stamp
        # guard. Canonical OCR resizing cannot manufacture source resolution.
        small = cv2.resize(card, (200, 280), interpolation=cv2.INTER_NEAREST)
        source, offset = manual_card_source(small, {
            'version': 1, 'quad': [[0, 0], [1, 0], [1, 1], [0, 1]]})
        self.assertEqual(source.shape, (280, 200, 3))
        self.assertEqual(offset, (0, 0))

    def test_manual_perspective_repair_retains_border_title_and_footer_in_all_quarter_turns(self):
        card = np.zeros((880, 630, 3), dtype=np.uint8)
        card[8:-8, 8:-8] = (170, 170, 170)
        card[20:70, 30:600] = (0, 0, 255)  # Labelled title band.
        card[815:860, 30:600] = (0, 255, 0)  # Labelled footer band.
        source = np.full((1300, 1100, 3), 220, dtype=np.uint8)
        quad = np.float32([[190, 180], [820, 225], [875, 1120], [140, 1070]])
        transform = cv2.getPerspectiveTransform(np.float32(
            [[0, 0], [629, 0], [629, 879], [0, 879]]), quad)
        layer = cv2.warpPerspective(card, transform, (1100, 1300))
        mask = cv2.warpPerspective(np.full(card.shape[:2], 255, np.uint8), transform, (1100, 1300))
        source[mask > 0] = layer[mask > 0]
        for turns in range(4):
            image = np.rot90(source, turns).copy()
            corners = quad.copy()
            height, width = source.shape[:2]
            for _ in range(turns):
                corners = np.column_stack((corners[:, 1], width - 1 - corners[:, 0]))
                height, width = width, height
            before, selection = image.copy(), normalized(corners, image)
            selection_before = copy.deepcopy(selection)
            crop, evidence = manual_card_region(image, selection)
            self.assertEqual(crop.shape, (1397, 1000, 3))
            np.testing.assert_array_equal(image, before)
            self.assertEqual(selection, selection_before)
            self.assertEqual(evidence['method'], 'manual-card-region-v1')
            self.assertFalse(evidence['boundaryVerified'])
            self.assertIsNone(evidence['confidence'])
            self.assertEqual(evidence['sourceFrame'], {'width': image.shape[1], 'height': image.shape[0]})
            # Either 180-degree direction is possible; both strips and every
            # physical border remain, independently of the detector's guess.
            strips = np.concatenate((crop[:130].reshape(-1, 3), crop[-130:].reshape(-1, 3)))
            self.assertGreater(np.count_nonzero((strips[:, 2] > 240) & (strips[:, 1] < 20)), 25000)
            self.assertGreater(np.count_nonzero((strips[:, 1] > 240) & (strips[:, 2] < 20)), 25000)
            for edge in (crop[3], crop[-4], crop[:, 3], crop[:, -4]):
                self.assertGreater(np.mean(np.max(edge, axis=1) < 30), .95)

    def test_invalid_boundary_never_falls_back_to_an_automatic_crop(self):
        image = np.zeros((880, 630, 3), dtype=np.uint8)
        valid = {'version': 1, 'quad': [[0, 0], [1, 0], [1, 1], [0, 1]]}
        bad = [None, {}, {**valid, 'version': True}, {**valid, 'version': 2},
               {**valid, 'extra': 'ignored'}, {**valid, 'quad': valid['quad'][:3]},
               {**valid, 'quad': [[0, 0], [1, 1], [1, 0], [0, 1]]},
               {**valid, 'quad': [[0, 0], [1, 0], [1, 0], [0, 1]]},
               {**valid, 'quad': [[0, 0], [.01, 0], [.01, .01], [0, .01]]},
               {**valid, 'quad': [[0, 0], [1, 0], [.3, .3], [0, 1]]}]
        for value in (-.01, 1.01, float('nan'), float('inf'), True, '0'):
            quad = copy.deepcopy(valid['quad'])
            quad[0][0] = value
            bad.append({**valid, 'quad': quad})
        for selection in bad:
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                manual_card_region(image, selection)

    def test_full_frame_inclusive_coordinates_preserve_source_identity(self):
        image = np.zeros((880, 630, 3), dtype=np.uint8)
        region = {'version': 1, 'quad': [[0, 0], [1, 0], [1, 1], [0, 1]]}
        for corners in (region['quad'], list(reversed(region['quad']))):
            crop, evidence = manual_card_region(image, {**region, 'quad': corners})
            self.assertEqual(crop.shape, (1397, 1000, 3))
            self.assertEqual(evidence['quad'], [[0, 0], [629, 0], [629, 879], [0, 879]])


if __name__ == '__main__':
    unittest.main()
