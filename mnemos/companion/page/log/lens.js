/* A memory opens where it is.
 *
 * The list stays, and the row doesn't leave it: it opens into a card around its own words, with the figure opening above
 * them. When the card needs room on screen, the list moves with it, row and neighbours together, like a small scroll, so
 * the words never travel across the page on their own. Around it the page softens, a little more with distance, and stays recognisably the
 * page you were on: nothing else moves, and it's never somewhere else you've gone. (Riley, on flying it to the middle of
 * a blurred, darkened, stretched world: "basically going to a new page". That fuller version is the focus-pull skill.)
 * What hangs faintly in the blur is true: each disc of light is a memory tied to this one, a stronger tie nearer, cut to
 * a cat's eye near the frame, so a memory tied to nothing opens with none.
 *
 * The springs carry their speed, so closing half way through opening just turns round. Asked for less motion, it's all
 * simply there. The page moves the words in and out; this only knows the glass. */

const still = matchMedia('(prefers-reduced-motion: reduce)');

const GO = { k: 300, c: 33 };                 // the window moving: quick, and it arrives without bouncing
const OPEN = { k: 240, c: 29 };               // the shutter opening: a little softer, so it settles
const SHUTTER_LAG = 0.05;                     // s: it settles sideways a moment before it opens up and down (closing, the other way round)
const EDGE = 12, MOST_WIDE = 860, MOST_TALL = 0.72, STEP = 1 / 240;

const hashOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const place = (seed) => { let h = seed; return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; };

export function makeLens(root, { leave, changed, list }) {
  const world = root.querySelector('.lens-world'), sheet = root.querySelector('.lens-sheet');
  const card = root.querySelector('.lens-card'), content = root.querySelector('.lens-content'), lights = root.querySelector('.lens-lights');
  let state = 'shut', showing = null, raf = 0, lifted = null, ghost = null, after = null, ties = [], anchor = null, home = null;
  const box = { left: 0, top: 0, w: 0, h: 0 };     // the card, where it comes to rest
  const p = { cx: 0, cy: 0, w: 0, h: 0, dx: 0, dy: 0 }, v = { cx: 0, cy: 0, w: 0, h: 0, dx: 0, dy: 0 }, to = { ...p };
  let last = 0, began = 0;

  /* the card's width and side: its words where the row's words are */
  function fit() {
    const W = innerWidth, pad = parseFloat(getComputedStyle(content).paddingLeft) || 0;
    const column = W >= 760 ? document.querySelector('main')?.getBoundingClientRect() : null;
    if (anchor?.isConnected && column) {
      const r = anchor.getBoundingClientRect(), at = (anchor.querySelector('.words, .q') || anchor).getBoundingClientRect(), inset = at.left - r.left;
      box.w = r.width + 2 * (pad - inset); box.left = at.left - pad;
    } else if (column) { box.w = Math.min(MOST_WIDE, column.width - 16); box.left = column.left + (column.width - box.w) / 2; }
    else { box.w = W - 16; box.left = 8; }
    box.w = Math.min(box.w, W - 16); box.left = Math.round(Math.max(8, Math.min(W - box.w - 8, box.left)));
    card.style.width = `${box.w}px`; card.style.left = `${box.left}px`;
  }
  /* and its height: as near as it fits to keeping those words on the line they were on */
  function measure() {
    fit();
    const W = innerWidth, H = innerHeight, m = Math.round(Math.max(EDGE, Math.min(32, H * 0.04)));
    card.style.height = 'auto'; card.style.maxHeight = `${H - 2 * m}px`;
    box.h = Math.round(Math.min(content.scrollHeight, W >= 760 ? H * MOST_TALL : H - 2 * m));
    let top = (H - box.h) / 2;
    const mine = content.querySelector('.detail > .words');
    if (anchor?.isConnected && mine) {
      const offset = mine.getBoundingClientRect().top - content.getBoundingClientRect().top;
      top = (anchor.querySelector('.words, .q') || anchor).getBoundingClientRect().top - offset;
    }
    box.top = Math.round(Math.max(m, Math.min(H - m - box.h, top)));
    card.style.top = `${box.top}px`; card.style.height = `${box.h}px`;
    root.style.setProperty('--cx', `${((box.left + box.w / 2) / W * 100).toFixed(1)}%`);
    root.style.setProperty('--cy', `${((box.top + box.h / 2) / H * 100).toFixed(1)}%`);
  }
  const atRest = () => { to.cx = box.left + box.w / 2; to.cy = box.top + box.h / 2; to.w = box.w; to.h = box.h; to.dx = 0; to.dy = 0; };
  function jump() { Object.assign(p, to); for (const k in v) v[k] = 0; }
  function paint() {
    sheet.style.transform = `translate(${(p.cx - p.w / 2).toFixed(2)}px,${(p.cy - p.h / 2).toFixed(2)}px)`;
    sheet.style.width = `${Math.max(0, p.w).toFixed(2)}px`; sheet.style.height = `${Math.max(0, p.h).toFixed(2)}px`;
    card.style.transform = `translate(${p.dx.toFixed(2)}px,${p.dy.toFixed(2)}px)`;
    if (home && list) list.style.transform = `translateY(${(p.dy - home.dy).toFixed(2)}px)`;   // the list moves with the words, in step
    // the words show only through the sheet's window
    const l = p.cx - p.w / 2 - (box.left + p.dx), t = p.cy - p.h / 2 - (box.top + p.dy);
    card.style.clipPath = `inset(${t.toFixed(1)}px ${(box.w - l - p.w).toFixed(1)}px ${(box.h - t - p.h).toFixed(1)}px ${l.toFixed(1)}px round var(--r-card))`;
  }
  function settle() {
    raf = 0;
    jump(); paint();
    if (state === 'closing') { finish(); return; }
    state = 'open';
    card.style.clipPath = '';
    ghost?.remove(); ghost = null;
  }
  // small fixed steps, so the springs keep real time however slowly the frames arrive
  function tick(now) {
    const since = (now - began) / 1000, closing = state === 'closing';
    let left = Math.min(0.25, (now - last) / 1000), moving = false; last = now;
    for (; left > 0; left -= STEP) {
      const dt = Math.min(STEP, left);
      moving = false;
      for (const k in p) {
        const shutter = k === 'h';
        if (closing ? !shutter && since < SHUTTER_LAG : shutter && since < SHUTTER_LAG) { moving = true; continue; }
        const { k: stiff, c } = shutter ? OPEN : GO;
        v[k] += (stiff * (to[k] - p[k]) - c * v[k]) * dt;
        p[k] += v[k] * dt;
        if (Math.abs(to[k] - p[k]) > 0.25 || Math.abs(v[k]) > 2) moving = true;
      }
    }
    paint();
    if (moving) raf = requestAnimationFrame(tick); else settle();
  }
  function run() {
    if (still.matches) { settle(); return; }
    began = last = performance.now();
    if (!raf) raf = requestAnimationFrame(tick);
  }
  function fade(el, from, toValue, ms, delay = 0) {
    if (still.matches) return;
    el.animate({ opacity: [from, toValue] }, { duration: ms, delay, easing: 'linear', fill: 'backwards' });
  }

  /* the discs are drawn once for each memory and each window */
  function drawLights() {
    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
    lights.width = Math.round(W * dpr); lights.height = Math.round(H * dpr);
    const g = lights.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (W < 760) return;                       // a phone has no edges to speak of: the card is nearly all of it
    const dark = document.documentElement.dataset.theme !== 'light', cx = W / 2, cy = H / 2;
    g.globalCompositeOperation = dark ? 'lighter' : 'multiply';
    const tint = dark ? ['168,192,236', '226,232,244'] : ['118,136,172', '150,156,170'];
    const out = Math.hypot(cx, cy);
    for (const { id, w } of ties.slice(0, 28)) {
      const r = place(hashOf(id)), angle = r() * Math.PI * 2, strong = Math.max(0.15, Math.min(1, w ?? 0.5));
      // a stronger tie hangs nearer the card; every one is clear of the card's own column
      const far = 1 - strong * 0.55 + r() * 0.3;
      const ring = 0.52 + 0.56 * Math.min(1, far);
      const x = cx + Math.cos(angle) * cx * ring * 1.05, y = cy + Math.sin(angle) * cy * ring * 1.12;
      const size = (11 + 24 * far + r() * 12) * (W > 1300 ? 1.25 : 1);
      const a = (dark ? 0.036 : 0.03) * (0.55 + strong * 0.9), colour = tint[r() < 0.34 ? 1 : 0];
      const edge = Math.min(1, Math.hypot(x - cx, y - cy) / out), toward = Math.atan2(cy - y, cx - x);
      g.save();
      // the cat's eye: near the frame a real lens cuts its discs with its own rim
      if (edge > 0.45) { g.beginPath(); g.arc(x + Math.cos(toward) * size * (edge - 0.45) * 1.1, y + Math.sin(toward) * size * (edge - 0.45) * 1.1, size, 0, Math.PI * 2); g.clip(); }
      const d = g.createRadialGradient(x, y, 0, x, y, size);
      d.addColorStop(0, `rgba(${colour},${a * 0.72})`);
      d.addColorStop(0.8, `rgba(${colour},${a})`);
      d.addColorStop(0.95, `rgba(${colour},${a * 1.5})`);    // the rim a disc of defocused light has
      d.addColorStop(1, `rgba(${colour},0)`);
      g.fillStyle = d; g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill();
      g.restore();
    }
  }

  function finish() {
    state = 'shut'; showing = null; anchor = null; home = null;
    if (list) list.style.transform = '';
    changed();
    root.hidden = true;
    sheet.style.opacity = '';
    card.style.opacity = '';
    content.innerHTML = '';
    ghost?.remove(); ghost = null;
    const row = lifted; lifted = null;
    if (row?.isConnected) { row.classList.remove('lifted'); row.focus({ preventScroll: true }); }
    const then = after; after = null;
    then?.();
  }

  /* the row's window, and the words in it, as where this card starts from or goes back to */
  function fromRow(row) {
    const r = row.getBoundingClientRect(), wordsAt = (row.querySelector('.words, .q') || row).getBoundingClientRect();
    const mine = (content.querySelector('.detail > .words') || content).getBoundingClientRect();
    to.cx = r.left + r.width / 2; to.cy = r.top + r.height / 2; to.w = r.width; to.h = r.height;
    to.dx = wordsAt.left - (mine.left - p.dx); to.dy = wordsAt.top - (mine.top - p.dy);
  }
  const inView = (row) => {
    if (!row?.isConnected) return false;
    const r = row.getBoundingClientRect(), port = row.closest('main')?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
    return r.bottom > port.top && r.top < port.bottom && r.height > 0;
  };

  addEventListener('resize', () => {
    if (state === 'shut') return;
    home = null; if (list) list.style.transform = '';   // the window changed shape, so the row isn't where it was
    measure(); atRest();
    if (state === 'open') { jump(); paint(); card.style.clipPath = ''; }
    drawLights();
  });
  world.addEventListener('click', () => leave());
  addEventListener('mnemos-theme', () => { if (state !== 'shut') drawLights(); });

  return {
    content,
    get showing() { return showing; },
    isOpen: () => state !== 'shut',
    prepare(from) { root.hidden = false; if (state === 'shut') { anchor = from?.isConnected ? from : null; fit(); } },
    arrive({ id, from, same, ties: tied, top = 0 }) {
      ties = tied || [];
      if (same) {                             // the same memory, redrawn by a live look: nothing moves
        measure(); card.scrollTop = top;
        if (state === 'open') { atRest(); jump(); paint(); card.style.clipPath = ''; }
        return;
      }
      const opening = state === 'shut' || state === 'closing';
      showing = id;
      card.scrollTop = 0;
      measure();
      drawLights();
      if (!opening) {                         // from one memory to another inside the card: the glass stays, the words change
        atRest(); card.style.clipPath = 'inset(0 round var(--r-card))';
        fade(content, 0, 1, 260);
        if (!still.matches) content.querySelector('.specimen canvas')?.animate({ filter: ['blur(10px)', 'blur(0)'], opacity: [0, 1] }, { duration: 620, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
        run();
        return;
      }
      if (state === 'closing') {              // asked for again on its way home: it just turns round
        card.style.opacity = ''; sheet.style.opacity = ''; after = null;
        for (const a of sheet.getAnimations()) a.cancel();
        document.body.classList.add('lensed');
      }
      if (state === 'shut') {
        const row = from?.isConnected ? from : null;
        p.dx = p.dy = 0;
        if (row) {
          card.style.transform = 'none';
          fromRow(row);
          home = { ...to };
          row.classList.add('lifted'); lifted = row;
          ghost = row.cloneNode(true);
          ghost.removeAttribute('data-mem'); ghost.setAttribute('aria-hidden', 'true'); ghost.tabIndex = -1; ghost.classList.remove('lifted');
          ghost.classList.add('lens-ghost');
          ghost.style.width = `${row.getBoundingClientRect().width}px`;
          sheet.append(ghost);
          if (!still.matches) ghost.animate({ opacity: [1, 0] }, { duration: 170, easing: 'linear', fill: 'forwards' });
        } else {                              // opened from the address, or from nowhere on screen: the shutter opens in place
          atRest(); to.h = 44; to.w = box.w * 0.86;
        }
        jump();
        document.body.classList.add('lensed');
      }
      state = 'opening';
      changed();
      atRest();
      paint();
      if (!still.matches) {
        fade(sheet, 0, 1, 140);
        fade(content, 0, 1, 220, 70);
        // the figure comes into focus last, as the card finishes opening round it
        content.querySelector('.specimen canvas')?.animate({ filter: ['blur(14px)', 'blur(0)'], opacity: [0, 1] }, { duration: 860, delay: 130, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
        for (const pane of world.children) fade(pane, 0, 1, 300);   // each pane itself: fading their parent would cut the glass off from what's behind it
      }
      card.focus({ preventScroll: true });
      run();
    },
    leave(findRow, then) {
      if (state === 'shut') { then?.(); return; }
      after = then;
      state = 'closing';
      document.body.classList.remove('lensed');
      if (still.matches) { finish(); return; }
      const row = lifted?.isConnected ? lifted : findRow();
      if (home && lifted?.isConnected) Object.assign(to, home);
      else if (inView(row)) { lifted = row; row.classList.add('lifted'); fromRow(row); }
      else {                                  // its row isn't on screen to go back to: it closes where it is
        atRest(); to.h = 0; to.w = box.w * 0.9;
        sheet.animate({ opacity: [1, 0] }, { duration: 240, easing: 'linear', fill: 'forwards' }).onfinish = () => { sheet.style.opacity = '0'; };
      }
      fade(card, 1, 0, 150);
      card.style.opacity = '0';
      for (const pane of world.children) pane.animate({ opacity: [1, 0] }, { duration: 260, easing: 'linear', fill: 'forwards' }).onfinish = (e) => e.target.cancel();
      run();
    },
  };
}
