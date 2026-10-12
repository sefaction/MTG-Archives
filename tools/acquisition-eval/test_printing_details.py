import unittest
import cv2
import numpy as np
from printing_details import REGIONS, SIZE, printing_detail_evidence


def fixture():
    rng = np.random.default_rng(20261012)
    image = rng.integers(40, 190, (SIZE[1], SIZE[0], 3), dtype=np.uint8)
    # Smooth paper surfaces plus printed details, rather than noise-only regions.
    image[745:900] = 210
    image[1230:1375] = 25
    image[:, :85] = image[:, 915:] = 12
    cv2.putText(image, 'Creature  SYMBOL', (100, 820), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20,)*3, 3)
    cv2.putText(image, '012  ABC EN', (120, 1300), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (240,)*3, 3)
    cv2.circle(image, (890, 825), 25, (80, 20, 40), -1)
    return image


class DetailTests(unittest.TestCase):
    def setUp(self):
        self.image = fixture()
        self.alignment = {'status': 'ALIGNED', 'sourceCardWidth': 1000}
        self.visibility = np.full(self.image.shape[:2], 255, np.uint8)

    def observe(self, query, reference=None, visibility=None):
        return printing_detail_evidence(query, self.alignment,
            self.image if reference is None else reference,
            self.visibility if visibility is None else visibility)['regions']

    def test_identical_printing_has_exact_observed_detail_and_uniform_frame_support(self):
        before = self.image.copy()
        rows = self.observe(self.image)
        self.assertEqual({r['region'] for r in rows}, set(REGIONS))
        self.assertTrue(all(r['status'] == 'MEASURED' for r in rows))
        self.assertTrue(all(r['colorResidual'] == 0 for r in rows))
        self.assertTrue(all(r.get('correlation', 1) > .999 for r in rows))
        np.testing.assert_array_equal(before, self.image)

    def test_shared_art_with_changed_footer_symbol_and_frame_cannot_share_zero_residual(self):
        other = self.image.copy()
        other[1230:1375, 110:910] = 240
        other[780:855, 845:940] = (10, 190, 220)
        other[:, :85] = other[:, 915:] = 250
        rows = {r['region']:r for r in self.observe(other)}
        for name in ('FOOTER', 'SET_SYMBOL_AREA', 'LEFT_FRAME', 'RIGHT_FRAME'):
            self.assertEqual(rows[name]['status'], 'MEASURED')
            self.assertGreater(rows[name]['colorResidual'], 10)

    def test_artwork_lighting_fit_does_not_explain_away_a_changed_symbol(self):
        query = np.clip(self.image.astype(float)*.75+20, 0, 255).astype(np.uint8)
        unchanged = {r['region']:r for r in self.observe(query)}
        self.assertLess(unchanged['SET_SYMBOL_AREA']['colorResidual'], 2)
        query[790:850, 850:935] = (190, 20, 20)
        changed = {r['region']:r for r in self.observe(query)}
        self.assertGreater(changed['SET_SYMBOL_AREA']['colorResidual'], 10)

    def test_clipped_padding_and_small_source_are_not_measured_details(self):
        mask = self.visibility.copy()
        mask[1240:1250, 200:210] = 0
        rows = {r['region']:r for r in self.observe(self.image, visibility=mask)}
        self.assertEqual(rows['FOOTER']['reason'], 'REGION_CLIPPED')
        self.assertEqual(rows['TYPE_LINE']['status'], 'MEASURED')
        self.alignment['sourceCardWidth'] = 499
        self.assertTrue(all(r['reason'] == 'SOURCE_TOO_SMALL' for r in self.observe(self.image)))

    def test_blur_is_explicit_and_failed_alignment_does_not_create_absence(self):
        blurred = cv2.GaussianBlur(self.image, (31,31), 8)
        rows = {r['region']:r for r in self.observe(blurred)}
        self.assertEqual(rows['FOOTER']['reason'], 'DETAIL_BLURRED')
        result = printing_detail_evidence(None, {'status':'UNREADABLE'}, self.image, None)
        self.assertTrue(all(r['status'] == 'UNREADABLE' for r in result['regions']))
        self.assertNotIn('automaticAcceptance', result)


if __name__ == '__main__':
    unittest.main()
