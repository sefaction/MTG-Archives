"""Reconstruct nearby OCR words on the same printed line, without pixel changes."""


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
        'title': grouped_text([line for line in lines if max(p[1] for p in line['polygon']) < 260]),
        'footer': grouped_text([line for line in lines if min(p[1] for p in line['polygon']) > 1220]),
    }
