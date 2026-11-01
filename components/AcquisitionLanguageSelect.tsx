"use client";
import {acquisitionBatchLanguages,acquisitionLanguageLabels} from "@/lib/acquisition-batch-language";
import {filterInputClass as input} from "./filterStyles";

export function AcquisitionLanguageSelect({value,onChange,disabled=false}: {
  value:string|null;onChange:(value:string|null)=>void;disabled?:boolean;
}) {
  return <label className="min-w-0 max-w-full">Batch language
    <select className={input+" block w-full sm:w-auto min-w-0 max-w-full"} value={value??""}
      disabled={disabled} onChange={event=>onChange(event.target.value||null)}>
      <option value="">Use printing evidence</option>
      {acquisitionBatchLanguages.map(language=><option key={language} value={language}>
        {acquisitionLanguageLabels[language]}</option>)}
    </select>
  </label>;
}
