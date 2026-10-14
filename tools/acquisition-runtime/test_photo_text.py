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



class ScannerSourceTest(unittest.TestCase):
    def test_positions_map_from_resized_to_original_without_extra_calls(self):
        class FooterOCR:
            def __init__(self): self.calls = 0
            def predict(self, image):
                self.calls += 1
                return [{'rec_texts': ['Card name', '153/264 C', 'WAR EN'],
                    'rec_polys': [np.array([[40,30],[160,30],[160,50],[40,50]]),
                                  np.array([[40,1420],[180,1420],[180,1436],[40,1436]]),
                                  np.array([[40,1450],[180,1450],[180,1466],[40,1466]])]}]
        ocr = FooterOCR()
        result = whole_photo_text(np.zeros((2400,1700,3),dtype=np.uint8),ocr,input_kind='CARD_SCAN')
        self.assertEqual(ocr.calls,4)
        source = result['readings'][0]['scannerSource']
        self.assertEqual((source['width'],source['height']),(1700,2400))
        self.assertEqual(source['boundaryVerified'],False)
        self.assertEqual(source['lines'][0]['text'],'153/264 C')
        self.assertAlmostEqual(source['lines'][0]['polygon'][0][1],2130)
        self.assertNotIn('scannerSource',result['readings'][2])
        photo = whole_photo_text(np.zeros((2400,1700,3),dtype=np.uint8),FooterOCR())
        self.assertTrue(all('scannerSource' not in r for r in photo['readings']))

    def test_outside_body_malformed_and_excess_boxes_do_not_supply_source_metadata(self):
        from photo_text import scanner_source
        good = {'text':'WAR EN','polygon':[[40,1300],[180,1300],[180,1316],[40,1316]]}
        self.assertIsNone(scanner_source([good]*13,(1400,1000),(1400,1000)))
        self.assertIsNone(scanner_source([good],(1000,1400),(1000,1400)))
        for polygon in [[[40,900],[180,900],[180,916],[40,916]],
                        [[900,1300],[1080,1300],[1080,1316],[900,1316]],
                        [[40,1300],[float('nan'),1300],[180,1316],[40,1316]],
                        [[40,1300],[180,1300],[180,1316]]]:
            self.assertIsNone(scanner_source([{**good,'polygon':polygon}],(1400,1000),(1400,1000)))

    def test_completed_scanner_metadata_matches_progress_and_budget_keeps_one_direction(self):
        class FooterOCR:
            def predict(self, image):
                return [{'rec_texts':['153/264 C','WAR EN'],
                         'rec_polys': [np.array([[40,1300],[180,1300],[180,1316],[40,1316]]),
                                       np.array([[40,1325],[180,1325],[180,1341],[40,1341]])]}]
        ticks=iter([0,0,26]); completed=[]
        result=whole_photo_text(np.zeros((1400,1000,3),dtype=np.uint8),FooterOCR(),
            input_kind='CARD_SCAN',clock=lambda:next(ticks),on_reading=completed.append)
        self.assertEqual(completed,result['readings'])
        self.assertEqual(result['status'],'PARTIAL')
        self.assertIn('scannerSource',completed[0])

if __name__=='__main__':
    unittest.main()
