"""Meaningful regressions for timing attribution and scheduling lineage."""
import unittest
from summarize_snapshot import summarize

def fixture():
 def job(identity,stage,source):
  return {'id':identity,'stage':stage,'status':'COMPLETE','artifactId':'a','candidateId':'c','candidateRevision':1,'input':{'digest':'d','model':'m','sourceCatalogJobId':source}}
 return {'readOnly':True,'exportedAt':'frozen','photos':[{'digest':'d'},{'digest':'d'}],
  'candidates':[{'review':None},{'review':{'source':'HUMAN'}}],'invariants':{'inventory':'unchanged'},
  'jobMeta':[job('ocr','photo-recognition-v1','one'),job('cat','photo-catalog-reconciliation-v1','one'),job('p1','photo-printing-evidence-v1','one'),job('p2','photo-printing-evidence-v1','two')],
  'newest':[{'id':'ocr','output':{'native':{'milliseconds':42}}},{'id':'cat','output':{'native':{'milliseconds':99999}}},{'id':'p1','output':{'printingNative':{'milliseconds':150}}},{'id':'p2','output':{'printingNative':{'milliseconds':200}}}]}
class SnapshotTests(unittest.TestCase):
 def test_inherited_ocr_is_not_catalog_time(self):
  result=summarize(fixture())
  self.assertEqual(result['stages']['photo-recognition-v1']['latestNativeTimings']['medianMs'],42)
  self.assertEqual(result['stages']['photo-catalog-reconciliation-v1']['latestNativeTimings']['n'],0)
 def test_lineage_only_repeats_and_revision_is_preserved(self):
  data=fixture();stage='photo-printing-evidence-v1'
  self.assertEqual(summarize(data)['stages'][stage]['repeatedSchedulingInputExcludingLineageIds'],1)
  data['jobMeta'][-1]['candidateRevision']=2
  self.assertEqual(summarize(data)['stages'][stage]['repeatedSchedulingInputExcludingLineageIds'],0)
 def test_model_or_photo_change_prevents_repeat_signature(self):
  for key in ['model','digest']:
   data=fixture();data['jobMeta'][-1]['input'][key]='changed'
   self.assertEqual(summarize(data)['stages']['photo-printing-evidence-v1']['distinctSchedulingInputSignatures'],2)
 def test_unproven_snapshot_rejected(self):
  data=fixture();data['readOnly']=False
  with self.assertRaises(ValueError):summarize(data)
 def test_no_label_inference_from_review(self):
  result=summarize(fixture());self.assertEqual(result['reviewSources'],{'HUMAN':1})
  self.assertEqual(result['uniqueOriginalDigests'],1)
  self.assertNotIn('accuracy',result)
if __name__=='__main__':unittest.main()
