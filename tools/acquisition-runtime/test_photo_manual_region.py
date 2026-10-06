"""Real native entry points with synthetic pixels and model-free adapters."""
import contextlib
import hashlib
import importlib
import io
import json
from pathlib import Path
import struct
import sys
import types
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-eval'))
import recognize

REGION = {'version': 1, 'quad': [[.25, .25], [.75, .25], [.75, .75], [.25, .75]]}


def source_bytes(width=800, height=1000, orientation=None):
    image = Image.new('RGB', (width, height), (210, 30, 20))
    image.paste((20, 210, 30), (width//4, height//4, 3*width//4, 3*height//4))
    output = io.BytesIO()
    if orientation:
        exif = image.getexif()
        exif[274] = orientation
        image.save(output, format='JPEG', exif=exif)
    else:
        image.save(output, format='PNG')
    return output.getvalue()


def frame(data, metadata):
    value = json.dumps(metadata).encode()
    return struct.pack('>I', len(value)) + value + data


class ManualNativeTest(unittest.TestCase):
    def test_recognition_uses_selected_region_without_automatic_or_whole_photo_fallback(self):
        data = source_bytes()
        seen = []
        engine = types.SimpleNamespace(predict=lambda image: seen.append(image.copy()) or [])
        output = io.StringIO()
        with patch('baseline.geometry', side_effect=AssertionError('automatic detector attempted')), \
                patch.object(recognize, 'ocr_engine', return_value=engine), \
                patch.object(recognize, 'whole_photo_text', side_effect=AssertionError('whole photo attempted')), \
                patch.object(sys, '__stdout__', output), contextlib.redirect_stdout(io.StringIO()):
            recognize.recognize(frame(data, {'inputKind': 'PHOTO', 'manualRegion': REGION}), {'digest': 'a'*64})
        result = json.loads(output.getvalue())
        self.assertEqual(result['photoDigest'], hashlib.sha256(data).hexdigest())
        self.assertEqual(result['geometry']['manualRegion'], REGION)
        self.assertEqual(result['geometry']['sourceFrame'], {'width': 800, 'height': 1000})
        self.assertFalse(result['geometry']['boundaryVerified'])
        self.assertEqual(len(seen), 2)
        self.assertTrue(all(image.shape[1] == 1000 for image in seen))
        self.assertTrue(all(image[50, 500, 1] > image[50, 500, 2] for image in seen))
        self.assertFalse(result['automaticAcceptance'])
        self.assertNotIn('photoText', result)

    def test_exif_frame_is_normalized_before_manual_coordinates_and_invalid_selection_fails(self):
        data = source_bytes(600, 800, 6)
        output = io.StringIO()
        engine = types.SimpleNamespace(predict=lambda image: [])
        with patch.object(recognize, 'ocr_engine', return_value=engine), \
                patch.object(sys, '__stdout__', output), contextlib.redirect_stdout(io.StringIO()):
            recognize.recognize(frame(data, {'inputKind': 'CARD_SCAN', 'manualRegion': REGION}), {'digest': 'b'*64})
        result = json.loads(output.getvalue())
        self.assertEqual(result['geometry']['sourceFrame'], {'width': 800, 'height': 600})
        for bad in [dict(REGION, quad=[[0, 0], [1, 1], [1, 0], [0, 1]]),
                    dict(REGION, quad=[[0, 0], [.001, 0], [.001, .001], [0, .001]])]:
            with patch.object(recognize, 'ocr_engine', side_effect=AssertionError('invalid region reached OCR')), \
                    patch('baseline.geometry', side_effect=AssertionError('invalid region fell back')), \
                    contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(ValueError):
                    recognize.recognize(frame(data, {'inputKind': 'PHOTO', 'manualRegion': bad}), {'digest': 'c'*64})

    def test_visual_embedding_and_geometric_queries_use_only_selected_pixels(self):
        # CI has no Torch. Replace model/matching adapters while retaining the
        # real entry point, decoder, manual geometry and query pixels. Block
        # Torch explicitly so a fuller local image cannot hide a dependency.
        with patch.dict(sys.modules, {'torch': None, 'torchvision': None,
                'image_encoder': types.SimpleNamespace(Encoder=object),
                'visual_compare': types.SimpleNamespace(features=object, match=object)}):
            visual = importlib.import_module('visual')
        encoded, geometric = [], []
        def embed(images):
            encoded.extend(np.asarray(image) for image in images)
            return np.ones((4, 2), dtype=np.float32)
        row = {'cardId': '11111111-1111-4111-8111-111111111111', 'referenceId': 'face:0',
               'name': 'Synthetic', 'setCode': 'tst', 'collectorNumber': '1'}
        def features(image, size):
            geometric.append(image.copy())
            return object()
        data = source_bytes()
        with patch.object(visual, 'runtime', return_value=(types.SimpleNamespace(embed=embed), [row], np.ones((1,2)))), \
                patch.object(visual, 'features', side_effect=features), patch.object(visual, 'match', return_value=0), \
                patch.dict(visual._reference_features, {0: object()}, clear=True), \
                patch.object(visual, 'geometry', side_effect=AssertionError('automatic detector attempted')):
            result = visual.recognize(frame(data, {'inputKind': 'PHOTO', 'manualRegion': REGION}),
                                     {'digest': 'd'*64, 'referenceCount': 1, 'unavailableCount': 0})
        self.assertEqual(result['geometry']['manualRegion'], REGION)
        self.assertEqual(result['inputRegion'], 'CARD')
        self.assertEqual(len(encoded), 4)
        self.assertTrue(all(image[image.shape[0]//2,image.shape[1]//2,1] > 200 for image in encoded))
        self.assertEqual(len(geometric), 1)
        self.assertLess(geometric[0].shape[1], 500)
        self.assertTrue(np.all(geometric[0][20,20] == [30,210,20]))
        self.assertEqual(result['photoDigest'], hashlib.sha256(data).hexdigest())

    def test_printing_uses_original_resolution_and_restores_reported_coordinates(self):
        printing = importlib.import_module('printing_worker')
        seen = []
        def observe(image, candidates):
            seen.append(image.copy())
            return {'candidates': [{'alignment': {'status': 'ALIGNED', 'sourceCardWidth': image.shape[1],
                                     'quad': [[0,0],[image.shape[1]-1,0],[image.shape[1]-1,image.shape[0]-1],[0,image.shape[0]-1]]}}]}
        data = source_bytes(400, 560)
        digest = hashlib.sha256(data).hexdigest()
        with patch.object(printing, '_runtime', types.SimpleNamespace(observe=observe)), \
                patch.object(printing, '_records', {}), patch.object(printing, 'sha256', return_value='index'):
            result = printing.request(frame(data, {'scryfallIds': [], 'manualRegion': REGION}),
                                      {'details': {'indexSha256': 'index'}, 'digest': 'e'*64})
            with self.assertRaises(ValueError):
                printing.request(frame(data, {'scryfallIds': [], 'manualRegion': None}),
                                 {'details': {'indexSha256': 'index'}, 'digest': 'e'*64})
        self.assertEqual(result['photoDigest'], digest)
        self.assertEqual(result['manualRegion'], REGION)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].shape, (282, 202, 3))
        self.assertEqual(result['candidates'][0]['alignment']['sourceCardWidth'], 202)
        self.assertEqual(result['candidates'][0]['alignment']['quad'][0], [99,139])


if __name__ == '__main__':
    unittest.main()
