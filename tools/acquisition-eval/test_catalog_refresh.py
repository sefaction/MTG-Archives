import gzip
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
from catalog_index import load_published_index
from catalog_refresh import refresh, validate_metadata
from catalog_references import Downloader


def card(n, version=1, **fields):
    identity = f'00000000-0000-4000-8000-{n:012d}'
    return {'id': identity, 'name': f'Card {n}', 'set': 'tst', 'collector_number': str(n),
            'lang': 'en', 'image_status': 'highres_scan',
            'image_uris': {'normal': f'https://cards.scryfall.io/normal/front/{identity}.jpg?{version}'}, **fields}


def jpeg(color):
    output = io.BytesIO()
    Image.new('RGB', (63, 88), color).save(output, format='JPEG')
    return output.getvalue()


class Encoder:
    dimension = 2
    def __init__(self, version=1, fail_on=None):
        self.identity = {'name': 'fixture', 'weightsSha256': str(version), 'transform': 'fixture'}
        self.calls = 0
        self.fail_on = fail_on

    def embed(self, images):
        self.calls += 1
        if self.calls == self.fail_on:
            raise RuntimeError('Interrupted feature batch')
        return np.array([[1., 0.] for _ in images], dtype='<f4')


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.refs, self.index, self.state = [self.root / p for p in ('references', 'index', 'state')]
        self.fetches = []
        def fetch(_downloader, row):
            self.fetches.append(row['url'])
            return jpeg('red' if row['url'].endswith('?2') else 'blue')
        self.patch = patch.object(Downloader, 'fetch', fetch)
        self.patch.start()
        self.initial = self.run_pass([card(1), card(2)])
        self.previous = (self.index / 'index.json').read_bytes()
        self.fetches.clear()

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def run_pass(self, cards, encoder=None):
        data = ''.join(json.dumps(c) + '\n' for c in cards).encode()
        source = self.root / (hashlib.sha256(data).hexdigest() + '.gz')
        if not source.exists():
            source.write_bytes(gzip.compress(data, mtime=0))
        return refresh(source, self.refs, self.index, self.root, self.state,
                       encoder_factory=lambda: encoder or Encoder())

    def test_update_reuses_unchanged_bytes_and_vectors_but_refreshes_metadata(self):
        old_manifest, old_rows, old_matrix = load_published_index(self.index / 'index.json')
        del old_matrix
        old_image = self.refs / old_rows[0]['file']
        result = self.run_pass([card(1, name='Corrected public name'), card(2, version=2), card(3),
                                card(4, image_status='placeholder')])
        self.assertEqual((result['reusedImages'], result['downloadedImages'], result['reusedVectors'], result['newVectors']),
                         (1, 2, 1, 2))
        self.assertEqual(len(self.fetches), 2)
        manifest, rows, matrix = load_published_index(self.index / 'index.json')
        del matrix
        self.assertEqual(manifest['unavailableCount'], 1)
        row = next(r for r in rows if r['cardId'] == card(1)['id'])
        self.assertEqual(row['name'], 'Corrected public name')
        self.assertEqual(old_image, self.refs / row['file'], 'unchanged images are shared, not duplicated')
        archived = self.index / ('manifest-' + hashlib.sha256(self.previous).hexdigest() + '.json')
        old, _, matrix = load_published_index(archived)
        self.assertEqual(old, old_manifest)
        del matrix
        self.assertEqual(old_image.read_bytes(), jpeg('blue'))
        self.assertIn('verifiedStat', row)
        self.fetches.clear()
        unchanged = self.run_pass([card(1, name='Corrected public name'), card(2, version=2), card(3),
                                   card(4, image_status='placeholder')])
        self.assertFalse(unchanged['published'])
        self.assertEqual(self.fetches, [])

    def test_interruption_keeps_active_generation_and_resumes_saved_feature_batches(self):
        cards = [card(n) for n in range(1, 18)]
        with self.assertRaisesRegex(RuntimeError, 'Interrupted'):
            self.run_pass(cards, Encoder(fail_on=2))
        self.assertEqual((self.index / 'index.json').read_bytes(), self.previous)
        self.assertEqual(len(self.fetches), 15)
        self.fetches.clear()
        result = self.run_pass(cards)
        self.assertEqual(result['newVectors'], 7, 'the first committed eight new vectors survived')
        self.assertEqual(self.fetches, [], 'received public images are not downloaded again')
        changed_model = self.run_pass(cards, Encoder(version=2))
        self.assertEqual(changed_model['reusedVectors'], 0)
        self.assertEqual(changed_model['newVectors'], 17)

    def test_model_loading_is_deferred_until_public_reference_preparation_finishes(self):
        source = self.root / 'deferred.gz'
        source.write_bytes(gzip.compress(''.join(json.dumps(card(n))+'\n' for n in range(1,5)).encode(), mtime=0))
        def factory():
            self.assertEqual(len(self.fetches), 2, 'new image transfers finish before allocating model memory')
            return Encoder()
        result = refresh(source, self.refs, self.index, self.root, self.state, encoder_factory=factory)
        self.assertEqual(result['newVectors'], 2)

    def test_reuse_receipt_avoids_repeat_reads_and_changed_file_still_fails(self):
        # New catalog metadata with unchanged public assets only stats the verified
        # receipt; it must not read/decode all images again. Native per-use hash
        # checks are separate and unchanged.
        real_open = Path.open
        def open_file(path, *args, **kwargs):
            if path.suffix == '.jpg':
                raise AssertionError('unchanged public bytes reread')
            return real_open(path, *args, **kwargs)
        with patch.object(Path, 'open', open_file):
            self.run_pass([card(1, name='Changed metadata'), card(2)])
        _, rows, matrix = load_published_index(self.index / 'index.json')
        del matrix
        (self.refs / rows[0]['file']).write_bytes(jpeg('red'))
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.run_pass([card(1, name='Later metadata'), card(2)])

    def test_provider_or_reference_corruption_cannot_activate_partial_generation(self):
        with patch.object(Downloader, 'fetch', side_effect=RuntimeError('HTTP_429_STOP')):
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                self.run_pass([card(1), card(2), card(3)])
        self.assertEqual((self.index / 'index.json').read_bytes(), self.previous)
        _, rows, matrix = load_published_index(self.index / 'index.json')
        del matrix
        (self.refs / rows[0]['file']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.run_pass([card(1), card(2), card(4)])
        self.assertEqual((self.index / 'index.json').read_bytes(), self.previous)

    def test_bulk_metadata_rejects_other_origins_redirect_credentials_and_bounds(self):
        meta = {'type': 'default_cards', 'updated_at': '2026-09-28T00:00:00Z',
                'jsonl_download_uri': 'https://data.scryfall.io/default-cards/version.jsonl.gz', 'compressed_size': 100}
        self.assertEqual(validate_metadata(meta), meta)
        for update in ({'compressed_size': True}, {'compressed_size': 2**31}, {'type': 'all_cards'},
                       {'jsonl_download_uri': 'https://data.scryfall.io.evil/default-cards/version.jsonl.gz'},
                       {'jsonl_download_uri': 'https://user:secret@data.scryfall.io/default-cards/version.jsonl.gz'},
                       {'jsonl_download_uri': 'https://data.scryfall.io/default-cards/version.jsonl.gz?redirect=other'}):
            with self.assertRaises(ValueError):
                validate_metadata({**meta, **update})

    def test_generated_cache_retention_preserves_baseline_images_and_unknown_files(self):
        sentinel = self.state / 'operator-notes.txt'
        sentinel.write_text('keep')
        for n in range(4):
            result = self.run_pass([card(1, name=f'Updated {n}'), card(2)])
        self.assertGreater(result['retiredIndexFiles'], 0)
        archived = self.index / ('manifest-' + hashlib.sha256(self.previous).hexdigest() + '.json')
        _, rows, matrix = load_published_index(archived)
        del matrix
        self.assertTrue(all((self.refs / row['file']).exists() for row in rows))
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertEqual(list(self.state.glob('features-*/features.sqlite')), [])


if __name__ == '__main__':
    unittest.main()
