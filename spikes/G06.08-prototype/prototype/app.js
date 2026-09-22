// G06.08 interactive prototype. Synthetic data only. Walk-session semantics
// are NOT re-implemented here: state always comes from the normative model
// (docs/run-model/run-model.mjs) via start/step/status/missed, and this file
// renders that state plus the UI-layer contracts of docs/11 §16 (navigation),
// §15 (R07 hint) and docs/21 §5 (feedback states).
import { start, step, status, missed } from '/docs/run-model/run-model.mjs';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean') { if (v) node.setAttribute(k, ''); else node.removeAttribute(k); }
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children.flat()) if (child != null && child !== false && child !== true) node.append(child);
  return node;
};
const T = { // chrome strings; UI language is a user choice persisted per L02
  be: { city: 'Горад', guides: 'Гіды', nearby: 'Побач', mykudy: 'My KUDY', walk: 'Прагулка',
    whatToDo: 'Чым заняцца', minutes: 'хв', start: 'Спампаваць і пачаць', paused: 'Прагулка прыпынена',
    pause: 'Прыпыніць прагулку', finish: 'Завяршыць прагулку', nowPlaying: 'Зараз грае', nearbyStop: 'побач',
    empty: 'Кантэнт яшчэ не апублікаваны', offline: 'Офлайн: паказаны папярэдні валідны кэш', resume: 'Працягнуць',
    otherGuide: 'Побач ёсць гід…', continueGuide: 'Працягнуць гід', more: 'Яшчэ пра гэтае месца',
    step: 'Крок (сімуляцыя хады)', unlock: 'Разблакаваць пашыраныя гісторыі (сімуляцыя пакупкі)',
    canOpen: 'Яшчэ можна адкрыць', rate: 'Ацаніць гід?', send: 'Адправіць', save: 'Захаваць', skip: 'Прапусціць',
    edit: 'змяніць', del: 'выдаліць', history: 'Гісторыя прагулак', downloads: 'Загрузкі', lang: 'Мова інтэрфейсу',
    myRatings: 'Мае ацэнкі', ratingState: 'стан', sessionLang: 'мова сесіі',
    deny: 'GPS адключаны — аўтазапуск выключаны, ручны Play працуе' },
  en: { city: 'City', guides: 'Guides', nearby: 'Nearby', mykudy: 'My KUDY', walk: 'Walk', whatToDo: 'What to do',
    minutes: 'min', start: 'Download and start', paused: 'Walk paused', pause: 'Pause walk', finish: 'Finish walk',
    nowPlaying: 'Now playing', nearbyStop: 'nearby', empty: 'No content published yet',
    offline: 'Offline: showing the last valid cache', resume: 'Resume', otherGuide: 'A guide is nearby…',
    continueGuide: 'Continue the guide', more: 'More about this place', step: 'Step (simulated walking)',
    unlock: 'Unlock extended stories (simulated purchase)', canOpen: 'Still open to discover', rate: 'Rate the guide?',
    send: 'Send', save: 'Save', skip: 'Skip', edit: 'edit', del: 'delete', history: 'Walk history',
    downloads: 'Downloads', lang: 'Interface language', myRatings: 'My ratings', ratingState: 'state',
    sessionLang: 'session locale', deny: 'GPS denied — autoplay off, manual Play works' },
};
const t = (key) => (T[ui.lang] ?? T.be)[key] ?? T.be[key];

let city, index, outcomes;
const ui = {
  lang: localStorage.getItem('kudy.ui.lang') || 'be', // L02: explicit choice persists
  screen: [{ name: 'explore' }],                      // surface stack; Back returns to the source surface (11 §16.2)
  session: null, sessionMeta: null,
  inspected: null,                                    // transcript belongs to inspected, not nowPlaying (11 §3.2)
  panel: 'peek',
  fix: null, denied: false, offline: false, emptyCity: false,
  hintShown: new Set(), momentSeq: 0, fbInvited: null, momentNoSession: null,
  audio: { tokenKey: null, remaining: 0 },
  history: [], ratings: [],
};
const guideById = (id) => city.guides.find((g) => g.route_id === id);
const offerB1 = () => index.offers.find((o) => o.offer_id === 'offer-b1-guide');
const paidGuide = () => ({ ...city.preview_only_guides[0], offer: offerB1() });
const storyOf = (storyId) => {
  for (const g of city.guides) for (const s of g.stops) for (const st of s.stories)
    if (st.id === storyId) return { ...st, stopTitle: s.title, guide: g };
  const m = city.moments.find((mm) => mm.story_id === storyId);
  return m ? { id: storyId, seconds: m.seconds, title: m.title, transcript: m.transcript, moment: true } : null;
};
const L = (obj) => obj?.[ui.lang] ?? obj?.be ?? Object.values(obj ?? {})[0] ?? '';

// ── model bridge ─────────────────────────────────────────────────────────────
function send(event) {
  const before = ui.session;
  ui.session = step(ui.session, event, Date.now());
  for (const cmd of ui.session.commands) {
    if (cmd.type === 'PlayStory') {
      ui.audio.tokenKey = `g:${cmd.playId}`;
      ui.audio.remaining = (storyOf(cmd.storyId)?.seconds ?? 5) * 1000;
    } else if (cmd.type === 'PlayMoment') {
      ui.audio.tokenKey = `m:${cmd.momentId}`;
      ui.audio.remaining = (city.moments.find((m) => m.moment_id === cmd.momentId)?.seconds ?? 4) * 1000;
    } else if (cmd.type === 'StopAudio') {
      ui.audio.tokenKey = null;
    }
  }
  if (before && ui.session.state === 'Ended' && before.state !== 'Ended') onEnd();
  render();
}

setInterval(() => { // synthetic playback clock; a live pause holds the offset
  const p = ui.session?.playing;
  if (p && !p.paused && ui.audio.tokenKey) {
    ui.audio.remaining -= 250;
    if (ui.audio.remaining <= 0) {
      if (p.owner === 'guide') send({ type: 'AudioFinished', sessionId: ui.session.sessionId, playId: p.playId, storyId: p.storyId });
      else send({ type: 'MomentFinished', token: { kind: 'moment', ref: p.momentId, seq: p.seq } });
      ui.audio.tokenKey = null;
    }
  } else if (!p && ui.momentNoSession && ui.audio.tokenKey) { // moment without a session (ADR G01.02 §3.8)
    ui.audio.remaining -= 250;
    if (ui.audio.remaining <= 0) { ui.audio.tokenKey = null; ui.momentNoSession = null; render(); }
  }
}, 250);

function startGuide(guide, locale) {
  ui.session = start(`sess-${Date.now()}`, guide.stops.map((st) => ({
    id: st.id,
    storyBaseId: st.stories.find((x) => x.tier === 'base')?.id,
    storyExtendedId: st.stories.find((x) => x.tier === 'extended')?.id,
  })), { routeId: guide.route_id, version: guide.version, locale,
    accessibleStopIds: guide.stops.map((st) => st.id), tierAvailable: ['base'] });
  ui.sessionMeta = { guide, locale, startedAt: Date.now(), promised: false };
  ui.inspected = null; ui.panel = 'peek'; ui.hintShown = new Set(); ui.fbInvited = null;
  ui.audio.tokenKey = null; ui.momentNoSession = null;
  ui.screen = [{ name: 'explore' }]; // a new session anchors the Run surface
  go('run');
}

// ── navigation (Back returns to the source surface; 11 §16.2/§16.7) ─────────
function go(name, params) { ui.screen.push({ name, params, panel: ui.panel }); render(); }
function back() {
  if (ui.screen.length > 1) {
    ui.screen.pop();
    const top = current();
    if (top.name === 'run') ui.panel = top.panel ?? ui.panel;
    render();
  }
}
const current = () => ui.screen.at(-1);

// ── discovery (D01–D07); results come from the real selector via prepare ────
let sel = { max_minutes: 60, theme_ids: ['theme-history'], season: 'any' };
const offersOf = () => ui.emptyCity ? [] : index.offers;
const outcomeFor = () => {
  const key = JSON.stringify([sel.max_minutes, sel.theme_ids, sel.season]);
  if (ui.offline && !(key in outcomes)) return outcomes[JSON.stringify([60, ['theme-history'], 'any'])]; // last valid cache (21 §3.3)
  return outcomes[key];
};

// ── feedback (client states of 21 §5.4; server is G16.01) ────────────────────
const reasonsFor = (kind) => kind === 'guide'
  ? ['interesting_stories', 'clear_delivery', 'too_long', 'hard_to_navigate', 'audio_problem', 'description_mismatch']
  : ['worth_visiting', 'description_mismatch', 'hard_to_reach', 'access_problem'];
function openFeedback(target) { go('feedback', { target, score: null, reasons: new Set(), state: 'draft', revision: 0 }); }
function fbSend(live) {
  live.state = 'pending'; render();
  setTimeout(() => {
    live.state = ui.offline ? 'pending' : 'sending'; render();
    setTimeout(() => {
      if (ui.offline) live.state = 'pending';
      else if (live.conflict) live.state = 'conflict';
      else { live.state = 'sent'; live.revision += 1; upsertRating(live); }
      render();
    }, 700);
  }, 500);
}
function upsertRating(live) {
  const key = JSON.stringify(live.target);
  const row = { key, target: live.target, score: live.score, reasons: [...live.reasons], state: live.state, revision: live.revision };
  const prev = ui.ratings.find((r) => r.key === key);
  if (prev) Object.assign(prev, row); else ui.ratings.push(row);
}

// ── render ───────────────────────────────────────────────────────────────────
function render() {
  const scr = current();
  $('#btn-back').hidden = ui.screen.length <= 1 || scr.name === 'run'; // inside Run Back has its own map (11 §2)
  $('#btn-walk').hidden = !(ui.session && ui.session.state !== 'Ended' && scr.name !== 'run');
  $('#btn-lang').textContent = ui.lang;
  $('#screen').className = ui.bigText ? 'big-text' : '';
  const titles = { explore: t('city'), guides: t('guides'), nearby: t('nearby'), mykudy: t('mykudy'),
    run: t('walk'), end: t('finish'), feedback: t('rate'), discovery: t('whatToDo') };
  $('#screen-title').textContent = scr.name === 'preview'
    ? L(scr.params.guide.offer?.localized.title ?? scr.params.guide.title)
    : scr.name === 'place' ? L(scr.params.place.title) : titles[scr.name] ?? '';
  const views = VIEWS[scr.name](scr.params ?? {}).flat(9).filter((n) => n instanceof Node);
  $('#screen').replaceChildren(...views);
  if (scr.name === 'run' && ui.sessionMeta && !ui.sessionMeta.promised) { // one promise, then quiet (11 §5)
    ui.sessionMeta.promised = true;
    $('#screen').prepend(el('div', { class: 'notice', role: 'status' }, 'Гісторыі будуць запускацца самі, калі вы падыдзеце да кропкі.'));
  }
}

function viewExplore() {
  if (ui.emptyCity) return [ // NAV3: named empty-city state; Побач/My KUDY still work
    el('div', { class: 'card' }, el('h3', {}, L(city.city.name)), el('p', { class: 'muted' }, t('empty'))),
    el('div', { class: 'row' }, el('button', { onclick: () => go('nearby') }, t('nearby')),
      el('button', { onclick: () => go('mykudy') }, t('mykudy'))),
  ];
  return [
    el('h2', {}, L(city.city.name)),
    el('div', { class: 'card' }, el('h3', {}, t('whatToDo')), discoveryForm()),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: () => go('guides') }, t('guides')),
      el('button', { onclick: () => go('nearby') }, t('nearby'))),
    ...city.guides.map((g) => guideCard(g, () => go('preview', { guide: g, source: 'guides' }))),
    guideCardFromOffer(offerB1()),
    placeCard(index.offers.find((o) => o.offer_id === 'offer-a1-place')),
    el('div', { class: 'card' }, el('h3', {}, L(index.collections[0].localized.title)),
      el('span', { class: 'badge mixed' }, 'mixed'),
      el('p', { class: 'muted' }, L(index.collections[0].localized.description)),
      el('button', { onclick: () => go('collection', { source: 'explore' }) }, 'Адкрыць падборку')),
  ];
}

function discoveryForm() {
  const chip = (label, pressed, ontoggle) => el('button', { class: 'chip', 'aria-pressed': String(pressed), onclick: ontoggle }, label);
  const themes = index.themes.map((th) => chip(L(th.labels), sel.theme_ids.includes(th.id),
    () => { sel.theme_ids = sel.theme_ids.includes(th.id) ? sel.theme_ids.filter((x) => x !== th.id) : [...sel.theme_ids, th.id]; render(); }));
  return el('div', {}, el('div', { class: 'row', role: 'group', 'aria-label': 'Тэмы' }, themes),
    el('div', { class: 'row' },
      ...[30, 60, 120].map((m) => chip(`${m} ${t('minutes')}`, sel.max_minutes === m, () => { sel.max_minutes = m; render(); })),
      ...['any', 'autumn'].map((sn) => chip(sn === 'any' ? 'усе сезоны' : 'восень', sel.season === sn, () => { sel.season = sn; render(); }))),
    ui.offline && el('p', { class: 'notice' }, t('offline')),
    el('p', {}, el('button', { class: 'primary', onclick: () => go('discovery') }, 'Паказаць')),
    el('p', { class: 'muted' }, 'D01: рэальны кантэнт горада бачны без выбару і дазволаў — карткі на гэтай жа старонцы.'));
}

function guideCard(g, onclick) {
  return el('div', { class: 'card' },
    el('h3', {}, L(g.title), ' ', el('span', { class: 'badge free' }, 'free')),
    el('p', { class: 'muted' }, L(g.promise)),
    el('p', { class: 'muted' }, `тэкст: ${g.availability.text_locales.join(', ')} · аўдыё: ${g.availability.audio_locales.join(', ') || '—'}`),
    el('button', { class: 'primary', onclick }, 'Адкрыць'));
}
function guideCardFromOffer(o) { // the same preview card is reached from every path (D02, 16.1)
  return el('div', { class: 'card' },
    el('h3', {}, L(o.localized.title), ' ', el('span', { class: `badge ${o.access}` }, o.access)),
    el('p', { class: 'muted' }, L(o.localized.summary)),
    el('p', { class: 'muted' }, `${o.estimated_duration.min_minutes}–${o.estimated_duration.max_minutes} ${t('minutes')} · ${o.distance_m} м · тэкст: ${o.availability.text_locales.join(', ')} · аўдыё: ${o.availability.audio_locales.join(', ') || '—'}`),
    el('button', { class: 'primary', onclick: () => go('preview', { guide: paidGuide(), source: 'explore' }) }, 'Прэв\'ю'));
}
function placeCard(o) {
  const place = city.places.find((p) => p.place_id === o.ref.place_id);
  return el('div', { class: 'card' },
    el('h3', {}, L(o.localized.title), ' ', el('span', { class: 'badge free' }, 'free')),
    el('p', { class: 'muted' }, L(o.localized.summary)),
    place && el('button', { onclick: () => go('place', { place, source: 'explore' }) }, 'Картка месца'));
}

function viewGuides() { // NAV1/NAV2: one card per guide; the rubric renders only with published guides
  return city.guides.map((g) => guideCard(g, () => go('preview', { guide: g, source: 'guides' })));
}

function viewPreview({ guide, source }) {
  const o = guide.offer;
  const locale = ui.previewLocale ?? 'be';
  const avail = o ? o.availability : guide.availability;
  const audioOk = avail.audio_locales.includes(locale);
  const textOk = avail.text_locales.includes(locale);
  const liveSession = ui.session && ui.session.state !== 'Ended';
  return [
    el('div', { class: 'card' },
      el('h2', {}, L(o ? o.localized.title : guide.title), ' ', el('span', { class: `badge ${o ? o.access : 'free'}` }, o ? o.access : 'free')),
      el('p', {}, L(o ? o.localized.summary : guide.promise)),
      o && el('p', { class: 'muted' }, `${o.estimated_duration.min_minutes}–${o.estimated_duration.max_minutes} ${t('minutes')} · ${o.distance_m} м · free_stop_count: ${guide.free_stop_count}`),
      el('p', { class: 'muted' }, `даступна па факце — тэкст: ${avail.text_locales.join(', ')}; аўдыё: ${avail.audio_locales.join(', ') || '—'}`),
      el('div', { class: 'row' }, ['be', 'en', 'uk'].map((lc) => el('button', { class: 'chip', 'aria-pressed': String(locale === lc),
        onclick: () => { ui.previewLocale = lc; render(); } }, lc))),
      !audioOk && textOk && el('p', { class: 'notice' }, 'L01: тэкст на гэтай мове ёсць, аўдыё яшчэ няма — Start не абяцае гук.')),
    o
      ? el('button', { class: 'primary', onclick: dialogPaid }, 'Купіць — D06: націск не купляе і не пачынае Run')
      : el('button', { class: 'primary', disabled: !audioOk || !textOk,
          onclick: () => liveSession ? dialogSwitch(guide, locale) : startGuide(guide, locale) }, t('start')),
    !o && guide.stops.map((st) => el('div', { class: 'card' }, el('h3', {}, L(st.title)),
      el('p', { class: 'muted' }, st.stories.map((x) => `${x.role === 'primary' ? 'асноўная' : 'дадатковая'} (${x.tier}): ${L(x.title)}`).join(' · ')),
      el('p', { class: 'muted' }, `стан кропкі: ${ui.session ? status(ui.session, st.id) : 'pending'}`))),
    o && el('div', { class: 'card' }, el('h3', {}, 'Замкнёная кропка — публічнае прэв\'ю (NAV5)'),
      el('p', {}, '🔒 ', L(guide.locked_stop_announcement)),
      el('p', { class: 'muted' }, 'поўны тэкст, транскрыпт і медыя ў бясплатным пакеце адсутнічаюць')),
    el('p', { class: 'muted' }, `Back вяртае на паверхню-крыніцу: ${source}; Start іншага гіда пры жывой сесіі — толькі праз дыялог (NAV8)`),
  ];
}

function viewPlace({ place, source }) {
  return [
    el('div', { class: 'card' }, el('h2', {}, L(place.title)),
      el('p', {}, L(place.summary)),
      el('p', { class: 'muted' }, `тэкст: ${place.availability.text_locales.join(', ')} · аўдыё: ${place.availability.audio_locales.join(', ') || '—'}`)),
    el('div', { class: 'card' }, el('h3', {}, 'Уласная ацэнка месца'),
      el('p', { class: 'muted' }, 'толькі яўнае дзеянне на картке месца; месца/падборка/гід — тры шляхі адной прапановы (16.5)'),
      el('button', { onclick: () => openFeedback({ kind: 'place', place_id: place.place_id, content_version: place.content_version, locale: ui.lang }) }, 'Ацаніць месца')),
    el('p', { class: 'muted' }, `Back вяртае: ${source}`),
  ];
}

function viewCollection({ source }) { // NAV11: no Start, no buy, no audio; members open their own cards
  const c = index.collections[0];
  return [
    el('div', { class: 'card' }, el('h2', {}, L(c.localized.title)), el('span', { class: 'badge mixed' }, 'mixed'),
      el('p', {}, L(c.localized.description)),
      el('p', { class: 'notice' }, 'overlap_note: ', L(c.overlap_note)),
      el('p', { class: 'muted' }, 'аўдыё падборкі: няма (audio_locales заўжды []); кнопкі «паслухаць падборку» не існуе')),
    el('div', { class: 'card' }, el('h3', {}, 'Члены'),
      el('div', { class: 'row' },
        el('button', { onclick: () => go('place', { place: city.places[0], source: 'collection' }) }, 'Двор сукнараў (месца)'),
        el('button', { onclick: () => go('preview', { guide: paidGuide(), source: 'collection' }) }, 'Гід сукнараў (прэв\'ю)'))),
    el('p', { class: 'muted' }, `Back з члена вяртае ў падборку; Back з падборкі — на ${source} (NAV11)`),
  ];
}

function viewDiscovery() { // D03/D04/D05: exact alone; honest zero + labeled alternatives
  const r = outcomeFor();
  if (!r) return [el('div', { class: 'card error' }, 'Сінтэтычны вынік для гэтай камбінацыі не падрыхтаваны — пусціце npm run prepare')];
  const card = (m) => {
    const o = index.offers.find((x) => x.offer_id === m.offer_id);
    const place = o.ref.kind === 'place' ? city.places.find((p) => p.place_id === o.ref.place_id) : null;
    const open = () => o.ref.kind === 'place'
      ? (place ? go('place', { place, source: 'discovery' }) : alertNoPlaceCard(o))
      : go('preview', { guide: paidGuide(), source: 'discovery' });
    return el('div', { class: 'card' }, el('h3', {}, L(o.localized.title), ' ', el('span', { class: `badge ${o.access}` }, o.access)),
      el('p', { class: 'muted' }, L(o.localized.summary)),
      o.estimated_duration && el('p', { class: 'muted' }, `${o.estimated_duration.min_minutes}–${o.estimated_duration.max_minutes} ${t('minutes')}`),
      el('p', { class: 'muted' }, `reasons: ${m.reasons.join(', ')}`),
      el('button', { class: 'primary', onclick: open }, 'Адкрыць'));
  };
  return [
    r.exact.length ? r.exact.map(card)
      : el('div', { class: 'card' }, el('h3', {}, 'Нічога дакладнага не знайшлося'),
        el('p', { class: 'muted' }, 'D04: сумленнае паведамленне; горад і мова запыту не падменяюцца')),
    r.alternatives.length > 0 && el('div', { class: 'card' }, el('h3', {}, 'Іншыя варыянты (alternatives)'),
      r.alternatives.map((m) => el('p', {}, `• ${L(index.offers.find((x) => x.offer_id === m.offer_id).localized.title)} — differences: ${m.differences.join(', ') || '—'}`))),
    el('p', { class: 'muted' }, 'D07: падбор не мае доступу да сесіі — актыўная прагулка не мяняецца.'),
  ];
}
const alertNoPlaceCard = (o) => {
  const d = el('dialog', {}, el('h3', {}, 'Карткі гэтага месца няма ў сінтэтычным пакеце'),
    el('p', { class: 'muted' }, `У пратотыпе змадэляваны толькі place-a1; ${o.ref.place_id} — сапраўдная прапанова фіксчура без Run-карткі.`),
    el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => d.close() }, 'Зразумела')));
  $('#dialog-root').replaceChildren(d); d.showModal();
};

function viewNearby() { // Побач: Moments with explicit Play only (P02)
  const m = city.moments[0];
  const playing = ui.session?.playing;
  const sounding = playing?.owner === 'moment' && playing.momentId === m.moment_id;
  return [
    el('div', { class: 'card momentcard' }, el('h3', {}, `Moment: ${L(m.title)}`),
      el('p', { class: 'muted' }, L(m.transcript)),
      sounding ? el('p', { class: 'muted' }, 'гучыць…')
        : el('button', { class: 'primary', onclick: () => playMoment(m) }, 'Паслухаць Moment (яўны Play)')),
    el('div', { class: 'card' }, el('h3', {}, 'Moment без сесіі (ADR G01.02 §3.8)'),
      el('p', { class: 'muted' }, 'грае на тым жа адзіным плэеры без фіктыўнай сесіі; Start падчас moment-гукавання дазволены і яго не спыняе')),
    el('button', { onclick: () => go('mykudy') }, t('mykudy')),
  ];
}

function playMoment(m) {
  if (ui.session && ui.session.state !== 'Ended') {
    send({ type: 'PlayMoment', momentId: m.moment_id, storyId: m.story_id, token: { kind: 'moment', ref: m.moment_id, seq: ++ui.momentSeq } });
    ui.inspected = { kind: 'moment' }; ui.panel = 'half';
  } else { // no session: the single player serves manual content without any session mutation
    ui.momentNoSession = m; ui.audio.tokenKey = `m:${m.moment_id}`; ui.audio.remaining = m.seconds * 1000;
  }
  render();
}

// ── Run surface (панэль Peek/Half/Full; карта — рэжым, не таб) ───────────────
function viewRun() {
  if (!ui.session || ui.session.state === 'Ended')
    return [el('div', { class: 'card' }, 'Сесіі няма. Пачніце прагулку з прэв\'ю гіда.')];
  const s = ui.session;
  const guide = ui.sessionMeta.guide;
  const p = s.playing;
  const nowLine = p
    ? (p.owner === 'guide'
      ? `${t('nowPlaying')}: ${guide.stops.findIndex((x) => x.id === p.stopId) + 1} · ${L(guide.stops.find((x) => x.id === p.stopId).title)}`
      : `${t('nowPlaying')}: Moment · ${L(city.moments.find((m) => m.moment_id === p.momentId).title)}`)
    : s.state === 'Paused' ? t('paused') : nearest();
  const map = el('div', { id: 'map', role: 'img', 'aria-label': 'Карта: маркеры кропак і ваша пазіцыя; тап па маркеры адкрывае прэв\'ю, не гук' });
  for (const st of guide.stops) {
    const stat = status(s, st.id);
    map.append(el('button', { class: `marker ${stat}`, style: `left:${st.position.x}%;top:${st.position.y}%`,
      'aria-label': `${st.title.be}: ${stat}`, title: `${st.title.be} — ${stat}`,
      onclick: () => { ui.inspected = { kind: 'stop', id: st.id }; ui.panel = 'half'; render(); } }, stat[0].toUpperCase()));
  }
  if (ui.fix) {
    const at = guide.stops.find((x) => x.id === ui.fix.stopId)?.position ?? { x: 10, y: 85 };
    map.append(el('div', { class: 'person', style: `left:${at.x}%;top:${at.y}%` }));
  }
  map.append(el('div', { class: 'street', style: 'left:0;right:0;top:48%;height:6px' }));

  const peek = el('div', { id: 'peek', role: 'button', tabindex: '0', 'aria-expanded': String(ui.panel !== 'peek'),
    onclick: () => { ui.panel = ui.panel === 'peek' ? 'half' : 'peek'; render(); } },
    el('div', { class: 'now' }, el('div', {}, nowLine), el('div', { class: 'line2' },
      p ? `${(ui.audio.remaining / 1000).toFixed(0)} с застаўся` : ui.denied ? t('deny') : t('nearbyStop'))),
    p && !p.paused && el('button', { 'aria-label': 'Паўза аўдыё', onclick: (e) => { e.stopPropagation(); send({ type: 'UserPausedAudio' }); } }, '⏸'),
    p && p.paused && el('button', { 'aria-label': 'Працягнуць аўдыё', onclick: (e) => { e.stopPropagation(); send({ type: 'ResumeAudio', token: p.owner === 'guide' ? { kind: 'guide', ref: s.sessionId, seq: p.playId } : { kind: 'moment', ref: p.momentId, seq: p.seq } }); } }, '▶'),
    p && el('button', { 'aria-label': 'Стоп аўдыё', onclick: (e) => { e.stopPropagation(); send({ type: 'UserStoppedAudio' }); } }, '⏹'),
    el('button', { 'aria-label': 'Меню сесіі', onclick: (e) => { e.stopPropagation(); sessionMenu(); } }, '⋯'));

  const body = el('div', { class: 'panel-body' });
  if (s.suspended && !p) body.append(el('div', { class: 'notice' },
    'Аўтаматыка прыпыненая. ', el('button', { onclick: () => send({ type: 'GuideResume' }) }, t('continueGuide')),
    ' — адзіны шлях вяртання; больш нічога не загучыць сама (P02).'));
  if (ui.inspected?.kind === 'stop') body.append(...inspectedStopView(guide.stops.find((x) => x.id === ui.inspected.id)));
  if (ui.inspected?.kind === 'moment') body.append(...inspectedMomentView());
  if (p && p.owner === 'guide' && ui.inspected?.kind !== 'stop')
    body.append(el('div', { class: 'notice' }, `${t('nowPlaying')}: ${L(storyOf(p.storyId).title)} `,
      el('button', { onclick: () => { ui.inspected = { kind: 'stop', id: p.stopId }; render(); } }, 'вярнуцца да кропкі')));
  if (!ui.inspected) body.append(el('p', { class: 'muted' }, 'Транскрыпт належыць адкрытай гісторыі (inspected), не таму, што гучыць (11 §3.2).'));

  const upgrade = !s.tierAvailable.includes('extended') &&
    el('button', { onclick: () => send({ type: 'AccessReady', issuer: 'services/download', routeId: s.routeId, version: s.version, locale: s.locale,
      stopIds: guide.stops.filter((st) => st.stories.some((x) => x.tier === 'extended')).map((st) => st.id), tiers: ['extended'] }) }, t('unlock'));
  const hintEligible = s.state === 'Active' && !s.suspended && !(p && !p.paused)
    && ui.fix && guide.route_id === 'route-free-1'; // R07: never during sounding audio (11 §15)
  if (hintEligible && !ui.hintShown.has('route-free-2')) { ui.hintShown.add('route-free-2'); ui.hintActive = true; } // R07: one factual show per session
  const hint = ui.hintActive && hintEligible
    ? el('div', { class: 'card hintcard', role: 'note' }, `${t('otherGuide')} «${L(guideById('route-free-2').title)}» — ціхая картка без гуку і вібрацыі (11 §15) `,
        el('button', { onclick: () => go('preview', { guide: guideById('route-free-2'), source: 'run' }) }, 'Прэв\'ю'),
        el('button', { onclick: () => { ui.hintActive = false; render(); } }, 'Схаваць'))
    : null;

  return [el('div', { id: 'run-layout' },
    el('div', {}, map, el('div', { class: 'row' },
      el('button', { onclick: stepWalk }, t('step')),
      el('button', { onclick: () => { ui.denied = !ui.denied; render(); } }, ui.denied ? 'GPS: дазволіць (сімуляцыя)' : 'GPS: адклікаць (сімуляцыя)')),
      ui.denied && el('p', { class: 'notice' }, t('deny')), hint, upgrade),
    el('div', {}, el('div', { id: 'panel' }, peek, ui.panel !== 'peek' && body),
      el('p', { class: 'muted' }, `Панэль: ${ui.panel} (Peek/Half/Full). Full гартае змест кнопкай «далей» без каманды плэеру.`)))];
}

function nearest() {
  if (!ui.fix) return 'уключыце сімуляцыю хады («Крок»)';
  const st = ui.sessionMeta.guide.stops.find((x) => x.id === ui.fix.stopId);
  return st ? `${t('nearbyStop')}: ${L(st.title)} · ${Math.round(st.radius / 2)} м` : '';
}
function inspectedStopView(st) {
  const s = ui.session;
  if (status(s, st.id) === 'locked') // NAV5: locked stop has only the public preview
    return [el('h3', {}, `${L(st.title)} 🔒`),
      el('p', { class: 'muted' }, 'замкнёная: назва і публічны анонс; поўны тэкст, транскрыпт і медыя не загружаюцца ў бясплатны пакет')];
  const story = st.stories.find((x) => x.tier === 'base') ?? st.stories[0];
  const ext = st.stories.find((x) => x.tier === 'extended' && x.role === 'additional');
  const out = [el('h3', {}, L(st.title)), el('p', { class: 'muted' }, `стан кропкі: ${status(s, st.id)} (адзінка — stop; ADR G01.01 §4.5)`),
    el('h4', {}, `${L(story.title)} (${story.tier})`), el('p', {}, L(story.transcript)),
    el('button', { class: 'primary', onclick: () => send({ type: 'UserSelectedStop', stopId: st.id }) }, 'Ручны Play (не патрабуе блізкасці)')];
  if (ext) out.push(el('div', { class: 'card' }, el('h4', {}, `${t('more')} — ${L(ext.title)} (${ext.tier})`),
    s.tierAvailable.includes('extended')
      ? el('button', { onclick: () => send({ type: 'UserSelectedStory', stopId: st.id, storyId: ext.id }) }, 'Прайграць дадатковую (UserSelectedStory)')
      : el('p', { class: 'muted' }, 'пасля разблакіроўкі (AccessReady) стане даступная без скіду прагрэсу')));
  return out;
}
function inspectedMomentView() {
  const m = city.moments[0];
  return [el('div', { class: 'card momentcard' }, el('h3', {}, `Moment: ${L(m.title)}`), el('p', {}, L(m.transcript)),
    el('button', { class: 'primary', onclick: () => playMoment(m) }, 'Play Moment (яўны)')),
    el('p', { class: 'muted' }, 'Адкрыццё карткі Moment не чапае плэер; яўны Play спыняе гід камандай, ачышчае чаргу і прыпыняе аўтаматыку да «Працягнуць гід» (P02).')];
}
function stepWalk() { // synthetic walking: fresh fix + dwell at the next stop
  const stops = ui.sessionMeta.guide.stops;
  const next = stops[(stops.findIndex((x) => x.id === ui.fix?.stopId) + 1) % stops.length];
  ui.fix = { stopId: next.id, at: Date.now() };
  send({ type: 'LocationAccepted', fix: { at: Date.now(), accuracy: next.radius / 2,
    distances: Object.fromEntries(stops.map((x) => [x.id, x.id === next.id ? x.radius / 2 : 10000])) } });
  if (!ui.denied) setTimeout(() => send({ type: 'DwellCompleted', stopId: next.id, radius: next.radius }), 1100);
  ui.panel = 'half'; // аўтатрыгер падымае панэль (11 §3.2)
}

function sessionMenu() {
  const active = ui.session.state === 'Active';
  const d = el('dialog', {}, el('h3', {}, 'Сесія'),
    el('p', { class: 'muted' }, `стан: ${ui.session.state}; мова сесіі ${ui.session.locale} замацаваная да End — змена мовы інтэрфейсу яе не чапае (L02)`),
    el('div', { class: 'row' },
      el('button', { onclick: () => { d.close(); send({ type: active ? 'Pause' : 'Resume' }); } }, active ? t('pause') : t('resume')),
      el('button', { class: 'primary', onclick: () => { d.close(); send({ type: 'End' }); } }, t('finish'))));
  $('#dialog-root').replaceChildren(d); d.showModal();
}
function dialogSwitch(guide, locale) { // NAV8 / 11 §4.1: the single confirm dialog; Cancel changes nothing
  const d = el('dialog', {},
    el('h3', {}, `Завяршыць «${L(ui.sessionMeta.guide.title)}» і пачаць «${L(guide.title)}»?`),
    el('p', { class: 'muted' }, 'Ціхае перамыканне забароненае; прагрэс бягучай прагулкі застанецца ў My KUDY.'),
    el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: () => { d.close(); send({ type: 'End' }); startGuide(guide, locale); } }, 'Завяршыць і пачаць'),
      el('button', { onclick: () => d.close() }, 'Скасаваць — вяртае ў прэв\'ю без змен сесіі')));
  $('#dialog-root').replaceChildren(d); d.showModal();
}
function dialogPaid() { // D06: a paid tap never buys, never starts, never unlocks private
  const d = el('dialog', {}, el('h3', {}, 'Пакупка — па-за пратотыпам G06.08'),
    el('p', { class: 'muted' }, 'Націск на платную прапанову адкрывае прэв\'ю; ён не купляе, не пачынае Run і не раскрывае private (D06). Пакупка, загрузка і Start — асобныя дзеянні (09 §6.5).'),
    el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => d.close() }, 'Зразумела')));
  $('#dialog-root').replaceChildren(d); d.showModal();
}

function onEnd() { // Finish: history kept; «Яшчэ можна адкрыць» counts stories (G01.01 §4.6)
  ui.history.push({ guide: ui.sessionMeta.guide, locale: ui.sessionMeta.locale,
    heard: [...ui.session.heard], state: ui.session.state === 'Ended' ? 'finished' : 'paused' });
  ui.lastEnded = { missed: missed(ui.session), guide: ui.sessionMeta.guide };
  go('end');
}

function viewEnd() {
  const { missed: open, guide } = ui.lastEnded;
  const invited = ui.fbInvited != null;
  return [
    el('div', { class: 'card' }, el('h2', {}, 'Прагулка завяршана'),
      el('p', { class: 'muted' }, `«${L(guide.title)}» — радок захаваны ў My KUDY; Finished не рэактывуецца, паўторны праход — новая сесія з чыстымі наборамі (G01.03 §3.1)`)),
    el('div', { class: 'card' }, el('h3', {}, t('canOpen')),
      open.length ? el('ul', {}, open.map((id) => {
        const st = storyOf(id);
        return el('li', {}, `${L(st.title)} — ${st.stopTitle ? L(st.stopTitle) + ' · ' : ''}${st.moment ? 'moment' : st.role === 'additional' ? 'дадатковая' : 'асноўная'}`);
      })) : el('p', { class: 'muted' }, 'усё даступнае праслуханае; замкнёныя не ўваходзяць'),
      el('p', { class: 'muted' }, 'адзінка — story_id; гэта магчымасці, не пропускі (ADR G01.01 §4.6)')),
    !invited && el('div', { class: 'card' }, el('h3', {}, t('rate')),
      el('p', { class: 'muted' }, 'неабавязковае, немадальнае, не падчас аўдыё; максімум адно запрашэнне за сесію (16.7)'),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => { ui.fbInvited = ui.session.sessionId;
          openFeedback({ kind: 'guide', route_id: guide.route_id, version: guide.version, locale: ui.sessionMeta.locale }); } }, 'Ацаніць'),
        el('button', { onclick: render }, t('skip')))),
    el('button', { onclick: () => go('mykudy') }, t('mykudy')),
  ];
}

function viewFeedback(params) { // temporary surface (16.7): no stack entry, Back returns to the source
  const live = current().params;
  const toggleReason = (r) => {
    if (live.reasons.has(r)) live.reasons.delete(r);
    else if (live.reasons.size < 3) live.reasons.add(r); // max 3 unique reasons (21 §5.1)
    render();
  };
  return [
    el('div', { class: 'card' }, el('h3', {}, 'Водгук — заўсёды прыватны (R09)'),
      el('p', { class: 'muted' }, `адрасат: ${live.target.kind} · мова фактычнага досведу: ${live.target.locale} · версія з факту выкарыстання`),
      el('p', { class: 'muted' }, 'шкала 1–5 без default; максімум 3 прычыны; публічнага сярэдняга няма')),
    el('div', { class: 'card' }, el('h3', {}, 'Ацэнка'),
      el('div', { class: 'fb-scale', role: 'group', 'aria-label': 'Ацэнка 1–5' },
        [1, 2, 3, 4, 5].map((v) => el('button', { 'aria-pressed': String(live.score === v), onclick: () => { live.score = v; render(); } }, String(v))))),
    el('div', { class: 'card' }, el('h3', {}, 'Прычыны (замкнёны спіс)'),
      reasonsFor(live.target.kind).map((r) => el('div', {},
        el('label', {}, el('input', { type: 'checkbox', checked: live.reasons.has(r) ? '' : undefined,
          disabled: !live.reasons.has(r) && live.reasons.size >= 3 ? '' : undefined, onchange: () => toggleReason(r) }), ' ', r)))),
    el('div', { class: 'card' }, el('p', {}, `стан: ${live.state} (draft → pending → sending → sent; збой вяртае pending; 409 → conflict; 401/422 → action_required — 21 §5.4)`),
      live.state === 'conflict' && el('p', { class: 'notice' }, 'Рэвізія на серверы змянілася — чэсны канфлікт, не бясконцы retry.'),
      el('div', { class: 'row' },
        el('button', { onclick: () => { live.state = 'draft'; render(); } }, t('save')),
        live.state !== 'sent' && el('button', { class: 'primary', disabled: live.score == null, onclick: () => fbSend(live) }, t('send')),
        live.state !== 'sent' && el('button', { onclick: () => { live.conflict = true; fbSend(live); } }, 'сімуляцыя 409'),
        el('button', { onclick: back }, t('skip')))),
    el('p', { class: 'muted' }, 'форма — часовая паверхня: не ўваходзіць у стос навігацыі; падача/адпраўка/памылка не мяняюць Run і навігацыю (F01, NAV10).'),
  ];
}

function viewMykudy() {
  return [
    el('div', { class: 'card' }, el('h3', {}, t('history')),
      ui.history.length ? el('table', { class: 'simple' },
        el('tr', {}, el('th', {}, 'гід'), el('th', {}, t('sessionLang')), el('th', {}, 'heard'), el('th', {}, 'стан')),
        ui.history.map((h) => el('tr', {}, el('td', {}, L(h.guide?.title)), el('td', {}, h.locale),
          el('td', {}, String(h.heard.length)), el('td', {}, h.state))))
        : el('p', { class: 'muted' }, 'пуста; старыя радкі ніколі не выдаляюцца і не перазапісваюцца (G01.03 §3.1)')),
    el('div', { class: 'card' }, el('h3', {}, t('downloads')),
      el('p', { class: 'muted' }, 'route-free-1 v1 · base · сінтэтычныя 3.2 МБ — кіраванне сховішчам тут, а не long-press (09 §6.5)')),
    el('div', { class: 'card' }, el('h3', {}, t('lang')),
      el('div', { class: 'row' }, ['be', 'en'].map((lc) => el('button', { class: 'chip', 'aria-pressed': String(ui.lang === lc),
        onclick: () => { ui.lang = lc; localStorage.setItem('kudy.ui.lang', lc); render(); } }, lc))),
      ui.session && el('p', { class: 'muted' }, `${t('sessionLang')}: ${ui.session.locale} — не мяняецца зменай мовы інтэрфейсу (L02)`)),
    el('div', { class: 'card' }, el('h3', {}, t('myRatings')),
      ui.ratings.length ? ui.ratings.map((r) => el('p', {},
        `${r.target.kind} ${r.target.route_id ?? r.target.place_id} · ${r.score}/5 · ${t('ratingState')}: ${r.state} · rev ${r.revision} `,
        el('button', { onclick: () => openFeedback({ ...r.target }) }, t('edit')),
        el('button', { onclick: () => { r.state = 'deleted (tombstone)'; render(); } }, t('del'))))
        : el('p', { class: 'muted' }, 'адна актуальная ацэнка на (прылада, мэта, версія, мова); рэдагаванне замяняе, паўторная прагулка не дадае голас (21 §5.1)')),
    el('div', { class: 'card' }, el('h3', {}, 'Сімулятары стану (толькі пратотып)'),
      el('div', { class: 'row' },
        el('button', { onclick: () => { ui.offline = !ui.offline; render(); } }, ui.offline ? 'сетка: уключыць' : 'сетка: адключыць (офлайн)'),
        el('button', { onclick: () => { ui.emptyCity = !ui.emptyCity; render(); } }, ui.emptyCity ? 'горад: вярнуць кантэнт' : 'горад: пусты (NAV3)'),
        el('button', { onclick: () => { ui.bigText = !ui.bigText; render(); } }, ui.bigText ? 'буйны тэкст: выключыць' : 'буйны тэкст: уключыць'))),
  ];
}

const VIEWS = { explore: viewExplore, guides: viewGuides, preview: viewPreview, place: viewPlace, collection: viewCollection,
  discovery: viewDiscovery, nearby: viewNearby, run: viewRun, end: viewEnd, mykudy: viewMykudy, feedback: viewFeedback };

// ── wiring ───────────────────────────────────────────────────────────────────
$('#btn-back').addEventListener('click', back);
$('#btn-walk').addEventListener('click', () => { // NAV7: «Прагулка» вяртае ў тым жа становішчы панэлі; аўдыё не спыняе
  const runTop = ui.screen.find((s) => s.name === 'run');
  if (runTop) { ui.screen = [ui.screen[0], runTop]; ui.panel = runTop.panel ?? ui.panel; }
  else { ui.screen = [...ui.screen, { name: 'run', panel: ui.panel }]; } // the session lives independent of the stack
  render();
});
$('#btn-mykudy').addEventListener('click', () => go('mykudy'));
$('#btn-lang').addEventListener('click', () => { ui.lang = ui.lang === 'be' ? 'en' : 'be'; localStorage.setItem('kudy.ui.lang', ui.lang); render(); });

const base = '/spikes/G06.08-prototype';
Promise.all([
  fetch(base + '/data/synthetic-city.json').then((r) => r.json()),
  fetch(base + '/data/discovery-index.json').then((r) => r.json()),
  fetch(base + '/data/selection-outcomes.json').then((r) => r.json()),
]).then(([c, i, o]) => {
  city = c; index = i; outcomes = o;
  render();
}).catch((e) => {
  document.body.replaceChildren(el('div', { class: 'card error', style: 'margin:40px' },
    'Дадзеныя не загрузіліся. Пусціце `npm run prepare` і `npm run serve` (модулі не працуюць праз file://).', el('pre', {}, String(e))));
});
