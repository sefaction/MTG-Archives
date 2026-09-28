import unittest
from reading_direction import reading_text


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


if __name__ == '__main__':
    unittest.main()
