"use client";
import {useRef,useState} from 'react';
import type {AcquisitionCardReview} from '@/lib/acquisition-review';
export function AcquisitionScannerLayoutControls({record,endpoint,disabled,refresh,onChange}:{record:AcquisitionCardReview;endpoint:string;disabled:boolean;refresh:()=>void;onChange:(saved:boolean)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const retry=useRef<{reset:boolean;revision:number;requestKey:string}|undefined>(undefined);
  if(!record.scannerLayout)return null;
  const {saved,canSave,applied}=record.scannerLayout;
  if(!saved&&!canSave&&!applied)return null;
  async function change(reset:boolean){
    if(retry.current?.reset!==reset||retry.current?.revision!==record.revision)retry.current={reset,revision:record.revision,requestKey:crypto.randomUUID()};
    setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'scanner-layout',photoId:record.photoId,...retry.current})});
      const body=await response.json();if(!response.ok)throw Error(body.error??'The scanner layout could not be saved.');
      setMessage(reset?'Saved scanner layout removed.':'Scanner layout saved for future scans.');retry.current=undefined;onChange(!reset);refresh();
    }catch(failure){setError((failure as Error).message);}finally{setBusy(false);}
  }
  return <section aria-label="Reusable scanner layout" className="my-3 rounded border p-3 min-w-0">
    <h4 className="font-semibold">Scanner layout</h4>
    {applied&&<p className="text-sm my-2">Printed anchors helped infer this card’s outline. Check its border and exact printing.</p>}
    {saved&&<p className="text-sm my-2">A layout is saved for this collection owner’s future card scans. Keep the scanner size and placement consistent.</p>}
    {canSave&&<p className="text-sm my-2">Reuse this observed outline and printed anchor positions when a later scan’s border is difficult to see.</p>}
    <div className="flex flex-wrap gap-2">
      {canSave&&<button type="button" className="rounded border px-3 py-2 text-sm" disabled={disabled||busy} onClick={()=>void change(false)}>Reuse outline for future scans</button>}
      {saved&&<button type="button" className="rounded border px-3 py-2 text-sm" disabled={disabled||busy} onClick={()=>void change(true)}>Remove saved scanner layout</button>}
    </div>
    {message&&<p role="status" className="text-sm mt-2">{message}</p>}
    {error&&<p role="alert" className="text-sm mt-2">{error}</p>}
  </section>;
}
