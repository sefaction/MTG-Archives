"""Actual printing request reference snapshots; no models or private photos."""
import copy
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
import printing_worker as worker


class ReferenceSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.references = self.root / 'references.json'
        self.identity = '00000000-0000-4000-8000-000000000001'
        self.records = [{'referenceId': self.identity + ':0', 'cardId': self.identity,
                         'file': 'r\u00e9f\u00e9rence.png', 'sha256': 'a' * 64,
                         'name': 'Unused catalogue metadata'}]
        self.original = json.dumps(self.records, ensure_ascii=False, indent=2).replace('\n', '\r\n').encode('utf8')
        self.references.write_bytes(self.original)
        self.index = self.root / 'index.json'
        self.index.write_text(json.dumps({'format': 1, 'downloadComplete': True,
            'files': {'references.json': {'path': self.references.name,
                'sha256': hashlib.sha256(self.original).hexdigest()}},
            'referenceCount': 1, 'unavailableCount': 0}))
        original_sha = worker.sha256

        def hashes(path):
            # CI runs from a checkout; the production image mounts these same
            # checked-in files under /eval. No descriptor inputs are invented.
            path = Path(path)
            source = Path(__file__).resolve().parent / path.name if path.parent == Path('/eval') else path
            return original_sha(source)

        self.runtime_inputs = []
        self.inferences = []
        owner = self

        class RecordingRuntime:
            def __init__(self, records, root):
                owner.runtime_inputs.append(copy.deepcopy(records))
                self.records = {row['referenceId']: row for row in records}

            def observe(self, photo, candidates):
                owner.inferences.append(copy.deepcopy(candidates))
                return {'candidates': candidates, 'automaticAcceptance': False}

        for name, value in [('INDEX', self.index), ('sha256', hashes),
                            ('PrintingRuntime', RecordingRuntime), ('_runtime', None), ('_records', None)]:
            replacement = patch.object(worker, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        photo = io.BytesIO()
        Image.new('RGB', (2, 2), 'white').save(photo, format='PNG')
        self.photo = photo.getvalue()
        metadata = json.dumps({'scryfallIds': [self.identity]}).encode()
        self.frame = struct.pack('>I', len(metadata)) + metadata + self.photo
        self.descriptor = worker.descriptor()

    def replacement(self):
        return json.dumps([{**self.records[0], 'file': 'replacement.png', 'sha256': 'b' * 64}]).encode()

    def request(self):
        return worker.request(self.frame, self.descriptor)

    def assert_original_snapshot(self, result):
        compact = [{key: row[key] for key in ('referenceId', 'cardId', 'file', 'sha256')} for row in self.records]
        self.assertEqual(self.runtime_inputs, [compact])
        self.assertEqual(result['descriptor'], self.descriptor['digest'])
        self.assertEqual(result['photoDigest'], hashlib.sha256(self.photo).hexdigest())
        self.assertEqual(result['sourceSize'], [2, 2])
        self.assertFalse(result['automaticAcceptance'])

    def test_unchanged_utf8_crlf_bytes_keep_compact_records_and_descriptor(self):
        self.assert_original_snapshot(self.request())
        self.assertEqual(len(self.inferences), 1)

    def test_same_count_replacement_is_refused_before_runtime_and_inference(self):
        self.references.write_bytes(self.replacement())
        with self.assertRaisesRegex(ValueError, 'Printing reference manifest integrity changed'):
            self.request()
        self.assertEqual(self.runtime_inputs, [])
        self.assertEqual(self.inferences, [])
        self.assertIsNone(worker._runtime)
        self.assertIsNone(worker._records)

    def test_corrupt_json_is_refused_as_integrity_failure_before_decoding(self):
        self.references.write_bytes(b'not the validated JSON')
        with self.assertRaisesRegex(ValueError, 'Printing reference manifest integrity changed'):
            self.request()
        self.assertEqual(self.runtime_inputs, [])
        self.assertEqual(self.inferences, [])

    def test_file_change_during_decoding_cannot_replace_captured_snapshot(self):
        decode = json.loads

        def change_after_capture(value, *args, **kwargs):
            if kwargs.get('object_hook') is worker.compact_reference_record:
                self.references.write_bytes(self.replacement())
            return decode(value, *args, **kwargs)

        with patch.object(worker.json, 'loads', change_after_capture):
            result = self.request()
        self.assertNotEqual(self.references.read_bytes(), self.original)
        self.assert_original_snapshot(result)

    def test_warm_requests_reuse_verified_snapshot_without_reloading_catalogue(self):
        self.request()
        self.references.write_bytes(self.replacement())
        self.assert_original_snapshot(self.request())
        self.assertEqual(len(self.inferences), 2)

    def test_reference_count_guard_still_precedes_runtime_construction(self):
        self.descriptor['details']['referenceCount'] = 2
        with self.assertRaisesRegex(ValueError, 'Printing reference count changed'):
            self.request()
        self.assertEqual(self.runtime_inputs, [])
        self.assertEqual(self.inferences, [])

    def test_descriptor_still_rejects_catalogue_changed_before_startup(self):
        self.references.write_bytes(self.replacement())
        with self.assertRaisesRegex(ValueError, 'Public reference manifest integrity changed'):
            worker.descriptor()
        self.assertEqual(self.runtime_inputs, [])

    def test_framed_worker_emits_normal_evidence_for_unchanged_snapshot(self):
        output = io.StringIO()
        incoming = SimpleNamespace(buffer=io.BytesIO(struct.pack('>I', len(self.frame)) + self.frame))
        with patch.object(worker.sys, 'argv', ['printing_worker.py', '--stream']), \
             patch.object(worker.sys, 'stdin', incoming), patch.object(worker.sys, 'stdout', output):
            worker.main()
        frames = output.getvalue().splitlines()
        self.assertEqual(len(frames), 1)
        self.assert_original_snapshot(json.loads(frames[0]))

    def test_framed_worker_emits_no_evidence_after_post_describe_substitution(self):
        describe = worker.descriptor

        def change_after_describe():
            descriptor = describe()
            self.references.write_bytes(self.replacement())
            return descriptor

        output = io.StringIO()
        incoming = SimpleNamespace(buffer=io.BytesIO(struct.pack('>I', len(self.frame)) + self.frame))
        with patch.object(worker.sys, 'argv', ['printing_worker.py', '--stream']), \
             patch.object(worker.sys, 'stdin', incoming), patch.object(worker.sys, 'stdout', output), \
             patch.object(worker, 'descriptor', change_after_describe):
            with self.assertRaisesRegex(ValueError, 'Printing reference manifest integrity changed'):
                worker.main()
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(self.runtime_inputs, [])
        self.assertEqual(self.inferences, [])


if __name__ == '__main__':
    unittest.main()
