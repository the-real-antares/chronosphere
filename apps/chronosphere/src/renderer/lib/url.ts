/**
 * Resolve a server-relative asset URL ("/files/thumbs/x.png") against the API
 * base. Absolute http(s)/file/data URLs pass through untouched (the render
 * cache hands back file: URLs). Null/empty in → null out.
 */
export function resolveAssetUrl(apiBase: string, url: string | null): string | null {
  if (url === null || url === '') return null;
  if (/^(?:https?|file|data):/i.test(url)) return url;
  const base = apiBase.replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}
