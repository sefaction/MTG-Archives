"use client";
import {useEffect,useRef,useState} from "react";
import {cropPoint,type AcquisitionReviewEvidence} from "@/lib/acquisition-review-evidence";
import {printingDetailBounds,printingDetailLabels} from "@/lib/acquisition-printing-details";
import type {AcquisitionPrinting} from "@/lib/acquisition-review";
import {filterInputClass as input} from "./filterStyles";

type Band=keyof typeof printingDetailBounds;
export function AcquisitionPrintingDetails({src,evidence,selected}:{src:string;evidence:AcquisitionReviewEvidence;selected:AcquisitionPrinting|null}){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [band,setBand]=useState<Band>("FOOTER"),[face,setFace]=useState("");
  const [open,setOpen]=useState(false);
  const [reference,setReference]=useState<{key:string;url:string}|null>(null);
  const [referenceError,setReferenceError]=useState<{key:string;message:string}|null>(null);
  const [sourceError,setSourceError]=useState<{key:string;message:string}|null>(null);
  const candidates=evidence?.printing?.candidates.filter(c=>c.cardId===selected?.id && c.details && c.referenceBoundary && c.referenceImage)??[];
  const choice=candidates.length===1?candidates[0]:candidates.find(c=>String(c.referenceFace)===face);
  const region=choice?.details?.regions.find(r=>r.region===band);
  const alignment=JSON.stringify(choice?.referenceBoundary?.quad??null);
  const uri=choice?.referenceImage?.uri,digest=choice?.referenceImage?.sha256;
  const referenceKey=JSON.stringify([uri,digest]);
  const sourceKey=JSON.stringify([src,alignment,band]);
  const referenceUrl=open&&reference?.key===referenceKey?reference.url:null;
  const errors=[referenceError?.key===referenceKey?referenceError.message:null,
    sourceError?.key===sourceKey?sourceError.message:null].filter(Boolean);
  useEffect(()=>{
    let cancelled=false,url:string|null=null;
    const controller=new AbortController();
    if(!open||!uri||!digest)return;
    void (async()=>{try{
      const response=await fetch(uri,{credentials:"omit",signal:controller.signal});
      if(!response.ok)throw Error("Reference image unavailable.");
      const data=await response.arrayBuffer();
      if(data.byteLength>10*1024*1024)throw Error("Reference image exceeds its preview limit.");
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",data)),n=>n.toString(16).padStart(2,"0")).join("");
      if(sha!==digest)throw Error("The reference image changed; its saved comparison remains available in the original evidence.");
      if(cancelled)return;
      url=URL.createObjectURL(new Blob([data],{type:response.headers.get("content-type")??"image/jpeg"}));
      setReference({key:referenceKey,url});setReferenceError(null);
    }catch(e){if(!cancelled)setReferenceError({key:referenceKey,message:(e as Error).message})}})();
    return()=>{cancelled=true;controller.abort();if(url)URL.revokeObjectURL(url);};
  },[open,uri,digest,referenceKey]);
  useEffect(()=>{
    const normalized=JSON.parse(alignment) as [number,number][]|null;
    if(!open||!normalized||region?.status!=="MEASURED"||!canvas.current)return;
    canvas.current.width=canvas.current.height=0;
    let cancelled=false;
    const image=new Image();
    image.onload=()=>{if(cancelled||!canvas.current)return;
      try{
        const buffer=document.createElement("canvas"),scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
        buffer.width=Math.round(image.naturalWidth*scale);buffer.height=Math.round(image.naturalHeight*scale);
        const source=buffer.getContext("2d",{willReadFrequently:true})!;source.drawImage(image,0,0,buffer.width,buffer.height);
        const data=source.getImageData(0,0,buffer.width,buffer.height).data;
        const [x0,y0,x1,y1]=printingDetailBounds[band],target=canvas.current;
        target.width=Math.min(400,x1-x0);target.height=Math.round(target.width*(y1-y0)/(x1-x0));
        const context=target.getContext("2d")!,pixels=context.createImageData(target.width,target.height);
        const quad=normalized.map(([x,y])=>[x*(image.naturalWidth-1),y*(image.naturalHeight-1)] as [number,number]);
        for(let y=0;y<target.height;y++)for(let x=0;x<target.width;x++){
          const [sx,sy]=cropPoint(quad,(x0+x/(target.width-1)*(x1-x0-1))/999,(y0+y/(target.height-1)*(y1-y0-1))/1396);
          const px=Math.round(sx*scale),py=Math.round(sy*scale),out=(y*target.width+x)*4;
          if(px<0||py<0||px>=buffer.width||py>=buffer.height)throw Error("The comparison region leaves the captured image.");
          for(let c=0;c<3;c++)pixels.data[out+c]=data[(py*buffer.width+px)*4+c];pixels.data[out+3]=255;
        }
        context.putImageData(pixels,0,0);buffer.width=buffer.height=0;setSourceError(null);
      }catch(e){canvas.current.width=canvas.current.height=0;setSourceError({key:sourceKey,message:(e as Error).message})}
    };
    image.onerror=()=>{if(!cancelled)setSourceError({key:sourceKey,message:"Original image unavailable for detail comparison."})};image.src=src;
    return()=>{cancelled=true;};
  },[open,src,alignment,band,region?.status,sourceKey]);
  if(!evidence?.printing)return null;
  const [x0,y0,x1,y1]=printingDetailBounds[band];
  return <details className="mt-3" data-testid="printing-detail-comparison" onToggle={e=>{setOpen(e.currentTarget.open);if(!e.currentTarget.open){setReference(null);setReferenceError(null);setSourceError(null)}}}>
    <summary className="cursor-pointer underline text-sm">Compare printing details</summary>
    <p className="text-sm my-2">These windows are aligned to a proposed printing. Inspect the visible text, symbol and frame; image similarity does not confirm the printing.</p>
    {candidates.length>1&&<label className="block text-sm">Reference face<select className={input} value={face} onChange={e=>setFace(e.target.value)}><option value="">Choose a face</option>{candidates.map(c=><option key={c.referenceFace} value={c.referenceFace}>{c.referenceFace===0?"Front":"Back"}</option>)}</select></label>}
    <label className="block text-sm">Detail window<select className={input} value={band} onChange={e=>setBand(e.target.value as Band)}>{Object.keys(printingDetailBounds).map(name=><option key={name} value={name}>{printingDetailLabels[name as Band]}</option>)}</select></label>
    {!choice?<p className="text-sm mt-2">A supported comparison outline is unavailable for this selection. Inspect the original image.</p>:
      region?.status!=="MEASURED"?<p className="text-sm mt-2">This region could not be compared reliably. Inspect the original or use a clearer scan.</p>:
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 min-w-0">
        <figure className="min-w-0"><figcaption className="text-sm">Scan detail</figcaption><canvas ref={canvas} role="img" aria-label={`Scan ${printingDetailLabels[band]}`} className="max-w-full h-auto border"/></figure>
        <figure className="min-w-0"><figcaption className="text-sm">Verified reference image</figcaption>{referenceUrl?<div className="relative overflow-hidden border" style={{width:`min(100%, ${Math.min(400,x1-x0)}px)`,aspectRatio:(x1-x0)/(y1-y0)}}><img alt={`Reference ${printingDetailLabels[band]}`} src={referenceUrl} className="absolute" style={{maxWidth:"none",width:`${1000/(x1-x0)*100}%`,height:`${1397/(y1-y0)*100}%`,left:`${-x0/(x1-x0)*100}%`,top:`${-y0/(y1-y0)*100}%`}}/></div>:<p className="text-sm">Reference preview unavailable or loading.</p>}</figure>
      </div>}
    {errors.map(error=><p key={error} role="status" className="text-sm mt-2">{error}</p>)}
  </details>;
}
