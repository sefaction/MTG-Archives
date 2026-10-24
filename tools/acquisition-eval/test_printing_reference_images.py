"""Verified reference-image snapshots; synthetic pixels, no models or labels."""
from collections import OrderedDict
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
import printing
from catalog_references import MAX_IMAGE_BYTES


class ReferenceImageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'references'
        self.root.mkdir()
        self.path = self.root / 'reference.png'
        self.original = self.encoded('red')
        self.replacement = self.encoded('blue')
        self.path.write_bytes(self.original)
        self.digest = hashlib.sha256(self.original).hexdigest()
        self.runtime = printing.PrintingRuntime.__new__(printing.PrintingRuntime)
        self.runtime.root = self.root
        self.runtime.records = {'card:0': {'cardId': 'card', 'file': self.path.name, 'sha256': self.digest}}
        self.runtime.annotations = {'card:0': {'sha256': self.digest, 'stamp': 'PRESENT'}}
        self.runtime.cache = OrderedDict()
        self.runtime.cache_array_bytes = 0
        feature_patch = patch.object(printing, 'registration_features', return_value=(None, [], None, None))
        self.features = feature_patch.start()
        self.addCleanup(feature_patch.stop)

    @staticmethod
    def encoded(color):
        with io.BytesIO() as stream:
            Image.new('RGB', (8, 8), color).save(stream, format='PNG')
            return stream.getvalue()

    def assert_original(self, entry):
        np.testing.assert_array_equal(entry[0], np.full((8, 8, 3), (0, 0, 255), dtype=np.uint8))
        self.assertEqual(entry[1], 'PRESENT')
        self.assertEqual(self.runtime.cache_array_bytes, entry[0].nbytes)
        self.assertIs(self.runtime.cache['card:0'], entry)

    def test_unchanged_pixels_annotation_and_cache_accounting(self):
        self.assert_original(self.runtime.reference('card:0'))
        self.features.assert_called_once()

    def test_path_replacement_after_hash_cannot_change_decoded_pixels(self):
        original_open = Image.open

        def replace_before_decode(value, *args, **kwargs):
            self.path.write_bytes(self.replacement)
            return original_open(value, *args, **kwargs)

        with patch.object(printing.Image, 'open', side_effect=replace_before_decode):
            self.assert_original(self.runtime.reference('card:0'))
        self.assertEqual(self.path.read_bytes(), self.replacement)

    def test_changed_bytes_are_refused_before_decode_features_or_cache(self):
        self.path.write_bytes(self.replacement)
        with patch.object(printing.Image, 'open') as decode:
            with self.assertRaisesRegex(ValueError, 'Printing reference integrity changed'):
                self.runtime.reference('card:0')
        decode.assert_not_called()
        self.features.assert_not_called()
        self.assertEqual(self.runtime.cache, {})
        self.assertEqual(self.runtime.cache_array_bytes, 0)

    def test_outside_root_is_refused_before_file_read(self):
        self.runtime.records['card:0']['file'] = '../outside.png'
        with patch.object(Path, 'open') as opened:
            with self.assertRaisesRegex(ValueError, 'Printing reference integrity changed'):
                self.runtime.reference('card:0')
        opened.assert_not_called()
        self.features.assert_not_called()

    def test_oversized_reference_reads_only_existing_limit_plus_one(self):
        requested = []

        class Oversized(io.BytesIO):
            def read(self, length=-1):
                requested.append(length)
                return super().read(length)

        with patch.object(Path, 'open', return_value=Oversized(b'x' * (MAX_IMAGE_BYTES + 2))), patch.object(printing.Image, 'open') as decode:
            with self.assertRaisesRegex(ValueError, 'Printing reference integrity changed'):
                self.runtime.reference('card:0')
        self.assertEqual(requested, [MAX_IMAGE_BYTES + 1])
        decode.assert_not_called()
        self.features.assert_not_called()
        self.assertEqual(self.runtime.cache, {})

    def test_exact_existing_byte_limit_is_accepted(self):
        data = self.original + b'\0' * (MAX_IMAGE_BYTES - len(self.original))
        self.path.write_bytes(data)
        digest = hashlib.sha256(data).hexdigest()
        self.runtime.records['card:0']['sha256'] = digest
        self.runtime.annotations['card:0']['sha256'] = digest
        self.assert_original(self.runtime.reference('card:0'))

    def test_warm_cache_reuses_verified_pixels_without_reopening_path(self):
        first = self.runtime.reference('card:0')
        self.path.write_bytes(self.replacement)
        with patch.object(Path, 'open') as opened:
            self.assertIs(self.runtime.reference('card:0'), first)
        opened.assert_not_called()
        self.assert_original(first)
        self.features.assert_called_once()

    def test_annotation_for_other_bytes_stays_unknown(self):
        self.runtime.annotations['card:0']['sha256'] = '0' * 64
        self.assertEqual(self.runtime.reference('card:0')[1], 'UNKNOWN')

    def test_encoded_snapshot_closes_before_feature_extraction(self):
        original_open = Image.open
        buffers = []

        def capture(value, *args, **kwargs):
            buffers.append(value)
            return original_open(value, *args, **kwargs)

        def features(*args):
            self.assertTrue(buffers[0].closed)
            return None, [], None, None

        self.features.side_effect = features
        with patch.object(printing.Image, 'open', side_effect=capture):
            self.assert_original(self.runtime.reference('card:0'))


if __name__ == '__main__':
    unittest.main()
