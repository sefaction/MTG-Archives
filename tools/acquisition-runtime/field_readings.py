"""Supporting field observations; glyph similarities never authorize identity."""
import hashlib
import re
from pathlib import Path

_symbols = None
_mana = None


def asset_root():
    candidates = [Path('/app/node_modules'), Path(__file__).resolve().parents[2]/'node_modules']
    for root in candidates:
        if (root/'mana-font/fonts/mana.ttf').is_file() and (root/'keyrune/fonts/keyrune.ttf').is_file():
            return root
    raise ValueError('Bundled field-recognition assets unavailable')


def assets():
    root = asset_root()
    return {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in
            ('mana-font/fonts/mana.ttf','mana-font/css/mana.css',
             'keyrune/fonts/keyrune.ttf','keyrune/css/keyrune.css')}


def mana_templates():
    global _mana
    if _mana is not None:
        return _mana
    import cv2
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    root = asset_root()/'mana-font'
    css = (root/'css/mana.css').read_text()
    font = ImageFont.truetype(str(root/'fonts/mana.ttf'), 48)
    bank = []
    for symbol in ('w','u','b','r','g','c'):
        match = re.search(r'\.ms-'+symbol+r':{1,2}before\s*\{\s*content:\s*"\\([a-fA-F0-9]+)"',css)
        if not match:
            continue
        image = Image.new('L',(64,64),255)
        draw = ImageDraw.Draw(image)
        draw.text((8,4),chr(int(match[1],16)),font=font,fill=0)
        mask = np.asarray(image)<128
        ys,xs=np.nonzero(mask)
        if len(xs):
            normalized=cv2.resize(mask[ys.min():ys.max()+1,xs.min():xs.max()+1].astype(np.uint8)*255,(32,32))
            bank.append((symbol.upper(),normalized))
    _mana=bank
    return bank


def mana_observations(card):
    import cv2
    import numpy as np
    gray=cv2.cvtColor(card[30:145,600:970],cv2.COLOR_BGR2GRAY)
    # Isolate printed mana circles before comparing the inner symbol. Unsupported
    # hybrid/Phyrexian/other shapes remain unknown instead of guessed letters.
    circles=cv2.HoughCircles(gray,cv2.HOUGH_GRADIENT,1,26,param1=100,param2=28,minRadius=12,maxRadius=35)
    found=[]
    if circles is not None:
        for cx,cy,r in sorted(circles[0],key=lambda c:c[0])[:16]:
            radius=max(6,int(r*.63));x,y=int(cx),int(cy)
            if x-radius<0 or y-radius<0 or x+radius>=gray.shape[1] or y+radius>=gray.shape[0]:
                continue
            patch=gray[y-radius:y+radius,x-radius:x+radius]
            _,mask=cv2.threshold(patch,0,255,cv2.THRESH_BINARY_INV|cv2.THRESH_OTSU)
            ys,xs=np.nonzero(mask)
            if not len(xs):continue
            query=cv2.resize(mask[ys.min():ys.max()+1,xs.min():xs.max()+1],(32,32))
            scores=sorted(((float(cv2.matchTemplate(query,template,cv2.TM_CCOEFF_NORMED)[0,0]),name)
                           for name,template in mana_templates()),reverse=True)
            if scores and all(np.isfinite(s) for s,_ in scores):
                found.append({'symbol':scores[0][1] if len(scores)>1 and scores[0][0]>=.9 and scores[0][0]-scores[1][0]>=.1 else None,
                              'similarity':round(max(-1,min(1,scores[0][0])),6),'x':600+x,'y':30+y})
    return {'status':'OBSERVED' if found else 'UNREADABLE','automaticAcceptance':False,'symbols':found}


def supporting_fields(card, ocr):
    global _symbols
    from expansion_symbols import ExpansionSymbolBank
    if _symbols is None:
        _symbols=ExpansionSymbolBank(asset_root()/'keyrune')
    def read(bounds):
        x0,y0,x1,y1=bounds
        result=[]
        for prediction in ocr.predict(card[y0:y1,x0:x1]):
            for text,score in zip(prediction['rec_texts'],prediction['rec_scores']):
                if len(result)<16 and len(str(text))<=200 and 0<=float(score)<=1:
                    result.append({'text':str(text),'score':float(score)})
        return result
    return {'typeLine':read((70,740,950,900)), 'manaText':read((600,25,970,150)),
            'mana':mana_observations(card),
            'setSymbol':{'version':'expansion-symbol-shapes-v1','bounds':[790,745,960,900],
                         'automaticAcceptance':False,'query':_symbols.observe_patch(card[745:900,790:960]),
                         'reference':{'status':'UNREADABLE','reason':'REFERENCE_NOT_CHECKED'},'relation':'UNRESOLVED'}}
