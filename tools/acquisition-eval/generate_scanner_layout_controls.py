"""Controlled synthetic pixels for the opt-in scanner-layout browser workflow.

These are mechanism controls, not independent physical-card accuracy samples.
No expected printing IDs or labels are passed to recognition.
"""
import argparse,hashlib,json
from pathlib import Path
import cv2,numpy as np
width,height=1700,2300
quad=np.float32([[50,30],[1650,30],[1650,2270],[50,2270]])
region={'version':1,'quad':(quad/[width-1,height-1]).tolist()}

def pixels(name,collector,border,shift=(0,0)):
    image=np.full((height,width,3),235,np.uint8)
    x,y=(quad[0]+shift).astype(int)
    card_width,card_height=int(quad[1,0]-quad[0,0]),int(quad[3,1]-quad[0,1])
    if border:
        cv2.rectangle(image,(x,y),(x+card_width,y+card_height),(10,)*3,12)
    def point(a,b):return (int(x+a*card_width/999),int(y+b*card_height/1396))
    cv2.putText(image,name,point(60,115),cv2.FONT_HERSHEY_SIMPLEX,2.0,(20,)*3,3,cv2.LINE_AA)
    cv2.putText(image,collector,point(40,1320),cv2.FONT_HERSHEY_SIMPLEX,1.2,(20,)*3,2,cv2.LINE_AA)
    cv2.putText(image,'TST EN',point(40,1350),cv2.FONT_HERSHEY_SIMPLEX,1.0,(20,)*3,2,cv2.LINE_AA)
    return image

def main():
    global width,height,quad
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--padded',action='store_true')
    parser.add_argument('--marker-only',action='store_true')
    args=parser.parse_args();output=args.output
    if args.padded:
        width,height=1600,2300
        quad=np.float32([[100,200],[1500,200],[1500,2155],[100,2155]])
    if output.exists() and any(output.iterdir()):
        raise ValueError('Use an empty dedicated control directory')
    output.mkdir(parents=True,exist_ok=True)
    rows=[]
    for role,image in [('calibration',pixels('Calibration Creature','' if args.marker_only else 'R 0017',True)),
                       ('unresolved',pixels('Another Creature','' if args.marker_only else 'U 0042',False,(8,-6)))]:
        path=output/(role+'.png')
        if not cv2.imwrite(str(path),image):raise ValueError('Control encoding failed')
        rows.append({'role':role,'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (output/'manifest.json').write_text(json.dumps({'syntheticPixels':True,'independentScannerAccuracy':False,'images':rows},indent=2))

if __name__=='__main__':main()
