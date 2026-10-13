import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from scanner_boundaries import VERSION, initialize, validate_truth, boundary_metrics, score


class ScannerBoundariesTests(unittest.TestCase):
    def truth(self, status='VISIBLE'):
        return {'version': VERSION, 'entries': [{'sampleId':'one','file':'one.png','sha256':'a'*64,'width':120,'height':160,
            'split':'DEVELOPMENT','physicalGroup':None,'expectedScryfallIds':['right'],
            'boundary':{'status':status,'quad':[[10,10],[110,10],[110,150],[10,150]] if status=='VISIBLE' else None,
                        'reviewer':'Operator','reviewedAt':'2026-10-13T00:00:00Z'}}]}

    def report(self, geometry=None, ids=None):
        geometry=geometry or {'status':'PROPOSED','method':'declared-card-scan','quad':[[10,10],[110,10],[110,150],[10,150]]}
        return {'rounds':[{'sampleId':'one','sha256':'a'*64,'variant':'BASELINE',
                         'nativeOCR':{'photoDigest':'a'*64,'geometry':geometry},
                         'result':{'proposals':[{'card':{'id':i}} for i in (ids or ['right'])]}}]}

    def test_exact_boundary_is_not_measured_by_a_declared_frame(self):
        result=score(self.truth(),self.report())
        s=result['summaries']['BASELINE']
        self.assertEqual((s['withinCornerTolerance'],s['measuredWithinTolerance'],s['exactFirst']),(1,0,1))
        self.assertFalse(result['independentPopulationAccuracy'])
        self.assertEqual(result['rows'][0]['boundary']['intersectionOverUnion'],1)

    def test_correct_printing_does_not_hide_bad_crop_and_missing_rows(self):
        g={'status':'PROPOSED','method':'scanner-card-edges','quad':[[20,20],[100,20],[100,140],[20,140]]}
        result=score(self.truth(),self.report(g))
        self.assertEqual(result['summaries']['BASELINE']['correctPrintingOutsideBoundaryTolerance'],1)
        second=copy.deepcopy(self.truth()['entries'][0]);second.update(sampleId='two',file='two.png',sha256='b'*64)
        truth=self.truth();truth['entries'].append(second)
        s=score(truth,self.report())['summaries']['BASELINE']
        self.assertEqual((s['visibleBoundaryLabels'],s['missingObservations'],s['boundarySuccessFraction']),(2,1,.5))

    def test_pending_uncertain_and_clipped_denominators_do_not_invent_accuracy(self):
        for status in ['PENDING','UNCERTAIN','CLIPPED']:
            s=score(self.truth(status),self.report())['summaries']['BASELINE']
            self.assertIsNone(s['boundarySuccessFraction'])
        g={'status':'NEEDS_CROP','framing':'CLIPPED'}
        self.assertEqual(score(self.truth('CLIPPED'),self.report(g))['rows'][0]['boundary']['outcome'],'CLIPPING_REFUSED')
        self.assertEqual(score(self.truth('CLIPPED'),self.report())['rows'][0]['boundary']['outcome'],'CLIPPING_NOT_REFUSED')

    def test_source_frame_duplicate_and_truth_substitution_are_rejected(self):
        for mutate in [lambda t:t['entries'].append(copy.deepcopy(t['entries'][0])),
                       lambda t:t['entries'][0].update(file='../one.png'),
                       lambda t:t['entries'][0]['boundary'].update(quad=[[0,0],[110,150],[110,0],[0,150]]),
                       lambda t:t['entries'][0]['boundary'].update(quad=[[0,0],[120,0],[110,150],[0,150]]),
                       lambda t:t['entries'][0]['boundary'].update(quad=[[False,0],[110,0],[110,150],[0,150]])]:
            truth=self.truth();mutate(truth)
            with self.assertRaises(ValueError):validate_truth(truth)
        r=self.report();r['rounds'][0]['sha256']='b'*64
        with self.assertRaises(ValueError):score(self.truth(),r)
        r=self.report();r['rounds'].append(copy.deepcopy(r['rounds'][0]))
        with self.assertRaises(ValueError):score(self.truth(),r)
        r={'samples':[{'file':'one','sha256':'a'*64,'width':121,'height':160,'geometry':{}}]}
        with self.assertRaises(ValueError):score(self.truth(),r)

    def test_inferred_normalized_region_is_separate_from_primary_and_truth(self):
        r=self.report({'status':'NEEDS_CROP'})
        r['rounds'][0]['nativeOCR']['scannerLayout']={'inference':{'status':'PROPOSED','region':{'quad':[[10/119,10/159],[110/119,10/159],[110/119,150/159],[10/119,150/159]]}}}
        result=score(self.truth(),r);s=result['summaries']['BASELINE']
        self.assertEqual((s['withinCornerTolerance'],s['inferredWithinTolerance']),(0,1))
        self.assertEqual(result['rows'][0]['boundary']['outcome'],'UNAVAILABLE')
        r['rounds'][0]['nativeOCR']['scannerLayout']['inference']['region']['quad'][0][0]=float('nan')
        self.assertEqual(score(self.truth(),r)['rows'][0]['inferredBoundary']['outcome'],'INVALID_GEOMETRY')

    def test_report_claims_never_supply_printing_truth(self):
        r=self.report(ids=['wrong'])
        r['rounds'][0].update(exactTop1=True,expectedScryfallIds=['wrong'])
        result=score(self.truth(),r)
        self.assertFalse(result['rows'][0]['exactFirst'])
        self.assertEqual(result['summaries']['BASELINE']['exactFirst'],0)
        truth=self.truth();truth['entries'][0]['boundary']['reviewer']=''
        with self.assertRaises(ValueError):validate_truth(truth)

    def test_ambiguous_printing_labels_cannot_count_as_exact_success(self):
        truth=self.truth();truth['entries'][0]['expectedScryfallIds']=['right','other']
        result=score(truth,self.report());s=result['summaries']['BASELINE']
        self.assertIsNone(result['rows'][0]['exactFirst'])
        self.assertEqual((s['labelledExactPrintings'],s['ambiguousPrintingLabels']),(0,1))
        self.assertIsNone(s['exactFirstFraction'])

    def test_source_bytes_and_exif_dimensions_are_bound_before_scoring(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);p=root/'one.png';Image.new('RGB',(120,160)).save(p)
            original=p.read_bytes();truth=initialize(root)
            self.assertEqual(truth['entries'][0]['boundary']['status'],'PENDING')
            self.assertEqual(truth['entries'][0]['sha256'],hashlib.sha256(original).hexdigest())
            validate_truth(truth,root)
            truth['entries'][0]['width']=121
            with self.assertRaises(ValueError):validate_truth(truth,root)
            truth=initialize(root);p.write_bytes(original+b'changed')
            with self.assertRaises(ValueError):validate_truth(truth,root)

    def test_corner_matching_rotation_iou_and_invalid_predictions(self):
        q=[[10,10],[110,10],[110,150],[10,150]]
        self.assertEqual(boundary_metrics(q[1:]+q[:1],q,120,160)['maximumCornerErrorPixels'],0)
        g={'status':'PROPOSED','quad':[[0,0],[0,0],[0,0],[0,0]]}
        self.assertEqual(score(self.truth(),self.report(g))['rows'][0]['boundary']['outcome'],'INVALID_GEOMETRY')
        for tolerance in [0,-1,True,float('nan')]:
            with self.assertRaises(ValueError):score(self.truth(),self.report(),tolerance)


if __name__=='__main__':unittest.main()
