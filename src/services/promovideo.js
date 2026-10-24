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
  paysage: { label: 'Paysage 16:9 (1280 × 720)', width: 1280, height: 720 },
  vertical: { label: 'Vertical 9:16 (720 × 1280), pour les réseaux', width: 720, height: 1280 },
  carre: { label: 'Carré 1:1 (720 × 720)', width: 720, height: 720 },
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
  return { fps, seconds, format, subject };
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

/** Vérifie la scène avant tout rendu. Renvoie le document avec la CSP, ou lève une SceneError dont le message est renvoyé à Claude. */
export function prepareScene(html) {
  const doc = String(html || '');
  if (!doc.trim()) throw new SceneError("Aucun document HTML n'a été produit.");
  if (doc.length > PROMO.maxHtml) throw new SceneError(`La scène est trop longue (${doc.length} caractères, ${PROMO.maxHtml} au plus) : simplifie-la.`);
  if (!/window\.renderFrame\s*=|function\s+renderFrame\s*\(|renderFrame\s*=\s*(?:async\s*)?(?:function|\()/.test(doc)) {
    throw new SceneError('La scène doit définir window.renderFrame = function (t) { … } (t en secondes).');
  }
  for (const [re, what] of FORBIDDEN) if (re.test(doc)) throw new SceneError(`Interdit dans la scène : ${what}.`);
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
  const stop = () => {
    try { cdp?.close(); } catch { /* rien */ }
    try { child.kill('SIGKILL'); } catch { /* déjà arrêté */ }
    launch.cleanup();
    if (!sandboxed) rmSync(profile, { recursive: true, force: true });
  };
  signal?.addEventListener('abort', stop, { once: true });
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
  } catch (e) { stop(); throw e; }
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
      expression: `(async () => { await window.renderFrame(${Number(t)}); return location.href; })()`,
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

/**
 * Rend la scène en MP4 (`out`). Vérifie d'abord trois images (début, milieu, fin) : la scène doit se charger, ne pas planter et bouger.
 * @returns {Promise<{frames:number, bytes:number}>}
 * @throws SceneError : problème de la scène (renvoyé à Claude pour correction) ; Error : problème technique.
 */
export async function renderPromo({ cfg, html, fps, seconds, width, height, out, onProgress = () => {}, signal }) {
  const doc = prepareScene(html);
  const total = Math.round(fps * seconds);
  const ffmpegBin = cfg.ffmpegBin || 'ffmpeg';
  const { cdp, stop } = await openBrowser(cfg, { width, height, signal });
  let ff = null;
  const deadline = setTimeout(stop, PROMO.renderTimeoutMs);
  const aborted = () => { if (signal?.aborted) throw new Error('Annulé'); };
  try {
    await loadScene(cdp, doc, { width, height });
    // Contrôle : la scène doit changer au cours du temps
    await shot(cdp, 0); // première capture jetée : la toute première peinture peut différer des suivantes (polices, mise en page)
    const a = await shot(cdp, 0);
    const b = await shot(cdp, seconds / 2);
    const c = await shot(cdp, Math.max(0, seconds - 1 / fps));
    if (a.equals(b) && b.equals(c)) throw new SceneError("La scène ne bouge pas : renderFrame(t) doit modifier l'affichage en fonction de t (début, milieu et fin identiques).");

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
    return { frames: total, bytes: statSync(out).size };
  } catch (e) {
    try { ff?.kill('SIGKILL'); } catch { /* déjà arrêté */ }
    rmSync(out, { force: true });
    throw e;
  } finally { clearTimeout(deadline); stop(); }
}

/** Dossier de travail laissé par un rendu interrompu : rien à faire (le profil Chromium est dans /tmp), gardé pour les tests. */
export const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith('aitools-chromium-'));
