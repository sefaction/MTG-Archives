"""Bounded runtime printing observations from actual combined candidates.

Reuses evaluated registration/stamp policy. Never chooses a reference from photo
ground truth, never infers absence from a failed detector, never confirms stock.
"""
from collections import OrderedDict
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageOps
from catalog_references import sha256
from printing_evidence import SIZE, register, registration_features, stamp_evidence, candidate_relation, shared_stamp_evidence

VERSION = 'registered-printing-runtime-v1'
LABELS = Path('/eval/stamp-reference-labels.json')
TEMPLATES = ('58f0a2f9-5c5e-4477-ae7e-a52cf5778962:0', 'cfe4a22f-c945-42f4-8b3a-ac3a03ffa015:0')


class PrintingRuntime:
    def __init__(self, records, root, labels=LABELS):
        self.root = Path(root).resolve()
        self.records = {r['referenceId']: r for r in records}
        self.annotations = {r['referenceId']: r for r in json.loads(Path(labels).read_text())['entries']}
        self.cache = OrderedDict()
        self.templates = []
        for identity in TEMPLATES:
            image, state, _ = self.reference(identity)
            if state != 'PRESENT':
                raise ValueError('Verified public stamp template unavailable')
            self.templates.append(cv2.cvtColor(cv2.resize(image, SIZE), cv2.COLOR_BGR2GRAY)[1293:1362, 30:80])

    def reference(self, identity):
        if identity not in self.cache:
            row = self.records[identity]
            path = (self.root / row['file']).resolve()
            if not path.is_relative_to(self.root) or sha256(path) != row['sha256']:
                raise ValueError('Printing reference integrity changed')
            annotation = self.annotations.get(identity)
            state = annotation['stamp'] if annotation and annotation['sha256'] == row['sha256'] else 'UNKNOWN'
            with Image.open(path) as source:
                image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
            self.cache[identity] = image, state, registration_features(image, True)
            if len(self.cache) > 48:
                self.cache.popitem(last=False)
        self.cache.move_to_end(identity)
        return self.cache[identity]

    def observe(self, photo, candidates):
        if len(candidates) > 24 or len({c['referenceId'] for c in candidates}) != len(candidates):
            raise ValueError('Printing candidates exceed bound or repeat')
        rows = []
        query_features = registration_features(photo)
        for candidate in candidates:
            identity = candidate['referenceId']
            if identity not in self.records:
                rows.append({'scryfallId': candidate['scryfallId'], 'referenceId': identity,
                             'referenceStampState': 'UNKNOWN', 'alignment': {'status': 'UNREADABLE'},
                             'stamp': {'status': 'UNREADABLE', 'reason': 'REFERENCE_UNAVAILABLE'},
                             'relation': 'UNRESOLVED'})
                continue
            if self.records[identity]['cardId'] != candidate['scryfallId']:
                raise ValueError('Printing identity mismatch')
            image, state, ref_features = self.reference(identity)
            warped, alignment = register(photo, image, query_features, ref_features)
            stamp = stamp_evidence(warped, alignment, self.templates, image, state)
            rows.append({'scryfallId': candidate['scryfallId'], 'referenceId': identity,
                         'referenceStampState': state, 'alignment': alignment, 'stamp': stamp,
                         'relation': candidate_relation(stamp['status'], state)})
        observed, conflicting = shared_stamp_evidence(rows)
        return {'version': VERSION, 'observedStamp': observed,
                'conflictingObservations': conflicting, 'candidates': rows,
                'automaticAcceptance': False}
