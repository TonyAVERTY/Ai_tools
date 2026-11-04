// Pièces jointes de la page IA : images, PDF, fichiers texte, vidéos. Stockées dans le dossier de l'utilisateur (supprimé avec son compte), jamais
// servies à un autre compte, jamais exécutées. Le type est reconnu à la SIGNATURE du fichier (pas à son nom ni à ce que le navigateur annonce).
// Une vidéo n'est pas lue par Claude : on en tire quelques images (ffmpeg, lancé dans le même bac à sable que Claude), le son n'est pas analysé.
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync, existsSync, linkSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { HttpError, json } from './http.js';
import { now } from './db.js';
import { userChatRoot } from './users.js';
import { prepareLaunch } from './services/sandbox.js';

const MB = 1024 * 1024;
export const FILES = {
  perMessage: 6,
  maxBytes: { image: 10 * MB, pdf: 20 * MB, text: 1 * MB, video: 50 * MB },
  perUser: 300 * MB,        // espace total par compte
  frames: 8,                // images tirées d'une vidéo
  frameWidth: 1024,
  maxVideoSeconds: 3600,
  pendingHours: 24,         // une pièce jointe jamais envoyée est supprimée après ce délai
  sniffBytes: 8192,
  ffmpegTimeoutMs: 60_000,
};
export const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'php', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'cs', 'sql', 'sh', 'vue', 'svelte']);
const VIDEO_BRANDS = /^(isom|iso\d|mp4\d|mp41|mp42|avc1|M4V |qt  |3gp\d|3g2\d|mmp4|dash|MSNV|f4v )/;

const ascii = (b, from, to) => b.subarray(from, to).toString('latin1');

/**
 * Type d'un fichier d'après ses premiers octets. `null` si non pris en charge (archives, exécutables, SVG, audio…).
 * @param {Buffer} head  les premiers octets (8 Ko au plus)
 * @param {string} name  nom d'origine (n'intervient que pour choisir l'extension d'un fichier texte)
 * @returns {{kind: 'image'|'pdf'|'text'|'video', mime: string, ext: string} | null}
 */
export function sniff(head, name = '') {
  const b = Buffer.from(head);
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG') return { kind: 'image', mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { kind: 'image', mime: 'image/gif', ext: 'gif' };
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp', ext: 'webp' };
  if (ascii(b, 0, 5) === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (!VIDEO_BRANDS.test(brand)) return null; // M4A et autres audio, HEIC…
    return brand === 'qt  ' ? { kind: 'video', mime: 'video/quicktime', ext: 'mov' } : { kind: 'video', mime: 'video/mp4', ext: 'mp4' };
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', mime: 'video/webm', ext: 'webm' };
  // Texte : extension connue, aucun octet nul, UTF-8 valide (on tolère un caractère coupé à la fin des octets lus)
  const ext = String(name).toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? '';
  if (TEXT_EXT.has(ext) && b.length && !b.includes(0)) {
    const dec = new TextDecoder('utf-8', { fatal: true });
    for (let cut = 0; cut <= 3 && cut < b.length; cut++) {
      try { dec.decode(b.subarray(0, b.length - cut)); return { kind: 'text', mime: 'text/plain; charset=utf-8', ext }; } catch { /* caractère coupé : on réessaie un octet plus court */ }
    }
  }
  return null;
}

/** Nom d'origine affiché : sans chemin ni caractère de contrôle, borné. Jamais utilisé comme nom de fichier sur le disque. */
export function displayName(raw) {
  const base = String(raw ?? '').replace(/[\\/]+/g, '/').split('/').pop().replace(/[\u0000-\u001f\u007f<>"]/g, '').replace(/\s+/g, ' ').trim();
  return (base || 'fichier').slice(0, 120);
}

export const attachmentDir = (cfg, userId, id) => join(userChatRoot(cfg, userId), 'files', String(Number(id)));

const shape = (r) => {
  let meta = null;
  try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* meta illisible : ignorée */ }
  return {
    id: Number(r.id), kind: r.kind, name: r.name, size: Number(r.size) || 0, mime: r.mime || null,
    projectId: r.project_id == null ? null : Number(r.project_id), messageId: r.message_id == null ? null : Number(r.message_id),
    ...(meta ? { meta } : {}),
  };
};
export const shapeAttachment = shape;

/** Supprime les fichiers de ces pièces jointes (les lignes partent avec la conversation ou le message, par cascade). */
export function removeAttachmentFiles(cfg, userId, rows) {
  for (const r of rows) if (r.kind !== 'project') rmSync(attachmentDir(cfg, userId, r.id), { recursive: true, force: true });
}

/** Pièces jointes de toute une conversation, pour effacer leurs fichiers avant de supprimer la conversation. */
export async function conversationAttachments(db, convId) {
  return db.prepare('SELECT id, kind FROM chat_attachments WHERE conversation_id = ?').all(Number(convId));
}

/** Pièces jointes jamais envoyées (téléversées puis abandonnées) : supprimées après `pendingHours`. */
export async function purgePendingUploads(app, at = now()) {
  const old = await app.db.prepare('SELECT id, user_id, kind FROM chat_attachments WHERE message_id IS NULL AND kind <> ? AND created_at < ?').all('project', at - FILES.pendingHours * 3600);
  for (const r of old) {
    rmSync(attachmentDir(app.cfg, r.user_id, r.id), { recursive: true, force: true });
    await app.db.prepare('DELETE FROM chat_attachments WHERE id = ?').run(r.id);
  }
  return old.length;
}

/** Dossiers de travail laissés par un arrêt brutal du serveur (plus d'une heure) : supprimés. */
export async function sweepRunDirs(cfg, at = Date.now()) {
  const root = join(cfg.dataDir, 'chat');
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const user of readdirSync(root)) {
    const runs = join(root, user, 'run');
    if (!existsSync(runs)) continue;
    for (const d of readdirSync(runs)) {
      try { if (at - statSync(join(runs, d)).mtimeMs > 3600_000) { rmSync(join(runs, d), { recursive: true, force: true }); n++; } } catch { /* déjà supprimé */ }
    }
  }
  return n;
}

// ---------- ffmpeg / ffprobe, dans le bac à sable ----------

const toolOk = new Map();
export function toolAvailable(bin) {
  if (!toolOk.has(bin)) { const r = spawnSync(bin, ['-version'], { stdio: 'ignore', timeout: 5000 }); toolOk.set(bin, !r.error && r.status === 0); }
  return toolOk.get(bin);
}
export const videoSupported = (cfg) => toolAvailable(cfg.ffmpegBin || 'ffmpeg') && toolAvailable(cfg.ffprobeBin || 'ffprobe');

/** Lance un outil (dossier `dir` monté en lecture seule, aucun secret), renvoie sa sortie. */
function runTool(cfg, userId, bin, args, dir, { timeoutMs = FILES.ffmpegTimeoutMs, maxOut = 12 * MB } = {}) {
  const launch = prepareLaunch({ bin, args, cwd: dir, allowedRoot: userChatRoot(cfg, userId), secretEnv: {}, sandbox: cfg.sandbox });
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    let size = 0;
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c) => { size += c.length; if (size > maxOut) child.kill('SIGKILL'); else out.push(c); });
    child.stderr.on('data', (c) => { err = (err + c).slice(-3000); });
    child.on('error', (e) => { clearTimeout(timer); launch.cleanup(); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); launch.cleanup(); resolve({ code, stdout: Buffer.concat(out), stderr: err }); });
  });
}

/** Coupe un flux de JPEG concaténés (image2pipe) en images séparées. */
export function splitJpegs(buf) {
  const frames = [];
  let start = -1;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && start < 0) start = i;
    else if (buf[i] === 0xff && buf[i + 1] === 0xd9 && start >= 0 && (i + 2 >= buf.length || (buf[i + 2] === 0xff && buf[i + 3] === 0xd8))) { frames.push(buf.subarray(start, i + 2)); start = -1; i++; }
  }
  return frames;
}

/**
 * Tire quelques images régulièrement espacées d'une vidéo et les écrit à côté (frame-1.jpg…).
 * @returns {Promise<{duration: number, width: number, height: number, frames: number}>}
 */
export async function extractFrames(cfg, userId, dir, file) {
  const ffmpeg = cfg.ffmpegBin || 'ffmpeg';
  const ffprobe = cfg.ffprobeBin || 'ffprobe';
  const input = join(dir, file);
  const probe = await runTool(cfg, userId, ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', input], dir, { timeoutMs: 20_000, maxOut: MB });
  let info = null;
  try { info = JSON.parse(probe.stdout.toString('utf8')); } catch { /* sortie illisible */ }
  const st = info?.streams?.[0];
  const duration = Number(info?.format?.duration);
  if (probe.code !== 0 || !st || !(duration > 0)) throw new HttpError(415, "Cette vidéo n'a pas pu être lue (fichier abîmé ou format non pris en charge).", { expose: true });
  if (duration > FILES.maxVideoSeconds) throw new HttpError(413, `Vidéo trop longue (${Math.round(FILES.maxVideoSeconds / 60)} minutes au plus).`, { expose: true });
  const step = Math.max(0.5, duration / FILES.frames);
  const r = await runTool(cfg, userId, ffmpeg, [
    '-nostdin', '-hide_banner', '-v', 'error', '-threads', '1', '-i', input, '-an', '-sn',
    '-vf', `fps=1/${step.toFixed(3)},scale='min(${FILES.frameWidth},iw)':-2`, '-frames:v', String(FILES.frames),
    '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1',
  ], dir, { maxOut: 16 * MB });
  const frames = splitJpegs(r.stdout);
  if (!frames.length) throw new HttpError(415, "Aucune image n'a pu être tirée de cette vidéo.", { expose: true });
  frames.forEach((f, i) => writeFileSync(join(dir, `frame-${i + 1}.jpg`), f));
  return { duration: Math.round(duration * 10) / 10, width: Number(st.width) || 0, height: Number(st.height) || 0, frames: frames.length };
}

// ---------- Dossier de travail d'un tour de conversation ----------

/**
 * Rassemble les fichiers à lire dans un dossier jetable (liens physiques, sinon copies) : Claude n'a accès qu'à lui, en lecture seule.
 * @param {Array<{id:number, kind:string, name:string, file?:string, meta?:object}>} atts  pièces jointes (hors projets)
 * @returns {{dir: string, files: Array<{att: object, paths: string[]}>, cleanup: () => void}}
 */
export function prepareRunDir(cfg, userId, atts) {
  const dir = join(userChatRoot(cfg, userId), 'run', randomBytes(8).toString('hex'));
  mkdirSync(dir, { recursive: true });
  const put = (src, name) => {
    const dest = join(dir, name);
    try { linkSync(src, dest); } catch { copyFileSync(src, dest); }
    return dest;
  };
  const files = [];
  for (const att of atts) {
    const src = attachmentDir(cfg, userId, att.id);
    if (!existsSync(src)) continue;
    const paths = [];
    const main = readdirSync(src).find((f) => f.startsWith('file.'));
    if (att.kind === 'video') {
      for (let i = 1; i <= (att.meta?.frames || 0); i++) if (existsSync(join(src, `frame-${i}.jpg`))) paths.push(put(join(src, `frame-${i}.jpg`), `${att.id}-image-${i}.jpg`));
    } else if (main) paths.push(put(join(src, main), `${att.id}-${main.replace(/^file/, 'fichier')}`));
    if (paths.length) files.push({ att, paths });
  }
  return { dir, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------- Routes ----------

export function registerChatFileRoutes(router, app) {
  const { db, cfg } = app;

  // Envoi d'un fichier : le corps de la requête EST le fichier (pas de multipart). Nom d'origine dans X-File-Name (encodé).
  router.post('/api/chat/upload', async ({ req, res, session }) => {
    const userId = session.userId;
    const declared = Number(req.headers['content-length']);
    const biggest = Math.max(...Object.values(FILES.maxBytes));
    const refuse = (status, msg) => new HttpError(status, msg, { expose: true });
    if (!Number.isFinite(declared) || declared <= 0) throw refuse(411, 'Taille du fichier manquante.');
    if (declared > biggest) throw refuse(413, `Fichier trop gros (${Math.round(biggest / MB)} Mo au plus).`);
    const used = Number((await db.prepare('SELECT COALESCE(SUM(size), 0) n FROM chat_attachments WHERE user_id = ?').get(userId)).n);
    if (used + declared > FILES.perUser) throw refuse(413, `Espace plein (${Math.round(FILES.perUser / MB)} Mo) : supprime des conversations avec des pièces jointes.`);
    const pending = Number((await db.prepare('SELECT COUNT(*) n FROM chat_attachments WHERE user_id = ? AND message_id IS NULL AND kind <> ?').get(userId, 'project')).n);
    if (pending >= FILES.perMessage * 2) throw refuse(429, 'Trop de fichiers en attente : envoie ton message ou retire-en.');
    let name = '';
    try { name = displayName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch { name = displayName(''); }

    // Le corps de la requête est lu par un flux : les premiers octets donnent le type (donc la limite), la suite va au disque.
    // Une erreur n'abîme pas la requête : le serveur répond normalement (le reste du corps est jeté par Node).
    let id = null;
    let dir = null;
    let out = null;
    let size = 0;
    let type = null;
    let phase = 'sniff';
    const head = [];
    let headLen = 0;
    const put = (c) => new Promise((ok, ko) => {
      size += c.length;
      if (size > declared + 1024) return ko(refuse(400, 'Envoi incohérent : réessaie.'));
      out.write(c, (e) => (e ? ko(e) : ok()));
    });
    const begin = async (buf) => {
      type = sniff(buf.subarray(0, FILES.sniffBytes), name);
      if (!type) throw refuse(415, 'Type de fichier non pris en charge (images, PDF, fichiers texte et vidéos MP4, MOV ou WebM).');
      if (declared > FILES.maxBytes[type.kind]) throw refuse(413, `Fichier trop gros pour ce type (${Math.round(FILES.maxBytes[type.kind] / MB)} Mo au plus).`);
      if (type.kind === 'video' && !videoSupported(cfg)) throw refuse(415, 'Les vidéos ne sont pas prises en charge sur ce serveur.');
      id = Number((await db.prepare('INSERT INTO chat_attachments(user_id, kind, name, mime, size, file, created_at) VALUES(?, ?, ?, ?, 0, ?, ?)').run(userId, type.kind, name, type.mime, `file.${type.ext}`, now())).lastInsertRowid);
      dir = attachmentDir(cfg, userId, id);
      mkdirSync(dir, { recursive: true });
      out = createWriteStream(join(dir, `file.${type.ext}`));
      phase = 'body';
      await put(buf);
    };
    const sink = new Writable({
      write(chunk, _enc, cb) {
        (async () => {
          if (phase === 'body') return put(chunk);
          head.push(chunk);
          headLen += chunk.length;
          if (headLen >= Math.min(FILES.sniffBytes, declared)) await begin(Buffer.concat(head));
        })().then(() => cb(), cb);
      },
      final(cb) {
        (async () => { if (phase === 'sniff') await begin(Buffer.concat(head)); })().then(() => cb(), cb);
      },
    });
    try {
      await new Promise((ok, ko) => { sink.on('finish', ok); sink.on('error', ko); req.on('error', ko); req.on('aborted', () => ko(refuse(400, 'Envoi interrompu : réessaie.'))); req.pipe(sink); });
      await new Promise((ok) => out.end(ok));
      if (size !== declared) throw refuse(400, 'Envoi incomplet : réessaie.');
      let meta = null;
      if (type.kind === 'video') meta = await extractFrames(cfg, userId, dir, `file.${type.ext}`);
      await db.prepare('UPDATE chat_attachments SET size = ?, meta = ? WHERE id = ?').run(size, meta ? JSON.stringify(meta) : null, id);
    } catch (e) {
      req.unpipe(sink);
      req.resume();
      out?.destroy();
      if (dir) rmSync(dir, { recursive: true, force: true });
      if (id != null) await db.prepare('DELETE FROM chat_attachments WHERE id = ?').run(id);
      throw e instanceof HttpError ? e : refuse(400, 'Envoi interrompu : réessaie.');
    }
    json(res, { attachment: shape(await db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(id)) }, 201);
  }, { limit: 'chat_upload' });

  // Retire une pièce jointe pas encore envoyée
  router.post('/api/chat/attachments/:id/delete', async ({ res, params, session }) => {
    const r = await db.prepare('SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?').get(Number(params.id) || 0, session.userId);
    if (!r) throw new HttpError(404, 'Pièce jointe introuvable');
    if (r.message_id != null) throw new HttpError(409, 'Cette pièce jointe fait partie d\'un message envoyé.', { expose: true });
    removeAttachmentFiles(cfg, session.userId, [r]);
    await db.prepare('DELETE FROM chat_attachments WHERE id = ?').run(r.id);
    json(res, { ok: true });
  }, { limit: 'chat_upload' });

  // Lecture d'une pièce jointe (aperçu dans le fil) : son propriétaire seulement, type figé, jamais interprété par le navigateur
  router.get('/api/chat/files/:id', async ({ req, res, params, session }) => {
    const r = await db.prepare('SELECT * FROM chat_attachments WHERE id = ? AND user_id = ?').get(Number(params.id) || 0, session.userId);
    if (!r || r.kind === 'project' || !r.file) throw new HttpError(404, 'Fichier introuvable');
    const path = join(attachmentDir(cfg, session.userId, r.id), r.file);
    if (!existsSync(path)) throw new HttpError(404, 'Fichier introuvable');
    const total = statSync(path).size;
    const head = {
      'Content-Type': r.mime || 'application/octet-stream', 'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.name)}`,
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    let start = 0;
    let end = total - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } else { start = Math.max(0, total - Number(range[2])); }
      if (!(start <= end) || start >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
      status = 206;
      head['Content-Range'] = `bytes ${start}-${end}/${total}`;
    }
    head['Content-Length'] = String(end - start + 1);
    res.writeHead(status, head);
    if (req.method === 'HEAD') return res.end();
    createReadStream(path, { start, end }).pipe(res);
  });
}
