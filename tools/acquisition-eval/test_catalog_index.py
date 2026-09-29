import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
from catalog_index import open_index, pending_rows, publish, save_batch, load_published_index


class IndexIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'images').mkdir()
        self.source = {'catalogSha256': 'frozen'}
        self.encoder = {'weightsSha256': 'model', 'transform': 'whole-card'}
        self.db = open_index(self.root, self.source, self.encoder, 2)
        self.rows = []
        for i in range(3):
            data = f'fixture-{i}'.encode()
            relative = f'images/{i}.jpg'
            (self.root / relative).write_bytes(data)
            self.rows.append({'referenceId': str(i), 'file': relative, 'sha256': hashlib.sha256(data).hexdigest()})

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def snapshot(self, rows=None, pending=0):
        selected = self.rows if rows is None else rows
        return {'references': selected, 'counts': {'READY': len(selected), 'PENDING': pending, 'UNAVAILABLE': 1},
                'unavailable': [{'referenceId': 'missing'}], 'downloadComplete': pending == 0}

    def test_resume_committed_batches_and_reject_changed_model(self):
        save_batch(self.db, self.rows[:1], np.array([[1., 0.]]), 2)
        self.db.close()
        self.db = open_index(self.root, self.source, self.encoder, 2)
        self.assertEqual([r['referenceId'] for r, _ in pending_rows(self.db, self.rows, self.root, 2)], ['1', '2'])
        with self.assertRaisesRegex(ValueError, 'source/model'):
            open_index(self.root, self.source, {'weightsSha256': 'different'}, 2)
        with self.assertRaisesRegex(ValueError, 'source/model'):
            open_index(self.root, {'catalogSha256': 'new'}, self.encoder, 2)

    def test_bad_batch_rolls_back_all_vectors(self):
        with self.assertRaisesRegex(ValueError, 'normalized'):
            save_batch(self.db, self.rows[:2], np.array([[1., 0.], [np.nan, 0.]]), 2)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM features').fetchone()[0], 0)

    def test_reader_requires_explicit_partial_opt_in_and_checks_published_bytes(self):
        save_batch(self.db, self.rows[:1], np.array([[1., 0.]]), 2)
        report = publish(self.db, self.snapshot(self.rows[:1], pending=2), self.root, 2)
        with self.assertRaisesRegex(ValueError, 'Full catalog'):
            load_published_index(self.root / 'index.json')
        _, records, matrix = load_published_index(self.root / 'index.json', allow_partial=True)
        self.assertEqual(records, self.rows[:1])
        np.testing.assert_array_equal(matrix, [[1., 0.]])
        del matrix
        (self.root / report['files']['references.json']['path']).write_text('[]')
        with self.assertRaisesRegex(ValueError, 'path/digest'):
            load_published_index(self.root / 'index.json', allow_partial=True)

    def test_incomplete_never_claims_complete_and_failed_publish_keeps_previous(self):
        save_batch(self.db, self.rows[:1], np.array([[1., 0.]]), 2)
        report = publish(self.db, self.snapshot(self.rows[:1], pending=2), self.root, 2)
        self.assertFalse(report['downloadComplete'])
        self.assertFalse(report['allReferencesAvailable'])
        previous = (self.root / 'index.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'cover snapshot'):
            publish(self.db, self.snapshot(), self.root, 2)
        self.assertEqual(previous, (self.root / 'index.json').read_bytes())
        vectors = np.load(self.root / report['files']['vectors.npy']['path'], allow_pickle=False)
        np.testing.assert_array_equal(vectors, [[1., 0.]])

    def test_corrupt_cached_vector_or_reference_rejected(self):
        save_batch(self.db, self.rows[:1], np.array([[1., 0.]]), 2)
        self.db.execute("UPDATE features SET vector=? WHERE id='0'", (b'corrupt!',))
        self.db.commit()
        with self.assertRaisesRegex(ValueError, 'digest/size'):
            list(pending_rows(self.db, self.rows, self.root, 2))
        with self.assertRaisesRegex(ValueError, 'digest/size'):
            publish(self.db, self.snapshot(self.rows[:1]), self.root, 2)
        self.assertFalse((self.root / 'index.json').exists())

    def test_source_bytes_and_path_checked_even_when_already_indexed(self):
        save_batch(self.db, self.rows[:1], np.array([[1., 0.]]), 2)
        (self.root / self.rows[0]['file']).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'path/digest'):
            list(pending_rows(self.db, self.rows, self.root, 2))
        with self.assertRaisesRegex(ValueError, 'path/digest'):
            list(pending_rows(self.db, [{**self.rows[0], 'file': '../outside.jpg'}], self.root, 2))

    def test_manifest_matrix_mapping_is_deterministic_and_missing_coverage_explicit(self):
        save_batch(self.db, self.rows[::-1], np.array([[1., 0.], [0., 1.], [-1., 0.]]), 2)
        report = publish(self.db, self.snapshot(), self.root, 2)
        records = json.loads((self.root / report['files']['references.json']['path']).read_text())
        self.assertEqual([r['referenceId'] for r in records], ['0', '1', '2'])
        vectors = np.load(self.root / report['files']['vectors.npy']['path'], allow_pickle=False)
        np.testing.assert_array_equal(vectors, [[-1., 0.], [0., 1.], [1., 0.]])
        self.assertTrue(report['downloadComplete'])
        self.assertFalse(report['allReferencesAvailable'])
        self.assertEqual(report['unavailableCount'], 1)


if __name__ == '__main__':
    unittest.main()
