import assert from 'node:assert/strict';
import test from 'node:test';
import {Prisma} from '@prisma/client';
import {recognitionWorkerFailure} from '../lib/acquisition-worker-diagnostics';
import {nativeFailureError} from '../lib/acquisition-native-failure';

test('OCR stop records preserve fixed phase and public database classification only',()=>{
 const error=new Prisma.PrismaClientKnownRequestError('private query and credential',{code:'P1001',clientVersion:'private',meta:{account:'secret'}});
 assert.deepEqual(recognitionWorkerFailure('ADMISSION',error),{event:'recognition-worker-stopped',phase:'ADMISSION',errorKind:'DATABASE',errorType:'PrismaClientKnownRequestError',errorCode:'P1001',systemCode:null,nativeFailure:null});
 assert.equal(recognitionWorkerFailure('LOAD_CATALOG',{errorCode:'P1002',message:'private'}).errorCode,'P1002');
});
test('only locally trusted native failures provide native exit detail',()=>{
 const error=nativeFailureError('Processing native worker stopped','EXIT',137,'SIGKILL','ENOMEM');
 const row=recognitionWorkerFailure('PREPARE_NATIVE',error);assert.equal(row.errorKind,'NATIVE');assert.deepEqual(row.nativeFailure,{reason:'EXIT',exitCode:137,signal:'SIGKILL',systemCode:'ENOMEM'});
 const forged=recognitionWorkerFailure('PREPARE_NATIVE',{reason:'EXIT',exitCode:137,signal:'SIGKILL',stderr:'private'});assert.equal(forged.nativeFailure,null);assert.equal(forged.errorKind,'UNKNOWN');
});
test('arbitrary fields, malformed values and hostile accessors remain private',()=>{
 const privateData='private-scan-auth-account-payload';
 for(const error of [privateData,null,undefined,{code:'P1001 '+privateData},{code:'P100100'},{code:{payload:privateData}},{name:privateData,message:privateData,stack:privateData,cause:{secret:privateData}},{code:'ENOENT '+privateData}]){
  const row=recognitionWorkerFailure('PROCESSING',error);assert.equal(row.errorKind,'UNKNOWN');assert.equal(row.errorCode,'UNKNOWN');assert.equal(row.systemCode,null);assert.ok(!JSON.stringify(row).includes(privateData));
 }
 for(const error of [Object.defineProperty({},'code',{get(){throw Error(privateData)}}),new Proxy({}, {get(){throw Error(privateData)}})])assert.equal(recognitionWorkerFailure('ADMISSION',error).errorKind,'UNKNOWN');
 assert.equal(recognitionWorkerFailure(privateData as never,new Error(privateData)).phase,'UNKNOWN');
});
test('system and programming classifications are bounded, without exception messages',()=>{
 assert.equal(recognitionWorkerFailure('DESCRIBE_MODEL',Object.assign(Error('private'),{code:'ENOENT'})).errorKind,'SYSTEM');
 assert.equal(recognitionWorkerFailure('PROCESSING',new TypeError('private')).errorKind,'PROGRAMMING');
 assert.equal(recognitionWorkerFailure('DESCRIBE_MODEL',{name:'ZodError',issues:['private']}).errorKind,'VALIDATION');
});

test('public exception types distinguish code-less database, timeout and abort failures',()=>{
 const invalid=new Prisma.PrismaClientValidationError('private query',{clientVersion:'private'});
 const database=recognitionWorkerFailure('LOAD_CATALOG',invalid);assert.equal(database.errorKind,'DATABASE');assert.equal(database.errorType,'PrismaClientValidationError');assert.equal(database.errorCode,'UNKNOWN');
 for(const [name,kind] of [['TimeoutError','TIMEOUT'],['AbortError','ABORTED']]){const row=recognitionWorkerFailure('PREPARE_NATIVE',new DOMException('private image/token',name));assert.equal(row.errorType,name);assert.equal(row.errorKind,kind);assert.ok(!JSON.stringify(row).includes('private'));}
 assert.equal(recognitionWorkerFailure('PROCESSING',{name:'private custom error',stack:'private'}).errorType,'UNKNOWN');
});
