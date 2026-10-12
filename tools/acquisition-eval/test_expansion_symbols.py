"""Public-asset integrity, complete-symbol extraction and visibility guards."""
from pathlib import Path
import tempfile
import unittest
import cv2
import numpy as np
from expansion_symbols import ExpansionSymbolBank, expansion_symbol_evidence, verified_assets


class SymbolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bank=ExpansionSymbolBank()

    def test_shared_glyphs_keep_family_aliases(self):
        self.assertTrue(any(len(e['codes'])>1 for e in self.bank.entries))
        self.assertTrue(any('SPM' in e['codes'] for e in self.bank.entries))

    def test_complete_known_shapes_survive_raster_scale_and_reverse_polarity(self):
        # Template raster controls exercise extraction, not scanner accuracy.
        for code in ['ATQ','AFR','SPM']:
            entry=next(e for e in self.bank.entries if code in e['codes'])
            for dark in [True,False]:
                patch=np.full((155,170,3),210 if dark else 20,np.uint8)
                mask=cv2.resize(entry['mask'].astype(np.uint8),(58,58),interpolation=cv2.INTER_NEAREST)>0
                patch[45:103,70:128][mask]=20 if dark else 210
                result=self.bank.observe_patch(patch)
                self.assertEqual(result['status'],'SIMILAR',(code,dark,result))
                self.assertEqual(result['matches'][0]['family'],entry['family'])

    def test_blank_text_and_generic_shapes_do_not_claim_a_family(self):
        for kind in ['blank','text','circle','ring','rectangle']:
            patch=np.full((155,170,3),210,np.uint8)
            if kind=='text':cv2.putText(patch,'ARTIFACT',(10,85),cv2.FONT_HERSHEY_SIMPLEX,.5,(20,)*3,1)
            if kind=='circle':cv2.circle(patch,(100,80),27,(20,)*3,-1)
            if kind=='ring':cv2.circle(patch,(100,80),27,(20,)*3,2)
            if kind=='rectangle':cv2.rectangle(patch,(75,55),(125,105),(20,)*3,2)
            self.assertNotEqual(self.bank.observe_patch(patch)['status'],'SIMILAR',kind)

    def test_two_separate_supported_marks_remain_ambiguous(self):
        patch=np.full((155,170,3),210,np.uint8)
        for code,x in [('ATQ',15),('AFR',95)]:
            entry=next(e for e in self.bank.entries if code in e['codes'])
            mask=cv2.resize(entry['mask'].astype(np.uint8),(54,54),interpolation=cv2.INTER_NEAREST)>0
            patch[50:104,x:x+54][mask]=20
        result=self.bank.observe_patch(patch)
        self.assertEqual(result['status'],'AMBIGUOUS',result)
        self.assertEqual(result['reason'],'MULTIPLE_OBSERVED_SHAPES')

    def test_padding_and_small_source_stay_unreadable(self):
        image=np.full((1397,1000,3),210,np.uint8)
        visibility=np.full((1397,1000),255,np.uint8)
        for alignment,mask,reason in [({'status':'UNREADABLE'},visibility,'ALIGNMENT_UNAVAILABLE'),
            ({'status':'ALIGNED','sourceCardWidth':499},visibility,'SOURCE_TOO_SMALL'),
            ({'status':'ALIGNED','sourceCardWidth':1000},np.zeros_like(visibility),'REGION_CLIPPED')]:
            result=expansion_symbol_evidence(image,alignment,image,mask,self.bank)
            self.assertEqual(result['query']['reason'],reason)
            self.assertEqual(result['relation'],'UNRESOLVED')
            self.assertFalse(result['automaticAcceptance'])

    def test_missing_and_changed_font_assets_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError,'unavailable'):verified_assets(folder)
            file=Path(folder)/'fonts/keyrune.ttf';file.parent.mkdir();file.write_bytes(b'changed public font')
            with self.assertRaisesRegex(ValueError,'integrity changed'):verified_assets(folder)


if __name__=='__main__':unittest.main()
