/* The glass the drawers are made of: dark glass laid over the living mind, so you read with it still glowing through.
 *
 * The material is CSS (in each page's own styles): the mind behind it softened and brought down to about an eighth
 * of its light, with a whisper of white and a hairline lit from above. What makes it glass and not a
 * tinted panel is here: at its rim the glass bends the world just beyond its edge in toward it, the way a thick pane
 * does, so the mind's lines jog and gather as they pass under the edge. That's an SVG displacement map the browser
 * applies to what's behind (backdrop-filter: url(#…)), which only Chromium does; elsewhere the glass is the same
 * without the bend.
 *
 * The bending needs to see past the rim, so the element given here is larger than the pane by `pad` on every side,
 * and the page cuts it back to the pane with clip-path (a mask wouldn't cut what a backdrop-filter draws). The map is
 * made for the element's size and made again when that changes. */

const NS = 'http://www.w3.org/2000/svg';
const bends = /Chrome\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'blur(1px)');
let defs = null, ids = 0;

function holder() {
  if (defs) return defs;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs); document.body.appendChild(svg);
  return defs;
}

/* where each point of the rim looks: just outside the pane at the very edge, easing back to straight through by
 * `band` inside it. Offsets are stored as fractions of the box's width on both axes (Chromium scales by width alone). */
function rimMap(W, H, { pad, radius, band, pull }) {
  const sx = Math.max(2, Math.round(W / 2)), sy = Math.max(2, Math.round(H / 2));
  const hw = W / 2 - pad, hh = H / 2 - pad, r = Math.min(radius, hw, hh);
  const off = new Float32Array(sx * sy * 2);
  let most = 0;
  for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
    const px = (i + 0.5) / sx * W - W / 2, py = (j + 0.5) / sy * H - H / 2;
    const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    const inward = Math.max(0, -d);
    if (inward >= band) continue;
    let nx, ny;
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); nx = qx / l * Math.sign(px); ny = qy / l * Math.sign(py); }
    else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
    const t = 1 - inward / band, k = pull * t * t, p = (j * sx + i) * 2;
    off[p] = nx * k / W; off[p + 1] = ny * k / W;
    most = Math.max(most, Math.abs(off[p]), Math.abs(off[p + 1]));
  }
  const scale = most * 2 + 1e-4, c = document.createElement('canvas');
  c.width = sx; c.height = sy;
  const g = c.getContext('2d'), img = g.createImageData(sx, sy);
  for (let p = 0; p < sx * sy; p++) {
    img.data[p * 4] = Math.round(255 * (0.5 + off[p * 2] / scale));
    img.data[p * 4 + 1] = Math.round(255 * (0.5 + off[p * 2 + 1] / scale));
    img.data[p * 4 + 2] = 128; img.data[p * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { url: c.toDataURL(), scale };
}

/* bend the rim of one glass element; its pane is the element less `pad` all round, with corners of `radius` */
export function bendRim(el, { pad = 16, radius = 22, band = 22, pull = 14 } = {}) {
  if (!bends || !el) return;
  const id = `glass-rim-${++ids}`, f = document.createElementNS(NS, 'filter');
  for (const [k, v] of Object.entries({ id, x: 0, y: 0, width: 1, height: 1, filterUnits: 'objectBoundingBox', primitiveUnits: 'objectBoundingBox', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  holder().appendChild(f);
  let size = '';
  new ResizeObserver(() => {
    const W = el.offsetWidth, H = el.offsetHeight, now = `${W}x${H}`;
    if (!W || !H || now === size) return;
    size = now;
    const map = rimMap(W, H, { pad, radius, band, pull });
    f.innerHTML = `<feImage href="${map.url}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="${map.scale.toFixed(6)}" xChannelSelector="R" yChannelSelector="G"/>`;
    el.style.setProperty('--bend', `url(#${id})`);
  }).observe(el);
}
