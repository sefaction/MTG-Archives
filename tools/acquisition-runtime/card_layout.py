"""Bounded geometry proposals and footer boundaries; no card identity authority."""
import cv2
import numpy as np

POLICY = 'card-layout-regions-v1'


def internal_card_region(image):
    h, w = image.shape[:2]
    scale = min(1., 1400 / max(h, w))
    small = cv2.resize(image, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5,5), 0), 40, 120)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    for contour in contours:
        x,y,bw,bh = cv2.boundingRect(contour)
        if bw < small.shape[1]*.25 or bh < 30 or not 1.1 < bw/bh < 5:
            continue
        rectangularity = abs(cv2.contourArea(contour))/(bw*bh)
        if rectangularity > .8:
            box = (x,y,bw,bh)
            if not any(sum(abs(a-b) for a,b in zip(box,old)) < 12 for old in boxes):
                boxes.append(box)
    proposals = []
    for x,y,bw,bh in boxes[:80]:
        card_w, card_h = bw/.84, bw/.84*1397/1000
        for tx,ty,tw,th in boxes[:80]:
            if not (.9 < tw/bw < 1.1 and abs(tx-x) < bw*.06 and .30 < (ty-y)/card_h < .55):
                continue
            # Both separate internal boxes must support the same standard-card
            # outline. This remains an inferred proposal, not a verified edge.
            left, top = x-card_w*.08, y-card_h*.18
            right, bottom = left+card_w, top+card_h
            if left < 0 or top < 0 or right >= small.shape[1] or bottom >= small.shape[0]:
                continue
            if not .18 < bh/card_h < .43 or not .10 < th/card_h < .40:
                continue
            proposals.append(np.float32([[left,top],[right,top],[right,bottom],[left,bottom]])/scale)
    if not proposals:
        return None
    chosen = proposals[0]
    # Conflicting outlines are not resolved by choosing the largest box.
    if any(np.max(np.abs(q-chosen)) > max(h,w)*.035 for q in proposals[1:]):
        return None
    return chosen


def card_geometry(image, input_kind='PHOTO'):
    from baseline import geometry
    crop, evidence = geometry(image, input_kind)
    if evidence.get('framing') != 'CLIPPED' and (crop is None or evidence.get('method') in ('declared-card-scan','full-frame')):
        quad = internal_card_region(image)
        if quad is not None:
            transform = cv2.getPerspectiveTransform(quad, np.float32([[0,0],[999,0],[999,1396],[0,1396]]))
            crop = cv2.warpPerspective(image, transform, (1000,1397))
            evidence = {'status':'PROPOSED','method':'internal-layout-v1','quad':quad.tolist(),
                        'boundaryVerified':False,'inferredFrom':['ART_BOX','TEXT_BOX']}
    if evidence.get('status')=='PROPOSED':
        evidence={**evidence,'sourceFrame':{'width':image.shape[1],'height':image.shape[0]}}
    return crop, evidence


def footer_top(card):
    # Search for the bottom text-box/frame boundary in a larger lower region.
    # Only a long observed divider permits expansion above the legacy strip.
    gray = cv2.cvtColor(card, cv2.COLOR_BGR2GRAY)
    band = gray[1140:1280, 60:940]
    edges = cv2.Canny(band, 50, 140)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, 80, minLineLength=520, maxLineGap=20)
    if lines is None:
        return 1270
    rows = [1140+max(y1,y2) for x1,y1,x2,y2 in lines[:,0] if abs(y1-y2) <= 3]
    return int(max(1160, min(1270, max(rows)+8))) if rows else 1270
