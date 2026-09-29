"""Offline evaluation encoders with explicit, whole-card preprocessing.

These produce retrieval features, never probabilities or printing confirmation.
All code/weights are local. Model construction cannot download weights.
"""
import hashlib
import json
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageOps
import torch
import torchvision
from torchvision import models, transforms
from catalog_references import sha256

WEIGHTS = {
    'vgg16': ('hub/checkpoints/vgg16-397923af.pth', '397923af8e79cdbb6a7127f12361acd7a2f83e06b05044ddf496e83de57a5bf0'),
    'dinov2': ('dinov2_vits14_pretrain.pth', 'b938bf1bc15cd2ec0feacfe3a1bb553fe8ea9ca46a7e1d8d00217f29aef60cd9'),
}


def decode(path):
    with Image.open(path) as image:
        if image.width * image.height > 36000000:
            raise ValueError('Image exceeds pixel bound')
        return ImageOps.exif_transpose(image).convert('RGB')


class Encoder:
    def __init__(self, name, root, device='cpu', threads=4):
        torch.set_num_threads(threads)
        self.device = torch.device(device)
        if self.device.type == 'cuda' and not torch.cuda.is_available():
            raise ValueError('CUDA requested but unavailable')
        relative, expected = WEIGHTS[name]
        path = root / relative
        if sha256(path) != expected:
            raise ValueError('Model weight digest mismatch')
        self.identity = {'name': name, 'weightsSha256': expected,
                         'encoderSha256': sha256(Path(__file__)),
                         'transform': 'EXIF-RGB-resize224x224-bilinear-antialias-ImageNetMeanStd-L2-float32',
                         'torch': torch.__version__, 'torchvision': torchvision.__version__}
        if name == 'vgg16':
            network = models.vgg16(weights=None)
            network.load_state_dict(torch.load(path, map_location='cpu', weights_only=True))
            self.model = torch.nn.Sequential(network.features, torch.nn.AdaptiveAvgPool2d((1, 1)), torch.nn.Flatten())
            self.dimension = 512
        else:
            source = root / 'dinov2-source'
            files = sorted((source / 'dinov2').rglob('*.py'))
            if not files:
                raise ValueError('Local DINOv2 source missing')
            self.identity['sourceSha256'] = hashlib.sha256(json.dumps(
                [(p.relative_to(source).as_posix(), sha256(p)) for p in files], separators=(',', ':')).encode()).hexdigest()
            sys.path.insert(0, str(source))
            from dinov2.hub.backbones import dinov2_vits14
            self.model = dinov2_vits14(pretrained=False)
            self.model.load_state_dict(torch.load(path, map_location='cpu', weights_only=True))
            self.dimension = 384
        self.model = self.model.eval().to(self.device)
        self.transform = transforms.Compose([
            transforms.Resize((224, 224), interpolation=transforms.InterpolationMode.BILINEAR, antialias=True),
            transforms.ToTensor(), transforms.Normalize([.485, .456, .406], [.229, .224, .225]),
        ])

    def embed(self, images):
        with torch.inference_mode():
            batch = torch.stack([self.transform(image) for image in images]).to(self.device)
            vectors = self.model(batch).float()
            vectors = torch.nn.functional.normalize(vectors, dim=1)
            result = vectors.cpu().numpy().astype('<f4', copy=False)
        if result.shape != (len(images), self.dimension) or not np.isfinite(result).all():
            raise ValueError('Invalid model features')
        return result
