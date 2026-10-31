/* The mind, built off the page: where each memory sits, and the light that draws it, made in a worker so the page
 * never stops to wait. One worker makes one build and is then let go, and the millions of small objects the anatomy
 * makes go with it; only the packed buffer comes back, handed over rather than copied.
 *
 * Where each memory sits is the shape of what the mind has connected (What Lights Up's layout, first made in Python
 * with numpy for the log's first study): its concerns found as communities of the link graph, placed as lobes by how
 * much they share, then every memory inside its lobe, links pulling, memories pushing apart, the ones it keeps
 * coming back to drawn to the heart of their lobe. Mnemos ships no numpy, so it's made here: the same forces, with
 * memories pushing only within their own lobe (from another lobe the push is too faint to move anything), which is
 * what lets it run on a mind of thousands in a second or two. A mind keeps its shape while it grows: the places the
 * page remembers stay, and a new memory settles beside the ones it's tied to.
 *
 * How much light draws it is a budget, not a constant: a body's membrane, its nucleus, its arbour and each fibre are
 * made of points, and at full detail a mind of two thousand memories is eleven million of them, far more than any
 * screen shows. The page asks for a number of points it can draw smoothly; the detail is set to land near it. */

import { anatomy } from '../engine/anatomy.js';
import { pack } from '../engine/tissue.js';
import { random } from '../engine/gl.js';

const INK = { skin: [0.42, 0.5, 1.0], nucleus: [0.7, 0.78, 1.0], dendrite: [0.36, 0.44, 1.0], fibre: [0.34, 0.4, 0.95], bouton: [0.5, 0.56, 1.0] };
const inkOf = (l) => [INK.skin, INK.nucleus, INK.dendrite, INK.fibre, INK.bouton][l.part];
const PACK = 0.34;                                   // drawn closer than laid out, so arbours and fibres meet as in tissue
// points at detail 1, measured on two real minds (2,097 memories and 10,825 links; 3,124 and 22,556): a memory's
// body and arbour, and a fibre per link
const POINTS_PER_MEMORY = 1583, POINTS_PER_LINK = 733;

/* ---------- its concerns: Louvain communities, a fading memory's tie to its lesson counting triple ---------- */

function communities(n, links, seed = 3) {
  const rnd = random(seed);
  // the graph as weighted adjacency; each pass works on the graph of the communities the last pass found
  let adj = Array.from({ length: n }, () => new Map());
  for (const l of links) {
    const w = l.w * (l.rel === 'distilled_into' ? 3 : 1);
    if (l.s === l.t) continue;
    adj[l.s].set(l.t, (adj[l.s].get(l.t) || 0) + w);
    adj[l.t].set(l.s, (adj[l.t].get(l.s) || 0) + w);
  }
  let member = Array.from({ length: n }, (_, i) => i);          // each original node's community
  for (let level = 0; level < 8; level++) {
    const m = adj.length, deg = adj.map((a) => { let d = 0; for (const w of a.values()) d += w; return d; });
    const self = adj.map((a, i) => a.get(i) || 0);
    const total = deg.reduce((a, b) => a + b, 0) || 1;
    const of = Array.from({ length: m }, (_, i) => i), tot = deg.slice();
    const order = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let moved = true, rounds = 0, any = false;
    while (moved && rounds++ < 20) {
      moved = false;
      for (const i of order) {
        const home = of[i], ki = deg[i];
        const to = new Map();
        for (const [j, w] of adj[i]) if (j !== i) to.set(of[j], (to.get(of[j]) || 0) + w);
        tot[home] -= ki;
        let best = home, gain = (to.get(home) || 0) - (tot[home] * ki) / total;
        for (const [c, w] of to) {
          const g = w - (tot[c] * ki) / total;
          if (g > gain + 1e-12) { gain = g; best = c; }
        }
        tot[best] += ki;
        if (best !== home) { of[i] = best; moved = true; any = true; }
      }
    }
    if (!any) break;
    // renumber, fold the graph into its communities, and carry the original nodes along
    const ids = new Map(); for (const c of of) if (!ids.has(c)) ids.set(c, ids.size);
    const next = Array.from({ length: ids.size }, () => new Map());
    for (let i = 0; i < m; i++) {
      const a = ids.get(of[i]);
      if (self[i]) next[a].set(a, (next[a].get(a) || 0) + self[i]);
      for (const [j, w] of adj[i]) if (j !== i) { const b = ids.get(of[j]); next[a].set(b, (next[a].get(b) || 0) + w); }
    }
    member = member.map((c) => ids.get(of[c]));
    adj = next;
    if (ids.size === m) break;
  }
  // largest concern first, as the first layout numbered them
  const size = new Map(); for (const c of member) size.set(c, (size.get(c) || 0) + 1);
  const rank = new Map([...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c], k) => [c, k]));
  return member.map((c) => rank.get(c));
}

/* ---------- forces: everything pushes apart within its group, links pull, the cooling step shrinks ---------- */

function forces(P, groups, links, iters, { k = 1, home = null, pullHome = null, gravity = 0.02, rnd }) {
  const n = P.length / 3, F = new Float64Array(n * 3);
  for (let it = 0; it < iters; it++) {
    F.fill(0);
    for (const g of groups) {
      for (let a = 0; a < g.length; a++) {
        const i = g[a] * 3;
        for (let b = a + 1; b < g.length; b++) {
          const j = g[b] * 3;
          let dx = P[i] - P[j], dy = P[i + 1] - P[j + 1], dz = P[i + 2] - P[j + 2];
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1e-9) { dx = rnd() - 0.5; dy = rnd() - 0.5; dz = rnd() - 0.5; d2 = 1e-3; }
          const d = Math.sqrt(d2), f = (k * k) / d2 / d;
          F[i] += dx * f; F[i + 1] += dy * f; F[i + 2] += dz * f;
          F[j] -= dx * f; F[j + 1] -= dy * f; F[j + 2] -= dz * f;
        }
      }
    }
    for (const [s, t, w] of links) {
      const i = s * 3, j = t * 3, dx = P[i] - P[j], dy = P[i + 1] - P[j + 1], dz = P[i + 2] - P[j + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9, f = (0.6 * w * d) / k / d;
      F[i] -= dx * f; F[i + 1] -= dy * f; F[i + 2] -= dz * f;
      F[j] += dx * f; F[j + 1] += dy * f; F[j + 2] += dz * f;
    }
    const cool = 0.12 * (1 - it / iters) + 0.004;
    for (let i = 0; i < n; i++) {
      const q = i * 3;
      const g = typeof gravity === 'number' ? gravity : gravity[i];
      let fx = F[q] - g * P[q], fy = F[q + 1] - g * P[q + 1], fz = F[q + 2] - g * P[q + 2];
      if (home) { const h = pullHome[i]; fx += h * (home[q] - P[q]); fy += h * (home[q + 1] - P[q + 1]); fz += h * (home[q + 2] - P[q + 2]); }
      const step = Math.sqrt(fx * fx + fy * fy + fz * fz) + 1e-9, s = Math.min(step, cool) / step;
      P[q] += fx * s; P[q + 1] += fy * s; P[q + 2] += fz * s;
    }
  }
  return P;
}

function layout(cells, links, comm, { seed = 7, together = 0.15, core = 0.5, lobes = 0.3 } = {}) {
  const rnd = random(seed), normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const n = cells.length, K = Math.max(0, ...comm) + 1;
  // the lobes, placed by how much their memories share
  const C = Array.from({ length: K }, () => new Float64Array(K));
  let cMax = 0;
  for (const l of links) {
    const a = comm[l.s], b = comm[l.t];
    if (a !== b) { C[a][b] += l.w; C[b][a] += l.w; cMax = Math.max(cMax, C[a][b]); }
  }
  const lobeLinks = [];
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    // a concern that shares nothing with the others still belongs to the same mind, or it drifts off and the whole
    // mind has to shrink to keep it in frame
    const w = (C[a][b] / (cMax || 1) + together) * 0.35;
    if (w > 0) lobeLinks.push([a, b, w]);
  }
  const Q = new Float64Array(K * 3).map(() => normal() * 2);
  forces(Q, [Array.from({ length: K }, (_, i) => i)], lobeLinks, 600, { k: 2.6, gravity: 0.01, rnd });
  // wider than tall, like the frame it lives in; and the lobes drawn in toward one another, so they read as one mind
  for (let a = 0; a < K; a++) { Q[a * 3] *= 1.35 * lobes; Q[a * 3 + 1] *= 0.8 * lobes; Q[a * 3 + 2] *= lobes; }
  // the memories, each in its lobe
  let wMax = 0;
  const memLinks = links.map((l) => {
    const w = l.w * (l.rel === 'distilled_into' ? 3 : 1) * (comm[l.s] === comm[l.t] ? 1 : 0.12);
    wMax = Math.max(wMax, w);
    return [l.s, l.t, w];
  });
  for (const l of memLinks) l[2] /= wMax || 1;
  const home = new Float64Array(n * 3), P = new Float64Array(n * 3), pullHome = new Float64Array(n), heart = new Float64Array(n);
  const rMax = Math.log1p(Math.max(1, ...cells.map((c) => c.recalls || 0)));
  const groups = Array.from({ length: K }, () => []);
  cells.forEach((c, i) => {
    const q = comm[i] * 3;
    for (let d = 0; d < 3; d++) { home[i * 3 + d] = Q[q + d]; P[i * 3 + d] = Q[q + d] + normal() * 0.8; }
    const often = Math.log1p(c.recalls || 0) / rMax;
    pullHome[i] = 0.05 + 0.25 * often;
    // the heart of the whole mind: what comes back most sits at its centre, what it rarely reaches drifts outward
    heart[i] = core * (0.15 + 0.85 * Math.max(often, c.acc || 0));
    groups[comm[i]].push(i);
  });
  // a larger mind settles in fewer passes: the shape is there long before the last of them, and the first visit waits
  forces(P, groups, memLinks, Math.round(Math.max(400, Math.min(900, 900 * 2000 / Math.max(1, n)))), { k: 0.55, home, pullHome, gravity: heart, rnd });
  // centred, and scaled so nearest neighbours sit about 0.9 apart: room for an arbour
  const mid = [0, 1, 2].map((d) => { let s = 0; for (let i = 0; i < n; i++) s += P[i * 3 + d]; return s / n; });
  for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) P[i * 3 + d] -= mid[d];
  const nearest = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < nearest[i]) nearest[i] = d;
    if (d < nearest[j]) nearest[j] = d;
  }
  const sorted = Array.from(nearest).filter(Number.isFinite).sort((a, b) => a - b);
  const median = sorted.length ? sorted[sorted.length >> 1] : 1, s = 0.9 / (median || 1);
  return Array.from({ length: n }, (_, i) => [P[i * 3] * s, P[i * 3 + 1] * s, P[i * 3 + 2] * s]);
}

/* where each memory sits: from the places the page remembers when they cover the mind, else laid out afresh */
function place(cells, links, known, seed, tune = {}) {
  const rnd = random(seed);
  const placed = cells.map((c) => known[c.id] || null);
  const have = placed.filter(Boolean).length;
  if (cells.length && have >= 0.9 * cells.length) {
    const nb = cells.map(() => []);
    for (const l of links) { nb[l.s].push(l.t); nb[l.t].push(l.s); }
    const newest = placed.map((p, i) => (p ? i : -1)).filter((i) => i >= 0).slice(-12);
    let fresh = 0;
    cells.forEach((c, i) => {
      if (placed[i]) return;
      fresh++;
      let near = nb[i].filter((j) => placed[j]);
      if (!near.length) near = newest;
      const mid = [0, 1, 2].map((d) => near.reduce((a, j) => a + placed[j][d], 0) / (near.length || 1));
      const votes = new Map(); for (const j of near) votes.set(placed[j][3], (votes.get(placed[j][3]) || 0) + 1);
      const k = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      placed[i] = [mid[0] + (rnd() - 0.5) * 0.9, mid[1] + (rnd() - 0.5) * 0.9, mid[2] + (rnd() - 0.5) * 0.9, k];
    });
    return { places: placed, fresh, laidOut: false };
  }
  const comm = communities(cells.length, links);
  const P = layout(cells, links, comm, tune);
  return { places: P.map((p, i) => [...p, comm[i]]), fresh: cells.length, laidOut: true };
}

onmessage = ({ data: job }) => {
  try { work(job); } catch (e) { postMessage({ error: `${e.message}\n${e.stack || ''}` }); }
};

function work(job) {
  const t0 = performance.now();
  const { cells, links, known, budget, glyphs, metrics } = job;
  const { places, fresh, laidOut } = place(cells, links, known, job.seed || 7, job.tune || {});
  const tLayout = performance.now() - t0;
  // drawn closer than laid out (the same shape, smaller), around a centre that holds still while the mind grows
  const MID = job.mid || [0, 1, 2].map((d) => places.reduce((a, p) => a + p[d], 0) / (places.length || 1));
  const drawn = cells.map((c, i) => ({ kind: c.lesson ? 'procedural' : 'episodic', strength: c.strength, stability: c.stability,
    p: [0, 1, 2].map((d) => MID[d] + (places[i][d] - MID[d]) * PACK) }));
  const detail = Math.max(0.02, Math.min(1, budget / (POINTS_PER_MEMORY * Math.max(1, cells.length) + POINTS_PER_LINK * links.length)));
  const A = anatomy({ cells: drawn, links }, { detail, reach: 0.75 });
  const glyph = (ch) => glyphs[ch];
  const packed = pack(A.points, glyph, metrics, inkOf);
  const R = new Float32Array(A.cells.length), P = new Float32Array(A.cells.length * 3);
  A.cells.forEach((c, i) => { R[i] = c.R; P.set(c.P, i * 3); });
  postMessage({ data: packed.data, count: packed.count, R, P, places, mid: MID, fresh, laidOut, detail,
    ms: { layout: Math.round(tLayout), total: Math.round(performance.now() - t0) } }, [packed.data.buffer, R.buffer, P.buffer]);
}
