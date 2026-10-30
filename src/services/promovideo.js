// Vidéo de promotion (design motion). Claude écrit UNE scène : un document HTML autonome qui définit `window.renderFrame(t)`, une fonction
// pure du temps (t en secondes) qui place tous les éléments. Le rendu est déterministe : Chromium sans interface ouvre la scène, on appelle
// renderFrame(t) puis on capture l'écran, image par image, et ffmpeg assemble les images en MP4. Aucune horloge réelle n'intervient, donc le
// résultat est identique quelle que soit la vitesse de la machine (un Raspberry Pi met simplement plus longtemps).
//
// La scène est du code écrit par un modèle : elle tourne dans le bac à sable (comme Claude), sans réseau (CSP + toute requête échoue),
// sans accès aux fichiers, et on vérifie à chaque image qu'elle n'a pas quitté la page.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { prepareLaunch } from './sandbox.js';
import { PROMO_STYLE_IDS } from './promokit.js';

export const PROMO = {
  fps: { min: 10, max: 60, def: 30 },
  seconds: { min: 3, max: 60, def: 15 },
  maxFrames: 1800,           // fps × secondes : borne le temps de rendu (une capture coûte ~0,3 s sur un Raspberry Pi)
  maxSubject: 500,
  maxHtml: 200_000,          // taille de la scène écrite par Claude
  frameTimeoutMs: 15_000,
  renderTimeoutMs: 40 * 60_000,
  maxVideos: 20,             // par compte
};

/** Formats proposés (pixels, toujours pairs : exigé par H.264). */
export const FORMATS = {
  paysage: { label: 'Paysage 16:9', width: 1280, height: 720 },
  vertical: { label: 'Vertical 9:16 (réseaux)', width: 720, height: 1280 },
  carre: { label: 'Carré 1:1', width: 720, height: 720 },
};

export class SceneError extends Error {
  constructor(message) { super(message); this.name = 'SceneError'; }
}

// ---------- Contrôle des paramètres ----------

/** Paramètres du formulaire → valeurs sûres, ou une erreur lisible. */
export function parsePromoParams(b = {}) {
  const fps = Math.floor(Number(b.fps ?? PROMO.fps.def));
  const seconds = Math.floor(Number(b.seconds ?? PROMO.seconds.def));
  if (!Number.isFinite(fps) || fps < PROMO.fps.min || fps > PROMO.fps.max) return { error: `Images par seconde : entre ${PROMO.fps.min} et ${PROMO.fps.max}.` };
  if (!Number.isFinite(seconds) || seconds < PROMO.seconds.min || seconds > PROMO.seconds.max) return { error: `Durée : entre ${PROMO.seconds.min} et ${PROMO.seconds.max} secondes.` };
  if (fps * seconds > PROMO.maxFrames) return { error: `Trop d'images à produire (${fps * seconds}) : ${fps} images/s × ${seconds} s dépasse ${PROMO.maxFrames}. Réduis la durée ou le nombre d'images par seconde.` };
  const format = FORMATS[b.format] ? b.format : 'paysage';
  const subject = String(b.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, PROMO.maxSubject);
  const style = PROMO_STYLE_IDS.includes(b.style) ? b.style : 'auto';
  return { fps, seconds, format, subject, style };
}

// ---------- La scène ----------

const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; base-uri 'none'; form-action 'none'";

/** Réponse de Claude → document HTML (retire les ``` éventuels et tout texte autour). Chaîne vide si rien d'exploitable. */
export function extractScene(text) {
  let t = String(text ?? '').trim();
  const fence = t.match(/```(?:html)?\s*\n([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start < 0) return '';
  t = t.slice(start);
  const end = t.search(/<\/html\s*>/i);
  if (end >= 0) t = t.slice(0, end + t.slice(end).match(/<\/html\s*>/i)[0].length);
  return t.trim();
}

const FORBIDDEN = [
  [/<iframe|<object|<embed|<frame\b/i, 'éléments incorporés (iframe, object, embed)'],
  [/<base\b/i, 'balise <base>'],
  [/<link\b/i, 'balise <link> (ressource externe)'],
  [/<script\b[^>]*\ssrc\s*=/i, 'script externe (<script src>)'],
  [/https?:\/\/(?!www\.w3\.org\/)/i, 'adresse http(s) : la scène doit être autonome, sans aucune ressource externe'],
];

// Textes de la scène de référence : un emplacement oublié dans la vidéo est un défaut, pas un contenu
const PLACEHOLDERS = ['EXEMPLE · remplace', 'adresse-du-site.fr', 'Premier bénéfice concret', 'Deuxième bénéfice concret', 'Troisième bénéfice concret', 'La promesse, en une ligne', 'Le problème, dit avec les mots du public', 'ce que c’est, en une phrase'];

/** Vérifie la scène avant tout rendu. Renvoie le document avec la CSP, ou lève une SceneError dont le message est renvoyé à Claude. */
export function prepareScene(html) {
  const doc = String(html || '');
  if (!doc.trim()) throw new SceneError("Aucun document HTML n'a été produit.");
  if (doc.length > PROMO.maxHtml) throw new SceneError(`La scène est trop longue (${doc.length} caractères, ${PROMO.maxHtml} au plus) : simplifie-la.`);
  if (!/window\.renderFrame\s*=|function\s+renderFrame\s*\(|renderFrame\s*=\s*(?:async\s*)?(?:function|\()/.test(doc)) {
    throw new SceneError('La scène doit définir window.renderFrame = function (t) { … } (t en secondes).');
  }
  for (const [re, what] of FORBIDDEN) if (re.test(doc)) throw new SceneError(`Interdit dans la scène : ${what}.`);
  const left = PLACEHOLDERS.find((p) => doc.includes(p));
  if (left) throw new SceneError(`Le texte d'exemple de la scène de référence est resté dans la vidéo (« ${left} ») : remplace tous les textes par ceux du projet.`);
  const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  // Notre CSP passe en premier : une seconde politique ne peut que restreindre davantage, jamais lever celle-ci
  if (/<head[\s>]/i.test(doc)) return doc.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${meta}`);
  if (/<html[\s>]/i.test(doc)) return doc.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${meta}</head>`);
  return `<!doctype html><html><head>${meta}</head><body>${doc}</body></html>`;
}

// ---------- Outils disponibles ----------

const CHROMIUM_NAMES = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome'];

/** Chromium à utiliser : CHROMIUM_BIN / cfg.chromiumBin, sinon le premier trouvé dans le PATH. null s'il n'y en a pas. */
export function findChromium(cfg = {}, env = process.env) {
  if (cfg.chromiumBin) return cfg.chromiumBin;
  if (env.CHROMIUM_BIN) return env.CHROMIUM_BIN;
  for (const dir of String(env.PATH || '').split(delimiter)) {
    for (const n of CHROMIUM_NAMES) if (dir && existsSync(join(dir, n))) return join(dir, n);
  }
  return null;
}

const ok = new Map();
const works = (bin, args = ['--version']) => {
  const k = `${bin} ${args.join(' ')}`;
  if (!ok.has(k)) { const r = spawnSync(bin, args, { stdio: 'ignore', timeout: 8000 }); ok.set(k, !r.error && r.status === 0); }
  return ok.get(k);
};

/** La génération de vidéo exige Chromium et ffmpeg (encodeur H.264). */
export function promoSupported(cfg) {
  const chromium = findChromium(cfg);
  const ffmpeg = cfg.ffmpegBin || 'ffmpeg';
  if (!chromium || !works(chromium)) return { ok: false, reason: "Chromium n'est pas installé sur ce serveur (variable CHROMIUM_BIN)." };
  if (!works(ffmpeg, ['-version'])) return { ok: false, reason: "ffmpeg n'est pas installé sur ce serveur." };
  return { ok: true };
}

// ---------- Protocole DevTools (WebSocket de Node) ----------

class Cdp {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.closed = false;
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', () => rej(new Error('Connexion à Chromium impossible')), { once: true }); });
    this.ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject, timer } = this.pending.get(m.id);
        this.pending.delete(m.id); clearTimeout(timer);
        if (m.error) reject(new Error(m.error.message || 'Erreur Chromium')); else resolve(m.result || {});
      } else if (m.method) for (const h of this.handlers.get(m.method) || []) h(m.params || {});
    });
    this.ws.addEventListener('close', () => this.fail(new Error('Chromium s\'est arrêté')));
  }

  fail(err) {
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(err); }
    this.pending.clear();
  }

  on(method, fn) { (this.handlers.get(method) || this.handlers.set(method, []).get(method)).push(fn); }

  send(method, params = {}, timeoutMs = PROMO.frameTimeoutMs) {
    if (this.closed) return Promise.reject(new Error('Chromium s\'est arrêté'));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chromium ne répond pas (${method})`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { try { this.ws.close(); } catch { /* déjà fermé */ } }
}

/** Lance Chromium (dans le bac à sable si activé) et renvoie { cdp, stop }. */
async function openBrowser(cfg, { width, height, signal }) {
  const bin = findChromium(cfg);
  if (!bin) throw new Error("Chromium n'est pas installé sur ce serveur.");
  const sandboxed = !!cfg.sandbox?.enabled;
  const profile = sandboxed ? '/tmp/chromium-profil' : mkdtempSync(join(tmpdir(), 'aitools-chromium-'));
  const args = [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-dev-shm-usage',
    '--disable-component-update', '--disable-features=Translate,MediaRouter',
    '--force-device-scale-factor=1', `--window-size=${width},${height}`,
    // Aucun nom ne se résout : une scène ne peut contacter personne, même si elle trouvait le moyen d'émettre une requête
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    // Le bac à sable de Chromium lui-même ne peut pas démarrer dans bwrap (espaces de noms imbriqués) ni en root : c'est bwrap qui isole
    ...(sandboxed || (process.getuid?.() === 0) ? ['--no-sandbox'] : []),
    'about:blank',
  ];
  const launch = prepareLaunch({ bin, args, cwd: null, secretEnv: {}, sandbox: cfg.sandbox });
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let cdp = null;
  let exited = false;
  child.on('exit', () => { exited = true; });
  // Arrêt : on tue Chromium, on attend qu'il soit vraiment parti (il écrit dans son profil jusqu'au bout), puis on efface le profil.
  // Le nettoyage ne doit jamais faire échouer un rendu réussi : toute erreur y est ignorée.
  const stop = async () => {
    try { cdp?.close(); } catch { /* rien */ }
    try { child.kill('SIGKILL'); } catch { /* déjà arrêté */ }
    for (let i = 0; i < 50 && !exited; i++) await new Promise((r) => setTimeout(r, 100));
    try { launch.cleanup(); } catch { /* rien */ }
    if (!sandboxed) { try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* sera effacé avec /tmp */ } }
  };
  signal?.addEventListener('abort', () => { stop(); }, { once: true });
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chromium ne démarre pas. ${stderr.slice(-300)}`)), 25_000);
      child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Chromium ne démarre pas : ${e.message}`)); });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chromium s'est arrêté (code ${code}). ${stderr.slice(-300)}`)); });
      child.stderr.on('data', (c) => {
        stderr = (stderr + c).slice(-4000);
        const m = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/\S+)/);
        if (m) { clearTimeout(timer); resolve({ port: m[2] }); }
      });
    });
    const list = await (await fetch(`http://127.0.0.1:${wsUrl.port}/json/list`, { signal: AbortSignal.timeout(10_000) })).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('Chromium : aucune page disponible');
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.ready;
    return { cdp, stop };
  } catch (e) { await stop(); throw e; }
}

/** Charge la scène dans la page. Lève une SceneError si elle ne définit pas renderFrame ou si elle plante au chargement. */
async function loadScene(cdp, html, { width, height }) {
  const errors = [];
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.exception?.description?.split('\n')[0] || p.exceptionDetails?.text || 'erreur JavaScript'));
  cdp.on('Fetch.requestPaused', (p) => { cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const { frameTree } = await cdp.send('Page.getFrameTree');
  await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  for (let i = 0; i < 50; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (r.result?.value === 'complete') break;
    await new Promise((res) => setTimeout(res, 100));
  }
  const has = await cdp.send('Runtime.evaluate', { expression: "typeof window.renderFrame === 'function'", returnByValue: true });
  if (has.result?.value !== true) throw new SceneError(`window.renderFrame n'est pas une fonction après le chargement${errors.length ? ` (erreur : ${errors[0]})` : ''}.`);
  // Une scène qui cherche à ouvrir une autre adresse est refusée aussitôt (sinon la capture reste bloquée sur la navigation en échec)
  cdp.on('Page.frameRequestedNavigation', () => { cdp.navigated = true; });
  return errors;
}

/** Une image : renderFrame(t), vérification qu'on est toujours sur la page, capture JPEG. */
async function shot(cdp, t) {
  // Chromium qui ne répond plus pendant une image = la scène le bloque (boucle infinie, navigation refusée…) : c'est un défaut de la scène
  const frozen = (e) => (/ne répond pas/.test(e.message) ? new SceneError(`La scène bloque l'affichage à t = ${Number(t).toFixed(2)} s (boucle infinie, navigation ou calcul trop long dans renderFrame).`) : e);
  let r;
  try {
    r = await cdp.send('Runtime.evaluate', {
      expression: `(async () => { await document.fonts.ready; await window.renderFrame(${Number(t)}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return location.href; })()`,
      awaitPromise: true, returnByValue: true,
    }, PROMO.frameTimeoutMs);
  } catch (e) { throw frozen(e); }
  if (cdp.navigated) throw new SceneError('La scène a quitté la page : rendu refusé.');
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new SceneError(`renderFrame(${Number(t).toFixed(2)}) a échoué : ${d.exception?.description?.split('\n')[0] || d.exception?.value || d.text}`);
  }
  if (r.result?.value !== 'about:blank') throw new SceneError('La scène a quitté la page : rendu refusé.');
  let s;
  try { s = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: true, optimizeForSpeed: true }); }
  catch (e) { throw cdp.navigated ? new SceneError('La scène a quitté la page : rendu refusé.') : frozen(e); }
  return Buffer.from(s.data, 'base64');
}

/** Tolérer le bruit de rasterisation, pas un changement de composition. */
export function rasterDifference(a, b) {
  if (!a?.length || a.length !== b?.length) throw new Error('Comparaison des images impossible');
  let changed = 0, total = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    total += delta;
    if (delta > 12) changed++;
  }
  const pixels = a.length / 4;
  return { changedRatio: changed / pixels, mean: total / pixels, different: changed / pixels > 0.015 && total / pixels > 0.5 };
}

export async function visiblyDifferent(cdp, a, b) {
  if (a.equals(b)) return false;
  const expression = `(async () => {
    const decode = async src => { const img = new Image(); img.src = src; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = Math.max(1, Math.round(160 * img.height / img.width));
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); return ctx.getImageData(0, 0, canvas.width, canvas.height).data; };
    return (${rasterDifference.toString()})(await decode("data:image/jpeg;base64,${a.toString('base64')}"), await decode("data:image/jpeg;base64,${b.toString('base64')}"));
  })()`;
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails || typeof result.result?.value?.different !== 'boolean') throw new SceneError('Le contrôle de stabilité des images est indisponible.');
  return result.result.value.different;
}


// ---------- Contrôle de qualité visuelle ----------
// Avant de rendre, la scène est parcourue (renderFrame à intervalles réguliers) et mesurée dans la page : place occupée, taille des titres, position du
// contenu, fond, mouvement. Une scène vide, minuscule, collée en haut, sur fond blanc ou figée est renvoyée à Claude avec ce qui ne va pas, une fois.

/** Fonction exécutée DANS la page : renvoie une mesure par instant. */
const MEASURE = String.raw`(async (times) => {
  const W = innerWidth, H = innerHeight, GX = 8, GY = 14;
  const SHAPES = new Set(['path','rect','circle','ellipse','line','polyline','polygon','image','canvas','text','use']);
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return c && c !== 'transparent' ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const lum = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return 0; const [r, g, b] = m[1].split(',').map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  const out = [];
  for (const t of times) {
    await window.renderFrame(t);
    const items = [];
    const textRects = [], clipped = [], collisions = [];
    let bgSolid = null, bgGradient = false;
    const all = document.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      let op = 1, hidden = false;
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.display === 'none') { hidden = true; break; }
        op *= parseFloat(c.opacity);
      }
      const cs = getComputedStyle(el);
      if (hidden || cs.visibility === 'hidden' || op < 0.2) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const x = Math.max(0, r.left), y = Math.max(0, r.top), w = Math.min(W, r.right) - x, h = Math.min(H, r.bottom) - y;
      if (w <= 0 || h <= 0) continue;
      const img = cs.backgroundImage || '';
      const big = w >= W * 0.8 && h >= H * 0.8;
      if (big) { if (/gradient/.test(img)) bgGradient = true; else if (alpha(cs.backgroundColor) > 0.9) bgSolid = cs.backgroundColor; continue; }
      let type = null, fs = 0;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own) { type = 'text'; fs = parseFloat(cs.fontSize); }
      else if (el instanceof SVGElement && SHAPES.has(el.tagName.toLowerCase())) type = 'shape';
      else if (alpha(cs.backgroundColor) > 0.04 || (img && img !== 'none') || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.1)) type = 'box';
      if (!type) continue;
      // Mesurer les glyphes eux-mêmes, avant découpe au viewport. Les entrées/sorties
      // à faible opacité ne comptent pas comme un texte établi et lisible.
      if (type === 'text' && op >= 0.85) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        const label = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 100);
        let cut = tr.left < -2 || tr.top < -2 || tr.right > W + 2 || tr.bottom > H + 2;
        for (let parent = el; parent && parent !== document.body; parent = parent.parentElement) {
          const pc = getComputedStyle(parent), pr = parent.getBoundingClientRect();
          if (/(hidden|clip|scroll|auto)/.test(pc.overflowX) && (tr.left < pr.left - 2 || tr.right > pr.right + 2)) cut = true;
          if (/(hidden|clip|scroll|auto)/.test(pc.overflowY) && (tr.top < pr.top - 2 || tr.bottom > pr.bottom + 2)) cut = true;
        }
        if (cut) clipped.push(label);
        if (tr.width > 2 && tr.height > 2) textRects.push({ el, r: tr, label });
      }
      // Halos et grilles de fond : décor, pas contenu
      if (type === 'box' && (/radial-gradient/.test(img) || (/gradient/.test(img) && w >= W * 0.8))) continue;
      items.push({ i, type, x, y, w, h, fs });
    }
    for (let i = 0; i < textRects.length; i++) for (let j = i + 1; j < textRects.length; j++) {
      const a = textRects[i], b = textRects[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      const area = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (w > 3 && h > 3 && w * h > area * 0.2) collisions.push(a.label + ' / ' + b.label);
    }
    const cells = new Set();
    for (const it of items) {
      const x0 = Math.floor(it.x / W * GX), x1 = Math.min(GX - 1, Math.floor((it.x + it.w) / W * GX));
      const y0 = Math.floor(it.y / H * GY), y1 = Math.min(GY - 1, Math.floor((it.y + it.h) / H * GY));
      for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) cells.add(a * 100 + b);
    }
    let cy = null;
    if (cells.size) { let s = 0; for (const c of cells) s += (c % 100 + 0.5) / GY; cy = s / cells.size; }
    const fonts = items.filter((n) => n.type === 'text').map((n) => n.fs);
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    out.push({ t, cover: cells.size / (GX * GY), cy, maxFont: fonts.length ? Math.max(...fonts) : 0, minFont: fonts.length ? Math.min(...fonts) : 0,
      clipped: clipped.slice(0, 10), collisions: collisions.slice(0, 10),
      count: items.length, boxes: items.map((n) => [n.i, Math.round(n.x), Math.round(n.y), Math.round(n.w), Math.round(n.h)]),
      bg: { solid: bgSolid || (alpha(bodyBg) > 0.9 ? bodyBg : null), gradient: bgGradient, lum: lum(bgSolid || bodyBg) } });
  }
  return out;
})`;

const median = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (x) => `${Math.round(x * 100)} %`;

/**
 * Juge les mesures. `errors` : défauts qui justifient de redemander la scène à Claude ; `notes` : constats à garder (affichés avec la vidéo).
 * Fonction pure : testée sans navigateur.
 */
export function judgeScene(metrics, { width, height }) {
  const errors = [];
  const notes = [];
  if (!metrics?.length) return { errors: ['Contrôle visuel impossible : aucune mesure de la scène.'], notes };
  for (const [field, label] of [['clipped', 'Texte coupé ou hors cadre'], ['collisions', 'Textes superposés']]) {
    const bad = metrics.filter((m) => m[field]?.length);
    if (bad.length >= 2 || metrics.at(-1)?.[field]?.length) {
      const examples = [...new Set(bad.flatMap((m) => m[field]))].slice(0, 3);
      errors.push(`${label} à ${bad[0].t?.toFixed(2) ?? '?'} s : ${examples.join(' ; ')}. Corrige les dimensions, les retours à la ligne et la visibilité des plans.`);
    }
  }
  const cover = median(metrics.map((m) => m.cover));
  const maxFont = median(metrics.filter((m) => m.maxFont > 0).map((m) => m.maxFont));
  const minFonts = metrics.filter((m) => m.minFont > 0).map((m) => m.minFont).sort((a, b) => a - b);
  const smallFont = minFonts.length ? minFonts[Math.floor(minFonts.length * 0.1)] : 0;
  const cy = median(metrics.filter((m) => m.cy != null).map((m) => m.cy));
  const empty = metrics.filter((m) => m.cover === 0).length / metrics.length;
  const side = Math.min(width, height); // les textes se jugent sur le petit côté : c'est lui qui limite leur largeur
  if (cover < 0.22) errors.push(`Trop de vide : en moyenne ${pct(cover)} de l'image est occupée par du contenu (vise au moins 30 %). Agrandis les éléments (la maquette ou l'illustration principale doit couvrir au moins 30 % de la largeur) et remplis l'image au lieu de la laisser blanche.`);
  if (maxFont && maxFont < side * 0.05) errors.push(`Titres trop petits : le plus grand texte fait ${Math.round(maxFont)} px sur une image de ${width} × ${height} px (${pct(maxFont / side)} du petit côté) ; vise au moins ${Math.round(side * 0.06)} px (6 % du petit côté) pour les titres.`);
  if (smallFont && smallFont < side * 0.03) errors.push(`Texte illisible : certains textes font ${Math.round(smallFont)} px (${pct(smallFont / side)} du petit côté) ; aucun texte ne doit descendre sous ${Math.round(side * 0.035)} px.`);
  if (cy && cy < 0.28) errors.push(`Le contenu est collé en haut de l'image (centre à ${pct(cy)} de la hauteur) : centre la composition verticalement, vers ${pct(0.5)}, et répartis les éléments sur toute la hauteur.`);
  if (cy && cy > 0.78) errors.push(`Le contenu est collé en bas de l'image (centre à ${pct(cy)} de la hauteur) : centre la composition verticalement.`);
  if (empty > 0.12) errors.push(`${pct(empty)} de la vidéo n'affiche aucun contenu (écran vide) : chaque seconde doit montrer quelque chose ; enchaîne les plans sans trou.`);
  const last = metrics[metrics.length - 1];
  if (last && last.cover < 0.1) errors.push("Le dernier plan est vide : il doit montrer le nom du produit (et l'adresse du site si elle est connue) jusqu'à la fin.");
  // Fond : un aplat blanc ou presque blanc, sans dégradé, ressemble à une diapositive vide
  const solidWhite = metrics.filter((m) => m.bg?.solid && !m.bg.gradient && m.bg.lum > 0.965).length / metrics.length;
  if (solidWhite > 0.5) errors.push('Fond blanc uni : utilise le dégradé et les halos de la direction artistique (jamais de fond blanc pur).');
  // Mouvement : parmi les éléments de contenu, combien bougent (position ou taille d'au moins ~1 px) entre deux instants voisins
  let still = 0;
  let steps = 0;
  for (let k = 1; k < metrics.length; k++) {
    const prev = new Map(metrics[k - 1].boxes.map((b) => [b[0], b]));
    let moved = false;
    for (const b of metrics[k].boxes) {
      const p = prev.get(b[0]);
      if (p && (Math.abs(b[1] - p[1]) >= 1 || Math.abs(b[2] - p[2]) >= 1 || Math.abs(b[3] - p[3]) >= 2 || Math.abs(b[4] - p[4]) >= 2)) { moved = true; break; }
    }
    steps++;
    if (!moved) still++;
  }
  const stillRatio = steps ? still / steps : 0;
  if (stillRatio > 0.4) errors.push(`Image figée : pendant ${pct(stillRatio)} du temps, aucun élément ne bouge. Ajoute un mouvement continu (légère flottaison des éléments, halos et grille de fond qui dérivent, compteurs qui avancent) en plus des entrées et sorties.`);
  notes.push(`Occupation de l'image : ${pct(cover)} · plus grand texte : ${pct(maxFont ? maxFont / side : 0)} du petit côté · mouvement : ${pct(1 - stillRatio)} du temps`);
  return { errors, notes };
}

/** Mesure la scène chargée : un instant toutes les ~0,5 s (au plus 80). */
export async function measureScene(cdp, { seconds }) {
  const step = Math.max(0.5, seconds / 80);
  const times = [];
  for (let t = 0; t < seconds; t += step) times.push(Number(t.toFixed(3)));
  times.push(Math.max(0, seconds - 0.05));
  const r = await cdp.send('Runtime.evaluate', { expression: `${MEASURE}(${JSON.stringify(times)})`, awaitPromise: true, returnByValue: true }, PROMO.frameTimeoutMs * 4);
  if (r.exceptionDetails) throw new SceneError(`Mesure de la scène impossible : ${r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text}`);
  return r.result?.value || [];
}

/**
 * Rend la scène en MP4 (`out`). Vérifie d'abord trois images (début, milieu, fin) : la scène doit se charger, ne pas planter et bouger.
 * @returns {Promise<{frames:number, bytes:number}>}
 * @throws SceneError : problème de la scène (renvoyé à Claude pour correction) ; Error : problème technique.
 */
export async function renderPromo({ cfg, html, fps, seconds, width, height, out, onProgress = () => {}, signal, quality = 'off' }) {
  const doc = prepareScene(html);
  const total = Math.round(fps * seconds);
  const ffmpegBin = cfg.ffmpegBin || 'ffmpeg';
  const { cdp, stop } = await openBrowser(cfg, { width, height, signal });
  let ff = null;
  const deadline = setTimeout(() => { stop(); }, PROMO.renderTimeoutMs);
  const aborted = () => { if (signal?.aborted) throw new Error('Annulé'); };
  try {
    await loadScene(cdp, doc, { width, height });
    // Contrôle : la scène doit changer au cours du temps
    await shot(cdp, 0); // première capture jetée : la toute première peinture peut différer des suivantes (polices, mise en page)
    const a = await shot(cdp, 0);
    const b = await shot(cdp, seconds / 2);
    const c = await shot(cdp, Math.max(0, seconds - 1 / fps));
    if (a.equals(b) && b.equals(c)) throw new SceneError("La scène ne bouge pas : renderFrame(t) doit modifier l'affichage en fonction de t (début, milieu et fin identiques).");
    // Le contrôle saute dans le temps avant le rendu : tous les plans doivent réinitialiser
    // leur état, sinon d'anciens titres restent visibles dans les images suivantes.
    const reset = await shot(cdp, 0);
    const middleAgain = await shot(cdp, seconds / 2);
    const badStart = await visiblyDifferent(cdp, a, reset);
    const badMiddle = await visiblyDifferent(cdp, b, middleAgain);
    if (badStart || badMiddle) throw new SceneError(`État visuel non déterministe : la composition change réellement à ${badStart ? '0' : (seconds / 2).toFixed(2)} s après un retour depuis un autre plan. Dans renderFrame(t), réinitialise explicitement l'opacité et les transformations de chaque élément AVANT d'afficher le plan courant. Utilise des conditions complètes (if/else), masque les plans inactifs et évite les opérations cumulatives (+=, *=) sur leur position. Renvoie le document corrigé.`);
    // Qualité visuelle : 'strict' renvoie la scène à Claude si elle est vide, minuscule, figée ou sur fond blanc ; 'warn' rend quand même et garde les constats
    let notes = [];
    if (quality !== 'off') {
      const verdict = judgeScene(await measureScene(cdp, { seconds }), { width, height });
      notes = verdict.notes;
      if (verdict.errors.length && quality === 'strict') throw new SceneError(`Qualité visuelle insuffisante, corrige : ${verdict.errors.join(' ')}`);
      if (verdict.errors.length) notes = [...verdict.errors.map((e) => `À améliorer : ${e}`), ...notes];
    }

    ff = spawn(ffmpegBin, [
      '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr = (ffErr + d).slice(-2000); });
    const done = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg a échoué : ${ffErr.trim().split('\n').pop() || `code ${code}`}`)))); });
    done.catch(() => {}); // l'erreur est relue plus bas ; évite un rejet non géré si ffmpeg s'arrête pendant les captures
    ff.stdin.on('error', () => {}); // idem : l'échec réel est dans `done`

    for (let i = 0; i < total; i++) {
      aborted();
      const buf = await shot(cdp, i / fps);
      if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res));
      if (i % Math.max(1, Math.round(total / 40)) === 0 || i === total - 1) onProgress({ done: i + 1, total });
    }
    ff.stdin.end();
    await done;
    return { frames: total, bytes: statSync(out).size, notes };
  } catch (e) {
    try { ff?.kill('SIGKILL'); } catch { /* déjà arrêté */ }
    rmSync(out, { force: true });
    throw e;
  } finally { clearTimeout(deadline); await stop(); }
}

/** Dossier de travail laissé par un rendu interrompu : rien à faire (le profil Chromium est dans /tmp), gardé pour les tests. */
export const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith('aitools-chromium-'));

