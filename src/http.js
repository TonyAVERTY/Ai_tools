// Mini-routeur + helpers HTTP. Pas de framework : moins de RAM, moins de surface.

export class Router {
  constructor() { this.routes = []; }
  add(method, path, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, public: !!opts.public });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { ...r, params };
      }
    }
    return null;
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, httpOnly = true, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`, 'Secure'];
  if (httpOnly) parts.push('HttpOnly');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join('; ')]);
}

const MAX_BODY = 256 * 1024;

export async function readBody(req, { max = MAX_BODY } = {}) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('Requête trop volumineuse'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) return raw ? JSON.parse(raw) : {};
  return Object.fromEntries(new URLSearchParams(raw));
}

export function send(res, status, body, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

export const html = (res, body, status = 200) => send(res, status, body);
export const json = (res, data, status = 200) => send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
export function redirect(res, location) { res.writeHead(303, { Location: location }); res.end(); }

// `expose` : message sûr destiné à l'utilisateur même pour un 5xx (ex. impossible de joindre un service tiers)
export class HttpError extends Error {
  constructor(status, message, { expose = false } = {}) { super(message); this.status = status; this.expose = expose; }
}

// Échappement HTML pour les templates
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
