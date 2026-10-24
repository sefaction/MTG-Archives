/** Preview first; explicit IDs/owner and apply opt-in, never a global sweep. */
import {PrismaClient} from "@prisma/client";
import {repairPurgedAcquisitionPhotoTemporaries} from "../lib/acquisition-photo-retention";

async function main(){
  const args=process.argv.slice(2), apply=args.includes("--apply");
  const owner=args.find(arg=>arg.startsWith("--owner="))?.slice(8);
  const ids=args.filter(arg=>arg.startsWith("--photo=")).map(arg=>arg.slice(8));
  if(args.some(arg=>arg!=="--apply"&&!arg.startsWith("--owner=")&&!arg.startsWith("--photo="))||!owner||!ids.length)
    throw new Error("Use --owner=OWNER --photo=UUID (at most 25); default previews only");
  if(apply&&process.env.MTG_PHOTO_TEMPORARY_REPAIR!=="1")throw new Error("Applying requires MTG_PHOTO_TEMPORARY_REPAIR=1");
  const db=new PrismaClient();
  let failed=false,primary:unknown;
  try{
    const result=await repairPurgedAcquisitionPhotoTemporaries(db,owner,ids,apply);
    console.log(JSON.stringify({mode:apply?"apply":"preview",...result}));
    if(result.failed)throw new Error("Some selected photo cleanup failed; inspect and retry the same IDs");
  }catch(error){failed=true;primary=error;}
  try{await db.$disconnect();}catch(error){throw new AggregateError([...(failed?[primary]:[]),error],"Photo repair and disconnect failed");}
  if(failed)throw primary;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
