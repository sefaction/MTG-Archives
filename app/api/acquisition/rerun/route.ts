import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { acquisitionRerunInput, getAcquisitionRerun, requestAcquisitionRerun } from "@/lib/acquisition-rerun";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await acquisitionActor(request);
    const scope = acquisitionRerunInput.shape.scope.parse(new URL(request.url).searchParams.get("scope"));
    return Response.json(await getAcquisitionRerun(prisma, actor, scope), {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return acquisitionError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await acquisitionActor(request);
    return Response.json(await requestAcquisitionRerun(prisma, actor, await request.json()),
      {status: 202, headers: {"Cache-Control": "no-store"}});
  } catch (error) { return acquisitionError(error); }
}
