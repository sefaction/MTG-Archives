import { z } from "zod";

const strip = z
  .object({
    top: z.number().int().min(0).max(1396),
    bottom: z.number().int().min(1).max(1397),
  })
  .refine(({ top, bottom }) => top < bottom);

export const acquisitionReadingZonesSchema = z
  .object({ title: strip, footer: strip })
  .refine(({ title, footer }) => title.bottom <= footer.top);

// Saved observations from older workers did not carry their attempted strips.
// Keep their preview honest rather than painting today's smaller footer on them.
export const legacyAcquisitionReadingZones = {
  title: { top: 0, bottom: 250 },
  footer: { top: 1210, bottom: 1397 },
};
