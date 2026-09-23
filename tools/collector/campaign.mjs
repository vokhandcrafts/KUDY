// Campaign YAML → validated campaign object (G17.01.a).
// Contract: docs/24_web_collection.md «Кампанія» — the YAML block there is the
// canonical shape; every key below is copied from it, none invented. The fence
// values are the crawler fence (G17.02 consumes them unchanged): depth counts
// hops from a seed, extra_domains widens the same-domain rule, delay_s is the
// [min, max] politeness delay in seconds.
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

export const campaignSchema = z.strictObject({
  city: z.string().min(1),
  seeds: z.array(z.url()).min(1),
  topics: z.array(z.string().min(1)).default([]),
  fence: z.strictObject({
    depth: z.number().int().min(1),
    extra_domains: z.array(z.string().min(1)).default([]),
    delay_s: z
      .tuple([z.number().positive(), z.number().positive()])
      .refine(([min, max]) => min <= max, { message: 'delay_s must be [min, max] with min <= max' }),
  }),
  youtube: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).default([]),
});

// One diagnostic per issue, each naming the offending field ("campaign.fence.depth: …"),
// so a bad campaign file answers with a reason instead of a thrown error.
export function parseCampaign(source) {
  let raw;
  try {
    raw = parseYaml(source);
  } catch (error) {
    return { ok: false, diagnostics: [`campaign YAML: ${error.message}`] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, diagnostics: ['campaign YAML: expected a mapping at the top level'] };
  }
  const result = campaignSchema.safeParse(raw);
  if (!result.success) {
    const diagnostics = result.error.issues.map((issue) => {
      const field = ['campaign', ...issue.path].join('.');
      return `${field}: ${issue.message}`;
    });
    return { ok: false, diagnostics };
  }
  return { ok: true, campaign: result.data };
}
