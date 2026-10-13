import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'acquisition-eval'))
import contextlib,io,json,struct
from unittest.mock import patch
from PIL import Image
import recognize
import copy
import unittest
import cv2
import numpy as np
from scanner_layout import make_scanner_layout, infer_scanner_layout, scanner_layout_search_region, POLICY


class ScannerLayoutTests(unittest.TestCase):
    def setUp(self):
        self.image = np.full((2300, 1700, 3), 180, np.uint8)
        cv2.rectangle(self.image, (50, 30), (1650, 2270), (230,)*3, -1)
        cv2.rectangle(self.image, (50, 30), (1650, 2270), (10,)*3, 12)
        self.quad = np.float32([[50, 30], [1650, 30], [1650, 2270], [50, 2270]])
        self.manual = {'status': 'PROPOSED', 'method': 'manual-card-region-v1', 'quad': self.quad.tolist()}
        self.direct = {'status': 'PROPOSED', 'method': 'declared-card-scan', 'quad': [[0,0],[1699,0],[1699,2299],[0,2299]]}
        self.polygons = {'TITLE': [[60,80],[500,80],[500,115],[60,115]],
                         'COLLECTOR': [[40,1290],[150,1290],[150,1320],[40,1320]]}
        self.source = {'rotationDegrees': 0, 'lines': [{'text': 'First Card', 'score': .97, 'polygon': self.polygons['TITLE']}],
                       'footerLines': [{'text': 'R 0177', 'score': .98, 'polygon': self.polygons['COLLECTOR']}]}
        self.profile = make_scanner_layout(self.image, self.manual, [self.source], 'a'*64)
        self.assertIsNotNone(self.profile)

    def observation(self, dx=8, dy=-6, degrees=0, title_dx=0):
        result = {'rotationDegrees': degrees, 'lines': [], 'footerLines': []}
        for kind, points in self.polygons.items():
            # Independent known rectangle fixture: no inferred geometry enters
            # these actual-source coordinates or the expected corner positions.
            points = np.asarray(points, np.float64)
            if degrees == 180:
                points = [999,1396]-points
            points = points/[999,1396]*[1600,2240]+[50+dx,30+dy]
            if kind == 'TITLE':
                points[:,0] += title_dx
            points = points/[1699,2299]*[999,1396]
            if degrees == 180:
                points = [999,1396]-points
            line = {'text': 'Different Card' if kind == 'TITLE' else 'U 0042', 'score': .99, 'polygon': points.tolist()}
            result['lines' if kind == 'TITLE' else 'footerLines'].append(line)
        return result

    def test_printed_anchors_restore_a_shifted_card_in_both_directions(self):
        before = self.image.copy()
        for degrees in (0,180):
            result = infer_scanner_layout(self.image,self.direct,[self.observation(degrees=degrees)],self.profile)
            self.assertEqual(result['status'],'PROPOSED')
            self.assertFalse(result['boundaryVerified'])
            self.assertEqual(result['rotationDegrees'],degrees)
            np.testing.assert_allclose(np.asarray(result['region']['quad'])*[1699,2299],self.quad+[8,-6],atol=.001)
            self.assertEqual(result['observedAnchors'],['COLLECTOR','TITLE'])
        np.testing.assert_array_equal(before,self.image)
        self.assertNotIn('First Card',str(self.profile))
        self.assertNotIn('0177',str(self.profile))

    def test_collector_alone_can_anchor_a_known_layout_with_unreadable_title(self):
        reading = self.observation();reading['lines'] = []
        result = infer_scanner_layout(self.image,self.direct,[reading],self.profile)
        self.assertEqual(result['status'],'PROPOSED');self.assertEqual(result['observedAnchors'],['COLLECTOR'])
        self.assertFalse(result['boundaryVerified'])

    def test_conflicting_positions_large_displacement_and_blank_reading_reject(self):
        for readings in [[],[self.observation(title_dx=60)],[self.observation(dx=80)],
                         [self.observation(degrees=0),self.observation(degrees=180)]]:
            result = infer_scanner_layout(self.image,self.direct,readings,self.profile)
            self.assertEqual(result['status'],'REJECTED')
        reading = self.observation()
        reading['footerLines'].append({**reading['footerLines'][0],'text':'U 0043'})
        self.assertEqual(infer_scanner_layout(self.image,self.direct,[reading],self.profile)['status'],'REJECTED')

    def test_physical_clipping_and_measured_or_manual_geometry_win(self):
        for direct,reason in [({**self.direct,'framing':'CLIPPED'},'PHYSICAL_CLIPPING'),
            ({**self.direct,'method':'scanner-card-edges'},'DIRECT_GEOMETRY_AUTHORITATIVE'),
            ({**self.direct,'method':'manual-card-region-v1'},'DIRECT_GEOMETRY_AUTHORITATIVE')]:
            self.assertEqual(infer_scanner_layout(self.image,direct,[self.observation()],self.profile)['reason'],reason)
        self.assertEqual(infer_scanner_layout(self.image,self.direct,[self.observation()],self.profile,'PHOTO')['reason'],'SCANNER_ONLY')

    def test_mismatched_frame_unknown_policy_and_unobserved_pixels_cannot_be_assumed(self):
        self.assertEqual(infer_scanner_layout(self.image[:-100],self.direct,[self.observation()],self.profile)['reason'],'FRAME_MISMATCH')
        self.assertEqual(infer_scanner_layout(self.image,self.direct,[self.observation()],{**self.profile,'policy':'future'})['reason'],'UNSUPPORTED_POLICY')
        bad = copy.deepcopy(self.profile);bad['region']['quad'][0][0] = -.01
        self.assertEqual(infer_scanner_layout(self.image,self.direct,[self.observation()],bad)['reason'],'INVALID_PROFILE')
        bad = copy.deepcopy(self.profile);bad['anchors'][0]['point'][0] = float('nan')
        self.assertEqual(infer_scanner_layout(self.image,self.direct,[self.observation()],bad)['reason'],'INVALID_PROFILE')

    def test_vertical_autocrop_keeps_card_pixel_size_and_requires_two_anchors(self):
        image = np.pad(self.image, ((0,20),(0,0),(0,0)), constant_values=180)
        direct = {**self.direct, 'quad': [[0,0],[1699,0],[1699,2319],[0,2319]]}
        reading = self.observation()
        for line in reading['lines']+reading['footerLines']:
            line['polygon'] = (np.asarray(line['polygon'])*[1,2299/2319]).tolist()
        result = infer_scanner_layout(image,direct,[reading],self.profile)
        self.assertEqual(result['status'],'PROPOSED')
        np.testing.assert_allclose(np.asarray(result['region']['quad'])*[1699,2319],self.quad+[8,-6],atol=.001)
        reading['lines']=[]
        self.assertEqual(infer_scanner_layout(image,direct,[reading],self.profile)['status'],'REJECTED')
        for bad in [None, {**self.profile,'sourceMethod':'declared-card-scan'}, {**self.profile,'sourceDigest':'bad'}]:
            self.assertEqual(infer_scanner_layout(image,direct,[],bad)['status'],'REJECTED')

    def test_saved_placement_finds_current_anchors_outside_generic_footer(self):
        image=np.full((2300,1600,3),235,np.uint8)
        quad=np.float32([[100,200],[1500,200],[1500,2155],[100,2155]])
        direct={'status':'PROPOSED','method':'declared-card-scan','quad':[[0,0],[1599,0],[1599,2299],[0,2299]]}
        profile=make_scanner_layout(image,{**self.manual,'quad':quad.tolist()},[self.source],'a'*64)
        normal={'rotationDegrees':0,'lines':[],'footerLines':[]}
        guided=copy.deepcopy(normal)
        for kind,points in self.polygons.items():
            physical=np.asarray(points)/[999,1396]*[1400,1955]+[108,194]
            line={'text':'Different Card' if kind=='TITLE' else 'U 0042','score':.99,
                  'polygon':(physical/[1599,2299]*[999,1396]).tolist()}
            key='lines' if kind=='TITLE' else 'footerLines';normal[key].append(line)
            guided[key].append({**line,'polygon':((physical-[100,200])/[1400,1955]*[999,1396]).tolist()})
        self.assertEqual(infer_scanner_layout(image,direct,[normal],profile)['status'],'REJECTED')
        search=scanner_layout_search_region(image,direct,profile)
        self.assertIsNotNone(search);guide_quad=np.asarray(search['quad'])*[1599,2299]
        result=infer_scanner_layout(image,direct,[guided],profile,observation_quad=guide_quad)
        self.assertEqual(result['status'],'PROPOSED');self.assertEqual(result['anchorSpace'],'LAYOUT_SEARCH')
        self.assertEqual(result['observedAnchors'],['COLLECTOR','TITLE']);self.assertFalse(result['boundaryVerified'])
        np.testing.assert_allclose(np.asarray(result['region']['quad'])*[1599,2299],quad+[8,-6],atol=.001)
        guided['lines']=[]
        self.assertEqual(infer_scanner_layout(image,direct,[guided],profile,observation_quad=guide_quad)['status'],'REJECTED')
        self.assertEqual(infer_scanner_layout(image,direct,[],profile,observation_quad=guide_quad+[1,0])['reason'],'INVALID_PROFILE')
        for blocked in [{**direct,'framing':'CLIPPED'},{**direct,'method':'scanner-card-edges'},self.manual]:
            self.assertIsNone(scanner_layout_search_region(image,blocked,profile))
        self.assertIsNone(scanner_layout_search_region(image,direct,profile,'PHOTO'))
        bad=copy.deepcopy(profile);bad['anchors']=bad['anchors'][:1]
        self.assertIsNone(scanner_layout_search_region(image,direct,bad))

    def test_failed_or_late_guide_search_preserves_completed_primary_output(self):
        buffer=io.BytesIO();Image.new('RGB',(1700,2300),(235,)*3).save(buffer,format='PNG');data=buffer.getvalue()
        metadata=json.dumps({'inputKind':'CARD_SCAN','scannerLayoutProfile':json.dumps(self.profile,separators=(',',':'))}).encode()
        frame=len(metadata).to_bytes(4,'big')+metadata+data
        for late,expected_calls in [(False,7),(True,6)]:
            class Engine:
                calls=0
                def predict(self,view):
                    self.calls+=1
                    if self.calls>6:raise RuntimeError('optional guide failure')
                    return []
            engine=Engine();clock_calls=0
            def clock():
                nonlocal clock_calls
                clock_calls+=1
                return 12 if late and clock_calls>1 else 0
            output=io.StringIO()
            with patch.object(recognize,'ocr_engine',return_value=engine),patch.object(recognize.time,'monotonic',side_effect=clock),patch.object(sys,'__stdout__',output),contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                recognize.recognize(frame,{'digest':'b'*64})
            result=json.loads(output.getvalue())
            self.assertEqual(engine.calls,expected_calls)
            self.assertEqual(result['geometry']['method'],'declared-card-scan')
            self.assertEqual([o['text']['title'] for o in result['orientations']],[[],[]])
            self.assertEqual([o['text']['footer'] for o in result['orientations']],[[],[]])
            self.assertEqual(result['scannerLayout']['inference']['status'],'REJECTED')
            self.assertNotIn('anchorSearch',result['scannerLayout'])
            self.assertFalse(result['automaticAcceptance'])

    def test_declared_background_trim_and_clipped_sources_cannot_train_a_layout(self):
        for geometry in [self.direct,{**self.manual,'method':'scanner-background-trim'},
                         {**self.manual,'framing':'CLIPPED'}]:
            self.assertIsNone(make_scanner_layout(self.image,geometry,[self.source],'a'*64))
        self.assertIsNone(make_scanner_layout(self.image,self.manual,[self.source],'a'*64,'PHOTO'))
        ambiguous = copy.deepcopy(self.source);ambiguous['rotationDegrees'] = 180
        self.assertIsNone(make_scanner_layout(self.image,self.manual,[self.source,ambiguous],'a'*64))


if __name__ == '__main__':
    unittest.main()

