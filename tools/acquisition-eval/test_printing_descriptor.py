"""Full native generation identity, without inference or public references."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'acquisition-runtime'))
import printing_worker


class DescriptorTests(unittest.TestCase):
    def test_every_runtime_reference_and_dependency_input_changes_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            references = root / 'references.json'
            references.write_text('[]')
            index = root / 'index.json'
            index.write_text(json.dumps({'format': 1, 'downloadComplete': True,
                'files': {'references.json': {'path': 'references.json',
                    'sha256': hashlib.sha256(references.read_bytes()).hexdigest()}},
                'referenceCount': 0, 'unavailableCount': 0}))
            original_sha = printing_worker.sha256

            def hashes(path):
                # The evaluated policy's absolute container path is irrelevant
                # to this model-free descriptor test; its content hash is not.
                return 'a' * 64 if str(path) in ('/eval/printing_evidence.py', str(printing_worker.LABELS)) else original_sha(path)

            with patch.object(printing_worker, 'INDEX', index), patch.object(printing_worker, 'sha256', hashes):
                baseline = printing_worker.descriptor()['digest']
                for module, name, value in [
                    (printing_worker.np, '__version__', 'changed-numpy'),
                    (printing_worker, 'pillow_version', 'changed-pillow'),
                    (printing_worker.cv2, '__version__', 'changed-opencv'),
                    (printing_worker.cv2, 'getBuildInformation', lambda: 'changed-build'),
                    (printing_worker.sys, 'version', 'changed-python'),
                    (printing_worker, 'VERSION', 'changed-runtime'),
                ]:
                    with patch.object(module, name, value):
                        self.assertNotEqual(baseline, printing_worker.descriptor()['digest'], name)
                for target in [printing_worker.LABELS, Path(printing_worker.__file__),
                               Path(printing_worker.__file__).with_name('printing.py'),
                               Path('/eval/printing_evidence.py')]:
                    with patch.object(printing_worker, 'sha256',
                            lambda path, target=target: 'b' * 64 if Path(path) == target else hashes(path)):
                        self.assertNotEqual(baseline, printing_worker.descriptor()['digest'], str(target))
                index.write_text(index.read_text() + '\n')
                self.assertNotEqual(baseline, printing_worker.descriptor()['digest'])
                references.write_text('[{}]')
                changed_index = json.loads(index.read_text())
                changed_index['files']['references.json']['sha256'] = original_sha(references)
                changed_index['referenceCount'] = 1
                index.write_text(json.dumps(changed_index))
                self.assertNotEqual(baseline, printing_worker.descriptor()['digest'])


if __name__ == '__main__':
    unittest.main()
