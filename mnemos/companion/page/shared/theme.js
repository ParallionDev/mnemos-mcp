/* The log's two looks, true black and white. It follows the system until someone picks one here, and it's a plain
 * script loaded before the page draws, so the page never flashes the wrong one. A page that doesn't load this (the
 * mind) stays dark. What's picked is kept in this browser; if the browser won't keep it, the page still works and
 * follows the system. */
(() => {
  const KEY = 'mnemos-theme';
  const root = document.documentElement;
  const light = matchMedia('(prefers-color-scheme: light)');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const stored = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } };
  let choice = stored();
  const draw = () => {
    root.dataset.theme = choice === 'auto' ? (light.matches ? 'light' : 'dark') : choice;
    root.style.colorScheme = root.dataset.theme;
    dispatchEvent(new CustomEvent('mnemos-theme', { detail: { choice, theme: root.dataset.theme } }));
  };
  // the whole page crossfades, when it can and when motion is welcome; otherwise it simply changes
  const change = () => { if (document.startViewTransition && !still.matches && document.visibilityState === 'visible') document.startViewTransition(draw); else draw(); };
  light.addEventListener('change', () => { if (choice === 'auto') change(); });
  addEventListener('storage', (e) => { if (e.key === KEY) { choice = stored(); change(); } });
  window.mnemosTheme = {
    get choice() { return choice; },
    set(next) {
      choice = next;
      try { if (next === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* it lasts as long as the page */ }
      change();
    },
  };
  draw();
})();
