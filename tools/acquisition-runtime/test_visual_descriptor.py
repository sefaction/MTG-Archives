"""Visual description stays validated without importing inference/model code."""
import builtins
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

EVAL = Path(__file__).resolve().parents[1] / 'acquisition-eval'
sys.path.insert(0, str(EVAL))
HEAVY = {'image_encoder', 'visual_compare', 'torch', 'torchvision'}


def load_visual():
    original = builtins.__import__
    def guarded(name, *args, **kwargs):
        if name in HEAVY:
            raise AssertionError('Inference import during visual description: ' + name)
        return original(name, *args, **kwargs)
    spec = importlib.util.spec_from_file_location('visual_descriptor_control', Path(__file__).with_name('visual.py'))
    module = importlib.util.module_from_spec(spec)
    with patch('builtins.__import__', guarded):
        spec.loader.exec_module(module)
    return module


class VisualDescriptorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.index = self.root / 'index.json'
        self.records = []
        for i in range(2):
            file = self.root / ('ref-' + str(i) + '.png')
            Image.new('RGB', (32, 44), ('white' if i == 0 else 'black')).save(file)
            self.records.append({'referenceId': 'ref-' + str(i), 'cardId': 'card-' + str(i),
                                 'name': 'Control ' + str(i), 'setCode': 'tst', 'collectorNumber': str(i),
                                 'file': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        (self.root / 'references.json').write_text(json.dumps(self.records))
        np.save(self.root / 'vectors.npy', np.eye(2, dtype='<f4'))
        self.manifest = {'downloadComplete': True, 'referenceCount': 2, 'unavailableCount': 0,
                         'dimension': 2, 'source': {'catalogSha256': 'a' * 64},
                         'encoder': {'name': 'control', 'torch': '1', 'torchvision': '1'}, 'files': {}}
        self.publish()

    def publish(self):
        for name in ['references.json', 'vectors.npy']:
            self.manifest['files'][name] = {'path': name,
                'sha256': hashlib.sha256((self.root / name).read_bytes()).hexdigest()}
        self.index.write_text(json.dumps(self.manifest))

    def configured(self):
        module = load_visual()
        module.INDEX = self.index
        module.MODELS = self.root / 'models'
        module.REFERENCES = self.root
        original = module.sha256
        def source_hash(path):
            path = Path(path)
            return original(EVAL / path.name if path.parent == Path('/eval') else path)
        module.sha256 = source_hash
        return module

    def test_describe_avoids_inference_imports_and_keeps_identity(self):
        module = self.configured()
        original = builtins.__import__
        def guarded(name, *args, **kwargs):
            if name in HEAVY:
                raise AssertionError('Inference imported while describing')
            return original(name, *args, **kwargs)
        with patch('builtins.__import__', guarded):
            first = module.descriptor()
            self.assertEqual(first, module.descriptor())
        self.assertEqual(first['referenceCount'], 2)
        self.assertEqual(first['encoder'], self.manifest['encoder'])
        self.assertEqual(first['catalogSha256'], 'a' * 64)
        self.assertEqual(first['codeSha256'], hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest())
        self.assertIsNone(module._runtime)

    def test_descriptor_still_binds_runtime_source(self):
        module = self.configured()
        before = module.descriptor()
        original = module.sha256
        with patch.object(module, 'sha256', lambda p: 'b' * 64 if Path(p) == Path(module.__file__) else original(p)):
            self.assertNotEqual(module.descriptor()['digest'], before['digest'])

    def test_partial_index_rejected(self):
        module = self.configured()
        self.manifest['downloadComplete'] = False
        self.publish()
        with self.assertRaisesRegex(ValueError, 'Full catalog download required'):
            module.descriptor()

    def test_changed_asset_digest_rejected(self):
        module = self.configured()
        (self.root / 'references.json').write_text('[]')
        with self.assertRaisesRegex(ValueError, 'path/digest mismatch'):
            module.descriptor()

    def test_nonfinite_vectors_rejected_even_with_updated_digest(self):
        module = self.configured()
        np.save(self.root / 'vectors.npy', np.array([[float('nan'), 0], [0, 1]], dtype='<f4'))
        self.publish()
        with self.assertRaisesRegex(ValueError, 'Invalid index features'):
            module.descriptor()

    def test_reference_shape_mismatch_rejected(self):
        module = self.configured()
        self.manifest['dimension'] = 3
        self.publish()
        with self.assertRaisesRegex(ValueError, 'shape mismatch'):
            module.descriptor()

    def test_outside_asset_path_rejected(self):
        module = self.configured()
        self.manifest['files']['vectors.npy']['path'] = '../outside.npy'
        self.index.write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'path/digest mismatch'):
            module.descriptor()

    def test_pointer_change_during_validation_rejected(self):
        module = self.configured()
        original = module.sha256
        calls = []
        def changed(path):
            if Path(path) == self.index:
                calls.append(1)
                if len(calls) == 2:
                    return 'c' * 64
            return original(path)
        with patch.object(module, 'sha256', changed), self.assertRaisesRegex(ValueError, 'Index changed'):
            module.descriptor()
        self.assertEqual(len(calls), 2)

    def test_first_recognition_defers_then_reuses_inference_and_geometry_modules(self):
        module = self.configured()
        descriptor = module.descriptor()
        calls = []
        encoder = types.ModuleType('image_encoder')
        class FakeEncoder:
            def __init__(self, name, root, device, threads):
                calls.append(('encoder', name, device, threads))
                self.identity = dict(self_manifest['encoder'])
            def embed(self, images):
                calls.append(('embed', len(images)))
                return np.tile(np.array([[1, 0]], dtype='<f4'), (len(images), 1))
        self_manifest = self.manifest
        encoder.Encoder = FakeEncoder
        geometric = types.ModuleType('visual_compare')
        geometric.features = lambda image, count: ('controlled-feature', count)
        geometric.match = lambda query, reference: 5
        photo = io.BytesIO()
        Image.new('RGB', (32, 44), 'white').save(photo, format='PNG')
        with patch.dict(sys.modules, {'image_encoder': encoder, 'visual_compare': geometric}), \
             patch.object(module, 'geometry', lambda *args: (None, {'status': 'CONTROLLED'})):
            first = module.recognize(photo.getvalue(), descriptor)
            second = module.recognize(photo.getvalue(), descriptor)
        self.assertEqual([v for v in calls if v[0] == 'encoder'], [('encoder', 'control', 'cpu', 1)])
        self.assertEqual([v for v in calls if v[0] == 'embed'], [('embed', 4), ('embed', 4)])
        self.assertEqual(first['candidates'], second['candidates'])
        self.assertEqual(first['geometricCandidates'], second['geometricCandidates'])
        self.assertEqual(first['descriptor'], descriptor['digest'])
        self.assertEqual(first['photoDigest'], hashlib.sha256(photo.getvalue()).hexdigest())
        self.assertFalse(first['automaticAcceptance'])
        self.assertEqual(first['geometry'], {'status': 'CONTROLLED'})


if __name__ == '__main__':
    unittest.main()
