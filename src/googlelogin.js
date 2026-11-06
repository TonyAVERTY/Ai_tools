// Connexion guidée à Google (abonnement Google AI) : le serveur lance Antigravity CLI (`agy`) pour l'utilisateur, lui donne le lien de connexion,
// puis, quand il recopie le code que Google affiche, transmet ce code au CLI et capte le fichier de connexion qu'il écrit.
// Comportement observé sur un vrai agy 1.5.2 : sans connexion, `agy -p …` affiche « Authentication required. Please visit the URL to log in: <lien> »,
// puis « Waiting for authentication (timeout 60s)… Or paste the authorization code here and press Enter » : le code se donne sur l'entrée standard,
// et le CLI n'attend que 60 secondes. Le HOME est jetable (le fichier de connexion y est écrit, jamais ailleurs), l'environnement assaini.
// Le lancement exécute aussi une toute petite demande (« ok ») : tous les outils sont refusés (mêmes règles que le moteur, providers/agy.js).
// Une seule connexion par utilisateur, quelques-unes en même temps sur le serveur.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomId } from './crypto.js';
import { HttpError } from './http.js';
import { buildChildEnv } from './services/sandbox.js';
import { buildArgs, TOKEN_FILE, CATALOG_DEFAULT } from './services/providers/agy.js';

const MAX_SESSIONS = 5;
/** Durée pendant laquelle agy attend le code (60 s) : on garde une marge, la page affiche ce compte à rebours. */
export const CODE_WINDOW_S = 55;
const TTL_MS = 3 * 60_000;
const URL_WAIT_MS = 25_000;
const FINISH_WAIT_MS = 90_000;
const MAX_OUTPUT = 64 * 1024;
// Le lien affiché à l'utilisateur ne peut mener que chez Google, même si la sortie du CLI était altérée
const ALLOWED_HOST = /^accounts\.google\.com$/;
// Le code d'autorisation : lettres, chiffres et quelques signes (« 4/0A… »). Jamais d'espace ni de saut de ligne : rien d'autre n'atteint le CLI.
const CODE_RE = /^[A-Za-z0-9_\-/.~#%]{8,600}$/;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const clean = (out) => String(out).replace(ANSI, '').replace(/\r/g, '');
const busy = (msg) => new HttpError(503, msg, { expose: true });

/** Lien de connexion contenu dans la sortie du CLI (https, chez Google, SANS coupure : toute l'adresse), ou null. */
export function extractLoginUrl(out) {
  for (const m of clean(out).matchAll(/https:\/\/[^\s"'<>)]+/g)) {
    try {
      const u = new URL(m[0].replace(/[.,;]+$/, ''));
      if (u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname) && u.searchParams.has('response_type')) return u.href;
    } catch { /* pas un lien */ }
  }
  return null;
}

/** Ce qui s'affiche, sur une ligne, sans lien (pour les journaux). */
export const readableTail = (out, max = 300) => clean(out).replace(/https?:\/\/\S+/g, '…').replace(/\s+/g, ' ').trim().slice(-max);

export class GoogleLogins {
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

  /** Lance le CLI et renvoie { id, url, expiresIn } dès que le lien est affiché. */
  async start(userId) {
    const { cfg } = this.app;
    userId = Number(userId);
    for (const [id, s] of this.sessions) if (s.userId === userId) this.#drop(id);
    if (this.sessions.size >= MAX_SESSIONS) throw busy('Beaucoup de monde se connecte en ce moment : réessaie dans une minute.');
    const home = mkdtempSync(join(tmpdir(), 'aitools-google-login-'));
    mkdirSync(join(home, ...TOKEN_FILE.slice(0, -1)), { recursive: true, mode: 0o700 });
    const id = randomId(18);
    const s = { userId, home, out: '', done: false, exit: null, events: new EventEmitter() };
    try {
      s.proc = spawn(cfg.agyBin, buildArgs({ prompt: 'Réponds uniquement : ok', model: CATALOG_DEFAULT, tools: [], maxTurns: 1 }), {
        cwd: home, env: buildChildEnv(process.env, { home }), stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      rmSync(home, { recursive: true, force: true });
      throw new HttpError(502, "Impossible de lancer la connexion à Google sur le serveur. Préviens l'administrateur.", { expose: true });
    }
    const feed = (b) => { s.out = (s.out + b.toString('utf8')).slice(-MAX_OUTPUT); s.events.emit('data'); };
    s.proc.stdout.on('data', feed);
    s.proc.stderr.on('data', feed);
    s.proc.stdin.on('error', () => {});
    s.proc.on('error', () => { s.done = true; s.events.emit('data'); });
    s.proc.on('close', (code) => { s.done = true; s.exit = code; s.events.emit('data'); });
    s.timer = setTimeout(() => this.#drop(id), TTL_MS);
    s.timer.unref?.();
    this.sessions.set(id, s);

    const url = await this.#waitFor(s, extractLoginUrl, URL_WAIT_MS);
    if (!url) {
      console.warn(`Connexion Google : pas de lien (compte ${userId}, CLI ${s.done ? 'terminé' : 'actif'}) : ${readableTail(s.out)}`);
      this.#drop(id);
      throw new HttpError(502, "Google n'a pas donné de lien de connexion : Antigravity CLI (agy) est-il installé sur le serveur ? Préviens l'administrateur.", { expose: true });
    }
    s.startedAt = Date.now();
    return { id, url, expiresIn: CODE_WINDOW_S };
  }

  /**
   * L'utilisateur a recopié le code : il est transmis au CLI, qui écrit son fichier de connexion puis répond à sa petite demande.
   * Renvoie le fichier de connexion. 404 si la session a expiré, 400 si le code a un format impossible ou est refusé.
   */
  async finish(userId, id, code) {
    const s = this.sessions.get(String(id));
    if (!s || s.userId !== Number(userId)) throw new HttpError(404, 'Connexion expirée : recommence.');
    const c = String(code ?? '').trim();
    if (!CODE_RE.test(c)) throw new HttpError(400, 'Code invalide : recopie-le en entier, sans espace, tel que Google l\'affiche.');
    if (s.done) { this.#drop(String(id)); throw new HttpError(400, 'Le délai de Google est passé (60 secondes) : recommence, avec un nouveau lien.'); }
    s.proc.stdin.write(`${c}\n`);
    await new Promise((resolve) => {
      if (s.done) return resolve();
      const t = setTimeout(resolve, FINISH_WAIT_MS);
      const check = () => { if (s.done) { clearTimeout(t); s.events.off('data', check); resolve(); } };
      s.events.on('data', check);
    });
    let authFile = '';
    try { authFile = readFileSync(join(s.home, ...TOKEN_FILE), 'utf8'); } catch { /* pas de fichier : code refusé */ }
    const tail = readableTail(s.out);
    this.#drop(String(id));
    if (!authFile.trim()) {
      console.warn(`Connexion Google refusée (compte ${Number(userId)}) : ${tail}`);
      throw new HttpError(400, "Google a refusé le code (code faux, périmé, ou délai de 60 secondes passé). Recommence avec un nouveau lien.");
    }
    return authFile;
  }
}

/** Gestionnaire unique par application (créé à la première utilisation, arrêté avec elle). */
export const googleLoginsOf = (app) => (app.googleLogins ??= new GoogleLogins(app));
