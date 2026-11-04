/* A memory opens in its row.
 *
 * Its words stay on the line they were on, and the rest of the page moves around them: the figure opens above, pushing
 * what's above up; the whole text and what's known about it open below, pushing what's below down. It's the list you
 * were reading, with one row open. The words move only when they have to, so the figure fits above them and some of them
 * are on screen. Riley, after a card, a blur and bokeh: "i think i asked for too much. it should be as minimal as we can
 * make it".
 *
 * One spring for each row opening or closing, carrying its speed, so a row asked back half way through closing just
 * turns round. Each frame sets the heights, then scrolls by whatever keeps the words on their line, so a row closing above
 * and one opening below don't fight. Asked for less motion, it's all simply there. Room writes the words; this only knows
 * the row they open in. */

const still = matchMedia('(prefers-reduced-motion: reduce)');

const STIFF = 240, DAMP = 30, STEP = 1 / 240;
const MARGIN = 16;                            // the least room left above the figure
const SHOWN = 0.34;                           // of the window: at least this much of the words stays on screen

export function makeUnfold({ body, scroller, port, settled, relaid }) {
  const rows = [];                            // every row open, opening or closing; the last is the one in hand
  let raf = 0, last = 0, following = true, focused = null;

  const inHand = () => { const s = rows.at(-1); return s && s.to === 1 ? s : null; };
  const parts = (s) => ({ fig: s.el.querySelector('.specimen'), words: s.el.querySelector('.detail > .words'), rest: s.el.querySelector('.unfold-rest'), detail: s.el.querySelector('.detail') });
  const rowsIn = (id) => [...body.querySelectorAll(`[data-mem="${CSS.escape(id)}"]`)].filter((b) => !b.closest('.unfold'));

  function place(s, row) {
    s.row = row || null;
    s.el.classList.toggle('loose', !row);
    if (row) { row.classList.add('unfolded'); row.after(s.el); } else body.prepend(s.el);
  }
  /* how tall each part is when it's open, and how far the figure's foot is from the words */
  function measure(s) {
    const { fig, words, rest } = parts(s);
    for (const el of [fig, words, rest]) el.style.height = '';
    s.full = { fig: fig.offsetHeight, words: words.offsetHeight, rest: rest.offsetHeight, gap: words.getBoundingClientRect().top - fig.getBoundingClientRect().bottom };
  }
  /* the nearest line to this one that shows the whole figure, and some of the words */
  function nearest(s, y) {
    const { top, bottom } = port();
    const lo = top + MARGIN + s.full.fig + s.full.gap, hi = bottom - Math.min(s.full.words + 24, (bottom - top) * SHOWN);
    return Math.round(Math.max(lo, Math.min(hi, y)));
  }
  function paint(s) {
    const { fig, words, rest } = parts(s), p = Math.max(0, s.p);
    for (const el of [fig, words, rest]) el.style.overflow = 'hidden';
    fig.style.height = `${(s.full.fig * p).toFixed(2)}px`;
    fig.style.opacity = Math.min(1, p * 1.5).toFixed(3);
    words.style.height = `${(s.from + (s.full.words - s.from) * p).toFixed(2)}px`;
    rest.style.height = `${(s.full.rest * p).toFixed(2)}px`;
    rest.style.opacity = Math.max(0, (p - 0.3) / 0.7).toFixed(3);
    s.el.style.setProperty('--open', p.toFixed(3));
  }
  function hold() {
    const s = rows.at(-1);
    if (!s || !following) return;
    scroller().scrollTop += parts(s).words.getBoundingClientRect().top - (s.ya + (s.yb - s.ya) * s.p);
  }
  function finish(s) {
    const hadFocus = s.el.contains(document.activeElement);
    s.el.remove();
    rows.splice(rows.indexOf(s), 1);
    s.row?.classList.remove('unfolded');
    if (hadFocus && s.row?.isConnected) s.row.focus({ preventScroll: true });
  }
  function atRest() {
    raf = 0;
    for (const s of [...rows]) {
      s.p = s.to; s.v = 0;
      if (s.to === 0) { finish(s); continue; }
      paint(s); hold();
      const { fig, words, rest } = parts(s);
      for (const el of [fig, words, rest]) { el.style.height = ''; el.style.opacity = ''; el.style.overflow = ''; }
    }
    scroller().style.overflowAnchor = '';
    settled();
  }
  function tick(now) {
    let left = Math.min(0.25, (now - last) / 1000), moving = false; last = now;
    for (; left > 0; left -= STEP) {
      const dt = Math.min(STEP, left);
      moving = false;
      for (const s of rows) {
        s.v += (STIFF * (s.to - s.p) - DAMP * s.v) * dt;
        s.p += s.v * dt;
        if (Math.abs(s.to - s.p) > 0.002 || Math.abs(s.v) > 0.02) moving = true;
      }
    }
    for (const s of rows) paint(s);
    hold();
    if (moving) raf = requestAnimationFrame(tick); else atRest();
  }
  function run() {
    following = true;
    if (still.matches) { atRest(); return; }
    scroller().style.overflowAnchor = 'none';
    for (const s of rows) paint(s);
    hold();
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  // scrolling while it moves is yours: the words stop holding their line
  for (const ev of ['wheel', 'touchmove']) addEventListener(ev, () => { if (raf) following = false; }, { passive: true });

  // the column changes width with the drawer and the window; the figure is drawn again once it's done
  let waiting = 0, wide = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w === wide) return;
    wide = w;
    clearTimeout(waiting);
    waiting = setTimeout(() => { const s = inHand(); if (s) { s.el.written = null; relaid(); } }, 140);
  }).observe(body);

  return {
    get showing() { return inHand()?.id ?? null; },
    isOpen: () => !!inHand(),
    moving: () => raf !== 0,
    /* the open row comes out while the list is drawn again, and goes back into it after, canvas and all */
    lift() {
      const s = inHand();
      if (!s) return;
      focused = s.el.contains(document.activeElement) ? document.activeElement : null;
      s.el.remove();
    },
    rehome() {
      const s = inHand();
      if (!s) return;
      const found = rowsIn(s.rowOf || s.id);
      place(s, found[Math.min(s.nth, found.length - 1)]);
      focused?.focus({ preventScroll: true }); focused = null;
    },
    /* the tab changed under it, so there's no row to go back to */
    drop() {
      cancelAnimationFrame(raf); raf = 0;
      for (const s of rows) s.el.remove();
      rows.length = 0;
      scroller().style.overflowAnchor = '';
    },
    /* the element its words are written into. From inside the open row, it's this row with new words; from a row in the
       list, that row opens and this one closes */
    ready(id, from) {
      const here = inHand();
      if (here && (here.id === id || !from || from.closest('.unfold'))) { if (here.id !== id) here.changing = true; here.id = id; return here.el; }
      const coming = rows.find((s) => s.to === 0 && s.id === id && (!from || from === s.row));
      if (coming) {                           // asked for again on its way home: it just turns round
        rows.push(rows.splice(rows.indexOf(coming), 1)[0]);
        coming.to = 1; coming.turning = true;
        return coming.el;
      }
      if (here) this.close();
      const row = from?.isConnected ? from : rowsIn(id)[0] || null;
      const el = document.createElement('div');
      el.className = 'unfold';
      const s = { el, id, rowOf: row?.dataset.mem, nth: row ? rowsIn(row.dataset.mem).indexOf(row) : 0, p: 0, v: 0, to: 1, ya: 0, yb: 0, from: 0, full: null, fresh: true, began: null };
      if (row) {                              // where its words are, measured while the row's still showing
        const words = row.querySelector('.words, .q'), edge = row.getBoundingClientRect(), at = words?.getBoundingClientRect();
        if (at) { const css = getComputedStyle(row); s.began = at.top; s.from = edge.bottom - at.top - parseFloat(css.paddingBottom) - parseFloat(css.borderBottomWidth); }
      }
      rows.push(s);
      place(s, row);
      return el;
    },
    arrive() {
      const s = inHand();
      if (!s) return;
      const { words, detail } = parts(s);
      if (s.fresh) {
        s.fresh = false;
        measure(s);
        const { top, bottom } = port(), y = s.began ?? top;
        s.yb = nearest(s, y);
        s.ya = y > top && y < bottom ? y : s.yb;   // a row off screen isn't travelled from: it opens where it'll rest
        detail.focus({ preventScroll: true });
        run();
      } else if (s.turning) {
        s.turning = false;
        measure(s);
        const y = words.getBoundingClientRect().top;
        s.yb = nearest(s, y); s.ya = s.p < 0.01 ? y : (y - s.yb * s.p) / (1 - s.p);
        run();
      } else if (s.changing) {                 // another memory in this row: the words change where they are
        s.changing = false;
        measure(s);
        if (raf) { paint(s); return; }
        const y = words.getBoundingClientRect().top, to = nearest(s, y);
        s.ya = s.yb = to;
        scroller().scrollTop += y - to;
        if (!still.matches) detail.animate({ opacity: [0, 1] }, { duration: 220, easing: 'linear' });
        detail.focus({ preventScroll: true });
      } else if (raf) { measure(s); paint(s); }
    },
    close() {
      const s = inHand();
      if (!s) return;
      measure(s);
      const y = parts(s).words.getBoundingClientRect().top, { top, bottom } = port();
      s.to = 0;
      // it closes on the line it's on, or the nearest one you can see
      s.ya = Math.round(Math.max(top + MARGIN, Math.min(bottom - 80, y)));
      s.yb = s.p > 0.01 ? (y - s.ya * (1 - s.p)) / s.p : y;
      run();
    },
  };
}
