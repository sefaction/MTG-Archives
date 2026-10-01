import unittest
from compare_benchmark import compare
from test_benchmark_summary import row, report

class ComparisonTests(unittest.TestCase):
    def fixture(self):
        entries = [{'sampleId': identity, 'sha256': identity, 'expectedScryfallIds': ['id'], 'conservativeGroup': 'one-printing'} for identity in ['a', 'b']]
        rows = [row(identity, variant, ['id'], None, not (variant == 'IDENTIFIER_PARTIAL' and identity == 'b')) for identity in ['a', 'b'] for variant in ['BASELINE', 'IDENTIFIER_PARTIAL']]
        for value in rows:
            value['sha256'] = value['sampleId']
        return report(rows), {'entries': entries}

    def test_group_correlation_does_not_invent_two_independent_printings(self):
        observations, manifest = self.fixture()
        result = compare(observations, manifest)['comparisons']['IDENTIFIER_PARTIAL']
        self.assertEqual(result['printingGroups'], 1)
        self.assertEqual(result['groupsWithEveryImageCorrect'], 0)
        self.assertEqual(result['groupsWithAnyWrongImage'], 1)
        self.assertEqual(result['pairedAccuracyLosses'], 1)

    def test_missing_or_changed_original_rejected(self):
        observations, manifest = self.fixture()
        observations['rounds'][0]['sha256'] = 'changed'
        with self.assertRaises(ValueError):
            compare(observations, manifest)
        observations, manifest = self.fixture()
        manifest['entries'].pop()
        with self.assertRaises(ValueError):
            compare(observations, manifest)

if __name__ == '__main__':
    unittest.main()
