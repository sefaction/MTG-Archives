import unittest
from reading_direction import reading_text, restore_reading_polygon, restore_footer_polygon


def word(text, x, y, width, height=30):
    return {'text': text, 'polygon': [[x, y], [x + width, y],
                                     [x + width, y + height], [x, y + height]]}


class ReadingDirectionTest(unittest.TestCase):
    def test_split_title_and_collector_are_joined_in_reading_order(self):
        result = reading_text([word('Ants', 180, 70, 90), word('Saber', 70, 75, 115),
                               word('L', 70, 1310, 25), word('0304', 90, 1308, 80)])
        self.assertEqual(result, {'title': ['Saber Ants'], 'footer': ['L 0304']})

    def test_other_rows_distant_symbols_and_body_are_not_combined(self):
        result = reading_text([word('Forest', 70, 70, 150), word('2', 900, 70, 30),
                               word('unrelated', 70, 115, 100), word('body', 70, 500, 100),
                               word('C0123', 70, 1310, 100), word('ABC EN', 70, 1345, 140)])
        self.assertEqual(result['title'], ['Forest', '2', 'unrelated'])
        self.assertEqual(result['footer'], ['C0123', 'ABC EN'])

    def test_joining_does_not_overwrite_raw_evidence(self):
        lines = [word('Saber', 70, 70, 110), word('Ants', 180, 70, 90)]
        reading_text(lines)
        self.assertEqual([line['text'] for line in lines], ['Saber', 'Ants'])

    def test_flavor_and_power_toughness_are_not_printing_identifiers(self):
        result = reading_text([word('with our programmed mission!', 80, 1231, 500, 25),
                               word('1/3', 880, 1249, 70, 25),
                               word('Paolo Parente', 70, 1276, 260, 25),
                               word('185/306', 700, 1307, 130, 25),
                               word('DMC EN', 70, 1318, 200, 25)])
        self.assertEqual(result['footer'], ['Paolo Parente', '185/306', 'DMC EN'])

    def test_stitched_footer_maps_to_real_card_position_and_seam_is_rejected(self):
        original = word('DMC EN', 70, 378, 200, 25)['polygon']
        mapped = restore_reading_polygon(original)
        self.assertEqual(mapped, word('DMC EN', 70, 1318, 200, 25)['polygon'])
        self.assertEqual(original, word('DMC EN', 70, 378, 200, 25)['polygon'])
        self.assertIsNone(restore_reading_polygon(word('seam', 70, 240, 200, 40)['polygon']))
        self.assertIsNone(restore_reading_polygon(word('outside', 70, 460, 200, 25)['polygon']))

    def test_separate_footer_boxes_restore_only_actual_footer_pixels(self):
        original = word('NEOEN', 80, 40, 100, 25)['polygon']
        self.assertEqual(restore_footer_polygon(original), word('NEOEN', 80, 1310, 100, 25)['polygon'])
        self.assertEqual(original, word('NEOEN', 80, 40, 100, 25)['polygon'])
        self.assertIsNone(restore_footer_polygon(word('outside', 80, -1, 100)['polygon']))
        self.assertIsNone(restore_footer_polygon(word('outside', 80, 120, 100)['polygon']))


if __name__ == '__main__':
    unittest.main()
