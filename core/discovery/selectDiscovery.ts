// G15.01 — pure deterministic discovery selector (21 §4). Consumes a validated
// DiscoveryIndexV1 (contracts/schemas/discovery-index.schema.json, built by
// G02.03 and read back by G04.03) and the person's explicit criteria; returns
// exact matches and labeled alternatives with typed reasons/differences.
//
// Boundaries (21 §2): no GPS, date, network, ratings or hidden preferences are
// read here. Access (free/paid/mixed) is never read — paid must not boost rank
// (20 §6, 21 §4 rule 6). The module is pure: same input, same output.
//
// Canonical names are copied verbatim from their sources (implementation-rules
// 2): field names from discovery-index.schema.json / 21 §3.1–§3.2, criteria and
// result types from 21 §4. The planned contracts/discovery.ts module does not
// exist yet (G02.01 delivered JSON Schemas), so the types live here until a
// task owns that module; consumers import them from this file.

export type DiscoverySeason = 'spring' | 'summer' | 'autumn' | 'winter';

// localized-text.schema.json: a map of allowlist locales (be/en/uk) to text.
export type LocalizedText = Record<string, string>;

// DiscoveryRef (21 §3.1): in each variant only its own fields are allowed.
export type DiscoveryRef =
  | { kind: 'guide'; route_id: string; version: string }
  | { kind: 'place'; place_id: string; content_version: string }
  | { kind: 'collection'; collection_id: string; content_version: string };

// Season recommendation (21 §3.2): author suitability with a reason; an empty
// array means not_assessed, never "fits all seasons" (20 §5).
export interface DiscoverySeasonRecommendation {
  season: DiscoverySeason;
  reason: LocalizedText;
}

export interface DiscoveryOffer {
  offer_id: string;
  ref: DiscoveryRef;
  city_id: string;
  editorial_order: number;
  themes: string[];
  localized: {
    title: LocalizedText;
    summary?: LocalizedText;
    why_recommended?: LocalizedText;
    conditions?: LocalizedText;
  };
  estimated_duration?: { min_minutes: number; max_minutes: number; basis: 'author_walk' | 'author_estimate' };
  distance_m?: number;
  suggested_start_place_id?: string;
  season_recommendations: DiscoverySeasonRecommendation[];
  availability: { text_locales: string[]; audio_locales: string[] };
  access: 'free' | 'paid' | 'mixed';
  detail_ref:
    | { kind: 'place_public'; path: string }
    | { kind: 'collection_public'; path: string }
    | { kind: 'guide_preview' };
}

// Editorial collection (21 §3.2): members are guide/place refs only, no nested
// collections; a collection is not a Route, Run, product or entitlement.
export interface DiscoveryCollection {
  collection_id: string;
  content_version: string;
  city_id: string;
  localized: { title: LocalizedText; description?: LocalizedText };
  members: DiscoveryRef[];
  overlap_note?: LocalizedText;
}

export interface DiscoveryIndexV1 {
  schema_version: 1;
  revision: string;
  city_id: string;
  themes: Array<{ id: string; labels: LocalizedText }>;
  offers: DiscoveryOffer[];
  collections: DiscoveryCollection[];
}

// DiscoveryCriteria/DiscoveryResult/DiscoveryMatch (21 §4, verbatim).
export interface DiscoveryCriteria {
  city_id: string;
  content_locale: string;
  max_minutes?: number;
  theme_ids: readonly string[];
  preferred_season?: DiscoverySeason;
}

export type DiscoveryReason = 'editorial' | 'theme_match' | 'within_time' | 'season_recommended';
export type DiscoveryDifference =
  | 'duration_unknown'
  | 'over_time'
  | 'theme_mismatch'
  | 'season_unassessed'
  | 'season_not_recommended';

export interface DiscoveryMatch {
  offer_id: string;
  reasons: readonly DiscoveryReason[];
  differences: readonly DiscoveryDifference[];
}

export interface DiscoveryResult {
  exact: readonly DiscoveryMatch[];
  alternatives: readonly DiscoveryMatch[];
}

// Differences are emitted in this fixed order — the §4 union order verbatim —
// so the label list is stable.
const DIFFERENCE_ORDER: readonly DiscoveryDifference[] = [
  'duration_unknown',
  'over_time',
  'theme_mismatch',
  'season_unassessed',
  'season_not_recommended',
];

// The display unit is the ref: one authored thing must not appear twice even
// if the (schema-rejected) input repeats it (21 §4 rule 6).
const refKey = (ref: DiscoveryRef): string => {
  switch (ref.kind) {
    case 'guide':
      return `guide:${ref.route_id}@${ref.version}`;
    case 'place':
      return `place:${ref.place_id}@${ref.content_version}`;
    case 'collection':
      return `collection:${ref.collection_id}@${ref.content_version}`;
  }
};

// Refs originate in package JSON and are never trusted (21 §3.3): a ref that
// does not carry its variant's fields is corrupt, not creative naming.
const isWellFormedRef = (ref: DiscoveryRef): boolean => {
  switch (ref?.kind) {
    case 'guide':
      return typeof ref.route_id === 'string' && ref.route_id.length > 0 && typeof ref.version === 'string' && ref.version.length > 0;
    case 'place':
      return typeof ref.place_id === 'string' && ref.place_id.length > 0 && typeof ref.content_version === 'string' && ref.content_version.length > 0;
    case 'collection':
      return typeof ref.collection_id === 'string' && ref.collection_id.length > 0 && typeof ref.content_version === 'string' && ref.content_version.length > 0;
    default:
      return false;
  }
};

const knownMaxMinutes = (offer: DiscoveryOffer): number | null => {
  const d = offer.estimated_duration;
  return d !== null && typeof d === 'object' && typeof d.max_minutes === 'number' && Number.isFinite(d.max_minutes) && d.max_minutes > 0
    ? d.max_minutes
    : null;
};

export function selectDiscovery(index: DiscoveryIndexV1, criteria: DiscoveryCriteria): DiscoveryResult {
  // Rule 1: unknown themes/locales and invalid max_minutes are rejected at the
  // controller boundary; the core receives valid types. A malformed criterion
  // that slips through is never silently satisfied — a corrupt limit cannot
  // prove any offer within time and a corrupt theme list cannot prove a theme
  // match, so both fail closed (nothing exact, labeled differences) instead of
  // widening the answer.
  const limitGiven = criteria.max_minutes !== undefined;
  const limitUsable =
    typeof criteria.max_minutes === 'number' && Number.isFinite(criteria.max_minutes) && criteria.max_minutes > 0;
  const maxMinutes = limitUsable ? criteria.max_minutes : undefined;
  const limitCorrupt = limitGiven && !limitUsable;
  const themesUsable = Array.isArray(criteria.theme_ids);
  const themeIds = themesUsable ? criteria.theme_ids : [];
  const season = criteria.preferred_season;

  const matches: Array<{ match: DiscoveryMatch; offer: DiscoveryOffer }> = [];
  for (const offer of index.offers ?? []) {
    // Rule 2 gates are fail-closed and never relax in alternatives: wrong city,
    // unconfirmed content locale or a corrupt ref/order excludes the offer
    // entirely — it is not surfaced as an alternative.
    const refOk = isWellFormedRef(offer?.ref);
    const cityOk = offer?.city_id === criteria.city_id;
    const textLocales = Array.isArray(offer?.availability?.text_locales) ? offer.availability.text_locales : [];
    const localeOk = textLocales.includes(criteria.content_locale);
    const orderOk = typeof offer?.editorial_order === 'number' && Number.isInteger(offer.editorial_order) && offer.editorial_order >= 0;
    if (!refOk || !cityOk || !localeOk || !orderOk) continue;

    const offerThemes = Array.isArray(offer.themes) ? offer.themes : [];
    const themeMatched = themeIds.length === 0 || themeIds.some((t) => offerThemes.includes(t));
    const known = knownMaxMinutes(offer);
    const withinTime = maxMinutes === undefined || (known !== null && known <= maxMinutes);
    const recommendations = Array.isArray(offer.season_recommendations) ? offer.season_recommendations : [];
    const seasonRecommended = season !== undefined && recommendations.some((r) => r?.season === season);

    const differences = new Set<DiscoveryDifference>();
    if (!themesUsable || !themeMatched) differences.add('theme_mismatch');
    if (limitCorrupt || (maxMinutes !== undefined && known === null)) differences.add('duration_unknown');
    if (maxMinutes !== undefined && known !== null && known > maxMinutes) differences.add('over_time');
    if (season !== undefined && recommendations.length === 0) differences.add('season_unassessed');
    if (season !== undefined && recommendations.length > 0 && !seasonRecommended) differences.add('season_not_recommended');

    // Reasons explain the surfaced placement: the author's index membership is
    // the baseline ('editorial'), the rest mirror the passed explicit gates.
    const reasons: DiscoveryReason[] = ['editorial'];
    if (themeIds.length > 0 && themeMatched) reasons.push('theme_match');
    if (maxMinutes !== undefined && known !== null && known <= maxMinutes) reasons.push('within_time');
    if (seasonRecommended) reasons.push('season_recommended');

    matches.push({
      match: {
        offer_id: offer.offer_id,
        reasons,
        differences: DIFFERENCE_ORDER.filter((d) => differences.has(d)),
      },
      offer,
    });
  }

  // Rule 6: both lists sort by editorial_order, then offer_id; one ref shows
  // once. Rules 6–7: exact is everything with no difference; the UI decides
  // when alternatives are shown, the selector never widens the query.
  const byEditorialOrder = (a: DiscoveryOffer, b: DiscoveryOffer): number =>
    a.editorial_order - b.editorial_order || (a.offer_id < b.offer_id ? -1 : a.offer_id > b.offer_id ? 1 : 0);

  const shown = new Set<string>();
  const exact: DiscoveryMatch[] = [];
  const alternatives: DiscoveryMatch[] = [];
  for (const { match, offer } of matches.slice().sort((a, b) => byEditorialOrder(a.offer, b.offer))) {
    const key = refKey(offer.ref);
    if (shown.has(key)) continue;
    shown.add(key);
    if (match.differences.length === 0) exact.push(match);
    else alternatives.push(match);
  }

  return { exact, alternatives };
}
