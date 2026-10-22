// Connexion guidée à Claude : le serveur lance `claude setup-token` pour l'utilisateur, lui donne le lien de connexion,
// puis, quand il recopie le petit code affiché par Claude, transmet ce code au CLI et capte le jeton produit.
// Le CLI a besoin d'un terminal : on le lance dans `script` (util-linux), avec un HOME jetable et un environnement assaini.
// Une seule connexion par utilisateur, 5 minutes au plus, quelques-unes en même temps sur le serveur.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomId } from './crypto.js';
import { HttpError } from './http.js';
import { buildChildEnv } from './services/sandbox.js';

const MAX_SESSIONS = 5;
const TTL_MS = 5 * 60_000;
const URL_WAIT_MS = 25_000;
const TOKEN_WAIT_MS = 45_000;
const MAX_OUTPUT = 64 * 1024;

const OSC_LINK = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/;
const TOKEN = /sk-ant-oat\d+-[A-Za-z0-9_-]{20,}/;
// Le CLI refuse un code expiré ou incorrect en affichant cette erreur, puis attend une nouvelle saisie
const REFUSED = /OAuth error|Press Enter to retry/i;
// Le CLI traite « code + Entrée » reçus d'un seul bloc comme du texte collé : l'Entrée part séparément, un instant après
const ENTER_DELAY_MS = 400;
const CODE_RE = /^[A-Za-z0-9_#.~-]{8,400}$/;
// Le lien affiché à l'utilisateur ne peut mener que chez Anthropic, même si la sortie du CLI était altérée
const ALLOWED_HOST = /(^|\.)(claude\.com|claude\.ai|anthropic\.com)$/;

const shq = (s) => `'${String(s).split("'").join("'\\''")}'`;
const busy = (msg) => new HttpError(503, msg, { expose: true });

/** Lien de connexion contenu dans la sortie du CLI (lien cliquable OSC 8, qui porte l'adresse complète), ou null. */
export function extractLoginUrl(out) {
  const m = OSC_LINK.exec(out);
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return u.protocol === 'https:' && ALLOWED_HOST.test(u.hostname) ? u.href : null;
  } catch { return null; }
}
/** Sortie du CLI lisible : sans séquences de terminal, et sans rien qui ressemble à un code ou un jeton. */
export function readableTail(out, max = 300) {
  return out
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[A-Za-z]/g, ' ')
    .replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
    .replace(/[A-Za-z0-9_#.~-]{24,}/g, '…')
    .trim().slice(-max);
}
// Le CLI affiche le jeton dans un terminal : selon la largeur, il peut être coupé par des retours à la ligne ou des
// séquences de déplacement du curseur, et les mots voisins ne sont pas toujours séparés par un espace. On prend donc tout
// ce qui se trouve entre « sk-ant- » et la phrase qui suit le jeton (« Store this token… »), puis on retire les blancs.
const TOKEN_END = /Store|You\s*won|Use\s*this/;
/**
 * Jeton d'abonnement contenu dans la sortie du CLI, ou null. Tant que la phrase de fin n'est pas arrivée le jeton peut
 * être incomplet : on attend, sauf si le CLI est terminé (`final`), auquel cas on prend jusqu'à la fin de la sortie.
 */
export function extractToken(out, final = false) {
  const text = out.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?<>=]*[A-Za-z]/g, ' ');
  const start = text.indexOf('sk-ant-oat') >= 0 ? text.indexOf('sk-ant-oat') : text.search(/sk-ant-\s*oat/);
  if (start < 0) return null;
  const rest = text.slice(start);
  const end = rest.search(TOKEN_END);
  if (end < 0 && !final) return null;
  const token = (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, '');
  return TOKEN.test(token) ? TOKEN.exec(token)[0] : null;
}

export class ClaudeLogins {
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

  /** Attend qu'une condition sur la sortie du CLI soit vraie, ou que le CLI se termine, ou le délai. */
  #waitFor(s, test, ms) {
    return new Promise((resolve) => {
      const check = () => { const v = test(s.out); if (v || s.done) { cleanup(); resolve(v || null); } };
      const t = setTimeout(() => { cleanup(); resolve(null); }, ms);
      const cleanup = () => { clearTimeout(t); s.events.off('data', check); };
      s.events.on('data', check);
      check();
    });
  }

  /** Lance le CLI et renvoie { id, url } dès que le lien de connexion est affiché. */
  async start(userId) {
    const { cfg } = this.app;
    userId = Number(userId);
    for (const [id, s] of this.sessions) if (s.userId === userId) this.#drop(id);
    if (this.sessions.size >= MAX_SESSIONS) throw busy('Beaucoup de monde se connecte en ce moment : réessaie dans une minute.');
    const home = mkdtempSync(join(tmpdir(), 'aitools-login-'));
    const id = randomId(18);
    const s = { userId, home, out: '', done: false, events: new (await import('node:events')).EventEmitter() };
    // stty : un terminal très large, pour que le jeton ne soit jamais coupé sur deux lignes
    const cmd = `stty cols 1000 rows 50; exec ${shq(cfg.claudeBin)} setup-token`;
    try {
      s.proc = spawn('script', ['-qefc', cmd, '/dev/null'], {
        cwd: home, env: buildChildEnv(process.env, { home }), stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      rmSync(home, { recursive: true, force: true });
      throw new HttpError(502, "Impossible de lancer la connexion à Claude sur le serveur. Préviens l'administrateur.", { expose: true });
    }
    const feed = (b) => { s.out = (s.out + b.toString('utf8')).slice(-MAX_OUTPUT); s.events.emit('data'); };
    s.proc.stdout.on('data', feed);
    s.proc.stderr.on('data', feed);
    s.proc.stdin.on('error', () => {});
    s.proc.on('error', () => { s.failed = true; s.done = true; s.events.emit('data'); });
    s.proc.on('close', () => { s.done = true; s.events.emit('data'); });
    s.timer = setTimeout(() => this.#drop(id), TTL_MS);
    s.timer.unref?.();
    this.sessions.set(id, s);

    const url = await this.#waitFor(s, extractLoginUrl, URL_WAIT_MS);
    if (!url) {
      this.#drop(id);
      throw new HttpError(502, "Claude n'a pas donné de lien de connexion (le CLI est-il installé sur le serveur ?). Réessaie, ou colle un jeton à la main.", { expose: true });
    }
    return { id, url };
  }

  /** Transmet le code recopié par l'utilisateur au CLI et renvoie le jeton produit. */
  async finish(userId, id, code) {
    const s = this.sessions.get(String(id));
    if (!s || s.userId !== Number(userId)) throw new HttpError(404, 'Connexion expirée : recommence.');
    const c = String(code ?? '').trim();
    if (!CODE_RE.test(c)) throw new HttpError(400, 'Ce code ne ressemble pas à celui de Claude : recopie-le en entier.');
    if (s.submitted) throw new HttpError(409, 'Code déjà envoyé : patiente un instant.');
    s.submitted = true;
    s.outAtSubmit = s.out.length;
    s.proc.stdin.write(c);
    await new Promise((r) => setTimeout(r, ENTER_DELAY_MS));
    s.proc.stdin.write('\r');
    const res = await this.#waitFor(s, (out) => extractToken(out, s.done) || (REFUSED.test(out.slice(s.outAtSubmit ?? 0)) ? 'refused' : null), TOKEN_WAIT_MS);
    const tail = readableTail(s.out.slice(s.outAtSubmit ?? 0));
    const exited = s.done;
    this.#drop(String(id));
    if (!res || res === 'refused') {
      // Ce que le CLI a vraiment répondu : indispensable pour distinguer un code périmé d'une panne (réseau, CLI)
      console.warn(`Connexion Claude refusée (compte ${userId}, CLI ${exited ? 'terminé' : 'actif'}) : ${tail}`);
      const detail = res === 'refused' ? (/status code (\d+)/i.exec(tail)?.[0] ?? 'erreur OAuth') : exited ? 'le CLI s\'est arrêté' : 'pas de réponse du CLI';
      throw new HttpError(400, `Claude n'a pas validé ce code (${detail}). Recommence depuis le début, avec une seule fenêtre de connexion, et colle le code dans la minute.`);
    }
    return res;
  }
}

/** Gestionnaire unique par application (créé à la première utilisation, arrêté avec elle). */
export const loginsOf = (app) => (app.claudeLogins ??= new ClaudeLogins(app));
