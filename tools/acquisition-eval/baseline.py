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


def geometry(image, input_kind='PHOTO'):
    h, w = image.shape[:2]
    if input_kind not in ('PHOTO', 'CARD_SCAN'):
        raise ValueError('Unknown image input kind')
    if input_kind == 'CARD_SCAN' or preserve_full_frame(image):
        q = order_quad([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]])
        transform = cv2.getPerspectiveTransform(q.astype(np.float32), np.float32([[0,0],[999,0],[999,1396],[0,1396]]))
        crop = cv2.warpPerspective(image, transform, (1000, 1397))
        return crop, {"status": "PROPOSED", "quad": q.tolist(),
                      "method": "declared-card-scan" if input_kind == 'CARD_SCAN' else "full-frame", "confidence": None}
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
