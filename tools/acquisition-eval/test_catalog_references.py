import gzip
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from catalog_references import references, open_plan, atomic_image, report, reuse_images, writer_lock, image_url
from catalog_snapshot import snapshot


def card(number=1, **values):
    identity = f'00000000-0000-4000-8000-{number:012d}'
    return {'id': identity, 'name': 'Same name', 'set': 'tst',
            'collector_number': str(number), 'lang': 'en',
            'image_status': 'highres_scan',
            'image_uris': {'normal': f'https://cards.scryfall.io/normal/front/{identity}.jpg?1'},
            **values}


def catalog(root, cards):
    path = root / 'catalog.jsonl.gz'
    with gzip.open(path, 'wt', encoding='utf-8') as output:
        for value in cards:
            output.write(json.dumps(value) + '\n')
    return path


def jpeg():
    out = io.BytesIO()
    Image.new('RGB', (63, 88), 'blue').save(out, format='JPEG')
    return out.getvalue()


class CatalogReferencesTest(unittest.TestCase):
    @unittest.skipIf(os.name == 'nt', 'POSIX restricted-reader permissions')
    def test_public_images_are_readable_and_permission_changes_stay_in_store(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'images').mkdir(mode=0o700)
            previous = os.umask(0o077)
            try:
                row = references(card())[0]
                atomic_image(root, row, jpeg())
            finally:
                os.umask(previous)
            self.assertEqual((root / row['file']).stat().st_mode & 0o777, 0o644)
            self.assertEqual((root / 'images').stat().st_mode & 0o777, 0o755)
            with self.assertRaisesRegex(ValueError, 'escapes image directory'):
                atomic_image(root, {**row, 'file': '../outside.jpg'}, jpeg())
            self.assertFalse((root.parent / 'outside.jpg').exists())

    def test_snapshot_reads_committed_wal_and_keeps_missing_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'images').mkdir()
            db, _ = open_plan(root, catalog(root, [card(), card(2), card(3, image_uris={})]))
            row = references(card())[0]
            digest, size = atomic_image(root, row, jpeg())
            db.execute("UPDATE refs SET state='READY',digest=?,bytes=? WHERE id=?", (digest, size, row['referenceId']))
            db.commit()
            db.execute("UPDATE refs SET state='FAILED' WHERE state='PENDING'")
            target = root / 'snapshot.json'
            result = snapshot(root, target)
            value = json.loads(target.read_text(encoding='utf-8'))
            self.assertEqual(result['counts'], {'PENDING': 1, 'READY': 1, 'UNAVAILABLE': 1})
            self.assertEqual(value['references'][0]['sha256'], digest)
            self.assertEqual(len(value['unavailable']), 1)
            self.assertFalse(result['downloadComplete'])
            db.rollback()
            db.close()

    def test_all_printings_and_both_faces_are_kept_with_identity(self):
        one, two = card(), card(2)
        faces = card(3, image_uris={}, card_faces=[
            {'name': 'Front', 'image_uris': one['image_uris']},
            {'name': 'Back', 'image_uris': two['image_uris']}])
        rows = references(one) + references(two) + references(faces)
        self.assertEqual(len(rows), 4)
        self.assertEqual(len({r['referenceId'] for r in rows}), 4)
        self.assertEqual([r['faceName'] for r in rows[-2:]], ['Front', 'Back'])
        self.assertEqual({r['cardId'] for r in rows[-2:]}, {faces['id']})
        self.assertEqual(references(card(digital=True)), [])

    def test_placeholder_and_missing_images_are_explicitly_unavailable(self):
        self.assertEqual(references(card(image_status='placeholder'))[0]['unavailable'], 'PLACEHOLDER_IMAGE')
        self.assertEqual(references(card(image_uris={}))[0]['unavailable'], 'MISSING_IMAGE')
        for url in ['http://cards.scryfall.io/a.jpg', 'https://evil.test/a.jpg',
                    'https://user:secret@cards.scryfall.io/a.jpg',
                    'https://cards.scryfall.io:444/a.jpg']:
            with self.assertRaises(ValueError):
                image_url(url)

    def test_resume_keeps_committed_images_and_rejects_changed_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'images').mkdir()
            source = catalog(root, [card(), card(2, image_status='placeholder')])
            db, meta = open_plan(root, source)
            row = references(card())[0]
            digest, length = atomic_image(root, row, jpeg())
            db.execute("UPDATE refs SET state='READY',digest=?,bytes=? WHERE id=?", (digest, length, row['referenceId']))
            db.commit()
            db.close()
            db, same = open_plan(root, source)
            self.assertEqual(same, meta)
            progress = report(db, root, meta)
            self.assertTrue(progress['downloadComplete'])
            self.assertFalse(progress['allReferencesAvailable'])
            self.assertEqual(progress['counts'], {'READY': 1, 'UNAVAILABLE': 1})
            db.close()
            source = catalog(root, [card(3)])
            with self.assertRaises(ValueError):
                open_plan(root, source)

    def test_duplicate_source_rolls_back_plan_instead_of_partial_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaises(ValueError):
                open_plan(root, catalog(root, [card(), card()]))
            db, meta = open_plan(root, catalog(root, [card()]))
            self.assertEqual(meta['paperCards'], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM refs').fetchone()[0], 1)
            self.assertFalse(report(db, root, meta)['downloadComplete'])
            db.close()

    def test_corrupt_reused_image_and_invalid_new_bytes_are_not_published(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'images').mkdir()
            db, _ = open_plan(root, catalog(root, [card()]))
            row = references(card())[0]
            with self.assertRaises(Exception):
                atomic_image(root, row, b'not an image')
            self.assertFalse((root / row['file']).exists())
            (root / 'old.jpg').write_bytes(jpeg())
            index = root / 'old.json'
            index.write_text(json.dumps({'references': [{'url': row['url'], 'file': 'old.jpg', 'sha256': '0' * 64}], 'errors': []}))
            with self.assertRaises(ValueError):
                reuse_images(db, root, index)
            self.assertEqual(db.execute('SELECT state FROM refs').fetchone()[0], 'PENDING')
            db.close()

    def test_writer_lock_is_released_and_stale_filename_can_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with writer_lock(root):
                with self.assertRaises(OSError):
                    with writer_lock(root):
                        self.fail('Second writer acquired the active lock')
            with writer_lock(root):
                self.assertTrue((root / 'writer.lock').exists())


if __name__ == '__main__':
    unittest.main()
