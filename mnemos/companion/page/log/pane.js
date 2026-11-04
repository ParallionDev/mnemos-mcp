/* A memory opens beside the list, and the list doesn't move.
 *
 * Mail, Linear and Finder all work this way, because you keep your place: nothing in the list changes but the mark on the
 * row you chose, and the arrow keys walk through it. Where the drawer is already open beside the list, the memory takes
 * its place and the list's width doesn't change. Otherwise the same pane floats over the list's edge, and on a phone it
 * covers the page. Room writes the words; this only knows the pane. */

const still = matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(.32,.72,0,1)';

export function makePane({ el, drawer, floats, covers, closed }) {
  let showing = null, moving = null;
  const body = document.body;

  function slide(open) {
    moving?.cancel(); moving = null;
    if (still.matches) return Promise.resolve();
    const from = covers() ? 'translateX(100%)' : 'translateX(18px)', fade = covers() ? [1, 1] : [0, 1];
    moving = drawer.animate({ transform: open ? [from, 'none'] : ['none', from], opacity: open ? fade : [...fade].reverse() }, { duration: open ? 320 : 200, easing: open ? EASE : 'cubic-bezier(.4,0,1,1)' });
    return moving.finished.catch(() => null);
  }
  function shut() {
    if (showing !== null) return;
    body.classList.remove('reading', 'peek');
    el.hidden = true; el.innerHTML = ''; el.written = null;
  }

  return {
    el, content: el,
    get showing() { return showing; },
    isOpen: () => showing !== null,
    /* writes the memory only if it changed, so a live redraw leaves your place and your focus alone */
    show(id, html) {
      const fresh = id !== showing, arriving = showing === null;
      showing = id;
      if (arriving) {
        el.hidden = false;
        body.classList.add('reading');
        body.classList.toggle('peek', floats());
      }
      const wrote = el.written !== html;
      if (wrote) { el.innerHTML = html; el.written = html; }
      if (fresh) el.scrollTop = 0;
      if (arriving && body.classList.contains('peek')) slide(true);
      else if (fresh && !still.matches) el.animate({ opacity: [0, 1] }, { duration: 140, easing: 'linear' });
      if (arriving) el.focus({ preventScroll: true });
      return wrote;
    },
    hide() {
      if (showing === null) return;
      const left = showing, hadFocus = el.contains(document.activeElement);
      showing = null;
      if (body.classList.contains('peek')) slide(false).then(shut); else shut();
      closed(left, hadFocus);
    },
    /* the window changed shape: is there still room beside the list? */
    relaid() { if (showing !== null) { body.classList.toggle('peek', floats()); el.written = null; } },
  };
}
