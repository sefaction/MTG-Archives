import type {PrismaClient} from "@prisma/client";

// Test-only observation of the actual claim SQL/CAS/lookup. Never change query
// values, availability, fairness, transactions, errors or the returned records.
// Explicit scalar allowlist: no input/output, owner names, SQL or lease tokens.
export type FixtureClaimTrace = {
  events: Record<string, unknown>[];
  droppedEvents: number;
};
export function traceFixtureClaim(db: PrismaClient) {
  const trace: FixtureClaimTrace = {events:[],droppedEvents:0};
  const leases=new Map<string,string>();
  const append=(event:Record<string,unknown>)=>{
    if(trace.events.length<128)trace.events.push(event);else trace.droppedEvents++;
  };
  function failed(operation:string,error:unknown){
    let code:unknown;
    try{code=(error as {code?:unknown})?.code;}catch{ /* Preserve malformed original exceptions. */ }
    append({operation,failed:true,code:typeof code==="string"&&/^P\d{4}$/.test(code)?code:"UNKNOWN"});
  }
  const client=new Proxy(db,{
    get(target,property){
      if(property==="$queryRaw")return async(...args:unknown[])=>{
        try{
          const rows=await Reflect.apply(target.$queryRaw,target,args);
          append({operation:"SELECTION",count:Array.isArray(rows)?rows.length:null,
            heads:Array.isArray(rows)?rows.slice(0,32).map(row=>({id:row.id,stage:row.stage,
              candidateRevision:row.candidateRevision})):[]});
          return rows;
        }catch(error){failed("SELECTION",error);throw error;}
      };
      if(property==="$transaction")return async(callback:any,...rest:unknown[])=>{
        // Production claim uses the callback transaction; preserve other forms.
        if(typeof callback!=="function")return Reflect.apply(target.$transaction,target,[callback,...rest]);
        try{
        const result=await Reflect.apply(target.$transaction,target,[async(tx:PrismaClient)=>callback(new Proxy(tx,{
          get(transaction,member){
            if(member==="acquisitionProcessingJob")return new Proxy(transaction.acquisitionProcessingJob,{
              get(model,method){
                if(method==="updateMany")return async(...args:any[])=>{
                  const id=args[0]?.where?.id;
                  try{
                    const result=await Reflect.apply(model.updateMany,model,args);
                    append({operation:"LEASE_CAS",id,count:result.count});
                    if(result.count&&typeof id==="string"&&typeof args[0]?.data?.leaseToken==="string")
                      leases.set(id,args[0].data.leaseToken);
                    return result;
                  }catch(error){failed("LEASE_CAS",error);throw error;}
                };
                const value=Reflect.get(model,method);return typeof value==="function"?value.bind(model):value;
              },
            });
            const value=Reflect.get(transaction,member);return typeof value==="function"?value.bind(transaction):value;
          },
        })),...rest]);
        append({operation:"TRANSACTION",committed:true});return result;
        }catch(error){failed("TRANSACTION",error);throw error;}
      };
      if(property==="acquisitionProcessingJob")return new Proxy(target.acquisitionProcessingJob,{
        get(model,method){
          if(method==="findUnique"||method==="findUniqueOrThrow")return async(...args:any[])=>{
            const id=args[0]?.where?.id;
            try{
              const row=await Reflect.apply(model[method],model,args);
              append({operation:"LEASE_LOOKUP",id,present:row!==null,status:row?.status??null,
                attempts:row?.attempts??null,leasePresent:!!row?.leaseToken,
                sameLease:row!==null&&leases.has(id)&&row.leaseToken===leases.get(id)});
              return row;
            }catch(error){failed("LEASE_LOOKUP",error);throw error;}
          };
          const value=Reflect.get(model,method);return typeof value==="function"?value.bind(model):value;
        },
      });
      const value=Reflect.get(target,property);return typeof value==="function"?value.bind(target):value;
    },
  });
  return {client,trace};
}
