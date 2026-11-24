// Fréquentation du site public, sans cookie et sans identifiant : un compteur par jour et par page, un autre par site d'origine.
// Ni adresse IP, ni empreinte du navigateur, ni durée de visite ne sont gardées : on ne peut reconnaître personne (mesure exemptée de consentement).
import { now } from '../db.js';

const DAY = 86400;
/** Sites d'origine distincts retenus par jour ; au-delà, les nouveaux sont regroupés sous « (autres) » (un robot qui envoie des milliers de faux Referer ne fait pas grossir la base). */
export const MAX_REFERRERS_PER_DAY = 200;
const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|httpclient|headless|lighthouse/i;
export const dayOf = (ts = now()) => Math.floor(ts / DAY);

/** À compter ? Une lecture de page par un navigateur, sans « Ne pas me suivre » (DNT ou Global Privacy Control). */
export function countable(req) {
  if (req.method !== 'GET') return false;
  if (req.headers.dnt === '1' || req.headers['sec-gpc'] === '1') return false;
  const ua = String(req.headers['user-agent'] || '');
  return ua !== '' && !BOT.test(ua);
}

/** Site d'origine (nom de domaine seulement) si la visite vient d'ailleurs que d'iaboss. */
export function referrerHost(req, appUrl) {
  try {
    const h = new URL(String(req.headers.referer || '')).hostname.toLowerCase().replace(/^www\./, '');
    return h && h !== new URL(appUrl).hostname.toLowerCase().replace(/^www\./, '') ? h.slice(0, 100) : null;
  } catch { return null; }
}

/** Compte une page vue. Ne lève jamais : la mesure ne doit pas faire échouer une page. */
export async function countView(db, req, pathname, appUrl, at = now()) {
  try {
    if (!countable(req)) return;
    const day = dayOf(at);
    const path = String(pathname || '/').slice(0, 80);
    await db.prepare('INSERT INTO page_views(day, path, views) VALUES(?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET views = views + 1').run(day, path);
    let host = referrerHost(req, appUrl);
    if (host && !(await db.prepare('SELECT 1 x FROM page_referrers WHERE day = ? AND host = ?').get(day, host))
      && Number((await db.prepare('SELECT COUNT(*) n FROM page_referrers WHERE day = ?').get(day)).n) >= MAX_REFERRERS_PER_DAY) host = '(autres)';
    if (host) await db.prepare('INSERT INTO page_referrers(day, host, views) VALUES(?, ?, 1) ON CONFLICT(day, host) DO UPDATE SET views = views + 1').run(day, host);
  } catch { /* mesure perdue : sans importance */ }
}

/** Totaux depuis `since` (secondes) : pages vues, pages les plus lues, sites d'origine les plus fréquents. */
export async function audienceStats(db, since) {
  const day = dayOf(since);
  const total = Number((await db.prepare('SELECT COALESCE(SUM(views), 0) n FROM page_views WHERE day >= ?').get(day)).n);
  const pages = await db.prepare('SELECT path, SUM(views) n FROM page_views WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 10').all(day);
  const referrers = await db.prepare('SELECT host, SUM(views) n FROM page_referrers WHERE day >= ? GROUP BY host ORDER BY n DESC LIMIT 10').all(day);
  return { total, pages: pages.map((r) => ({ path: r.path, n: Number(r.n) })), referrers: referrers.map((r) => ({ host: r.host, n: Number(r.n) })) };
}

/** Efface les compteurs de plus de 13 mois (durée maximale de conservation d'une mesure d'audience). */
export async function purgeAudience(db, at = now()) {
  const day = dayOf(at - 395 * DAY);
  await db.prepare('DELETE FROM page_views WHERE day < ?').run(day);
  await db.prepare('DELETE FROM page_referrers WHERE day < ?').run(day);
}
