"""Offline development-corpus evaluation. Never writes to the source folder.

Geometry is a heuristic proposal, not a card classifier or physical-count authority.
No image is sent to an external service. Missing inputs fail the requested run.
"""
import argparse
import hashlib
import json
from pathlib import Path
import resource
import subprocess
import time

import cv2
import numpy as np
from PIL import Image, ImageOps

cv2.setNumThreads(1)
VERSION = "opencv-contour-tesseract-regions-dev2"


def order_quad(points):
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    center = points.mean(axis=0)
    angles = np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0])
    points = points[np.argsort(angles)]
    points = np.roll(points, -np.argmin(points.sum(axis=1)), axis=0)
    # Keep the short edge across the top, for cards rotated sideways.
    if np.linalg.norm(points[1]-points[0]) > np.linalg.norm(points[2]-points[1]):
        points = np.roll(points, -1, axis=0)
    return points


def preserve_full_frame(image):
    """Conservative tight dark-border scan proposal; never a card classifier.

    A scanner export may already end at the physical card edge. Its strongest
    quadrilateral is often the inner printed frame, above the identifier strip.
    Require near-frame connected content AND a dark rim on every edge. Aspect
    ratio alone would also accept ordinary 3:4 phone photographs. White-border
    and borderless scans deliberately keep the existing detector for now.
    """
    h, w = image.shape[:2]
    if not .68 <= min(h, w) / max(h, w) <= .76:
        return False
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    rim = max(1, round(min(h, w) * .01))
    strips = (gray[:rim], gray[-rim:], gray[:, :rim], gray[:, -rim:])
    if not all(float(np.mean(strip < 70)) >= .85 for strip in strips):
        return False
    scale = min(1, 1400 / max(h, w))
    gray = cv2.resize(gray, None, fx=scale, fy=scale)
    mask = (gray >= 70).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    # Work from connected visible content, independently of the inner-border
    # quadrilateral ranking. This support remains useful after quarter turns.
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:3]:
        hull = cv2.convexHull(contour).astype(np.float32) / scale
        area = abs(cv2.contourArea(hull))
        low, high = hull.reshape(-1, 2).min(axis=0), hull.reshape(-1, 2).max(axis=0)
        bounds_area = np.prod(high - low)
        if (area / (w * h) < .70 or bounds_area / (w * h) < .75
                or area / bounds_area < .88):
            continue
        if all(value <= .14 for value in (low[0]/w, low[1]/h,
                                          (w-1-high[0])/w, (h-1-high[1])/h)):
            return True
    return False


def scanner_background_quad(image):
    """Remove only a small bright outer band beyond a dark card border.

    CARD_SCAN is already framed: never rank internal contours or infer a card
    from aspect alone. White borders, blank scans, broad margins and ambiguous
    seams retain the entire frame. This proposal changes derived pixels only.
    """
    h, w = image.shape[:2]
    # All channels must be bright: colored card content is not background.
    bright = np.min(image, axis=2) >= 245
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    bounds = [0, 0, w - 1, h - 1]
    for axis, length in ((0, h), (1, w)):
        profile = np.mean(bright, axis=1 - axis)
        dark_profile = np.mean(gray < 70, axis=1 - axis)
        for reverse in (False, True):
            light = profile[::-1] if reverse else profile
            dark = dark_profile[::-1] if reverse else dark_profile
            # Opposite white edge makes a white card border ambiguous.
            if light[0] < .98 or light[-1] >= .98:
                continue
            non_background = np.flatnonzero(light < .98)
            if not len(non_background):
                continue
            band = int(non_background[0])
            # A card scan needs little trimming. Reject broad padding rather
            # than search deeper into a card's printed frame or footer.
            if not .02 * length <= band <= .08 * length:
                continue
            seam = dark[band:band + max(2, round(length * .002))]
            if not len(seam) or np.min(seam) < .90:
                continue
            # Leave one background pixel outside the border; never cut into it.
            index = (3 if reverse else 1) if axis == 0 else (2 if reverse else 0)
            bounds[index] = length - band if reverse else band - 1
    x0, y0, x1, y1 = bounds
    cw, ch = x1 - x0 + 1, y1 - y0 + 1
    if bounds == [0, 0, w - 1, h - 1]:
        return None
    if cw * ch < .86 * w * h or not .66 <= min(cw, ch) / max(cw, ch) <= .80:
        return None
    return order_quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])


def scanner_card_edges(image):
    """Fit the exterior dark rim on a light scanner background, never artwork.

    Only a large, nearly rectangular, dark-bordered card with light exterior
    support qualifies. Rounded corners are excluded from line fitting; the four
    lines are moved outwards to enclose the entire observed rim. Missing exterior
    support on an image edge is clipping evidence, not a license to infer pixels.
    Other inputs keep the existing full-frame/strip behavior.
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Use the central portion: rounded card corners alone are not background.
    edge_samples = (gray[0, w//4:3*w//4], gray[-1, w//4:3*w//4],
                    gray[h//4:3*h//4, 0], gray[h//4:3*h//4, -1])
    exterior = [float(np.mean(s >= 100)) >= .95 for s in edge_samples]
    if sum(exterior) < 3:
        return None, None
    # A white card border can be indistinguishable from a pure white backdrop.
    # Do not promote an inner black rectangle to an observed physical outline.
    if all(float(np.median(s)) >= 245 for s in edge_samples):
        return None, None
    mask = (gray < 70).astype(np.uint8) * 255
    contour_scale = min(1, 2000/max(h, w))
    bounded_mask = cv2.resize(mask, None, fx=contour_scale, fy=contour_scale,
                              interpolation=cv2.INTER_NEAREST) if contour_scale < 1 else mask
    contours, _ = cv2.findContours(bounded_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if len(contours) > 1000:
        return None, None
    if not contours:
        return None, None
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    contour = contours[0].reshape(-1, 2).astype(np.float64)/contour_scale
    raw_area = abs(cv2.contourArea(contours[0]))
    area = raw_area/(contour_scale**2)
    if area < .60 * w * h or any(abs(cv2.contourArea(c)) > .02 * raw_area for c in contours[1:]):
        return None, None
    x0, y0 = contour.min(axis=0)
    x1, y1 = contour.max(axis=0)
    _, rectangle_size, _ = cv2.minAreaRect(contour.astype(np.float32))
    if area / max(1, rectangle_size[0]*rectangle_size[1]) < .97:
        return None, None
    # A visible dark rim reaching a boundary amid three light margins is an
    # incomplete source. Do not crop inward to the inner printed rectangle.
    if not all(exterior):
        distances = (y0, h-1-y1, x0, w-1-x1)
        if any(not light and distance < 2 for light, distance in zip(exterior, distances)):
            return None, 'CLIPPED'
        return None, None
    if min(x0, y0, w-1-x1, h-1-y1) < 2:
        return None, 'CLIPPED'

    # Samples from the straight middle of each exterior side, with support over
    # most of its length. The first/last dark point is outside every inner frame.
    lines = []
    for axis, low, high, other_low, other_high in (
            (0, y0, y1, x0, x1), (1, x0, x1, y0, y1)):
        span = high-low
        start, stop = int(low+.18*span), int(high-.18*span)
        positions = np.arange(start, stop+1)
        profiles = mask[positions, :] if axis == 0 else mask[:, positions].T
        present = profiles != 0
        if not np.all(np.any(present, axis=1)):
            return None, None
        first = np.argmax(present, axis=1)
        last = profiles.shape[1]-1-np.argmax(present[:, ::-1], axis=1)
        for reverse, samples in ((False, first), (True, last)):
            slope, intercept = np.polyfit(positions, samples, 1)
            residual = samples-(slope*positions+intercept)
            # No loose fit to bent, torn or ambiguous exterior edges. Error is
            # bounded in physical pixels, rather than by an OCR confidence.
            tolerance = max(1.5, min(w, h)*.003)
            if np.max(np.abs(residual)) > tolerance or abs(slope) > .15:
                return None, None
            # Enclose ALL contour pixels, including rounded-corner extremities,
            # plus two source pixels for antialiasing at the physical boundary.
            independent = contour[:, 1-axis]
            dependent = contour[:, axis]
            offsets = dependent-slope*independent
            allowance = 2/contour_scale
            intercept = (offsets.max()+allowance if reverse else offsets.min()-allowance)
            lines.append((slope, intercept))
    left, right, top, bottom = lines
    def intersection(vertical, horizontal):
        a, b = vertical
        c, d = horizontal
        y = (c*b+d)/(1-c*a)
        return [a*y+b, y]
    q = np.asarray([intersection(left, top), intersection(right, top),
                    intersection(right, bottom), intersection(left, bottom)], np.float32)
    if (not np.isfinite(q).all() or np.any(q[:, 0] < 0) or np.any(q[:, 0] > w-1)
            or np.any(q[:, 1] < 0) or np.any(q[:, 1] > h-1)):
        return None, 'CLIPPED'
    lengths = [np.linalg.norm(q[(i+1)%4]-q[i]) for i in range(4)]
    ratio = (lengths[0]+lengths[2])/(lengths[1]+lengths[3])
    if not .69 <= min(ratio, 1/ratio) <= .74:
        return None, None
    # Contrast on both sides of every straight edge independently supports the
    # physical rim. Dark/white card art or aspect ratio alone cannot qualify.
    for i in range(4):
        p, end = q[i], q[(i+1)%4]
        tangent = (end-p)/np.linalg.norm(end-p)
        inward = np.array([-tangent[1], tangent[0]])
        points = p+(end-p)*np.linspace(.20, .80, 80)[:, None]
        for offset, dark in ((5, True), (-5, False)):
            sample = np.rint(points+offset*inward).astype(int)
            if (np.any(sample[:, 0] < 0) or np.any(sample[:, 0] >= w)
                    or np.any(sample[:, 1] < 0) or np.any(sample[:, 1] >= h)):
                return None, None
            values = gray[sample[:, 1], sample[:, 0]]
            if np.mean(values < 90 if dark else values >= 90) < .95:
                return None, None
            if dark:
                inside_median = float(np.median(values))
            else:
                # A scanner shadow can darken the white backing near a side.
                # Require a strong transition across that side, independently
                # of the light support already observed at the source boundary.
                if float(np.median(values))-inside_median < 40:
                    return None, None
                # A white border outside an inner printed rectangle is not the
                # surrounding scanner background. Compare its level with the
                # corresponding exterior boundary, allowing scanner shading.
                edge_index = (0, 3, 1, 2)[i]
                if float(np.median(values))-float(np.median(edge_samples[edge_index])) > 8:
                    return None, None
    return order_quad(q), 'ALIGNED'

def geometry(image, input_kind='PHOTO'):
    h, w = image.shape[:2]
    if input_kind not in ('PHOTO', 'CARD_SCAN'):
        raise ValueError('Unknown image input kind')
    if input_kind == 'CARD_SCAN' or preserve_full_frame(image):
        edges, framing = scanner_card_edges(image) if input_kind == 'CARD_SCAN' else (None, None)
        if framing == 'CLIPPED':
            return None, {"status": "NEEDS_CROP", "framing": "CLIPPED"}
        trimmed = scanner_background_quad(image) if input_kind == 'CARD_SCAN' else None
        q = edges if edges is not None else trimmed if trimmed is not None else order_quad([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]])
        transform = cv2.getPerspectiveTransform(q.astype(np.float32), np.float32([[0,0],[999,0],[999,1396],[0,1396]]))
        crop = cv2.warpPerspective(image, transform, (1000, 1397))
        return crop, {"status": "PROPOSED", "quad": q.tolist(),
                      "method": ("scanner-card-edges" if edges is not None else
                                 "scanner-background-trim" if trimmed is not None else
                                 "declared-card-scan" if input_kind == 'CARD_SCAN' else "full-frame"),
                      "confidence": None, **({"framing": framing} if framing else {})}
    scale = min(1, 1400 / max(h, w))
    small = cv2.resize(image, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edge = cv2.Canny(gray, 40, 120)
    edge = cv2.morphologyEx(edge, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    candidates = []
    frame_area = small.shape[0] * small.shape[1]
    # Uniform-tabletop proposal supplements edges that reflections can interrupt.
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
    samples = np.concatenate([lab[:12,:12].reshape(-1,3), lab[:12,-12:].reshape(-1,3),
                              lab[-12:,:12].reshape(-1,3), lab[-12:,-12:].reshape(-1,3)])
    background = np.median(samples, axis=0)
    foreground = (np.linalg.norm(lab-background, axis=2) > 35).astype(np.uint8)*255
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, np.ones((15,15),np.uint8))
    for mask in (edge, binary, foreground):
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if not .08 * frame_area <= area <= .96 * frame_area:
                continue
            hull = cv2.convexHull(contour)
            quad = cv2.approxPolyDP(hull, .02 * cv2.arcLength(hull, True), True)
            if len(quad) != 4 or not cv2.isContourConvex(quad):
                continue
            q = order_quad(quad)
            sides = [float(np.linalg.norm(q[(i+1) % 4]-q[i])) for i in range(4)]
            ratio = (sides[0]+sides[2]) / (sides[1]+sides[3])
            if not .53 <= ratio <= .88:
                continue
            if np.any(q < 2) or np.any(q[:, 0] > small.shape[1]-3) or np.any(q[:, 1] > small.shape[0]-3):
                continue
            score = area / frame_area - abs(ratio - 63/88) * .15
            candidates.append((score, q / scale))
    if not candidates:
        return None, {"status": "NEEDS_CROP", "reason": "NO_CARD_QUADRILATERAL"}
    candidates.sort(key=lambda c: c[0], reverse=True)
    q = candidates[0][1]
    # Small outward margin retains rounded corners on ordinary photos.
    q = q.mean(axis=0) + (q - q.mean(axis=0)) * 1.015
    q[:, 0] = np.clip(q[:, 0], 0, w-1)
    q[:, 1] = np.clip(q[:, 1], 0, h-1)
    transform = cv2.getPerspectiveTransform(q.astype(np.float32), np.float32([[0,0],[999,0],[999,1396],[0,1396]]))
    crop = cv2.warpPerspective(image, transform, (1000, 1397))
    return crop, {"status": "PROPOSED", "quad": q.tolist(), "method": "contours", "confidence": None}


def ocr(image, psm):
    # Child gets no network capability in the runner; one CPU thread, hard timeout.
    ok, png = cv2.imencode('.png', image)
    if not ok:
        raise ValueError('Failed to encode OCR region')
    result = subprocess.run(['tesseract', 'stdin', 'stdout', '-l', 'eng', '--psm', str(psm)],
                            input=png.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            check=True, timeout=15)
    return result.stdout.decode('utf-8').strip()


def evaluate(path, output):
    started = time.monotonic()
    raw = path.read_bytes()
    if len(raw) > 10*1024*1024:
        raise ValueError('Oversized input')
    with Image.open(path) as source:
        if source.width * source.height > 36000000:
            raise ValueError('Oversized decoded image')
        image = cv2.cvtColor(np.asarray(ImageOps.exif_transpose(source).convert('RGB')), cv2.COLOR_RGB2BGR)
    crop, evidence = geometry(image)
    result = {"file": path.name, "sha256": hashlib.sha256(raw).hexdigest(), "geometry": evidence,
              "inputWidth": image.shape[1], "inputHeight": image.shape[0], "automaticAcceptance": False}
    # Whole-photo baseline versus perspective-normalized title/footer regions.
    whole = cv2.resize(image, None, fx=2000/max(image.shape[:2]), fy=2000/max(image.shape[:2]))
    result['wholeText'] = ocr(whole, 11)
    if crop is not None:
        cv2.imwrite(str(output / (path.stem + '.crop.jpg')), crop)
        regions = {"title": crop[45:155, 40:830], "footer": crop[1280:1397, 15:985]}
        result['regions'] = {}
        for name, region in regions.items():
            gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
            gray = cv2.copyMakeBorder(gray, 15,15,15,15,cv2.BORDER_CONSTANT,value=255)
            result['regions'][name] = {"text": ocr(gray, 7 if name == 'title' else 6), "sparseText": ocr(gray, 11)}
        result['sharpness'] = float(cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
    result['milliseconds'] = round((time.monotonic()-started)*1000)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        raise ValueError('Output must be separate from originals')
    paths = sorted(args.input.glob('*.jpg'))
    if not paths:
        raise ValueError('Requested private corpus is missing')
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for path in paths:
        result = evaluate(path, args.output)
        results.append(result)
        print(json.dumps({"file": path.name, "geometry": result['geometry']['status'], "milliseconds": result['milliseconds']}), flush=True)
    report = {"version": VERSION, "opencv": cv2.__version__, "numpy": np.__version__,
              "tesseract": subprocess.check_output(['tesseract', '--version'], text=True).splitlines()[0],
              "modelSha256": hashlib.sha256(Path('/usr/share/tesseract-ocr/5/tessdata/eng.traineddata').read_bytes()).hexdigest(),
              "codeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "peakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
              "childPeakRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
              "split": "development-only", "results": results}
    (args.output/'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
