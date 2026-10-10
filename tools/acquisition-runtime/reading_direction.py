"""Bounded reading strips and nearby words, in canonical card coordinates."""

TITLE_BOTTOM = 250
FOOTER_TOP = 1270
CARD_HEIGHT = 1397
# Keep the detector canvas size and the title's sampling scale stable. The extra
# 60 white rows mask the old footer's flavor/P-T area instead of shrinking it.
STRIP_GAP = 80


def reading_zones():
    return {'title': {'top': 0, 'bottom': TITLE_BOTTOM},
            'footer': {'top': FOOTER_TOP, 'bottom': CARD_HEIGHT}}


def restore_reading_polygon(polygon):
    """Undo the title/gap/footer stitch; discard boxes crossing its seam."""
    top = min(p[1] for p in polygon)
    bottom = max(p[1] for p in polygon)
    if 0 <= top <= bottom <= TITLE_BOTTOM:
        return [[p[0], p[1]] for p in polygon]
    stitched_footer = TITLE_BOTTOM + STRIP_GAP
    if stitched_footer <= top <= bottom <= stitched_footer + CARD_HEIGHT - FOOTER_TOP:
        return [[p[0], p[1] + FOOTER_TOP - stitched_footer] for p in polygon]
    return None


def grouped_text(lines):
    boxes = []
    for line in lines:
        points = line['polygon']
        left, right = min(p[0] for p in points), max(p[0] for p in points)
        top, bottom = min(p[1] for p in points), max(p[1] for p in points)
        boxes.append({'text': line['text'], 'left': left, 'right': right,
                      'center': (top + bottom) / 2, 'height': max(1, bottom - top)})
    rows = []
    for box in sorted(boxes, key=lambda b: (b['center'], b['left'])):
        row = next((row for row in rows if
                    abs(row[0]['center'] - box['center']) <= .4 * min(row[0]['height'], box['height'])), None)
        if row is None:
            rows.append([box])
        else:
            row.append(box)
    result = []
    for row in rows:
        previous = None
        for box in sorted(row, key=lambda b: b['left']):
            if previous is not None and box['left'] - previous['right'] <= 2 * min(box['height'], previous['height']):
                result[-1] += ' ' + box['text']
            else:
                result.append(box['text'])
            previous = box
    if len(result) > 100 or any(len(text) > 2000 for text in result):
        raise ValueError('Grouped OCR evidence exceeds bounds')
    return result


def reading_text(lines):
    return {
        'title': grouped_text([line for line in lines if max(p[1] for p in line['polygon']) <= TITLE_BOTTOM]),
        'footer': grouped_text([line for line in lines if min(p[1] for p in line['polygon']) >= FOOTER_TOP]),
    }


def restore_footer_polygon(polygon):
    """Map a separate full-width footer reading without invented coordinates."""
    top = min(p[1] for p in polygon)
    bottom = max(p[1] for p in polygon)
    if 0 <= top <= bottom <= CARD_HEIGHT - FOOTER_TOP:
        return [[p[0], p[1] + FOOTER_TOP] for p in polygon]
    return None
