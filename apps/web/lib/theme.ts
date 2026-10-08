export const THEME_KEY = 'shopstream.theme';

/** Inline script run before paint so the page never flashes the wrong theme. */
export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function toggleTheme(): 'dark' | 'light' {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  } catch {
    /* ignore */
  }
  return dark ? 'dark' : 'light';
}
