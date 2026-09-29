"""Retained reference payload bounds, eviction and unchanged reload integrity."""
from collections import OrderedDict
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
from printing import PrintingRuntime, reference_array_bytes


def entry(size):
    image = np.zeros(size, dtype=np.uint8)
    return image, 'UNKNOWN', (image, 1., [], None)


class CacheTests(unittest.TestCase):
    def runtime(self):
        runtime = PrintingRuntime.__new__(PrintingRuntime)
        runtime.cache = OrderedDict()
        runtime.cache_array_bytes = 0
        return runtime

    def test_array_payload_counts_distinct_image_and_descriptor_storage(self):
        image = np.zeros(11, dtype=np.uint8)
        resized = np.zeros(7, dtype=np.uint8)
        descriptors = np.zeros((2, 3), dtype=np.float32)
        self.assertEqual(reference_array_bytes((image, 'UNKNOWN', (resized, 1., [], descriptors))), 42)
        self.assertEqual(reference_array_bytes(entry(11)), 11)

    def test_byte_bound_evicts_least_recent_without_changing_warm_reference(self):
        runtime = self.runtime()
        a, b, c = entry(3), entry(3), entry(5)
        with patch('printing.MAX_REFERENCE_CACHE_ARRAY_BYTES', 10):
            runtime._remember_reference('a', a)
            runtime._remember_reference('b', b)
            self.assertIs(runtime.reference('a'), a)
            runtime._remember_reference('c', c)
        self.assertEqual(list(runtime.cache), ['a', 'c'])
        self.assertIs(runtime.reference('a'), a)
        self.assertIs(runtime.reference('c'), c)
        self.assertEqual(runtime.cache_array_bytes, 8)

    def test_count_bound_remains_for_small_entries(self):
        runtime = self.runtime()
        with patch('printing.MAX_REFERENCE_CACHE_ENTRIES', 2):
            for identity in ['a', 'b', 'c']:
                runtime._remember_reference(identity, entry(1))
        self.assertEqual(list(runtime.cache), ['b', 'c'])
        self.assertEqual(runtime.cache_array_bytes, 2)

    def test_oversized_reference_does_not_discard_warm_entries(self):
        runtime = self.runtime()
        a = entry(3)
        with patch('printing.MAX_REFERENCE_CACHE_ARRAY_BYTES', 10):
            runtime._remember_reference('a', a)
            runtime._remember_reference('large', entry(11))
        self.assertEqual(list(runtime.cache), ['a'])
        self.assertIs(runtime.reference('a'), a)
        self.assertEqual(runtime.cache_array_bytes, 3)

    def test_uncached_oversized_image_still_returns_bytes_and_revalidates_integrity(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'reference.png'
            Image.fromarray(np.zeros((10, 11, 3), dtype=np.uint8)).save(file)
            runtime = self.runtime()
            runtime.root = Path(folder).resolve()
            runtime.annotations = {}
            runtime.records = {'card': {'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()}}
            with patch('printing.MAX_REFERENCE_CACHE_ARRAY_BYTES', 1):
                image, state, _ = runtime.reference('card')
                self.assertEqual(image.shape, (10, 11, 3))
                self.assertEqual(state, 'UNKNOWN')
                self.assertEqual(len(runtime.cache), 0)
                self.assertEqual(runtime.cache_array_bytes, 0)
                file.write_bytes(b'changed public reference')
                with self.assertRaisesRegex(ValueError, 'integrity changed'):
                    runtime.reference('card')


if __name__ == '__main__':
    unittest.main()
