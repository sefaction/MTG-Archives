"""Exercise native recognition with quarter turns and EXIF-only rotation.

Only in-memory derivatives are rotated; supplied originals are hash-checked and
never modified. Every pixel-rotation control uses the same JPEG95 encoding.
Docker inference has no network and receives photos through its bounded stdin.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import queue
import subprocess
import threading
import uuid

from PIL import Image, ImageOps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--photos', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--models', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--image', default='mtg-acquisition-recognition:local')
    parser.add_argument('--runtime', type=Path, help='Optional local native source override')
    parser.add_argument('--geometry', type=Path, help='Optional local geometry source override')
    parser.add_argument('--originals-only', action='store_true', help='Evaluate original bytes without rotation derivatives')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(args.manifest.read_text(encoding='utf8'))
    container = 'mtg-rotation-eval-' + uuid.uuid4().hex
    command = ['docker', 'run', '--rm', '-i', '--name', container, '--network', 'none',
               '--memory', '2g', '--cpus', '1', '--user', '65534:65534',
               '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m',
               '--mount', f'type=bind,source={args.models.resolve()},target=/models,readonly']
    if args.runtime:
        command += ['--mount', f'type=bind,source={args.runtime.resolve()},target=/app/tools/acquisition-runtime,readonly']
    if args.geometry:
        command += ['--mount', f'type=bind,source={args.geometry.resolve()},target=/eval/baseline.py,readonly']
    command += ['--entrypoint', 'python', args.image,
                '/app/tools/acquisition-runtime/recognize.py', '--stream']
    results = []
    with (args.output / 'stderr.log').open('wb') as errors:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors)
        responses = queue.Queue()

        def read_responses():
            while True:
                line = process.stdout.readline(65537)
                responses.put(line)
                if not line or len(line) > 65536:
                    return

        threading.Thread(target=read_responses, daemon=True).start()
        try:
            for entry in manifest['entries']:
                if Path(entry['file']).name != entry['file']:
                    raise ValueError('Manifest photo must be a basename')
                raw = (args.photos / entry['file']).read_bytes()
                if hashlib.sha256(raw).hexdigest() != entry['sha256']:
                    raise ValueError('Original digest differs from manifest')
                with Image.open(io.BytesIO(raw)) as src:
                    if src.width * src.height > 36000000:
                        raise ValueError('Oversized source')
                    original = ImageOps.exif_transpose(src).convert('RGB')
                fixtures = ['original'] if args.originals_only else ['original', 'pixels-0', 'pixels-90', 'pixels-180', 'pixels-270', 'exif-6']
                for fixture in fixtures:
                    data = raw
                    if fixture != 'original':
                        # EXIF 6 should display the original orientation: store
                        # pixels counterclockwise and request clockwise display.
                        degrees = -90 if fixture == 'exif-6' else int(fixture.split('-')[1])
                        derived = original.rotate(-degrees, expand=True)
                        options = {}
                        if fixture == 'exif-6':
                            exif = Image.Exif()
                            exif[274] = 6
                            options['exif'] = exif
                        buffer = io.BytesIO()
                        derived.save(buffer, format='JPEG', quality=95, **options)
                        data = buffer.getvalue()
                    if len(data) > 10 * 1024 * 1024:
                        raise ValueError('Derived fixture exceeds native input bound')
                    process.stdin.write(len(data).to_bytes(4, 'big') + data)
                    process.stdin.flush()
                    line = responses.get(timeout=60)
                    if not line or len(line) > 65536 or not line.endswith(b'\n'):
                        raise RuntimeError('Native worker exited; see private stderr log')
                    result = json.loads(line)
                    if result['photoDigest'] != hashlib.sha256(data).hexdigest():
                        raise ValueError('Native evidence digest mismatch')
                    results.append({'file': entry['file'], 'fixture': fixture,
                                    'sourceSha256': entry['sha256'], **result})
                    report = {'scope': 'Development rotation robustness; not independent accuracy samples',
                              'manifestSha256': hashlib.sha256(args.manifest.read_bytes()).hexdigest(),
                              'pillow': Image.__version__, 'results': results}
                    (args.output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf8')
                    print(entry['file'], fixture, result['geometry']['status'], flush=True)
            process.stdin.close()
            process.wait(timeout=30)
            if process.returncode:
                raise RuntimeError('Native worker failed')
        finally:
            if process.poll() is None:
                subprocess.run(['docker', 'rm', '-f', container], check=False,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
                process.kill()
                process.wait()


if __name__ == '__main__':
    main()
