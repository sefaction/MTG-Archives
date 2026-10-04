import {randomUUID} from 'node:crypto';
import {renameSync,unlinkSync,writeFileSync} from 'node:fs';

type Report = {passed:boolean;reportWriteFailures?:{at:string;code:string}[]};
type FileOperations = {
  write:(file:string,data:string)=>void;
  rename:(from:string,to:string)=>void;
  unlink:(file:string)=>void;
};
const operations:FileOperations={
  write:(file,data)=>writeFileSync(file,data,{encoding:'utf8',flag:'wx'}),
  rename:renameSync,unlink:unlinkSync,
};

/** Periodic diagnostics must not throw outside the awaited test and bypass its
 * fixture cleanup. Stage a complete snapshot; retain the previous file on failure.
 * Final qualification still requires a successful durable report write. */
export function qualificationReportWriter(output:string|undefined,files=operations) {
  return (report:Report)=>{
    if(!output)return true;
    const pending=output+'.'+randomUUID()+'.pending';
    try{
      files.write(pending,JSON.stringify(report,null,2)+'\n');
      files.rename(pending,output);
      return true;
    }catch(error){
      const code=(error as NodeJS.ErrnoException).code??'';
      report.reportWriteFailures??=[];
      if(report.reportWriteFailures.length<100)report.reportWriteFailures.push({
        at:new Date().toISOString(),code:['EACCES','EBUSY','EPERM','ENOSPC','UNKNOWN'].includes(code)?code:'UNCLASSIFIED',
      });
      return false;
    }finally{
      try{files.unlink(pending);}catch{/* Renamed or never created; no recursive removal. */}
    }
  };
}

export function finalizeQualificationReport(write:(report:Report)=>boolean,report:Report,qualified:boolean) {
  report.passed=qualified;
  for(let attempt=0;attempt<3;attempt++)if(write(report))return;
  report.passed=false;write(report);
  throw Error('Qualification report could not be finalized after owned cleanup');
}
