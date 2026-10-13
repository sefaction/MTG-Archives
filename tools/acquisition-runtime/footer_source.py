"""A bounded identifier-footer view from original pixels, without upsampling.

Uses the existing proposed/manual card coordinate frame. It does not identify a
card, verify its edges, read unobserved padding, or replace any earlier OCR.
"""
import cv2
import json
import numpy as np

VERSION = 'source-footer-identifiers-v1'
BOUNDS = (24, 1270, 630, 1396)


def unavailable_source(degrees, reason):
    return {'version':VERSION,'bounds':list(BOUNDS),'rotationDegrees':degrees,
            'status':'UNAVAILABLE','reason':reason}


def source_footer_view(image, geometry, degrees):
    if degrees not in (0,180):raise ValueError('Unsupported identifier direction')
    base={'version':VERSION,'bounds':list(BOUNDS),'rotationDegrees':degrees}
    def unavailable(reason):return None,{**base,'status':'UNAVAILABLE','reason':reason}
    if geometry.get('framing')=='CLIPPED':return unavailable('PHYSICAL_CLIPPING')
    if geometry.get('status')!='PROPOSED':return unavailable('GEOMETRY_UNAVAILABLE')
    if not isinstance(image,np.ndarray) or image.ndim!=3 or image.shape[2]!=3 or image.dtype!=np.uint8:
        raise ValueError('Invalid original image')
    quad=np.asarray(geometry.get('quad',[]),np.float32)
    if quad.shape!=(4,2) or not np.isfinite(quad).all() or not cv2.isContourConvex(quad) or cv2.contourArea(quad,oriented=True)<=0:
        return unavailable('GEOMETRY_UNAVAILABLE')
    widths=[np.linalg.norm(quad[1]-quad[0]),np.linalg.norm(quad[2]-quad[3])]
    if min(widths)<500:return unavailable('SOURCE_TOO_SMALL')
    canonical=np.float32([[0,0],[999,0],[999,1396],[0,1396]])
    mapping=cv2.getPerspectiveTransform(canonical,quad)
    x0,y0,x1,y1=BOUNDS
    corners=np.float32([[x0,y0],[x1,y0],[x1,y1],[x0,y1]])
    if degrees==180:corners=np.float32([999,1396])-corners
    source=cv2.perspectiveTransform(corners[None],mapping)[0]
    h,w=image.shape[:2]
    if not np.isfinite(source).all() or np.any(source<0) or np.any(source[:,0]>w-1) or np.any(source[:,1]>h-1):
        return unavailable('REGION_CLIPPED')
    source_width=float(min(np.linalg.norm(source[1]-source[0]),np.linalg.norm(source[2]-source[3])))
    source_height=float(min(np.linalg.norm(source[3]-source[0]),np.linalg.norm(source[2]-source[1])))
    scale=min(1.,1280/max(1,source_width),512/max(1,source_height))
    width,height=int(np.floor(source_width*scale)),int(np.floor(source_height*scale))
    if min(width,height)<16:return unavailable('SOURCE_TOO_SMALL')
    low=np.floor(source.min(axis=0)).astype(int)
    high=np.ceil(source.max(axis=0)).astype(int)+1
    window=image[low[1]:min(h,high[1]),low[0]:min(w,high[0])]
    local=source-low.astype(np.float32)
    transform=cv2.getPerspectiveTransform(local,np.float32([[0,0],[width-1,0],[width-1,height-1],[0,height-1]]))
    visibility=cv2.warpPerspective(np.full(window.shape[:2],255,np.uint8),transform,(width,height))
    if int(visibility.min())<254:return unavailable('REGION_CLIPPED')
    view=cv2.warpPerspective(window,transform,(width,height))
    return view,{**base,'status':'EXTRACTED','sourceQuad':source.tolist(),
        'width':width,'height':height,'sourceWidth':source_width,'sourceHeight':source_height,
        'sourceFrame':{'width':w,'height':h}}


def restore_identifier_polygon(polygon, metadata):
    """Return coordinates in the same oriented card frame as earlier readings."""
    points=np.asarray(polygon,np.float64)
    if metadata.get('status')!='EXTRACTED' or points.shape!=(4,2) or not np.isfinite(points).all():return None
    w,h=metadata['width'],metadata['height']
    if np.any(points<0) or np.any(points[:,0]>w-1) or np.any(points[:,1]>h-1):return None
    x0,y0,x1,y1=BOUNDS
    result=points*np.array([(x1-x0)/(w-1),(y1-y0)/(h-1)])+[x0,y0]
    return result.tolist()


def bounded_source_footer_output(payload):
    output=json.dumps(payload)
    if len(output.encode())<=65535:return output
    payload.pop('scannerLayout',None)
    payload.pop('scannerLayoutTemplate',None)
    output=json.dumps(payload)
    if len(output.encode())<=65535:return output
    payload.get('text',{}).pop('footerSourceIdentifiers',None)
    for observation in payload.get('orientations',[]):
        observation['text'].pop('footerSourceIdentifiers',None)
        observation.pop('identifierSource',None)
        observation.pop('identifierLines',None)
    return json.dumps(payload)


def read_source_footer(image, geometry, degrees, ocr, remaining, elapsed):
    """Optional extra evidence cannot invalidate successful legacy readings."""
    from reading_direction import grouped_text
    if elapsed>=28:return [],[],unavailable_source(degrees,'TIME_BUDGET')
    if remaining<=0:return [],[],unavailable_source(degrees,'EVIDENCE_BUDGET')
    try:
        view,source=source_footer_view(image,geometry,degrees)
        if view is None:return [],[],source
        lines=[]
        for prediction in ocr.predict(view):
            for value,score,polygon in zip(prediction['rec_texts'],prediction['rec_scores'],prediction['rec_polys']):
                polygon=restore_identifier_polygon(np.asarray(polygon).tolist(),source)
                if polygon is None:continue
                if len(str(value))>2000 or len(lines)>=remaining:
                    return [],[],unavailable_source(degrees,'EVIDENCE_BUDGET')
                if not np.isfinite(float(score)):raise ValueError('Invalid extra OCR score')
                lines.append({'text':str(value),'score':float(score),'polygon':polygon})
        return grouped_text(lines),lines,source
    except MemoryError:
        raise
    except Exception:
        return [],[],unavailable_source(degrees,'WORKER_ERROR')
