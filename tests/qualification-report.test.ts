import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,readdirSync,rmdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {finalizeQualificationReport,qualificationReportWriter} from './qualification-report';

test('a periodic sharing failure retains the old complete report and cannot bypass cleanup',()=>{
  const files=new Map([['report.json','old complete report']]);
  let blocked=true;
  const writer=qualificationReportWriter('report.json',{
    write:(file,data)=>{files.set(file,data);},
    rename:(from,to)=>{
      if(blocked)throw Object.assign(Error('private path and arbitrary details'),{code:'UNKNOWN'});
      files.set(to,files.get(from)!);files.delete(from);
    },
    unlink:file=>{files.delete(file);},
  });
  const report:{passed:boolean;reportWriteFailures?:unknown[]}={passed:false};
  assert.equal(writer(report as Parameters<typeof writer>[0]),false);
  assert.deepEqual([...files.keys()],['report.json']);
  assert.equal(files.get('report.json'),'old complete report');
  assert.equal(JSON.stringify(report).includes('private'),false);
  assert.equal((report.reportWriteFailures![0] as {code:string}).code,'UNKNOWN');
  blocked=false;
  finalizeQualificationReport(writer,report as Parameters<typeof writer>[0],true);
  const final=JSON.parse(files.get('report.json')!);
  assert.equal(final.passed,true);assert.equal(final.reportWriteFailures.length,1);
});

test('permanent final report failure cannot claim qualification, while final retries are bounded',()=>{
  const report={passed:false};let attempts=0;
  assert.throws(()=>finalizeQualificationReport(()=>{attempts++;return false;},report,true),/after owned cleanup/);
  assert.equal(report.passed,false);assert.equal(attempts,4);
  let transient=0;
  finalizeQualificationReport(()=>++transient===3,report,true);
  assert.equal(report.passed,true);assert.equal(transient,3);
});

test('real staged reports replace complete snapshots and remove temporary files',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'mtg-qualification-report-'));
  const file=path.join(root,'report.json');
  try{
    const writer=qualificationReportWriter(file);
    const report={passed:false,progress:1};
    assert.equal(writer(report),true);
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),report);
    report.progress=2;
    assert.equal(writer(report),true);
    finalizeQualificationReport(writer,report,true);
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),report);
    assert.deepEqual(readdirSync(root),['report.json']);
  }finally{
    try{unlinkSync(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    rmdirSync(root);
  }
});
