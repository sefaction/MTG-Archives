"""Initialize verified public models in appdata. No private photos or DB access."""
import fcntl
import hashlib
import os
from pathlib import Path
import re
import sys
import urllib.request
from uuid import uuid4
from model_store import CACHE, LOCK, MANIFEST, model_root

def matches(path, expected):
    return (path.is_file() and not path.is_symlink() and
            path.stat().st_size == expected['bytes'] and
            hashlib.sha256(path.read_bytes()).hexdigest() == expected['sha256'])


def atomic_write(path, data):
    temporary = path.with_name(path.name + '.' + uuid4().hex + '.partial')
    try:
        with temporary.open('xb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        temporary.chmod(0o644)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(verify_only):
    root = model_root()
    for model in LOCK['models']:
        name, revision = model['name'], model['revision']
        if (not re.fullmatch(r'[A-Za-z0-9_-]+', name) or
                model['repository'] != f'PaddlePaddle/{name}' or
                not re.fullmatch(r'[a-f0-9]{40}', revision)):
            raise ValueError('Invalid model source')
        destination = root / name
        for parent in [destination, *destination.parents]:
            if parent.is_symlink():
                raise ValueError('Model paths cannot be symlinks')
        if not verify_only:
            destination.mkdir(parents=True, exist_ok=True)
        for filename, expected in model['files'].items():
            if Path(filename).name != filename or filename in ('.', '..'):
                raise ValueError('Invalid model path')
            path = destination / filename
            if path.is_symlink():
                raise ValueError('Model files cannot be symlinks')
            if matches(path, expected):
                continue
            if verify_only:
                raise ValueError(f'Missing or damaged model: {name}/{filename}')
            url = f'https://huggingface.co/{model["repository"]}/resolve/{revision}/{filename}'
            request = urllib.request.Request(url, headers={'User-Agent': 'MTG-Archives-model-setup/1.0'})
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read(expected['bytes'] + 1)
            if len(data) != expected['bytes'] or hashlib.sha256(data).hexdigest() != expected['sha256']:
                raise ValueError(f'Model integrity mismatch: {name}/{filename}')
            atomic_write(path, data)
    manifest = root.parent / 'models.lock.json'
    if verify_only:
        if manifest.read_bytes() != MANIFEST:
            raise ValueError('Persistent model manifest mismatch')
    else:
        atomic_write(manifest, MANIFEST)
    print('Verified persistent recognition models', flush=True)


if __name__ == '__main__':
    if not CACHE.is_mount():
        raise ValueError('/models must be mounted from persistent appdata; refusing container-layer storage')
    verify_only = '--verify-only' in sys.argv
    if verify_only:
        prepare(True)
    else:
        with (CACHE / '.initialize.lock').open('a') as guard:
            fcntl.flock(guard.fileno(), fcntl.LOCK_EX)
            prepare(False)
