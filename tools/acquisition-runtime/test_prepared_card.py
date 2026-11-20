import hashlib
import unittest
import cv2
import numpy as np
from card_layout import card_geometry, footer_top, internal_card_region
from prepared_card import prepared_crop, prepared_source
from reading_direction import reading_text, restore_footer_polygon
from printing_details import final_candidate_comparison


class PreparedCardTest(unittest.TestCase):
    def setUp(self):
        self.image=np.full((1100,800,3),240,np.uint8)
        self.image[100:1000,80:720]=(30,100,170)
        self.data=b'immutable-original'
        self.frame={'version':1,'policy':'shared-card-frame-v1','photoDigest':hashlib.sha256(self.data).hexdigest(),
                    'sourceWidth':800,'sourceHeight':1100,'region':{'version':1,'quad':[[.1,.09],[.9,.09],[.9,.91],[.1,.91]]},
                    'rotationDegrees':180,'sourceMethod':'scanner-card-edges','boundary':'OBSERVED'}

    def test_shared_crop_uses_saved_direction_and_original_pixel_resolution(self):
        original=self.image.copy()
        crop,evidence=prepared_crop(self.image,self.frame,self.data)
        forward,_=prepared_crop(self.image,{**self.frame,'rotationDegrees':0},self.data)
        self.assertTrue(np.array_equal(crop,cv2.rotate(forward,cv2.ROTATE_180)))
        self.assertEqual(evidence['preparedFrame'],self.frame)
        source,offset=prepared_source(self.image,self.frame,self.data)
        self.assertLess(source.shape[1],800)
        self.assertEqual(offset,(79,98))
        self.assertTrue(np.array_equal(self.image,original))

    def test_changed_bytes_dimensions_or_crossed_corners_are_refused(self):
        for change in [{'photoDigest':'a'*64},{'sourceWidth':801},{'rotationDegrees':90},
                       {'region':{'version':1,'quad':[[0,0],[1,1],[1,0],[0,1]]}}]:
            with self.assertRaises(ValueError):prepared_crop(self.image,{**self.frame,**change},self.data)

    def test_internal_boxes_can_propose_white_on_white_edges_without_claiming_measurement(self):
        image=np.full((1600,1200,3),255,np.uint8)
        cv2.rectangle(image,(180,351),(1020,831),(70,70,70),3)
        cv2.rectangle(image,(180,966),(1020,1336),(70,70,70),3)
        quad=internal_card_region(image)
        self.assertIsNotNone(quad)
        self.assertLess(float(np.max(np.abs(quad-np.float32([[100,100],[1100,100],[1100,1497],[100,1497]])))),20)
        crop,evidence=card_geometry(image,'CARD_SCAN')
        self.assertEqual(evidence['method'],'internal-layout-v1')
        self.assertFalse(evidence['boundaryVerified'])
        self.assertEqual(crop.shape,(1397,1000,3))

    def test_one_art_box_does_not_invent_an_outer_boundary(self):
        image=np.full((1600,1200,3),255,np.uint8)
        cv2.rectangle(image,(180,351),(1020,831),(70,70,70),3)
        self.assertIsNone(internal_card_region(image))

    def test_dynamic_footer_expands_only_below_an_observed_divider_and_excludes_flavor(self):
        card=np.full((1397,1000,3),255,np.uint8)
        self.assertEqual(footer_top(card),1270)
        cv2.line(card,(65,1240),(935,1240),(0,0,0),2)
        top=footer_top(card)
        self.assertIs(type(top),int,'native line coordinates must cross the JSON protocol as plain integers')
        from reading_direction import reading_zones
        __import__('json').dumps(reading_zones(top))
        self.assertGreater(top,1240);self.assertLess(top,1270)
        lines=[{'text':'flavor text 123','polygon':[[80,1200],[700,1200],[700,1230],[80,1230]]},
               {'text':'Illustrator Name','polygon':[[80,1255],[600,1255],[600,1280],[80,1280]]}]
        self.assertEqual(reading_text(lines,top)['footer'],['Illustrator Name'])
        mapped=restore_footer_polygon([[10,2],[30,2],[30,12],[10,12]],top)
        self.assertEqual(mapped[0],[10,top+2])

    def test_final_comparison_requires_distributed_observed_details_and_never_accepts(self):
        rows=[{'region':name,'status':'MEASURED','correlation':.95,'colorResidual':5}
              for name in ['TYPE_LINE','FOOTER','LEFT_FRAME']]
        aligned={'status':'ALIGNED','sourceCardWidth':700}
        image=np.random.default_rng(23).integers(0,256,(1397,1000,3),dtype=np.uint8)
        visibility=np.full(image.shape[:2],255,np.uint8)
        result=final_candidate_comparison(aligned,{'regions':rows},image,image,visibility)
        self.assertEqual(result['status'],'CONSISTENT');self.assertFalse(result['automaticAcceptance'])
        self.assertEqual(final_candidate_comparison(aligned,{'regions':rows})['status'],'UNREADABLE','matching frames alone cannot verify identity')
        wrong=image.copy();wrong[300:690,160:840]=255-wrong[300:690,160:840]
        different=final_candidate_comparison(aligned,{'regions':rows},wrong,image,visibility)
        self.assertEqual(different['status'],'DIFFERENT');self.assertIn('ARTWORK',different['differentRegions'])
        self.assertEqual(final_candidate_comparison(aligned,{'regions':rows[:1]})['status'],'UNREADABLE')
        self.assertEqual(final_candidate_comparison({'status':'UNREADABLE'},{'regions':rows})['status'],'UNREADABLE')
        for row in rows[:2]:row['correlation']=.1
        self.assertEqual(final_candidate_comparison(aligned,{'regions':rows})['status'],'DIFFERENT')

    def test_supporting_fields_use_bundled_symbols_without_making_identity_decisions(self):
        from field_readings import assets,mana_templates,supporting_fields
        self.assertEqual(len(assets()),4)
        self.assertEqual({name for name,_ in mana_templates()},set('WUBRGC'))
        class Reader:
            def predict(self,image):
                return [{'rec_texts':['Creature — Test'],'rec_scores':[.95]}]
        card=np.full((1397,1000,3),255,np.uint8)
        fields=supporting_fields(card,Reader())
        self.assertEqual(fields['typeLine'][0]['text'],'Creature — Test')
        self.assertFalse(fields['setSymbol']['automaticAcceptance'])
        self.assertEqual(fields['setSymbol']['query']['status'],'UNREADABLE')
        self.assertEqual(fields['mana']['status'],'UNREADABLE')

    def test_adaptive_footer_reuses_original_pixels_with_bound_source_coordinates(self):
        from footer_source import source_footer_view,restore_identifier_polygon
        quad=np.asarray(self.frame['region']['quad'],np.float32)*[799,1099]
        view,source=source_footer_view(self.image,{'status':'PROPOSED','quad':quad.tolist()},0,1248)
        self.assertEqual(source['version'],'source-footer-adaptive-v2')
        self.assertEqual(source['bounds'],[24,1248,630,1396])
        self.assertLessEqual(view.shape[0],source['sourceHeight'])
        self.assertLessEqual(view.shape[1],source['sourceWidth'])
        mapped=restore_identifier_polygon([[0,0],[view.shape[1]-1,0],
          [view.shape[1]-1,view.shape[0]-1],[0,view.shape[0]-1]],source)
        self.assertEqual(mapped,[[24,1248],[630,1248],[630,1396],[24,1396]])
        with self.assertRaises(ValueError):source_footer_view(self.image,{'status':'PROPOSED','quad':quad.tolist()},0,700)


if __name__=='__main__':unittest.main()
