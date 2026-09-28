"""Immutable, versioned model paths shared by initializer and read-only inference."""
import hashlib
import json
from pathlib import Path

CACHE = Path('/models')
LOCK = json.loads(Path(__file__).with_name('models.lock.json').read_text())
MANIFEST = json.dumps(LOCK, sort_keys=True, separators=(',', ':')).encode()
VERSION = hashlib.sha256(MANIFEST).hexdigest()


def model_root():
    return CACHE / 'versions' / VERSION / 'official_models'
