// Image fixe d'un post Instagram. Comme la vidéo de promotion, l'image est du code écrit par un modèle : UN document HTML autonome (CSS et SVG en ligne),
// ouvert par Chromium sans interface dans le bac à sable, sans réseau, SANS aucun script, puis capturé en PNG à la taille exacte du format.
import { openBrowser, SceneError, findChromium } from './promovideo.js';

export const STILL = { maxHtml: 120_000, minPng: 6_000, timeoutMs: 30_000 };

/**
 * Outils de l'IA par phase. Jamais le web ET le dépôt dans le même appel : une page web piégée pourrait pousser l'IA à envoyer du code
 * du dépôt vers l'extérieur (même séparation que pour les tâches des postes). La recherche n'a pas le dépôt ; le dessin n'a pas le web.
 */
export const TOOLS = { research: ['WebSearch', 'WebFetch'], design: ['Read', 'Glob', 'Grep'] };

// Aucun script, aucune ressource externe : le document ne peut ni contacter quiconque ni lire un fichier
const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const FORBIDDEN = [
  [/<script\b/i, 'script (l\'image est une page fixe : CSS et SVG seulement)'],
  [/<iframe|<object|<embed|<frame\b/i, 'éléments incorporés (iframe, object, embed)'],
  [/<base\b/i, 'balise <base>'],
  [/<link\b/i, 'balise <link> (ressource externe)'],
  [/\son[a-z]+\s*=/i, 'attribut d\'événement (onclick…)'],
  [/javascript:/i, 'adresse javascript:'],
  [/https?:\/\/(?!www\.w3\.org\/)/i, 'adresse http(s) : le document doit être autonome, sans aucune ressource externe'],
  [/@import\b/i, '@import (ressource externe)'],
];

/** Le document HTML de la réponse de l'IA (dans des balises <visuel>, un bloc de code ou brut), ou ''. */
export function extractVisual(text) {
  let t = String(text ?? '');
  const tagged = t.match(/<visuel>([\s\S]*?)<\/visuel>/i);
  if (tagged) t = tagged[1];
  const fence = t.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  if (fence) t = fence[1];
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return '';
  t = t.slice(start);
  const end = t.search(/<\/html\s*>/i);
  if (end >= 0) t = t.slice(0, end + t.slice(end).match(/<\/html\s*>/i)[0].length);
  return t.trim();
}

/** Vérifie le document avant tout rendu. Renvoie le document avec sa CSP, ou lève une SceneError dont le message est renvoyé à l'IA. */
export function prepareStill(html) {
  const doc = String(html || '');
  if (!doc.trim()) throw new SceneError("Aucun document HTML n'a été produit pour l'image.");
  if (doc.length > STILL.maxHtml) throw new SceneError(`Le document de l'image est trop long (${doc.length} caractères, ${STILL.maxHtml} au plus) : simplifie-le.`);
  for (const [re, what] of FORBIDDEN) if (re.test(doc)) throw new SceneError(`Interdit dans l'image : ${what}.`);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  if (/<head[\s>]/i.test(doc)) return doc.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${meta}`);
  if (/<html[\s>]/i.test(doc)) return doc.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${doc}</body></html>`;
}

/** Chromium est-il disponible ? { ok, reason } comme pour la vidéo. */
export function stillSupported(cfg) {
  return findChromium(cfg) ? { ok: true } : { ok: false, reason: "Chromium n'est pas installé sur ce serveur (variable CHROMIUM_BIN)." };
}

/**
 * Rend le document en PNG de width × height pixels. Lève une SceneError si l'image est inutilisable (vide, page quittée, scène qui plante) :
 * le message part à l'IA pour qu'elle corrige.
 */
export async function renderStill({ cfg, html, width, height, signal }) {
  const doc = prepareStill(html);
  const { cdp, stop } = await openBrowser(cfg, { width, height, signal });
  try {
    const errors = [];
    let navigated = false;
    cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description?.split('\n')[0] || p.exceptionDetails?.text || 'erreur'));
    cdp.on('Fetch.requestPaused', (p) => { cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); });
    cdp.on('Page.frameRequestedNavigation', () => { navigated = true; });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await cdp.send('Page.getFrameTree');
    await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html: doc });
    for (let i = 0; i < 50; i++) {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (r.result?.value === 'complete') break;
      await new Promise((res) => setTimeout(res, 100));
    }
    await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => 1)', awaitPromise: true, returnByValue: true }, STILL.timeoutMs);
    if (navigated) throw new SceneError("L'image a cherché à quitter la page : rendu refusé.");
    // Du texte lisible : une image sans aucun mot n'est pas un post.
    // Un élément qui dépasse le cadre n'est PAS un défaut : un produit rogné par le bord est un choix de composition courant, et la capture est de toute façon
    // découpée à la taille du format. Un texte coupé par le bord, lui, est jugé par le directeur artistique en regardant l'image.
    const m = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({ text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length }))()`,
      returnByValue: true,
    });
    if (!((m.result?.value?.text ?? 0) >= 8)) throw new SceneError("L'image ne contient presque aucun texte : ajoute un titre lisible (au moins quelques mots).");
    const s = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width, height, scale: 1 } }, STILL.timeoutMs);
    const png = Buffer.from(s.data, 'base64');
    if (png.length < STILL.minPng) throw new SceneError("L'image est vide ou unie : dessine un vrai visuel (fond, titre, éléments du produit).");
    if (errors.length) throw new SceneError(`Erreur dans le document de l'image : ${errors[0]}`);
    return png;
  } finally { await stop(); }
}
