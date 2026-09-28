"""Private offline method comparison; rankings are never automatic acceptance.

VGG16 feature method follows MTG_RealTime (global average pool, normalized
512-vector, 224-square input). Exact matrix search is equivalent to its flat L2
search; no ANN approximation. pHash and SIFT are independent comparison paths.
This evaluates methods, not the complete upstream applications.
"""
import argparse, hashlib, json, pathlib, time, resource
import cv2
import numpy as np
from PIL import Image, ImageOps
import torch
from torchvision import models, transforms
from baseline import geometry

cv2.setNumThreads(1)
torch.set_num_threads(1)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def decode(path):
    with Image.open(path) as src:
        if src.width * src.height > 36000000: raise ValueError('Oversized image')
        return cv2.cvtColor(np.asarray(ImageOps.exif_transpose(src).convert('RGB')), cv2.COLOR_RGB2BGR)

def phash(image):
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
    low=cv2.dct(cv2.resize(gray,(64,64)).astype(np.float32))[:16,:16].flatten()
    return low[1:] > np.median(low[1:])

def features(image, count):
    scale=min(1,1400/max(image.shape[:2]))
    image=cv2.resize(image,None,fx=scale,fy=scale)
    keypoints,desc=cv2.SIFT_create(nfeatures=count).detectAndCompute(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),None)
    return np.float32([p.pt for p in keypoints]),desc

def match(query, reference):
    qpoints,qdesc=query; rpoints,rdesc=reference
    if qdesc is None or rdesc is None or min(len(qdesc),len(rdesc))<4:return 0
    pairs=cv2.BFMatcher().knnMatch(rdesc,qdesc,k=2)
    good=[a for a,b in pairs if a.distance < .75*b.distance]
    if len(good)<4:return 0
    cv2.setRNGSeed(20260927)
    matrix,mask=cv2.findHomography(np.float32([rpoints[m.queryIdx] for m in good]),np.float32([qpoints[m.trainIdx] for m in good]),cv2.RANSAC,5)
    return int(mask.sum()) if matrix is not None and mask is not None else 0

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--references',type=pathlib.Path,required=True)
    parser.add_argument('--manifest',type=pathlib.Path,required=True)
    parser.add_argument('--photos',type=pathlib.Path,required=True)
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args();args.output.mkdir(exist_ok=True,parents=True)
    manifest=json.loads(args.manifest.read_text())
    source=json.loads(args.references.read_text());refs=source['references']
    if source['errors'] or not refs:raise ValueError('Reference preparation incomplete')
    refroot=args.references.parent
    for c in refs:
        if digest(refroot/c['file'])!=c['sha256']:raise ValueError('Reference digest mismatch')
    weights=pathlib.Path('/models/hub/checkpoints/vgg16-397923af.pth')
    if not weights.exists():raise ValueError('Initialize weights separately before offline evaluation')
    version={'code':digest(pathlib.Path(__file__)),'geometry':digest(pathlib.Path(__file__).with_name('baseline.py')),'referenceIndex':digest(args.references),'manifest':digest(args.manifest),'weights':digest(weights),'torch':torch.__version__,'opencv':cv2.__version__}
    # Cache identity includes code and all image digests via reference-index hash.
    key=hashlib.sha256(json.dumps(version,sort_keys=True).encode()).hexdigest()
    cache=args.output/(key+'.npz')
    vgg=models.vgg16(weights=None)
    vgg.load_state_dict(torch.load(weights,map_location='cpu',weights_only=True))
    model=torch.nn.Sequential(vgg.features,torch.nn.AdaptiveAvgPool2d((1,1)),torch.nn.Flatten()).eval()
    del vgg
    transform=transforms.Compose([transforms.ToPILImage(),transforms.Resize((224,224)),transforms.ToTensor(),transforms.Normalize([.485,.456,.406],[.229,.224,.225])])
    def embed(images):
        with torch.inference_mode():
            vectors=model(torch.stack([transform(cv2.cvtColor(im,cv2.COLOR_BGR2RGB)) for im in images])).numpy()
        return vectors/np.maximum(np.linalg.norm(vectors,axis=1,keepdims=True),1e-8)
    started=time.monotonic()
    torch.set_num_threads(4)
    if cache.exists():
        data=np.load(cache,allow_pickle=False);vectors=list(data['vectors']);hashes=list(data['hashes'])
    else:
        vectors=[];hashes=[]
    if len(vectors) != len(refs):
        for start in range(len(vectors),len(refs),8):
            images=[decode(refroot/c['file']) for c in refs[start:start+8]]
            vectors.extend(embed(images));hashes.extend(phash(im) for im in images)
            if start%200==0:
                np.savez_compressed(cache,vectors=np.array(vectors),hashes=np.array(hashes))
                print('indexed',len(vectors),'/',len(refs),flush=True)
        vectors=np.array(vectors);hashes=np.array(hashes)
        np.savez_compressed(cache,vectors=vectors,hashes=hashes)
    vectors=np.array(vectors);hashes=np.array(hashes)
    torch.set_num_threads(1)
    index_ms=round((time.monotonic()-started)*1000)
    ref_features={};results=[]
    for entry in manifest['entries']:
        p=args.photos/entry['file']
        if digest(p)!=entry['sha256']:raise ValueError('Photo digest mismatch')
        started=time.monotonic();original=decode(p);crop,ge=geometry(original)
        # The whole image is the explicit retrieval fallback when contour
        # detection fails; no invented card coordinates or automatic choice.
        query=crop if crop is not None else original
        hdist=np.count_nonzero(hashes!=phash(query),axis=1)
        phash_order=np.argsort(hdist,kind='stable')
        vector=embed([query])[0];vdist=np.sum((vectors-vector)**2,axis=1)
        vgg_order=np.argsort(vdist,kind='stable')
        candidates=sorted(set(int(i) for i in phash_order[:20])|set(int(i) for i in vgg_order[:20]))
        qfeatures=features(original,2000);scored=[]
        for i in candidates:
            if i not in ref_features:ref_features[i]=features(decode(refroot/refs[i]['file']),1000)
            scored.append((match(qfeatures,ref_features[i]),i))
        sift_order=[i for score,i in sorted(scored,key=lambda pair:(-pair[0],vdist[pair[1]],refs[pair[1]]['id']))]
        methods={}
        for method,order in [('phash',phash_order),('vgg16',vgg_order),('visual_then_sift',sift_order)]:
            rank=next((j+1 for j,i in enumerate(order) if refs[i]['id']==entry['scryfallId']),None)
            methods[method]={'exactRank':rank,'nameCorrect':refs[order[0]]['name']==entry['name'],'top':[{'id':refs[i]['id'],'name':refs[i]['name'],'set':refs[i]['setCode'],'collector':refs[i]['collectorNumber']} for i in order[:12]]}
        result={'file':entry['file'],'expected':entry['scryfallId'],'geometry':ge['status'],'methods':methods,'siftInliers':{refs[i]['id']:score for score,i in scored},'milliseconds':round((time.monotonic()-started)*1000),'automaticAcceptance':False}
        results.append(result)
        report={'version':version,'scope':source['scope'],'split':'development-only','referenceCount':len(refs),'indexMilliseconds':index_ms,'peakRssKiB':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'results':results}
        (args.output/'report.json').write_text(json.dumps(report,indent=2))
        print(entry['file'],{k:v['exactRank'] for k,v in methods.items()},flush=True)
    summary={m:{'exactTop1':sum(r['methods'][m]['exactRank']==1 for r in results),'exactTop12':sum(r['methods'][m]['exactRank'] is not None and r['methods'][m]['exactRank']<=12 for r in results),'nameTop1':sum(r['methods'][m]['nameCorrect'] for r in results)} for m in ['phash','vgg16','visual_then_sift']}
    print(json.dumps(summary),flush=True)

if __name__=='__main__':main()
