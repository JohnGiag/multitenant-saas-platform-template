// The browser's choice (localStorage `theme`: 'light' | 'dark'), else the system's. Runs inline in <head> so the
// first paint already has the right theme.
export const THEME_SCRIPT = `try{var t=localStorage.getItem('theme');document.documentElement.classList.toggle('dark',t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches)}catch(e){}`;
