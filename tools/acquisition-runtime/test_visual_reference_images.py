"""Real visual decoder, synthetic pixels; encoder/geometry scoring are isolated."""
from collections import OrderedDict
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-eval'))
import visual
from catalog_references import MAX_IMAGE_BYTES


class ReferenceImageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.path = self.root / 'reference.png'
        self.original = self.encoded('red')
        self.replacement = self.encoded('blue')
        self.path.write_bytes(self.original)
        self.record = {'cardId': 'card', 'referenceId': 'card:0', 'name': 'Synthetic',
            'setCode': 'tst', 'collectorNumber': '1', 'file': self.path.name,
            'sha256': hashlib.sha256(self.original).hexdigest()}
        self.descriptor = {'digest': 'a' * 64, 'referenceCount': 1, 'unavailableCount': 0}
        self.references = []
        self.compare = types.ModuleType('visual_compare')
        self.compare.features = self.feature_pixels
        self.compare.match = lambda query, reference: 0
        encoder = types.SimpleNamespace(embed=lambda images: np.ones((len(images), 2), dtype=np.float32))
        self.cache = OrderedDict()
        for context in [patch.object(visual, 'REFERENCES', self.root),
                        patch.object(visual, '_reference_features', self.cache),
                        patch.object(visual, 'runtime', return_value=(encoder, [self.record], np.ones((1, 2), dtype=np.float32))),
                        patch.object(visual, 'geometry', return_value=(None, {'status': 'NEEDS_CROP'})),
                        patch.dict(sys.modules, {'visual_compare': self.compare})]:
            context.start()
            self.addCleanup(context.stop)

    @staticmethod
    def encoded(color):
        with io.BytesIO() as buffer:
            Image.new('RGB', (8, 8), color).save(buffer, format='PNG')
            return buffer.getvalue()

    def feature_pixels(self, image, count):
        if count == 1000:
            self.references.append(image.copy())
        return image.copy()

    def recognize(self):
        return visual.recognize(self.original, self.descriptor)

    def assert_original(self):
        np.testing.assert_array_equal(self.references[-1], np.full((8, 8, 3), (0, 0, 255), dtype=np.uint8))

    def test_unchanged_reference_and_original_identity(self):
        result = self.recognize()
        self.assert_original()
        self.assertEqual(result['photoDigest'], hashlib.sha256(self.original).hexdigest())
        self.assertEqual(result['descriptor'], self.descriptor['digest'])
        self.assertEqual(result['geometricCandidates'][0]['referenceId'], 'card:0')
        self.assertFalse(result['automaticAcceptance'])

    def test_path_replacement_at_decode_keeps_verified_pixels(self):
        original_open = Image.open
        calls = 0

        def replace_reference(value, *args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:  # The first decode is the private input, then reference.
                self.path.write_bytes(self.replacement)
            return original_open(value, *args, **kwargs)

        with patch.object(visual.Image, 'open', side_effect=replace_reference):
            self.recognize()
        self.assertEqual(calls, 2)
        self.assertEqual(self.path.read_bytes(), self.replacement)
        self.assert_original()

    def test_changed_reference_is_refused_before_features_or_cache(self):
        self.path.write_bytes(self.replacement)
        with self.assertRaisesRegex(ValueError, 'Public reference path/digest mismatch'):
            self.recognize()
        self.assertEqual(self.references, [])
        self.assertEqual(self.cache, {})

    def test_outside_root_is_refused_before_read(self):
        self.record['file'] = '../outside.png'
        with patch.object(Path, 'open') as opened:
            with self.assertRaisesRegex(ValueError, 'Public reference path/digest mismatch'):
                self.recognize()
        opened.assert_not_called()
        self.assertEqual(self.cache, {})

    def test_oversized_matching_reference_is_bounded_and_refused(self):
        data = self.original + b'\0' * (MAX_IMAGE_BYTES + 1 - len(self.original))
        self.path.write_bytes(data)
        self.record['sha256'] = hashlib.sha256(data).hexdigest()
        original_open = Path.open
        requested = []

        class Reader:
            def __enter__(self):
                self.stream = original_open(self_path, 'rb')
                return self

            def __exit__(self, *args):
                self.stream.close()

            def read(self, count=-1):
                requested.append(count)
                return self.stream.read(count)

        self_path = self.path
        with patch.object(Path, 'open', return_value=Reader()):
            with self.assertRaisesRegex(ValueError, 'Public reference path/digest mismatch'):
                self.recognize()
        self.assertEqual(requested, [MAX_IMAGE_BYTES + 1])
        self.assertEqual(self.references, [])
        self.assertEqual(self.cache, {})

    def test_exact_existing_reference_limit_is_accepted(self):
        data = self.original + b'\0' * (MAX_IMAGE_BYTES - len(self.original))
        self.path.write_bytes(data)
        self.record['sha256'] = hashlib.sha256(data).hexdigest()
        self.recognize()
        self.assert_original()

    def test_warm_verified_features_reuse_without_reading_changed_path(self):
        self.recognize()
        cached = self.cache[0]
        self.path.write_bytes(self.replacement)
        with patch.object(Path, 'open') as opened:
            self.recognize()
        opened.assert_not_called()
        self.assertEqual(len(self.references), 1)
        self.assertIs(self.cache[0], cached)

    def test_encoded_snapshot_closes_before_reference_features(self):
        original_open = Image.open
        reference = []
        calls = 0

        def capture(value, *args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                reference.append(value)
            return original_open(value, *args, **kwargs)

        def features(image, count):
            if count == 1000:
                self.assertTrue(reference[0].closed)
            return self.feature_pixels(image, count)

        self.compare.features = features
        with patch.object(visual.Image, 'open', side_effect=capture):
            self.recognize()
        self.assert_original()

    def test_reference_exif_orientation_is_preserved(self):
        pixels = np.zeros((8, 12, 3), dtype=np.uint8)
        pixels[:, :6] = (255, 0, 0)
        pixels[:, 6:] = (0, 0, 255)
        exif = Image.Exif()
        exif[274] = 6
        buffer = io.BytesIO()
        Image.fromarray(pixels).save(buffer, format='JPEG', quality=95, exif=exif)
        data = buffer.getvalue()
        self.path.write_bytes(data)
        self.record['sha256'] = hashlib.sha256(data).hexdigest()
        self.recognize()
        with Image.open(io.BytesIO(data)) as source:
            expected = np.asarray(ImageOps.exif_transpose(source).convert('RGB'))[:, :, ::-1]
        np.testing.assert_array_equal(self.references[-1], expected)

    def test_reference_feature_cache_stays_bounded(self):
        self.cache.update((i, object()) for i in range(1, 129))
        self.recognize()
        self.assertEqual(len(self.cache), 128)
        self.assertNotIn(1, self.cache)
        self.assertIn(0, self.cache)


if __name__ == '__main__':
    unittest.main()
