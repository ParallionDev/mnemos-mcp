/* A memory up close, as the herbarium engraves it.
 *
 * From across the room a memory is a cell of light in the mind. Opened, it's pressed: drawn the way a natural-history
 * plate draws a one-celled animal, where every part is a measure (./herbarium/specimen.js says which). Its size is how
 * strongly it's kept; round, it's a lesson, and a drop is an experience, its front toward what it became; a spine for
 * each link, as long as the link is strong, barred where it supports and barbed where it contradicts; a ring for each
 * doubling of the times it came back; the threads around it as long as it's easy to reach; dashed, gone quiet.
 *
 * It's shown in the reading room, where the memory's life is drawn whole (./herbarium/figure.js): what it was
 * distilled from and what it was distilled into, in the order they were kept, with the one you opened in full ink.
 * (Laid over the living mind itself, a flat engraving read as pasted on; it belongs beside the mind, not on it.) */

import { composeFamily, drawFamily, pickFamily } from './herbarium/figure.js';

/* the ink and paper come from the page, so the plate is drawn for the look it's on (room.css: --fig-*) */
const figureColors = (el) => {
  const s = getComputedStyle(el), v = (k) => s.getPropertyValue(k).trim();
  return { ink: v('--fig-ink').split(',').map(Number), paper: v('--fig-paper'), signal: v('--fig-signal') };
};
const MOST_SPINES = 64;                       // a memory tied to hundreds is drawn with its strongest; the words say how many
const MOST_KIN = 7;                           // a life drawn in the room: the memory and the nearest six of its family
const ENGRAVE = 1100;                         // ms for a specimen to engrave itself, experience first
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- the memory as the herbarium reads it ---------- */

let read = null;
export function herbariumOf(mems) {
  if (read && read.mems === mems) return read.model;
  const index = new Map(mems.map((m, i) => [m.id, i]));
  const cells = mems.map((m, i) => ({ id: m.id, i, lesson: m.lesson === true, strength: m.strength ?? 0.5, stability: m.stability ?? 0.5,
    accessibility: m.acc ?? 0, accessCount: m.recalls || 0, state: m.state, bornT: Date.parse(m.born), inc: [], links: 0 }));
  mems.forEach((m, s) => {
    for (const [tid, rel, w, born, , out] of m.ties) {
      const t = index.get(tid);
      if (t === undefined || (out === undefined ? s > t : !out)) continue;      // each link once, from its sender
      const l = { li: 0, s, t, rel, w, bornT: Date.parse(born) };
      cells[s].inc.push(l); cells[t].inc.push(l);
    }
  });
  let li = 0;
  for (const c of cells) {
    c.links = c.inc.length;
    if (c.inc.length > MOST_SPINES) c.inc = c.inc.slice().sort((a, b) => (b.rel === 'distilled_into') - (a.rel === 'distilled_into') || b.w - a.w).slice(0, MOST_SPINES);
  }
  for (const c of cells) for (const l of c.inc) if (!l.li) l.li = ++li;
  const model = { cells, index };
  read = { mems, model };
  return model;
}

/* its life: what it was distilled from and into, nearest first, and the generations they make */
export function lifeOf(model, i) {
  const seen = new Set([i]), queue = [i];
  while (queue.length && seen.size < MOST_KIN) {
    const n = queue.shift();
    for (const l of model.cells[n].inc) {
      if (l.rel !== 'distilled_into') continue;
      const o = l.s === n ? l.t : l.s;
      if (!seen.has(o) && seen.size < MOST_KIN) { seen.add(o); queue.push(o); }
    }
  }
  const nodes = [...seen], pairs = [];
  for (const n of nodes) for (const l of model.cells[n].inc) if (l.rel === 'distilled_into' && l.s === n && seen.has(l.t)) pairs.push({ pi: pairs.length, a: l.s, b: l.t, link: l });
  const gen = new Map(nodes.map((n) => [n, 0]));
  for (let k = 0; k < nodes.length; k++) for (const p of pairs) gen.set(p.b, Math.max(gen.get(p.b), gen.get(p.a) + 1));
  return { nodes, pairs, gen, depth: Math.max(...gen.values()) + 1 };
}

const plural = (n, one, many) => `${n === 1 ? 'one' : n} ${n === 1 ? one : many}`;
/* what the figure shows, said plainly under it */
export function lifeWords(model, i, life) {
  const from = life.pairs.filter((p) => p.b === i).length, into = life.pairs.filter((p) => p.a === i).length;
  const c = model.cells[i], parts = [c.lesson ? 'A lesson' : 'An experience'];
  if (from) parts.push(`kept from ${plural(from, 'experience', 'experiences')}`);
  if (into) parts.push(`${from ? 'and ' : ''}kept again as ${plural(into, 'lesson', 'lessons')}`);
  if (!from && !into) parts.push(c.links ? `with ${plural(c.links, 'link', 'links')}` : 'tied to nothing yet');
  return parts.join(', ');
}

/* ---------- in the reading room: the life, engraved once ---------- */

const engraved = new Set();                   // a life already engraved isn't engraved again when the room redraws
export function mountLife(canvas, model, i, { open } = {}) {
  const life = lifeOf(model, i);
  const box = canvas.parentElement.getBoundingClientRect();
  const w = Math.round(box.width), h = life.nodes.length > 1 ? 250 : 230;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d'), colors = figureColors(canvas);
  const fig = composeFamily(model, life, { w, h }, { kMax: life.nodes.length > 1 ? 64 : 58, pad: 14 });
  let hover = null, start = engraved.has(model.cells[i].id) || reduce ? -1e9 : performance.now(), raf = 0;
  engraved.add(model.cells[i].id);
  const draw = (now) => {
    const progress = Math.min(1, (now - start) / ENGRAVE);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    drawFamily(ctx, fig, { ...colors, t: 0, progress, hover: hover ?? i });
    raf = progress < 1 && canvas.isConnected ? requestAnimationFrame(draw) : 0;
  };
  draw(performance.now());
  if (life.nodes.length < 2) return;
  // the others in its life open from the figure
  const at = (e) => { const r = canvas.getBoundingClientRect(); return pickFamily(fig, e.clientX - r.left, e.clientY - r.top).body; };
  canvas.addEventListener('pointermove', (e) => {
    const n = at(e), next = n != null && n !== i ? n : null;
    canvas.style.cursor = next != null ? 'pointer' : '';
    if (next !== hover) { hover = next; if (!raf) draw(performance.now()); }
  });
  canvas.addEventListener('pointerleave', () => { if (hover != null) { hover = null; if (!raf) draw(performance.now()); } });
  canvas.addEventListener('click', (e) => { const n = at(e); if (n != null && n !== i) open?.(model.cells[n].id); });
}
