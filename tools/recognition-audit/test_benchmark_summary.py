import unittest
from summarize_benchmark import summarize

def row(sample,variant,truth=None,auto=None,correct=True):
 return {'sampleId':sample,'variant':variant,'expectedScryfallIds':truth or [],'offlineAutomaticDecision':auto,'exactTop1':correct,'exactRank':1 if correct and truth else None,'route':'EXACT_IDENTIFIER','result':{'proposals':[{}]},'totalMilliseconds':100,'counts':{'printingRegistrations':2},'coldNativeStages':[]}

def report(rows):
 return {'complete':True,'variants':['BASELINE','IDENTIFIER_PARTIAL'],'scope':'TEST','rounds':rows,'limits':[]}

class MetricsTests(unittest.TestCase):
 def test_rejects_incomplete_and_unpaired_results(self):
  value=report([row('a','BASELINE',['id']),row('b','IDENTIFIER_PARTIAL',['id'])])
  with self.assertRaises(ValueError):summarize(value)
  value['complete']=False
  with self.assertRaises(ValueError):summarize(value)
 def test_unknown_targets_are_not_accuracy_successes(self):
  value=report([row('a',v,['id']) for v in ['BASELINE','IDENTIFIER_PARTIAL']]+[row('b',v) for v in ['BASELINE','IDENTIFIER_PARTIAL']])
  result=summarize(value)['variants']['BASELINE']
  self.assertEqual(result['identifiableFronts'],1)
  self.assertEqual(result['unobservableTargets'],1)
  self.assertEqual(result['unobservableTargetsWithSuggestions'],1)
  self.assertEqual(result['exactTop1Rate'],1)
  self.assertEqual(result['offlineAutomaticCoverage'],0)
  self.assertIsNone(result['offlineAcceptancePrecision'])
 def test_wrong_automatic_and_suggestion_errors_are_separate(self):
  value=report([row('a',v,['id'],'wrong',False) for v in ['BASELINE','IDENTIFIER_PARTIAL']])
  result=summarize(value)['variants']['BASELINE']
  self.assertEqual(result['offlineWrongAutomatic'],1)
  self.assertEqual(result['wrongFirstSuggestionsNeedingCorrection'],1)
  self.assertEqual(result['offlineAcceptancePrecision'],0)
 def test_strong_suggestion_is_not_automatic_acceptance(self):
  rows=[row('a',v,['id'],None,False) for v in ['BASELINE','IDENTIFIER_PARTIAL']]
  for value in rows:value['result']['status']='STRONG_MATCH'
  result=summarize(report(rows))['variants']['BASELINE']
  self.assertEqual(result['strongSuggestions'],1)
  self.assertEqual(result['wrongStrongSuggestions'],1)
  self.assertEqual(result['offlineAutomaticDecisions'],0)
 def test_rejects_duplicate_pair(self):
  value=report([row('a',v,['id']) for v in ['BASELINE','IDENTIFIER_PARTIAL']]+[row('a','BASELINE',['id'])])
  with self.assertRaises(ValueError):summarize(value)

if __name__=='__main__':unittest.main()
