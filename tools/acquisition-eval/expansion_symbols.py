"""Observed expansion-icon shapes; never a printing ID or probability.

Templates come from the versioned bundled public Keyrune font, not a chosen
printing. Shared glyphs retain their aliases. Missing/unreadable marks are
unknown, never evidence that an expansion symbol is absent.
"""
import hashlib
from pathlib import Path
import re
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

VERSION = 'expansion-symbol-shapes-v1'
BOUNDS = (790, 745, 960, 900)
ASSETS = {
    'fonts/keyrune.ttf': '028fc985da90ecd42e05c2238a7a5f5446f81b4b240bd779a049ccad96f78b65',
    'css/keyrune.css': '9ec792c1357a4724e246e2c1648d0fbc9838476fe45638ac25df8720f46d696d',
}
SIZE = 64


def verified_assets(root):
    root = Path(root).resolve()
    result = {}
    for name, expected in ASSETS.items():
        file = root / name
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 4 * 1024 * 1024:
            raise ValueError('Expansion shape asset unavailable')
        data = file.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Expansion shape asset integrity changed')
        result[name] = data
    return result


def glyphs(css):
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    base, before, after = {}, {}, {}
    for selectors, body in re.findall(r'([^{}]+)\{([^{}]*)\}', css):
        content = re.search(r'content\s*:\s*["\']\\([a-fA-F0-9]{4})["\']', body)
        if not content:
            continue
        char = chr(int(content.group(1), 16))
        for selector in selectors.split(','):
            selector = selector.strip()
            plain = re.fullmatch(r'\.ss-([a-z0-9]{2,8}):{1,2}before', selector)
            duo = re.fullmatch(r'\.ss-duo\.ss-([a-z0-9]{2,8}):{1,2}(before|after)', selector)
            if plain:
                base[plain.group(1)] = char
            elif duo:
                if duo.group(2) == 'before':
                    before[duo.group(1)] = char
                else:
                    after[duo.group(1)] = (char, bool(re.search(r'color\s*:\s*#fff\b', body)))
    if not 1 <= len(base) <= 1000:
        raise ValueError('Expansion glyph catalogue invalid')
    return {code: (before.get(code, char), after.get(code)) for code, char in base.items()}


def normalized(mask):
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    crop = mask[ys.min():ys.max()+1, xs.min():xs.max()+1].astype(np.uint8)*255
    height, width = crop.shape
    factor = (SIZE-4)/max(width, height)
    scaled = cv2.resize(crop, (max(1, round(width*factor)), max(1, round(height*factor))), interpolation=cv2.INTER_AREA)
    result = np.zeros((SIZE, SIZE), np.uint8)
    h, w = scaled.shape
    result[(SIZE-h)//2:(SIZE-h)//2+h, (SIZE-w)//2:(SIZE-w)//2+w] = scaled
    return result >= 128


def hole_fraction(mask):
    filled = mask.astype(np.uint8).copy()
    cv2.floodFill(filled, None, (0, 0), 1)
    holes = np.count_nonzero(filled == 0)
    return holes/max(1, holes+np.count_nonzero(mask))


class ExpansionSymbolBank:
    def __init__(self, root='/app/node_modules/keyrune'):
        assets = verified_assets(root)
        font = ImageFont.truetype(str(Path(root)/'fonts/keyrune.ttf'), 160)
        grouped = {}
        for code, (base, overlay) in glyphs(assets['css/keyrune.css'].decode('utf8')).items():
            image = Image.new('L', (256, 256), 255)
            draw = ImageDraw.Draw(image)
            draw.text((30, 20), base, font=font, fill=0)
            # A generic dark after-layer is a decorative border, not the
            # identifying inner shape; painting it over the mark can turn a
            # layered design into an uninformative filled disc.
            if overlay and overlay[1]:
                draw.text((30, 20), overlay[0], font=font, fill=255)
            mask = normalized(np.asarray(image) < 128)
            if mask is None:
                continue
            key = hashlib.sha256(mask.tobytes()).hexdigest()[:16]
            entry = grouped.setdefault(key, {'family': key, 'codes': [], 'mask': mask})
            entry['codes'].append(code.upper())
        self.entries = list(grouped.values())
        for entry in self.entries:
            entry['codes'] = sorted(set(entry['codes']))
            if len(entry['codes']) > 24:
                raise ValueError('Expansion alias bound exceeded')
        self.matrix = np.array([e['mask'].reshape(-1) for e in self.entries], dtype=np.float32)
        self.areas = self.matrix.sum(axis=1)
        self.holes = np.array([hole_fraction(e['mask']) for e in self.entries])
        self.distances = np.array([cv2.distanceTransform((~e['mask']).astype(np.uint8),
            cv2.DIST_L2, cv2.DIST_MASK_PRECISE).reshape(-1) for e in self.entries])

    def match_mask(self, mask):
        query = normalized(mask)
        if query is None:
            return []
        flat = query.reshape(-1).astype(np.float32)
        # Bidirectional shape distance tolerates raster stroke thickness while
        # still charging missing internal features in either direction.
        query_distance=cv2.distanceTransform((~query).astype(np.uint8),cv2.DIST_L2,cv2.DIST_MASK_PRECISE).reshape(-1)
        distance=(self.distances.dot(flat)/flat.sum()+self.matrix.dot(query_distance)/self.areas)/2
        scores=np.exp(-distance/2)
        # A filled disc cannot stand in for a glyph whose interior carries the
        # recognizable mark (for example a white design inside a dark disc).
        scores[(self.holes >= .02) & (hole_fraction(query) < .005)] = 0
        order = np.argsort(-scores)[:2]
        return [{'family': self.entries[i]['family'], 'codes': self.entries[i]['codes'],
                 'similarity': round(float(scores[i]), 6)} for i in order]

    def observe_patch(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
        if gray.shape != (155, 170) or float(gray.std()) < 6:
            return {'status': 'UNREADABLE', 'reason': 'LOW_REGION_CONTRAST'}
        masks = []
        for inverse in [False, True]:
            flags = cv2.THRESH_BINARY_INV if not inverse else cv2.THRESH_BINARY
            _, binary = cv2.threshold(gray, 0, 255, flags | cv2.THRESH_OTSU)
            count, labels, stats, _ = cv2.connectedComponentsWithStats(binary)
            parts = []
            for label in range(1, count):
                x, y, w, h, area = stats[label]
                if (x <= 1 or y <= 1 or x+w >= 169 or y+h >= 154 or
                        not 10 <= w <= 125 or not 16 <= h <= 110 or area < 40):
                    continue
                parts.append((label, (x, y, w, h)))
            if len(parts) > 24:
                return {'status': 'UNREADABLE', 'reason': 'REGION_TOO_COMPLEX'}
            for label, bounds in parts:
                mask = labels == label
                masks.append((mask, bounds))
                x, y, w, h = bounds
                # Enclosed details can be separate dark components (eyes,
                # lettering, etc.). Keep all observed ink inside the symbol's
                # outer box instead of dropping it as a too-small component.
                enclosed=np.zeros_like(mask)
                enclosed[y:y+h,x:x+w]=binary[y:y+h,x:x+w]>0
                masks.append((enclosed,bounds))
                neighbours = [other for other, (ox, oy, ow, oh) in parts if other != label and
                              abs(oy+oh/2-(y+h/2)) <= h/2 and abs(ox+ow/2-(x+w/2)) <= 1.5*h]
                if neighbours:
                    union = np.isin(labels, [label, *neighbours])
                    ys, xs = np.nonzero(union)
                    box = (int(xs.min()), int(ys.min()), int(xs.max()-xs.min()+1), int(ys.max()-ys.min()+1))
                    if box[2] <= 125 and box[3] <= 110:
                        masks.append((union, box))
        results = []
        for mask, bounds in masks:
            ranked = self.match_mask(mask)
            if ranked:
                results.append((ranked[0]['similarity'], ranked, bounds))
        if not results:
            return {'status': 'UNREADABLE', 'reason': 'NO_ISOLATED_SHAPE'}
        _, ranked, bounds = max(results, key=lambda row: row[0])
        if ranked[0]['similarity'] < .9:
            return {'status': 'UNREADABLE', 'reason': 'NO_SUPPORTED_TEMPLATE', 'matches': ranked}
        status = 'SIMILAR' if ranked[0]['similarity']-ranked[1]['similarity'] >= .04 else 'AMBIGUOUS'
        return {'status': status, 'reason': 'SHAPE_COMPARISON', 'matches': ranked,
                'box': [int(value) for value in bounds]}
