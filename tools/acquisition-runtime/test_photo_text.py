import unittest
import numpy as np
from photo_text import whole_photo_text


class FakeOCR:
    def __init__(self, count=1):
        self.count = count
        self.calls = []

    def predict(self, image):
        self.calls.append(image.shape)
        return [{'rec_texts': ['Card name' if i == 0 else 'Other text' for i in range(self.count)],
                 'rec_polys': [np.array([[0,i*30],[90,i*30],[90,i*30+20],[0,i*30+20]])
                               for i in range(self.count)]}]


class PhotoTextTest(unittest.TestCase):
    def test_whole_photo_readings_have_no_title_footer_or_stamp_assignments(self):
        ocr = FakeOCR()
        result = whole_photo_text(np.zeros((2400,1800,3),dtype=np.uint8),ocr)
        self.assertEqual(result['scope'],'WHOLE_PHOTO')
        self.assertEqual(set(r['rotationDegrees'] for r in result['readings']),{0,90,180,270})
        self.assertEqual(result['readings'][0]['text'],['Card name'])
        self.assertTrue(all(max(shape[:2])<=1600 for shape in ocr.calls))
        self.assertNotIn('footer',result)
        self.assertNotIn('title',result)
        self.assertNotIn('stamp',result)

    def test_budget_stops_additional_directions_and_retains_completed_readings(self):
        ticks=iter([0,0,26])
        ocr=FakeOCR()
        result=whole_photo_text(np.zeros((800,600,3),dtype=np.uint8),ocr,clock=lambda:next(ticks))
        self.assertEqual(result['status'],'PARTIAL')
        self.assertEqual(len(ocr.calls),1)
        self.assertEqual(result['readings'][0]['text'],['Card name'])

    def test_large_text_is_explicitly_truncated_within_the_native_output_bound(self):
        result=whole_photo_text(np.zeros((800,600,3),dtype=np.uint8),FakeOCR(60))
        self.assertEqual(result['status'],'PARTIAL')
        self.assertTrue(all(r['truncated'] and len(r['text'])<=12 for r in result['readings']))

    def test_completed_direction_callback_precedes_the_next_direction_and_matches_final(self):
        ticks=iter([0,0,26])
        completed=[]
        result=whole_photo_text(np.zeros((800,600,3),dtype=np.uint8),FakeOCR(),
                                clock=lambda:next(ticks),on_reading=completed.append)
        self.assertEqual(result['status'],'PARTIAL')
        self.assertEqual(completed,result['readings'])
        self.assertEqual(len(completed),1)
        self.assertEqual(completed[0]['text'],['Card name'])


if __name__=='__main__':
    unittest.main()
