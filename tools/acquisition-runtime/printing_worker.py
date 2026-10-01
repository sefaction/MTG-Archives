"""Private framed printing worker. No network, database, labels or ownership.

The parent supplies proposed public identities and unchanged photo bytes after
catalog reconciliation. This process only reports observable printing evidence.
"""
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import sys
import time
import uuid

sys.path.insert(0, '/eval')
import cv2
import numpy as np
from PIL import Image, ImageOps, __version__ as pillow_version
from catalog_references import sha256
from printing import PrintingRuntime, VERSION, LABELS

INDEX = Path('/visual/index/index.json')
if '--manifest' in sys.argv:
    name = sys.argv[sys.argv.index('--manifest') + 1]
    if not re.fullmatch(r'(index|manifest-[a-f0-9]{64})\.json', name):
        raise ValueError('Invalid immutable manifest name')
    INDEX = INDEX.with_name(name)
REFERENCES = Path('/visual/references')
MAX_PHOTO = 10 * 1024 * 1024
MAX_ENVELOPE = MAX_PHOTO + 65536
_runtime = None
_records = None


def descriptor():
    before = sha256(INDEX)
    index = json.loads(INDEX.read_text())
    if index.get('format') != 1 or not index.get('downloadComplete'):
        raise ValueError('Complete public reference manifest required')
    entry = index['files']['references.json']
    file = (INDEX.parent / entry['path']).resolve()
    if not file.is_relative_to(INDEX.parent.resolve()) or sha256(file) != entry['sha256']:
        raise ValueError('Public reference manifest integrity changed')
    if sha256(INDEX) != before:
        raise ValueError('Index changed during validation')
    details = {'version': VERSION, 'indexSha256': before,
               'referencesSha256': entry['sha256'], 'referenceCount': index['referenceCount'],
               'unavailableCount': index['unavailableCount'],
               'runtimeSha256': sha256(Path(__file__)),
               'registrationSha256': sha256(Path(__file__).with_name('printing.py')),
               'policySha256': sha256(Path('/eval/printing_evidence.py')),
               'annotationsSha256': sha256(LABELS), 'opencv': cv2.__version__,
               'opencvBuildSha256': hashlib.sha256(cv2.getBuildInformation().encode()).hexdigest(),
               'numpy': np.__version__, 'pillow': pillow_version, 'python': sys.version}
    archive = INDEX.with_name(f'manifest-{before}.json')
    immutable = archive.name if archive.is_file() and sha256(archive) == before else INDEX.name
    return {'digest': hashlib.sha256(json.dumps(details, sort_keys=True).encode()).hexdigest(),
            'details': details, 'file': file, 'manifest': immutable}


def request(envelope, desc):
    global _runtime, _records
    started = time.monotonic()
    if len(envelope) < 5 or len(envelope) > MAX_ENVELOPE:
        raise ValueError('Printing envelope size invalid')
    length = struct.unpack('>I', envelope[:4])[0]
    if not 0 < length <= 60000 or len(envelope) <= 4 + length:
        raise ValueError('Printing metadata size invalid')
    metadata = json.loads(envelope[4:4 + length])
    ids = metadata.get('scryfallIds')
    if (not isinstance(ids, list) or not 0 <= len(ids) <= 12 or
            len(set(ids)) != len(ids) or
            any(not isinstance(i, str) or str(uuid.UUID(i)) != i for i in ids)):
        raise ValueError('Printing candidate identities invalid')
    data = envelope[4 + length:]
    if not 0 < len(data) <= MAX_PHOTO:
        raise ValueError('Printing photo size invalid')
    if sha256(INDEX) != desc['details']['indexSha256']:
        raise ValueError('Printing index generation changed')
    if _runtime is None:
        _records = json.loads(desc['file'].read_text())
        if len(_records) != desc['details']['referenceCount']:
            raise ValueError('Printing reference count changed')
        _runtime = PrintingRuntime(_records, REFERENCES)
        # Maintain a full identity lookup for subsequent frames without loading
        # any embedding matrix or model into this printing-only worker.
        all_records = _runtime.records.values()
        _records = {}
        for row in all_records:
            _records.setdefault(row['cardId'], []).append(row)
    candidates = []
    for identity in ids:
        faces = _records.get(identity, [])
        if not faces:
            candidates.append({'scryfallId': identity, 'referenceId': identity + ':0'})
        else:
            for face in faces[:2]:
                candidates.append({'scryfallId': identity, 'referenceId': face['referenceId']})
    Image.MAX_IMAGE_PIXELS = 25_000_000
    with Image.open(io.BytesIO(data)) as source:
        if source.width * source.height > 25_000_000:
            raise ValueError('Printing decoded photo exceeds bound')
        photo = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
    result = _runtime.observe(photo, candidates)
    return {**result, 'descriptor': desc['digest'], 'photoDigest': hashlib.sha256(data).hexdigest(),
            'milliseconds': round((time.monotonic() - started) * 1000)}


def read_exact(length):
    chunks = bytearray()
    while len(chunks) < length:
        part = sys.stdin.buffer.read(length - len(chunks))
        if not part:
            raise ValueError('Printing frame truncated')
        chunks.extend(part)
    return bytes(chunks)


def main():
    desc = descriptor()
    if '--describe' in sys.argv:
        print(json.dumps({'digest': desc['digest'], 'details': desc['details'], 'manifest': desc['manifest']}))
        return
    while True:
        header = sys.stdin.buffer.read(4)
        if not header:
            return
        if len(header) != 4:
            raise ValueError('Printing frame header truncated')
        length = struct.unpack('>I', header)[0]
        if not 0 < length <= MAX_ENVELOPE:
            raise ValueError('Printing frame exceeds bound')
        output = json.dumps(request(read_exact(length), desc), separators=(',', ':'))
        if len(output.encode()) > 65535:
            raise ValueError('Printing evidence exceeds bound')
        print(output, flush=True)


if __name__ == '__main__':
    main()
