from unittest.mock import patch
import recognize
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

    def test_layout_budget_cannot_displace_previous_footer_observations(self):
        payload={'text':{'title':['known'],'footer':['R 0177'],'footerSourceIdentifiers':['TST EN']},
                 'orientations':[], 'scannerLayout':{'padding':'x'*65535},
                 'scannerLayoutTemplate':{'padding':'y'*1000}}
        result=json.loads(bounded_source_footer_output(payload))
        self.assertEqual(result['text'],{'title':['known'],'footer':['R 0177'],'footerSourceIdentifiers':['TST EN']})
        self.assertNotIn('scannerLayout',result);self.assertNotIn('scannerLayoutTemplate',result)

    def test_inferred_optional_footer_preserves_both_existing_reads_on_failure_or_exhaustion(self):
        original=[{'rotationDegrees':degree,'text':{'title':['kept title'],'footer':['kept footer'],'footerSupplemental':['kept extra']},
                   'lines':[],'footerLines':[]} for degree in (0,180)]
        class FailedOCR:
            calls=0
            def predict(self,image):self.calls+=1;raise RuntimeError('optional source failure')
        for elapsed,reason,calls in [(0,'WORKER_ERROR',2),(28,'TIME_BUDGET',0)]:
            readings=copy.deepcopy(original);engine=FailedOCR()
            with patch.object(recognize.time,'monotonic',return_value=elapsed):
                recognize.append_source_identifiers(self.image,self.geometry,readings,engine,0)
            self.assertEqual(engine.calls,calls)
            for before,after in zip(original,readings):
                for key in ('title','footer','footerSupplemental'):self.assertEqual(after['text'][key],before['text'][key])
                self.assertEqual(after['identifierSource']['reason'],reason)
                self.assertEqual(after['text']['footerSourceIdentifiers'],[]);self.assertEqual(after['identifierLines'],[])

    def test_inferred_footer_views_keep_directions_and_do_not_mutate_source_pixels(self):
        image=self.image.copy();seen=[]
        class SourceOCR:
            def predict(self,view):
                seen.append(view.copy());h,w=view.shape[:2]
                return [{'rec_texts':['DMC EN 0181'],'rec_scores':[.99],
                         'rec_polys':[[[0,0],[w-1,0],[w-1,h-1],[0,h-1]]]}]
        readings=[{'rotationDegrees':degree,'text':{'title':[],'footer':[]},'lines':[],'footerLines':[]} for degree in (0,180)]
        with patch.object(recognize.time,'monotonic',return_value=0):
            recognize.append_source_identifiers(self.image,self.geometry,readings,SourceOCR(),0)
        self.assertEqual(len(seen),2)
        self.assertGreater(min(p[1] for p in readings[0]['identifierSource']['sourceQuad']),1900)
        self.assertLess(max(p[1] for p in readings[1]['identifierSource']['sourceQuad']),500)
        for reading in readings:
            self.assertEqual(reading['identifierSource']['rotationDegrees'],reading['rotationDegrees'])
            self.assertEqual(reading['text']['footerSourceIdentifiers'],['DMC EN 0181'])
            self.assertEqual(reading['identifierLines'][0]['polygon'],[[24.,1270.],[630.,1270.],[630.,1396.],[24.,1396.]])
        np.testing.assert_array_equal(self.image,image)

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
        self.assertEqual(polygon,[[24.,1270.],[630.,1270.],[630.,1396.],[24.,1396.]])
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
