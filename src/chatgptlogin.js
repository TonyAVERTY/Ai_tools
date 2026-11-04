// Connexion guidée à ChatGPT : le serveur lance `codex login --device-auth` pour l'utilisateur (connexion par code d'appareil, la méthode
// que la documentation d'OpenAI indique pour un serveur sans navigateur), lui donne le lien et le code à saisir, puis capte le fichier de
// connexion (auth.json) que Codex écrit une fois la connexion validée sur chatgpt.com. L'utilisateur n'a rien à recopier vers AiTools.
// Prérequis côté compte ChatGPT : « Enable device code login » dans ses paramètres de sécurité (la doc le dit ; le message d'échec le rappelle).
// Une seule connexion par utilisateur, 15 minutes au plus (durée de vie d'un code), quelques-unes en même temps sur le serveur.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomId } from './crypto.js';
import { HttpError } from './http.js';
import { buildChildEnv } from './services/sandbox.js';

const MAX_SESSIONS = 5;
const TTL_MS = 15 * 60_000;
const LINK_WAIT_MS = 25_000;
const MAX_OUTPUT = 64 * 1024;
// Le lien affiché à l'utilisateur ne peut mener que chez OpenAI, même si la sortie du CLI était altérée
const ALLOWED_HOST = /(^|\.)(openai\.com|chatgpt\.com)$/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CODE_RE = /\b([A-Z0-9]{4,}(?:-[A-Z0-9]{3,}){1,2})\b/;

const busy = (msg) => new HttpError(503, msg, { expose: true });
const clean = (out) => String(out).replace(ANSI, '').replace(/\r/g, '');

/** Lien de connexion contenu dans la sortie du CLI (https, chez OpenAI), ou null. */
export function extractLoginUrl(out) {
  for (const m of clean(out).matchAll(/https:\/\/[^\s"'<>)]+/g)) {
    try {
      const u = new URL(m[0].replace(/[.,;]+$/, ''));
      if (u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname)) return u.href;
    } catch { /* pas un lien */ }
  }
  return null;
}

/** Code à saisir sur la page de connexion (une ligne qui parle de « code » en priorité, sinon le premier motif XXXX-XXXX), ou null. */
export function extractUserCode(out) {
  const lines = clean(out).split('\n');
  for (const l of lines) if (/code/i.test(l)) { const m = CODE_RE.exec(l); if (m) return m[1]; }
  const m = CODE_RE.exec(clean(out).split('\n').filter((l) => !/https?:\/\//.test(l)).join('\n'));
  return m ? m[1] : null;
}

/** Ce qui s'affiche, sur une ligne, sans lien ni code (pour les journaux). */
export const readableTail = (out, max = 300) => clean(out).replace(/https?:\/\/\S+/g, '…').replace(CODE_RE, '…').replace(/\s+/g, ' ').trim().slice(-max);

export class ChatgptLogins {
  constructor(app) { this.app = app; this.sessions = new Map(); }

  #drop(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    clearTimeout(s.timer);
    try { s.proc.kill('SIGKILL'); } catch { /* déjà terminé */ }
    rmSync(s.home, { recursive: true, force: true });
  }

  cancel(userId, id) {
    const s = this.sessions.get(id);
    if (s && s.userId === Number(userId)) this.#drop(id);
  }

  closeAll() { for (const id of [...this.sessions.keys()]) this.#drop(id); }

  #waitFor(s, test, ms) {
    return new Promise((resolve) => {
      const check = () => { const v = test(s.out); if (v || s.done) { cleanup(); resolve(v || null); } };
      const t = setTimeout(() => { cleanup(); resolve(null); }, ms);
      const cleanup = () => { clearTimeout(t); s.events.off('data', check); };
      s.events.on('data', check);
      check();
    });
  }

  /** Lance le CLI et renvoie { id, url, code } dès que le lien et le code sont affichés. */
  async start(userId) {
    const { cfg } = this.app;
    userId = Number(userId);
    for (const [id, s] of this.sessions) if (s.userId === userId) this.#drop(id);
    if (this.sessions.size >= MAX_SESSIONS) throw busy('Beaucoup de monde se connecte en ce moment : réessaie dans une minute.');
    const home = mkdtempSync(join(tmpdir(), 'aitools-chatgpt-login-'));
    // Codex doit ranger sa connexion dans un FICHIER (et non dans le trousseau du système) pour qu'on puisse la lire
    writeFileSync(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
    const id = randomId(18);
    const s = { userId, home, out: '', done: false, code: null, events: new EventEmitter() };
    try {
      s.proc = spawn(cfg.codexBin, ['login', '--device-auth'], {
        cwd: home, env: buildChildEnv(process.env, { home, extraEnv: { CODEX_HOME: home } }), stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      rmSync(home, { recursive: true, force: true });
      throw new HttpError(502, "Impossible de lancer la connexion à ChatGPT sur le serveur. Préviens l'administrateur.", { expose: true });
    }
    const feed = (b) => { s.out = (s.out + b.toString('utf8')).slice(-MAX_OUTPUT); s.events.emit('data'); };
    s.proc.stdout.on('data', feed);
    s.proc.stderr.on('data', feed);
    s.proc.on('error', () => { s.failed = true; s.done = true; s.events.emit('data'); });
    s.proc.on('close', (code) => { s.done = true; s.exit = code; s.events.emit('data'); });
    s.timer = setTimeout(() => this.#drop(id), TTL_MS);
    s.timer.unref?.();
    this.sessions.set(id, s);

    const ready = await this.#waitFor(s, (out) => { const url = extractLoginUrl(out); const code = extractUserCode(out); return url && code ? { url, code } : null; }, LINK_WAIT_MS);
    if (!ready) {
      console.warn(`Connexion ChatGPT : pas de lien ni de code (compte ${userId}, CLI ${s.done ? 'terminé' : 'actif'}) : ${readableTail(s.out)}`);
      this.#drop(id);
      throw new HttpError(502, "ChatGPT n'a pas donné de lien de connexion : le CLI Codex est-il installé sur le serveur, et la « connexion par code d'appareil » activée dans les paramètres de sécurité de ton compte ChatGPT ? Réessaie, ou colle ton fichier de connexion.", { expose: true });
    }
    return { id, ...ready };
  }

  /**
   * Où en est la connexion ? Lecture seule, appelée toutes les 2 s par la page : { state: 'pending' } tant que l'utilisateur n'a pas validé,
   * { state: 'ready' } quand Codex a écrit sa connexion (la session reste ouverte jusqu'à `finish`), { state: 'failed', message } si le CLI
   * s'est arrêté sans connexion (la session est alors fermée) ; 404 si elle a expiré.
   */
  poll(userId, id) {
    const s = this.sessions.get(String(id));
    if (!s || s.userId !== Number(userId)) throw new HttpError(404, 'Connexion expirée : recommence.');
    if (!s.done) return { state: 'pending' };
    if (s.ready) return { state: 'ready' };
    let ok = false;
    try { ok = !!readFileSync(join(s.home, 'auth.json'), 'utf8').trim() && s.exit === 0; } catch { /* pas de fichier */ }
    if (ok) { s.ready = true; return { state: 'ready' }; }
    const tail = readableTail(s.out);
    this.#drop(String(id));
    console.warn(`Connexion ChatGPT échouée (compte ${userId}, code ${s.exit}) : ${tail}`);
    return { state: 'failed', message: "ChatGPT n'a pas validé la connexion (code refusé, expiré, ou connexion par code d'appareil non activée dans ton compte). Recommence." };
  }

  /** Une fois la connexion prête : rend le fichier de connexion et ferme la session. 409 tant que l'utilisateur n'a pas validé. */
  finish(userId, id) {
    const s = this.sessions.get(String(id));
    if (!s || s.userId !== Number(userId)) throw new HttpError(404, 'Connexion expirée : recommence.');
    if (!s.ready) throw new HttpError(409, "La connexion n'est pas encore validée : valide-la sur chatgpt.com.", { expose: true });
    let authJson = '';
    try { authJson = readFileSync(join(s.home, 'auth.json'), 'utf8'); } catch { /* signalé ci-dessous */ }
    this.#drop(String(id));
    if (!authJson) throw new HttpError(502, "ChatGPT n'a pas renvoyé de connexion utilisable. Recommence.", { expose: true });
    return authJson;
  }
}

/** Gestionnaire unique par application (créé à la première utilisation, arrêté avec elle). */
export const chatgptLoginsOf = (app) => (app.chatgptLogins ??= new ChatgptLogins(app));
