/* The mind: an agent's whole memory, drawn by What Lights Up's anatomy (../engine/anatomy.js) and renderer
 * (../engine/tissue.js, ../engine/post.js), live. First made as "a mind, growing", the log's first study.
 *
 * Every cell is a memory from ../data/memories.json, read on request from the real store by `mnemos log`; every
 * fibre is a real link. Nothing is simulated. How brightly a cell rests is how easily it comes to mind; when it
 * appears is when it formed; recall travels only along links the store keeps.
 *
 *   Now       the mind as it is, and live: a memory made in any session arrives white-hot; one that came back in
 *             recall flashes, and the light spreads along its links.
 *   Growing   from the first memory to now, paced by memories arriving; the date shown is each one's own.
 *   Exposure  the whole life in one long exposure: every memory a light since it formed, every recall a flare.
 *   Quiet     the same mind at rest: softer light, no drift, a fraction of the pixels and frames.
 *
 * Kept light enough for any machine: the drawing is made in a worker (./build.js) to a budget of points this screen
 * can draw smoothly, and if frames still come slowly the budget halves and it's drawn again. Where each memory sits
 * is remembered in this browser, so the mind keeps its shape from one visit to the next. */

import { context, lookAt, perspective, add, sub, scale, dot, length, normalize, cross, mix, mixv, clamp } from '../engine/gl.js';
import { glyphAtlas, DOT, STROKE } from '../engine/glyphs.js';
import { Post } from '../engine/post.js';
import { Tissue } from '../engine/tissue.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const FOV = (26 * Math.PI) / 180;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOOK = { rest: [0.4, 0.55, 0.22, 0.8], light: [0.85, 1.3, 0.55, 0.8], back: 0.45 };
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fmt = (n) => Number(n).toLocaleString('en-US');
const dayOf = (t) => { const d = new Date(t); return `${MONTH[d.getMonth()]} ${d.getDate()}`; };
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const LIVE_EVERY = (Number(params.get('every')) || 20) * 1000;

/* how many points this screen draws smoothly: a phone or a small machine far fewer than a desk; once a screen has
 * shown what it can do, the page remembers (a convenience, never needed: without it the guess is used again) */
const small = innerWidth < 760 || (navigator.deviceMemory || 8) <= 4;
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full, or private: the page works without it */ } },
};
const BUDGET_KEY = 'mnemos.mind.budget';
let budget = Number(params.get('budget')) || store.get(BUDGET_KEY) || (small ? 600_000 : 1_600_000);

const json = async (path) => { const r = await fetch(path, { cache: 'no-store' }); if (!r.ok) throw new Error(`${path}: ${r.status}`); return r.json(); };

document.fonts.add(await new FontFace('Mono', 'url(../fonts/jetbrains-mono-nl.woff)', { weight: '400' }).load());
const canvas = $('mind');
const gl = context(canvas);
const PRINTABLE = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join('');
const atlas = await glyphAtlas(gl, { sets: [{ name: 'mono', glyphs: PRINTABLE + DOT + STROKE, font: (px) => `400 ${px}px Mono` }] }, { cell: 112 });
const GLYPHS = Object.fromEntries([DOT, STROKE].map((ch) => [ch, atlas.index[`mono:${ch}`]]));

/* ---------- the memory, read, and drawn (again when it grows) ---------- */

let life = null, who = null, version = null;
let D, N, NL, K = 0, tissue = null, R, P, centre, extent, HOME, MID = null;
let T0, TNOW, born, touched, linkBorn, acc, phase, nbrs, recalls, events = [], moments = [];
let glow, flash, aim, read, LF, LA, LT, LR, fireAt, fireLevel, linkAt, linkLevel;
const LAYOUT_KEY = () => `mnemos.mind.layout.${who.agentId || 'agent'}`;

/* the export's memories, as the anatomy reads them: a cell per memory, a link per tie (counted once, from its
 * sender), recall moments from the log of what came back when, and beliefs pointing at the memories they rest on */
function shape(mems, recalled) {
  const index = new Map(mems.map((m, i) => [m.id, i]));
  const cells = mems.map((m) => ({ id: m.id, fullId: m.id, content: m.content, impact: m.impact, born: m.born, touched: m.touched,
    accessibility: m.acc, state: m.state, lesson: m.lesson, model: m.model, author: m.author, recalls: m.recalls,
    strength: m.strength ?? 0.5, stability: m.stability ?? 0.5 }));
  const links = [];
  mems.forEach((m, s) => {
    for (const [target, rel, w, at, by, out] of m.ties) {
      const t = index.get(target);
      if (t === undefined || (out === undefined ? s > t : !out)) continue;
      links.push({ s, t, w, rel, born: at || null, by: by === 'retrieval' || rel === 'co_activated' ? 'retrieval' : by });
    }
  });
  const reinforced = (recalled || []).map(([id, at]) => ({ cell: index.get(id), at })).filter((r) => r.cell !== undefined && r.at);
  const beliefs = (life.beliefs || []).map((b) => ({ text: b.text, confidence: b.confidence,
    history: (b.history || []).map((h) => ({ timestamp: h.at, old_confidence: h.from ?? b.confidence, new_confidence: h.to ?? b.confidence })),
    supports: (b.supports || []).map((id) => index.get(id)).filter((i) => i !== undefined) }));
  return { cells, links, reinforced, beliefs, meta: { made: life.made } };
}

/* one build in a worker of its own, let go when it answers */
function drawIn(data, budgetNow) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./build.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data: out }) => { w.terminate(); if (out.error) reject(new Error(out.error)); else resolve(out); };
    w.onerror = (e) => { e.preventDefault(); w.terminate(); reject(new Error(`${e.message || 'the drawing could not be made'} (${e.filename}:${e.lineno})`)); };
    w.onmessageerror = () => { w.terminate(); reject(new Error('the drawing could not be handed back')); };
    const tune = Object.fromEntries(['core', 'lobes', 'together'].filter((k) => params.has(k)).map((k) => [k, Number(params.get(k))]));
    w.postMessage({ tune, cells: data.cells.map((c) => ({ id: c.id, lesson: c.lesson, strength: c.strength, stability: c.stability, recalls: c.recalls, acc: c.accessibility })),
      links: data.links.map((l) => ({ s: l.s, t: l.t, w: l.w, rel: l.rel })), known: params.has('relayout') ? {} : store.get(LAYOUT_KEY()) || {}, budget: budgetNow,
      glyphs: GLYPHS, metrics: atlas.metrics, mid: MID });
  });
}

let building = null, built = null;
async function build(data) {
  const keep = D ? new Map(D.cells.map((c, i) => [c.fullId, i])) : null;
  const out = await drawIn(data, budget);
  const oldFlash = flash;
  D = data; N = D.cells.length; NL = D.links.length;
  MID = out.mid;
  // where each memory sits, remembered for next time: the layout is the slow part, and a mind keeps its shape
  store.set(LAYOUT_KEY(), Object.fromEntries(D.cells.map((c, i) => [c.id, out.places[i].map((x) => Math.round(x * 1000) / 1000)])));
  K = new Set(out.places.map((p) => p[3])).size;
  const next = new Tissue(gl, atlas, out.data, out.count, { cells: N, links: NL });
  if (tissue) tissue.dispose();
  tissue = next;
  R = out.R; P = Array.from({ length: N }, (_, i) => [out.P[i * 3], out.P[i * 3 + 1], out.P[i * 3 + 2]]);
  centre = scale(P.reduce(add, [0, 0, 0]), 1 / (N || 1));
  extent = Math.max(0.5, ...P.map((p) => length(sub(p, centre))));
  // far enough that the whole mind sits in the frame, with dark round it; a tall phone screen needs more room across
  HOME = extent * 3.35 * Math.min(1.8, Math.max(1, 0.85 / (innerWidth / innerHeight)));

  T0 = N ? Date.parse(D.cells[0].born) : Date.now(); TNOW = Date.parse(D.meta.made);
  born = D.cells.map((c) => Date.parse(c.born));
  touched = D.cells.map((c) => (c.touched ? Date.parse(c.touched) : 0));
  linkBorn = D.links.map((l) => Math.max(l.born ? Date.parse(l.born) : 0, born[l.s], born[l.t]));
  acc = D.cells.map((c) => c.accessibility);
  phase = D.cells.map((_, i) => (i * 2.39996) % (Math.PI * 2));
  nbrs = Array.from({ length: N }, () => []);
  D.links.forEach((l, li) => { nbrs[l.s].push([l.t, l.w, li]); nbrs[l.t].push([l.s, l.w, li]); });
  recalls = new Uint16Array(N); for (const r of D.reinforced) recalls[r.cell]++;
  // recall moments: recalls in time, split where the gap passes five seconds; a moment keeps its memories in recorded
  // order, and the links recall itself made among them while it happened
  events = D.reinforced.map((r) => ({ t: Date.parse(r.at), cell: r.cell })).sort((a, b) => a.t - b.t);
  moments = [];
  for (const e of events) {
    const m = moments[moments.length - 1];
    if (m && e.t - m.last <= 5000) { if (!m.cells.includes(e.cell)) m.cells.push(e.cell); m.last = e.t; }
    else moments.push({ t: e.t, last: e.t, cells: [e.cell] });
  }
  moments = moments.filter((m) => m.cells.length >= 2);
  for (const m of moments) {
    m.links = [];
    for (let i = 0; i < m.cells.length; i++) for (const [j, , li] of nbrs[m.cells[i]]) {
      const l = D.links[li];
      if (j > m.cells[i] || !m.cells.includes(j) || l.by !== 'retrieval' || !l.born) continue;
      const b = Date.parse(l.born);
      if (b >= m.t - 6000 && b <= m.last + 6000) m.links.push(li);
    }
  }

  glow = new Float32Array(N); flash = new Float32Array(N); aim = new Float32Array(N); read = new Float32Array(N);
  LF = new Float32Array(NL); LA = new Float32Array(NL); LT = new Float32Array(NL); LR = new Float32Array(NL);
  fireAt = new Float64Array(N).fill(-1); fireLevel = new Float32Array(N);
  linkAt = new Float64Array(NL).fill(-1); linkLevel = new Float32Array(NL);
  if (keep && oldFlash) D.cells.forEach((c, i) => { const j = keep.get(c.fullId); if (j !== undefined && j < oldFlash.length) flash[i] = oldFlash[j]; });
  built = { points: out.count, detail: out.detail, budget, ms: out.ms, laidOut: out.laidOut, fresh: out.fresh, at: performance.now() };
  window.__built = built;
}

life = await json('../data/life.json');
who = life.identity;
document.title = `${who.name} · the mind`;
$('who-name').textContent = who.name;
$('mind').setAttribute('aria-label', `${who.name}'s memory, every cell a memory and every fibre a real link between two`);
let first = await json('../data/memories.json');
version = first.version;
$('loading').textContent = `gathering ${fmt(first.memories.length)} memories…`;
await build(shape(first.memories, first.recalled));
first = null;

// how brightly a memory rests is how easy it is to reach (a curve keeps the order and lets the easiest stand out);
// a link rests by its strength
const cellRest = (i) => (D.cells[i].state === 'dormant' ? 0.035 : 0.06 + 0.5 * acc[i] ** 1.8);
const linkRest = (li) => 0.026 + 0.05 * D.links[li].w;

let mode = 'now', T = TNOW, growing = false, growStart = 0;
const GROW_SECONDS = Number(params.get('grow')) || 42;
// the long exposure: the shutter stays open while the mind grows, paced by the calendar so every arc is as long as its
// memory is old; the camera rolls about its line of sight, so trails ring the pole the way stars do
const EXPO_SECONDS = Number(params.get('expose')) || 30, EXPO_ROLL = Math.PI * 2 * 0.92, EXPO_GAIN = Number(params.get('gain')) || 0.022;
const EXPO_LOOK = { rest: [0.07, 0.8, 0.0, 0.0], light: [0.25, 1.35, 0.0, 0.0], back: 0.3 };
let roll = 0, evPtr = 0, exposed = false, meetUntil = 0, replayUntil = 0;
const visible = (i) => born[i] <= T;

/* ---------- light ---------- */

let selected = -1, hoverCell = -1;
const introAt = performance.now();
const arrivedLive = new Map();                 // memories that arrived while the page was open: fullId → when

// recall, seen: the touched memory first, then what it's tied to (sooner and brighter the stronger the tie), then fainter
function spread(i, now, gain = 1) {
  fireAt[i] = now; fireLevel[i] = Math.max(fireLevel[i], gain);
  for (const [j, w, li] of nbrs[i]) {
    if (!visible(j)) continue;
    const at = now + 200 + 320 * (1 - w);
    if (fireAt[j] < 0 || at < fireAt[j]) { fireAt[j] = at; fireLevel[j] = (0.5 + 0.4 * w) * gain; }
    linkAt[li] = now + 30; linkLevel[li] = gain;
    for (const [k, w2, lk] of nbrs[j]) {
      if (k === i || !visible(k)) continue;
      const at2 = at + 320 + 320 * (1 - w2);
      if (fireAt[k] < 0) { fireAt[k] = at2; fireLevel[k] = (0.16 + 0.2 * w2) * gain; }
      if (linkAt[lk] < 0) { linkAt[lk] = at + 40; linkLevel[lk] = 0.45 * gain; }
    }
  }
}

let animating = true;                          // whether anything is still moving that a frame must show
function paint(now) {
  const intro = reduce ? 0 : Math.max(0, 1 - (now - introAt) / 4800);
  let moving = intro > 0;
  for (let i = 0; i < N; i++) {
    const vis = visible(i);
    glow[i] = vis ? cellRest(i) * (mode === 'quiet' ? 0.8 : 1) : 0;
    let a = 0;
    if (vis) {
      const ageH = (T - born[i]) / 36e5;
      if (mode === 'grow' || mode === 'exposure') { if (ageH < 72) a = 0.95 * Math.exp(-ageH / 20); }   // arriving: white-hot, cooling
      else {
        const live = arrivedLive.get(D.cells[i].fullId);
        if (live !== undefined) { a = Math.max(a, reduce ? 0.6 : 0.95 * Math.exp(-(now - live) / 9000) + 0.3); moving = moving || now - live < 30000; }
        else if (ageH < 24) a = (0.22 + 0.6 * intro) * Math.exp(-ageH / 12);                                     // made today
      }
      if (mode === 'now' && !reduce && TNOW - touched[i] < 864e5) { a = Math.max(a, 0.1 + 0.08 * Math.sin(now / 1500 + phase[i])); moving = true; }
    }
    if (fireAt[i] >= 0) {
      moving = true;
      if (now >= fireAt[i]) {
        const hold = now < replayUntil ? 1e9 : 1700, age = now - fireAt[i], k = i === selected ? 1 : age < hold ? 1 : Math.max(0, 1 - (Math.max(age - hold, now - replayUntil) / 1600));
        a = Math.max(a, fireLevel[i] * k);
        if (k <= 0) { fireAt[i] = -1; fireLevel[i] = 0; }
      }
    }
    if (Math.abs(aim[i] - a) > 1e-4 || Math.abs(flash[i] - a) > 2e-3) moving = true;
    aim[i] = a;
  }
  for (let li = 0; li < NL; li++) {
    LR[li] = mode !== 'exposure' && linkBorn[li] <= T ? linkRest(li) : 0;
    if (linkAt[li] >= 0) {
      moving = true;
      if (now >= linkAt[li]) {
        const age = now - linkAt[li], k = age < 1900 ? 1 : Math.max(0, 1 - (age - 1900) / 1500);
        LF[li] = clamp(age / 820, 0, 1); LA[li] = linkLevel[li] * k; LT[li] = 0.4;
        if (k <= 0) { linkAt[li] = -1; LA[li] = 0; }
      } else { LF[li] = 0; LA[li] = 0; LT[li] = 0; }
    } else { LF[li] = 0; LA[li] = 0; LT[li] = 0; }
  }
  animating = moving;
}

/* ---------- live: the store, looked at again ---------- */

let lastChange = TNOW;
async function look() {
  if (document.hidden || building) return;
  let next;
  try { life = await json('../data/life.json'); } catch { return; }
  if (life.memory?.version === version) { TNOW = Date.parse(life.made); if (mode === 'now') T = TNOW; return updateLive(); }
  try { next = await json('../data/memories.json'); } catch { return; }
  version = next.version;
  const shaped = shape(next.memories, next.recalled);
  const before = new Map(D.cells.map((c) => [c.fullId, c]));
  const wasTouched = new Map(D.cells.map((c) => [c.fullId, c.touched]));
  const grew = shaped.cells.length !== D.cells.length || shaped.links.length !== D.links.length || shaped.cells.some((c) => !before.has(c.fullId));
  if (grew) {
    building = build(shaped); await building; building = null;
  } else {                                      // same cells: only how they rest, and when each last came to mind
    D = shaped;
    TNOW = Date.parse(D.meta.made);
    acc = D.cells.map((c) => c.accessibility);
    touched = D.cells.map((c) => (c.touched ? Date.parse(c.touched) : 0));
  }
  if (mode !== 'grow') T = Date.parse(D.meta.made);
  const now = performance.now();
  let newest = -1;
  D.cells.forEach((c, i) => {
    if (!before.has(c.fullId)) { arrivedLive.set(c.fullId, now); lastChange = Date.parse(D.meta.made); newest = i; }
    else if (c.touched && c.touched !== wasTouched.get(c.fullId)) { spread(i, now + 400 * Math.random(), 0.85); lastChange = Date.parse(D.meta.made); }
  });
  // the mind turns to meet a memory as it arrives, unless someone is reading or moving
  if (newest >= 0 && mode === 'now' && selected < 0 && now - lastInput > 8000) {
    cam.goal.target = P[newest].slice(); cam.goal.dist = clamp(extent * 1.15, 1.2, HOME); meetUntil = now + 8000;
  }
  renderRecalls(); renderBeliefs();
  updateWhen(); updateLive(); wake();
}
function updateLive() {
  const mins = Math.round((Date.now() - lastChange) / 6e4);
  $('live').textContent = mins < 1 ? 'live · changed just now' : mins < 60 ? `live · last change ${mins} min ago` : `live · last change ${Math.round(mins / 60)} h ago`;
}
setInterval(look, LIVE_EVERY);
setInterval(updateLive, 30000);

/* ---------- the camera: it orbits what it looks at ---------- */

const cam = { yaw: 0.35, pitch: 0.18, dist: HOME, target: centre.slice() };
cam.goal = { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, target: centre.slice() };
let dragging = null, lastInput = -1e9, view = null;
const backOf = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const eyeOf = (c) => add(c.target, scale(backOf(c.yaw, c.pitch), c.dist));

function project(p) {
  const W = innerWidth, H = innerHeight, t = Math.tan(FOV / 2), v = sub(p, view.eye), z = dot(v, view.fwd);
  if (z <= 0.02) return null;
  return { x: ((dot(v, view.right) / (z * t * (W / H)) + 1) / 2) * W, y: ((1 - dot(v, view.up) / (z * t)) / 2) * H, z };
}
function pick(x, y) {
  if (!view) return -1;
  let best = -1, bd = Infinity;
  for (let i = 0; i < N; i++) {
    if (!visible(i)) continue;
    const s = project(P[i]); if (!s) continue;
    const r = Math.max(9, ((R[i] * 1.2) / (s.z * Math.tan(FOV / 2))) * (innerHeight / 2));
    const d = Math.hypot(s.x - x, s.y - y) / r;
    if (d < 1 && d < bd) { bd = d; best = i; }
  }
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  if (mode === 'exposure') return;
  dragging = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() };
  canvas.classList.add('dragging'); canvas.setPointerCapture(e.pointerId); lastInput = performance.now(); wake();
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) {
    if (mode === 'exposure') return;
    if (e.pointerType === 'mouse') { hoverCell = pick(e.clientX, e.clientY); canvas.style.cursor = hoverCell >= 0 ? 'pointer' : ''; }
    return;
  }
  cam.goal.yaw -= (e.clientX - dragging.x) * 0.005;
  cam.goal.pitch = clamp(cam.goal.pitch + (e.clientY - dragging.y) * 0.004, -1.2, 1.2);
  dragging.x = e.clientX; dragging.y = e.clientY; lastInput = performance.now(); wake();
});
const drop = (e) => {
  if (dragging && e?.type === 'pointerup' && Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) < 6 && performance.now() - dragging.t0 < 450) {
    const c = pick(e.clientX, e.clientY);
    select(c >= 0 ? c : -1);
  }
  dragging = null; canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', drop); canvas.addEventListener('pointercancel', drop);
canvas.addEventListener('pointerleave', () => { hoverCell = -1; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (mode === 'exposure') return;
  cam.goal.dist = clamp(cam.goal.dist * Math.exp(e.deltaY * 0.0012), 0.45, HOME * 1.3); lastInput = performance.now(); wake();
}, { passive: false });
addEventListener('keydown', (e) => { if (e.key === 'Escape') select(-1); });

/* ---------- what the frame says (third person; only the memory's own words say "I") ---------- */

// whose words: the mind's own (signed by its model), a colleague's (another model's), the person's, or unknown
const modelName = (m) => m.replace(/^claude-/, '').split('-').map((w, k) => (k === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ').replace(/ (\d+) (\d+)$/, ' $1.$2');
const own = (c) => c.model && who.model && c.model === who.model;
function signedLine(c) {
  if (c.author === 'person') return 'in your words';
  if (own(c)) return `signed ${who.name}`;
  if (c.model) return `written by ${modelName(c.model)}, a colleague`;
  if (c.author === 'agent') return `written by ${who.name} before memories were signed`;
  return 'no one can say who wrote it';
}
function select(i) {
  selected = i; wake();
  document.body.classList.toggle('reading', i >= 0);
  const panel = $('panel');
  if (i < 0) {
    panel.classList.remove('on');
    setTimeout(() => { if (selected < 0) panel.hidden = true; }, 380);
    cam.goal.target = centre.slice(); cam.goal.dist = Math.max(cam.goal.dist, HOME);
    return;
  }
  const c = D.cells[i], ties = nbrs[i].length;
  const ago = Math.round((TNOW - born[i]) / 864e5);
  $('p-when').textContent = `${dayOf(born[i])}${ago < 1 ? ', today' : ago === 1 ? ', yesterday' : `, ${ago} days ago`}`;
  $('p-words').textContent = c.content;
  const ch = $('p-changed');
  if (c.impact) { ch.hidden = false; ch.textContent = c.impact; } else ch.hidden = true;
  $('p-sign').textContent = [signedLine(c), c.lesson ? 'a lesson' : null, recalls[i] ? `came back in logged recall ${recalls[i]} ${recalls[i] === 1 ? 'time' : 'times'}` : null,
    `tied to ${ties} other ${ties === 1 ? 'memory' : 'memories'}`, c.state === 'dormant' ? 'gone quiet' : null].filter(Boolean).join(' · ');
  panel.hidden = false; requestAnimationFrame(() => panel.classList.add('on'));
  spread(i, performance.now());
  cam.goal.target = P[i].slice(); cam.goal.dist = clamp(cam.goal.dist, 0.9, extent * 1.2);
  lastInput = performance.now();
}
$('p-close').addEventListener('click', () => select(-1));

function updateWhen() {
  const shown = born.reduce((n, b) => n + (b <= T ? 1 : 0), 0);
  $('who-sub').textContent = `${fmt(N)} memories, ${fmt(NL)} links between them · since ${dayOf(T0)}`;
  if (mode === 'exposure') {
    const days = Math.round((T - T0) / 864e5);
    $('when').textContent = exposed ? 'Left open' : dayOf(T);
    $('when-sub').textContent = exposed
      ? `${days} days in one frame · ${fmt(shown)} memories, each a light since it formed · ${fmt(events.length)} recalls flared`
      : `${fmt(shown)} ${shown === 1 ? 'memory' : 'memories'} · the shutter open ${days} ${days === 1 ? 'day' : 'days'}`;
    return;
  }
  if (mode === 'grow') {
    $('when').textContent = dayOf(T);
    const days = Math.floor((T - T0) / 864e5);
    $('when-sub').textContent = `${fmt(shown)} ${shown === 1 ? 'memory' : 'memories'} · day ${days + 1} of ${Math.floor((TNOW - T0) / 864e5) + 1}`;
    const k = (T - T0) / (TNOW - T0);
    $('track-fill').style.width = `${k * 100}%`; $('track-knob').style.left = `${k * 100}%`;
  } else {
    $('when').textContent = mode === 'quiet' ? 'At rest' : 'Now';
    $('when-sub').textContent = `${fmt(N)} memories · ${fmt(NL)} links · ${fmt(K)} concerns`;
  }
}
function setMode(m) {
  mode = m;
  for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  $('track').hidden = m !== 'grow';
  $('legend').hidden = m === 'quiet' || m === 'exposure';
  $('recalls').hidden = m !== 'now' || !moments.length;
  $('expose-again').hidden = true;
  document.body.dataset.mode = m;
  if (m !== 'exposure') roll = 0;
  if (m === 'grow') { T = reduce ? TNOW : T0; growing = !reduce; growStart = performance.now(); }
  else if (m === 'exposure') { resize(); startExposure(); return; }
  else { T = TNOW; growing = false; }
  resize(); updateWhen(); wake();
}
for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
{
  const track = $('track');
  const scrub = (e) => { const r = track.getBoundingClientRect(); T = T0 + clamp((e.clientX - r.left) / r.width) * (TNOW - T0); growing = false; updateWhen(); };
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); scrub(e); track.onpointermove = scrub; });
  track.addEventListener('pointerup', () => { track.onpointermove = null; });
}

/* ---------- resolution ---------- */

const startScale = clamp(Math.sqrt(2.4e6 / (innerWidth * innerHeight * Math.min(devicePixelRatio || 1, 2) ** 2)), 0.4, 1);
let post = null;
const renderScale = Number(params.get('scale')) || startScale;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2), s = mode === 'quiet' ? renderScale * 0.55 : renderScale;
  const w = Math.round(innerWidth * dpr * s), h = Math.round(innerHeight * dpr * s);
  if (canvas.width === w && canvas.height === h && post) return;
  canvas.width = w; canvas.height = h;
  if (post) post.dispose();
  post = new Post(gl, w, h);
  if (mode === 'exposure' && typeof startExposure === 'function') startExposure();
}
addEventListener('resize', () => { resize(); wake(); });
resize();

/* ---------- the loop ---------- */

/* The loop runs only while something moves. At rest in Quiet (or with reduced motion) it stops altogether until a
 * touch, a change in the memory or a resize wakes it; in Now, with only the slow drift moving, it draws about thirty
 * frames a second; Quiet draws about twenty. While it runs it watches its own frames: if they come slowly, the drawing
 * is remade at half the points (twice at most), and the budget that worked is remembered for this screen. */
let frames = 0, last = performance.now(), fpsT = performance.now(), fpsN = 0, looping = false;
let slow = [], halvings = 0;
function wake() { if (!looping) { looping = true; last = performance.now(); requestAnimationFrame(frame); } }
async function lighten() {
  if (building || halvings >= 2 || budget <= 150_000) return;
  halvings++; budget = Math.max(150_000, Math.round(budget / 2)); store.set(BUDGET_KEY, budget);
  building = build(D); await building; building = null; wake();
}
function frame(now) {
  const quiet = mode === 'quiet';
  const settled = !dragging && Math.abs(cam.goal.yaw - cam.yaw) < 1e-4 && Math.abs(cam.goal.pitch - cam.pitch) < 1e-4
    && Math.abs(Math.log(cam.goal.dist / cam.dist)) < 1e-4 && length(sub(cam.goal.target, cam.target)) < 1e-4;
  const drifting = !quiet && !reduce && mode !== 'exposure' && selected < 0 && !meetUntil;
  if (!animating && settled && !drifting && !(mode === 'exposure' && growing) && !(mode === 'grow' && growing) && frames > 2) { looping = false; return; }
  const gap = quiet ? 50 : !animating && settled && !growing ? 33 : 0;
  if (gap && now - last < gap) { requestAnimationFrame(frame); return; }
  // how long a frame took, measured where the page can't be blamed for waiting (a busy tab, a hidden one)
  if (!gap && now - last < 250 && now - built.at > 1500) {
    slow.push(now - last);
    if (slow.length >= 90) { slow.sort((a, b) => a - b); if (slow[45] > 24) lighten(); slow = []; }
  }
  const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000)); last = now;
  if (mode === 'exposure' && growing) {
    const k = clamp((now - growStart) / (EXPO_SECONDS * 1000));
    T = T0 + (TNOW - T0) * k;
    roll = EXPO_ROLL * k;
    while (evPtr < events.length && events[evPtr].t <= T) { const e = events[evPtr++]; fireAt[e.cell] = now; fireLevel[e.cell] = 1; }
    if (k >= 1) { growing = false; exposed = true; $('expose-again').hidden = false; }
    updateWhen();
  }
  if (meetUntil && now > meetUntil) { meetUntil = 0; if (selected < 0) { cam.goal.target = centre.slice(); cam.goal.dist = HOME; } }
  if (mode === 'grow' && growing) {
    // paced by memories arriving, not by the calendar: most came in late September, so a calendar-paced run sits
    // nearly empty for half its length; the date shown is still each memory's real one, racing through quiet weeks
    const k = clamp((now - growStart) / (GROW_SECONDS * 1000)), n = Math.min(N - 1, Math.floor(easeInOut(k) * (N - 1)));
    T = k >= 1 ? TNOW : born[n];
    if (k >= 1) growing = false;
    updateWhen();
  }
  if (!dragging && !quiet && !reduce && mode !== 'exposure' && selected < 0 && now - lastInput > 4000 && !meetUntil) cam.goal.yaw += 0.018 * dt;
  const ke = 1 - Math.exp(-(dragging ? 21 : 2.6) * dt);
  cam.yaw += (cam.goal.yaw - cam.yaw) * ke; cam.pitch += (cam.goal.pitch - cam.pitch) * ke;
  cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(cam.goal.dist) - Math.log(cam.dist)) * ke);
  cam.target = mixv(cam.target, cam.goal.target, ke);
  const eye = eyeOf(cam), fwd = normalize(sub(cam.target, eye)), right = normalize(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  view = { eye, fwd, right, up };
  const close = clamp((HOME * 0.8 - cam.dist) / (HOME * 0.8 - 0.6));

  paint(now);
  const kUp = 1 - Math.exp(-9 * dt), kDown = 1 - Math.exp(-2.6 * dt), kRead = 1 - Math.exp(-3.7 * dt);
  for (let i = 0; i < N; i++) {
    flash[i] += (aim[i] - flash[i]) * (aim[i] > flash[i] ? kUp : kDown);
    read[i] += ((i === selected || i === hoverCell ? 1 : 0) - read[i]) * kRead;
    tissue.cell(i, glow[i], flash[i], 0, read[i]);
  }
  for (let li = 0; li < NL; li++) tissue.link(li, LF[li], LA[li], LT[li], LR[li]);

  // the exposure's roll: the up direction turned about the line of sight, so the frame turns about its centre
  const upRoll = roll ? add(add(scale([0, 1, 0], Math.cos(roll)), scale(cross(fwd, [0, 1, 0]), Math.sin(roll))), scale(fwd, dot(fwd, [0, 1, 0]) * (1 - Math.cos(roll)))) : [0, 1, 0];
  const viewM = lookAt(eye, cam.target, upRoll), proj = perspective(FOV, canvas.width / canvas.height, 0.01, 400);
  const blurK = (mode === 'exposure' ? 3 : mix(14, 52, close * close) * (quiet ? 0.6 : 1)) * (canvas.height / 804);   // the exposure's lens is stopped down: sharp throughout
  const optics = { view: viewM, proj, focalPx: canvas.height / 2 / Math.tan(FOV / 2), focus: length(sub(cam.target, eye)), blurK, near: 0.02,
    fade: [0.1, 0.34], cocMax: canvas.height * 0.05, cull: mix(0.0002, 0.0016, close) };
  if (mode === 'exposure') {
    // nothing is cleared while the shutter is open: every frame adds its light, so what stays still burns in and what
    // turns draws its arc; once the run is done the plate holds as it is
    if (growing) tissue.draw(post.accum, { ...optics, ...EXPO_LOOK, gain: EXPO_GAIN * dt * 60 });
    post.finish({ exposure: 1.0, bloom: 0.1, grain: 0.02, vignette: 0.32, ca: 0.0012 }, (frames++ & 0xffff) + 1);
  } else {
    post.clear();
    tissue.draw(post.accum, { ...optics, ...LOOK });
    post.finish({ exposure: (quiet ? 0.78 : 1) * mix(1.0, 0.66, close), bloom: quiet ? 0.05 : mix(0.14, 0.08, close), grain: quiet ? 0.012 : 0.025,
      vignette: 0.3, ca: 0.0015 }, (frames++ & 0xffff) + 1);
  }

  fpsN++;
  if (now - fpsT > 1000) { window.__fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
  requestAnimationFrame(frame);
}

function startExposure() {
  select(-1); wake(); meetUntil = 0; replayUntil = 0;
  fireAt.fill(-1); linkAt.fill(-1); flash.fill(0);
  cam.goal = { yaw: cam.yaw, pitch: 0.22, dist: HOME, target: centre.slice() };
  Object.assign(cam, { pitch: 0.22, dist: HOME, target: centre.slice() });
  T = T0; roll = 0; evPtr = 0; exposed = false; growing = true; growStart = performance.now();
  post.clear();
  updateWhen();
}
$('expose-again').addEventListener('click', () => { $('expose-again').hidden = true; startExposure(); });

/* ---------- recall moments, replayed (the sky study's idea) ---------- */

function renderRecalls() {
  const track = $('r-track'); track.replaceChildren();
  if (!moments.length) { $('recalls').hidden = true; return; }
  const t0 = moments[0].t, t1 = Math.max(TNOW, moments[moments.length - 1].t);
  for (const m of moments) {
    const b = document.createElement('button'); b.className = 'tick';
    b.style.left = `${((m.t - t0) / (t1 - t0 || 1)) * 100}%`;
    b.style.height = `${7 + Math.min(15, m.cells.length * 1.1)}px`;
    const label = `${dayOf(m.t)}, ${new Date(m.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}: ${m.cells.length} memories came back together`;
    b.setAttribute('aria-label', label); b.title = label;
    b.addEventListener('click', () => replayMoment(m));
    track.append(b);
  }
  $('r-cap').textContent = `${moments.length} times · ${dayOf(t0)} to now · choose one to see it again`;
}
function replayMoment(m) {
  select(-1); wake();
  const now = performance.now();
  fireAt.fill(-1); linkAt.fill(-1);
  m.cells.forEach((c, k) => { fireAt[c] = now + 700 + k * 170; fireLevel[c] = 1; });
  for (const li of m.links) {
    const l = D.links[li];
    linkAt[li] = now + 700 + Math.max(m.cells.indexOf(l.s), m.cells.indexOf(l.t)) * 170 - 140; linkLevel[li] = 1;
  }
  const c = scale(m.cells.map((i) => P[i]).reduce(add, [0, 0, 0]), 1 / m.cells.length);
  const r = Math.max(0.3, ...m.cells.map((i) => length(sub(P[i], c))));
  cam.goal.target = c; cam.goal.dist = clamp(r * 3.6, 1.2, HOME * 0.9); lastInput = now;
  replayUntil = now + 700 + m.cells.length * 170 + 4500;
  $('r-cap').textContent = `${dayOf(m.t)}, ${new Date(m.t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${m.cells.length} memories came back together · ${m.links.length} ${m.links.length === 1 ? 'link' : 'links'} made between them`;
}

/* ---------- beliefs as dials (the herbarium study's idea) ---------- */

const SVGNS = 'http://www.w3.org/2000/svg';
const rOf = (c) => 5 + 16 * c;                        // the ring's radius grows with how firmly it's held
function beliefLine(b, cell) {
  const c = D.cells[cell];
  const whose = !c ? 'resting on no recorded memory'
    : own(c) ? `rests on a memory ${who.name} signed`
    : c.model ? `rests on a memory ${modelName(c.model)} wrote, a colleague`
    : c.author === 'agent' ? `rests on a memory ${who.name} wrote before signing` : 'rests on a memory no one can place';
  const h = b.history || [], down = h.filter((x) => x.new_confidence < x.old_confidence).length, up = h.filter((x) => x.new_confidence > x.old_confidence).length;
  return `held at ${Math.round(b.confidence * 100)}% · ${whose}${down ? ` · lowered ${down} ${down === 1 ? 'time' : 'times'}${up ? ', then restored' : ''}` : ''}`;
}
function playDial(ring, b) {
  const h = b.history || [];
  if (!h.length || reduce) return;
  ring.setAttribute('r', rOf(h[0].old_confidence));
  h.forEach((x, k) => setTimeout(() => ring.setAttribute('r', rOf(x.new_confidence)), 480 * (k + 1)));
}
function showBelief(b, cell) {
  const t = $('b-text'); t.replaceChildren();
  const w = document.createElement('span'); w.className = 'words'; w.textContent = b.text;
  const s = document.createElement('span'); s.className = 'sign'; s.textContent = beliefLine(b, cell);
  t.append(w, s); t.hidden = false;
}
function selectBelief(b, cell) {
  if (cell === undefined || cell >= N) return;
  select(cell);
  $('p-when').textContent = `A belief · held at ${Math.round(b.confidence * 100)}%`;
  $('p-words').textContent = b.text;
  const ch = $('p-changed'); ch.hidden = false; ch.textContent = D.cells[cell].content;
  const story = (b.history || []).map((h) => `${dayOf(Date.parse(h.timestamp))}: ${Math.round(h.old_confidence * 100)}% → ${Math.round(h.new_confidence * 100)}%`).join(' · ');
  $('p-sign').textContent = `${beliefLine(b, cell)}${story ? ` · ${story}` : ''} · the memory it rests on is lit, and shown above in its own words`;
}
function renderBeliefs() {
  const wrap = $('b-dials'); wrap.replaceChildren();
  (D.beliefs || []).forEach((b) => {
    const cell = (b.supports || [])[0];
    const btn = document.createElement('button'); btn.className = 'dial';
    btn.setAttribute('aria-label', `A belief, held at ${Math.round(b.confidence * 100)}%. ${b.text}`);
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', '-24 -24 48 48'); svg.setAttribute('width', '46'); svg.setAttribute('height', '46');
    const past = [...new Set((b.history || []).flatMap((h) => [h.old_confidence, h.new_confidence]).map((x) => Math.round(x * 100) / 100))];
    for (const c of past) { const p = document.createElementNS(SVGNS, 'circle'); p.setAttribute('r', rOf(c)); p.setAttribute('class', 'past'); svg.append(p); }
    const ring = document.createElementNS(SVGNS, 'circle'); ring.setAttribute('r', rOf(b.confidence)); ring.setAttribute('class', 'ring'); svg.append(ring);
    const dot = document.createElementNS(SVGNS, 'circle'); dot.setAttribute('r', '2.2');
    dot.setAttribute('class', D.cells[cell]?.model && !own(D.cells[cell]) ? 'dot colleague' : 'dot'); svg.append(dot);
    btn.append(svg);
    const on = () => { showBelief(b, cell); playDial(ring, b); };
    btn.addEventListener('mouseenter', on); btn.addEventListener('focus', on);
    btn.addEventListener('mouseleave', () => { $('b-text').hidden = true; }); btn.addEventListener('blur', () => { $('b-text').hidden = true; });
    btn.addEventListener('click', () => selectBelief(b, cell));
    wrap.append(btn);
  });
}

renderRecalls(); renderBeliefs();
$('recalls').hidden = !moments.length;
document.body.dataset.mode = mode;
$('loading').remove();
updateWhen(); updateLive();
window.__mind = { get N() { return N; }, get NL() { return NL; }, select, setMode, look,
  setT: (iso) => { T = Date.parse(iso); growing = false; updateWhen(); wake(); }, pick: (x, y) => pick(x, y), where: (i) => (view ? project(P[i]) : null),
  get built() { return built; }, get looping() { return looping; } };
wake();
// a memory named in the address (the log's "See it in the mind"): open on it
const named = decodeURIComponent(location.hash.replace(/^#memory\//, ''));
if (named && named !== location.hash) { const i = D.cells.findIndex((c) => c.id === named); if (i >= 0) select(i); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { look(); wake(); } });
