import unittest
import copy
import json
import cv2
import numpy as np
from footer_source import source_footer_view,restore_identifier_polygon,bounded_source_footer_output,read_source_footer,BOUNDS


class FooterSourceTests(unittest.TestCase):
    def setUp(self):
        self.image=np.full((2200,1600,3),230,np.uint8)
        self.geometry={'status':'PROPOSED','quad':[[50,50],[1549,50],[1549,2143],[50,2143]]}
        cv2.putText(self.image,'DMC EN 0181',(95,2040),cv2.FONT_HERSHEY_SIMPLEX,1.1,(10,)*3,2)

    def test_original_resolution_is_retained_in_a_smaller_footer_view(self):
        before=self.image.copy()
        view,metadata=source_footer_view(self.image,self.geometry,0)
        self.assertEqual(metadata['status'],'EXTRACTED')
        self.assertGreater(metadata['width'],BOUNDS[2]-BOUNDS[0])
        self.assertLessEqual(metadata['width'],metadata['sourceWidth'])
        self.assertLessEqual(metadata['height'],metadata['sourceHeight'])
        self.assertLessEqual(metadata['width'],1280);self.assertLessEqual(metadata['height'],512)
        self.assertGreater(float(view.std()),5)
        np.testing.assert_array_equal(before,self.image)

    def test_both_reading_directions_keep_their_source_footprints(self):
        a,first=source_footer_view(self.image,self.geometry,0)
        upside_down=cv2.rotate(self.image,cv2.ROTATE_180)
        h,w=self.image.shape[:2]
        quad=[[w-1-x,h-1-y] for x,y in self.geometry['quad']]
        b,second=source_footer_view(upside_down,{'status':'PROPOSED','quad':quad},0)
        np.testing.assert_array_equal(a,b)
        c,reverse=source_footer_view(self.image,self.geometry,180)
        self.assertEqual(reverse['rotationDegrees'],180)
        self.assertLess(max(p[1] for p in reverse['sourceQuad']),500)

    def test_masked_clipped_or_unsupported_geometry_does_not_read_padding(self):
        for geometry,reason in [({'status':'NEEDS_CROP'},'GEOMETRY_UNAVAILABLE'),
            ({**self.geometry,'framing':'CLIPPED'},'PHYSICAL_CLIPPING'),
            ({'status':'PROPOSED','quad':[[0,0],[300,0],[300,400],[0,400]]},'SOURCE_TOO_SMALL'),
            ({'status':'PROPOSED','quad':[[50,50],[1549,50],[1549,2500],[50,2500]]},'REGION_CLIPPED')]:
            view,metadata=source_footer_view(self.image,geometry,0)
            self.assertIsNone(view);self.assertEqual(metadata['reason'],reason)

    def test_restored_polygons_are_bounded_in_oriented_card_coordinates(self):
        _,metadata=source_footer_view(self.image,self.geometry,0)
        w,h=metadata['width'],metadata['height']
        polygon=restore_identifier_polygon([[0,0],[w-1,0],[w-1,h-1],[0,h-1]],metadata)
        self.assertEqual(polygon,[[24.,1230.],[630.,1230.],[630.,1396.],[24.,1396.]])
        for invalid in [[[0,-1],[10,0],[10,10],[0,10]],[[0,0],[w,0],[w,h],[0,h]],
            [[0,0],[10,0],[float('nan'),10],[0,10]]]:self.assertIsNone(restore_identifier_polygon(invalid,metadata))

    def test_optional_source_data_cannot_displace_legacy_readings_at_the_output_limit(self):
        text={'title':['unchanged'],'footer':['ABC EN','17'],'footerSourceIdentifiers':['s'*40000]}
        payload={'text':text,'orientations':[{'text':text,'lines':[{'original':True}],'identifierSource':{'extra':'s'*40000},'identifierLines':[]}],'legacy':'kept'}
        expected={'text':{'title':['unchanged'],'footer':['ABC EN','17']},'orientations':[{'text':{'title':['unchanged'],'footer':['ABC EN','17']},'lines':[{'original':True}]}],'legacy':'kept'}
        self.assertEqual(json.loads(bounded_source_footer_output(payload)),expected)
        self.assertGreater(len(bounded_source_footer_output({'legacy':'l'*66000}).encode()),65535)

    def test_under_budget_keeps_all_source_provenance_without_mutation(self):
        payload={'text':{'title':[],'footer':[],'footerSourceIdentifiers':['DMC EN']},'orientations':[]}
        before=copy.deepcopy(payload)
        self.assertEqual(json.loads(bounded_source_footer_output(payload)),before)
        self.assertEqual(payload,before)

    def test_extra_failure_and_budget_limits_return_no_partial_claim(self):
        class FailingOCR:
            def predict(self,image):raise RuntimeError('extra failure')
        for remaining,elapsed,reason in [(100,0,'WORKER_ERROR'),(100,28,'TIME_BUDGET'),(0,0,'EVIDENCE_BUDGET')]:
            words,lines,source=read_source_footer(self.image,self.geometry,0,FailingOCR(),remaining,elapsed)
            self.assertEqual(words,[]);self.assertEqual(lines,[]);self.assertEqual(source['reason'],reason)


if __name__=='__main__':unittest.main()
