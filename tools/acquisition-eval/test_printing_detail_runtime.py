"""Envelope and reference identity guards with no private pixels or model."""
import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
from printing import valid_reference_uri
from printing_worker import bounded_detail_response


class DetailRuntimeTests(unittest.TestCase):
    def test_preview_identity_matches_public_card_and_face(self):
        identity = '0000419b-0bba-4488-8f7a-6194544ce91e'
        uri = 'https://cards.scryfall.io/normal/front/0/0/' + identity + '.jpg?1783910776'
        self.assertTrue(valid_reference_uri(uri, identity, '0'))
        self.assertFalse(valid_reference_uri(uri, identity, '1'))
        for bad in (uri.replace('https:', 'http:'), uri.replace('cards.scryfall.io', 'localhost'),
                    uri.replace('cards.scryfall.io', 'user:pass@cards.scryfall.io'), uri+'#private',
                    uri+'&token=private'):
            self.assertFalse(valid_reference_uri(bad, identity, '0'))

    def test_twenty_four_faces_keep_legacy_stamp_evidence_when_details_exceed_budget(self):
        value = {'automaticAcceptance': False, 'observedStamp': 'PRESENT', 'candidates': [
            {'referenceId':str(i), 'stamp': {'status':'PRESENT','reason':'OBSERVED'},
             'details':{'padding':'d'*3500}, 'setSymbol':{'padding':'s'*1500}, 'referenceImage':{'uri':'public'}} for i in range(24)]}
        expected = copy.deepcopy(value)
        for row in expected['candidates']:
            del row['details'], row['referenceImage'], row['setSymbol']
        output = bounded_detail_response(value)
        self.assertLessEqual(len(output.encode()), 65535)
        self.assertEqual(json.loads(output), expected)

    def test_under_budget_is_unchanged_and_legacy_overflow_is_not_hidden(self):
        value = {'candidates':[{'details':{'observed':True},'stamp':{'status':'UNREADABLE'}}]}
        before = copy.deepcopy(value)
        self.assertEqual(json.loads(bounded_detail_response(value)), before)
        self.assertEqual(value,before)
        oversized = {'candidates':[], 'legacy':'x'*66000}
        self.assertGreater(len(bounded_detail_response(oversized).encode()),65535)


if __name__ == '__main__':
    unittest.main()
