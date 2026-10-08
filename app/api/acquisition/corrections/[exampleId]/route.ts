import { prisma } from "@/lib/prisma";
import { acquisitionActor, acquisitionError } from "@/lib/acquisition-api";
import { readCorrectionExample, changeCorrectionExample } from "@/lib/acquisition-correction-access";
import { z } from "zod";
export const runtime = "nodejs";
type Context = { params: Promise<{ exampleId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const owner = z.string().min(1).max(200).parse(new URL(request.url).searchParams.get("owner"));
    const photo = await readCorrectionExample(prisma, await acquisitionActor(request), owner, (await context.params).exampleId);
    return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": photo.mediaType,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="correction-original"' } });
  } catch (error) { return acquisitionError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await acquisitionActor(request);
    const body = z.object({ owner: z.string().min(1).max(200), action: z.enum(["WITHDRAW_LABEL", "REMOVE"]) }).strict().parse(await request.json());
    return Response.json(await changeCorrectionExample(prisma, actor, body.owner, (await context.params).exampleId, body.action),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return acquisitionError(error); }
}
