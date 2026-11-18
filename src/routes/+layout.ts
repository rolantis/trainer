// A static, client-only app: every page is prerendered as an empty shell and
// rendered in the browser, where IndexedDB and the session live.
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';
