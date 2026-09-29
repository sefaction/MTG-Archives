"""Isolated printing-stage diagnostic using labelled candidate references.

Ground truth selects a reference ONLY to isolate alignment/stamp behavior. This
is not retrieval or end-to-end accuracy evidence. Do not use it to choose model
retrieval thresholds. Original images are never modified or sent off-device.
"""
import argparse
import json
from pathlib import Path
import time
import cv2
import numpy as np
from PIL import Image, ImageOps
from catalog_references import sha256
from printing_evidence import VERSION, SIZE, register, stamp_evidence


def decode(path):
    with Image.open(path) as im:
        if im.width * im.height > 36000000:
            raise ValueError('Image too large')
        return cv2.cvtColor(np.asarray(ImageOps.exif_transpose(im).convert('RGB')), cv2.COLOR_RGB2BGR)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('manifest', 'photos', 'references', 'snapshot', 'output'):
        parser.add_argument('--'+name, type=Path, required=True)
    args = parser.parse_args()
    code_digest = sha256(Path(__file__).with_name('printing_evidence.py'))
    labels_path = Path(__file__).with_name('stamp-reference-labels.json')
    labels_digest = sha256(labels_path)
    reference_labels = {r['referenceId']: r for r in json.loads(labels_path.read_text())['entries']}
    snapshot = json.loads(args.snapshot.read_text(encoding='utf8'))
    refs = {r['referenceId']: r for r in snapshot['references']}
    def reference(identity):
        row = refs.get(identity)
        if not row:
            return None
        path = (args.references / row['file']).resolve()
        if not path.is_relative_to(args.references.resolve()) or sha256(path) != row['sha256']:
            raise ValueError('Reference integrity failure')
        return decode(path)
    # Independently inspected public old/modern-frame stamps. No private photo
    # is used as a template, and presence thresholds are shared across frames.
    template_sources = ['58f0a2f9-5c5e-4477-ae7e-a52cf5778962:0', 'cfe4a22f-c945-42f4-8b3a-ac3a03ffa015:0']
    template = []
    for identity in template_sources:
        source = reference(identity)
        label = reference_labels.get(identity)
        if source is None or not label or label['stamp'] != 'PRESENT' or label['sha256'] != refs[identity]['sha256']:
            raise ValueError('Verified public stamp reference not ready')
        template.append(cv2.cvtColor(cv2.resize(source, SIZE), cv2.COLOR_BGR2GRAY)[1293:1362, 30:80])
    entries = json.loads(args.manifest.read_text(encoding='utf8'))['entries']
    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for entry in entries:
        start = time.monotonic()
        path = (args.photos / entry['file']).resolve()
        if not path.is_relative_to(args.photos.resolve()) or sha256(path) != entry['sha256']:
            raise ValueError('Private input path/digest mismatch')
        ref = reference(entry['scryfallId']+':0')
        row = {'file': entry['file'], 'expectedStamp': entry.get('stamp', 'UNLABELLED')}
        if ref is None:
            row.update({'status': 'REFERENCE_UNAVAILABLE'})
        else:
            warped, alignment, visibility = register(decode(path), ref, return_visibility=True)
            reference_id = entry['scryfallId']+':0'
            label = reference_labels.get(reference_id)
            reference_state = label['stamp'] if label and label['sha256'] == refs[reference_id]['sha256'] else 'UNKNOWN'
            evidence = stamp_evidence(warped, alignment, template, ref, reference_state, visibility=visibility)
            row.update({'alignment': alignment, 'stamp': evidence, 'referenceStampState': reference_state})
            if warped is not None:
                cv2.imwrite(str(args.output / (path.stem+'.aligned.jpg')), warped)
                cv2.imwrite(str(args.output / (path.stem+'.footer.jpg')), warped[1230:1397])
        row['elapsedMs'] = round((time.monotonic()-start)*1000)
        rows.append(row)
        print(json.dumps(row), flush=True)
    summary = {
        'method': VERSION,
        'scope': 'Isolated stage, labelled reference selection. NOT retrieval or end-to-end accuracy.',
        'manifestSha256': sha256(args.manifest),
        'codeSha256': code_digest,
        'referenceLabelsSha256': labels_digest,
        'templateSources': [refs[identity] for identity in template_sources],
        'photos': len(rows),
        'results': rows,
    }
    (args.output/'report.json').write_text(json.dumps(summary, indent=2), encoding='utf8')


if __name__ == '__main__':
    main()
