/**
 * Theme control — light / dark / system.
 *
 * The FOUC-safe bootstrap in `index.html` sets the initial `.dark` class before
 * first paint. This helper lets UI (e.g. a ThemeToggle) change it at runtime and
 * persist the choice. Added by /setup-design-system when light+dark was enabled.
 *
 * Wire a toggle like:
 *   import { setTheme, getTheme } from '@/shared/lib/theme';
 *   <button onClick={() => setTheme(getTheme() === 'dark' ? 'light' : 'dark')}>…</button>
 */

export type Theme = 'light' | 'dark' | 'system';

/** Apply `theme` to the document and persist it (`system` clears the override). */
export function setTheme(theme: Theme): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', isDark);
  if (theme === 'system') localStorage.removeItem('theme');
  else localStorage.setItem('theme', theme);
}

/** The persisted preference, or `'system'` when none is saved. */
export function getTheme(): Theme {
  const saved = localStorage.getItem('theme');
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

/** Whether the document is currently rendering dark. */
export function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}
