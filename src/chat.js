// Page IA : conversations avec Claude, depuis le compte Claude de l'utilisateur (même accès que les jobs, voir makeClaude).
// Chaque message part vers Claude sans aucun outil (ni fichiers, ni web, ni commandes) ; la réponse revient en flux (une ligne JSON par événement).
// Seule exception : ce que l'utilisateur JOINT au message. Un projet (dépôt en lecture seule) ou des fichiers (images, PDF, texte, images tirées d'une
// vidéo) ouvrent les seuls outils de lecture (Read, Glob, Grep), dans le bac à sable, sur ces éléments et rien d'autre.
// Les conversations sont privées : propres à chaque compte, supprimées avec lui (fichiers compris).
import { userProvider } from './claudelink.js';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, json, readBody, html, redirect } from './http.js';
import { now, getSetting, setSetting } from './db.js';
import { makeClaude, makeSync } from './handlers.js';
import { chatPrompt, supportPrompt, chatContext, parseCustomPrompts, CHAT_MAX_MESSAGE } from './services/prompts.js';
import { ensureSupportDocs } from './services/supportdocs.js';
import { plan } from './services/orchestrator.js';
import { repoProfile, renderRepoProfile } from './services/repoprofile.js';
import { getProject, repoDir } from './projects.js';
import { needAccess, accessOn } from './teams.js';
import { accessibleProjects } from './mailroutes.js';
import { userChatRoot } from './users.js';
import { FILES, shapeAttachment, removeAttachmentFiles, conversationAttachments, prepareRunDir, registerChatFileRoutes } from './chatfiles.js';
import { normalizeModel, catalogOf, isModel } from './services/models.js';
import { renderMarkdown } from './services/markdown.js';
import { budgetState, isPriced } from './services/budget.js';
import { loadRatio } from './services/load.js';
import { reportError } from './services/errormail.js';
import { chatPage } from './chatviews.js';

export const CHAT = {
  maxConversations: 100,     // au-delà, la plus ancienne est supprimée
  perDay: 300,               // réponses par 24 h glissantes et par compte
  maxParallel: 3,            // réponses en cours sur tout le serveur (la machine est petite)
  loadMax: 1.5,              // charge moyenne / nombre de cœurs au-delà de laquelle on refuse (réessayer dans un instant)
  timeoutMs: 5 * 60_000,
  pingMs: 15_000,            // petit signe de vie pendant que Claude réfléchit (les proxys coupent les connexions silencieuses)
  defaultModel: 'sonnet',
  toolTurns: 14,             // allers-retours permis quand Claude lit un projet ou des fichiers joints
  repoFreshMs: 15 * 60_000,  // un dépôt déjà cloné n'est remis à jour qu'après ce délai
};

const titleOf = (text) => {
  const line = String(text).split('\n').map((l) => l.trim()).find(Boolean) || 'Conversation';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
};

const shapeConv = (c) => ({ id: Number(c.id), title: c.title, model: c.model, mode: c.mode === 'support' ? 'support' : 'claude', updatedAt: Number(c.updated_at), createdAt: Number(c.created_at) });
export const shapeMessage = (m) => ({
  id: Number(m.id), role: m.role, content: m.content, model: m.model || null, createdAt: Number(m.created_at),
  ...(m.role === 'assistant' ? { html: renderMarkdown(m.content) } : {}),
});

/** Conversations d'un compte pour un mode : « claude » (assistant classique) ou « support » (aide sur AiTools). */
export async function listConversations(db, userId, mode = 'claude') {
  return (await db.prepare('SELECT * FROM chat_conversations WHERE user_id = ? AND mode = ? ORDER BY updated_at DESC, id DESC').all(userId, mode === 'support' ? 'support' : 'claude')).map(shapeConv);
}

export async function getConversation(db, userId, id) {
  const c = await db.prepare('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?').get(Number(id) || 0, userId);
  return c ? shapeConv(c) : null;
}

export async function conversationMessages(db, convId) {
  const rows = await db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(Number(convId));
  const byMessage = new Map();
  for (const a of (await db.prepare('SELECT * FROM chat_attachments WHERE conversation_id = ? ORDER BY id').all(Number(convId))).map(shapeAttachment)) {
    if (!byMessage.has(a.messageId)) byMessage.set(a.messageId, []);
    byMessage.get(a.messageId).push(a);
  }
  return rows.map((m) => ({ ...shapeMessage(m), attachments: byMessage.get(Number(m.id)) || [] }));
}

const KIND_WORD = { image: 'image', pdf: 'PDF', text: 'fichier texte', video: 'vidéo', project: 'projet' };
/** « [Pièces jointes : image « a.png », projet « Atelier »] », ou rien : ce que Claude lit en plus du texte d'un message. */
export const attachmentsNote = (atts) => (atts?.length ? `[Pièces jointes : ${atts.map((a) => `${KIND_WORD[a.kind] || 'fichier'} « ${a.name} »`).join(', ')}]\n` : '');

/** Projet joint au dernier message de la personne dans cette conversation (le choix « reste » d'un message à l'autre dans la page). */
export const lastProject = (messages) => {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const p = lastUser?.attachments.find((a) => a.kind === 'project');
  return p ? { id: p.projectId, name: p.name } : null;
};

export const chatModel = async (db, userId) => {
  const provider = await userProvider(db, userId);
  const fallback = catalogOf(provider).chatDefault;
  return normalizeModel(await getSetting(db, userId, 'chat_model', fallback), fallback, provider);
};

export function registerChatRoutes(router, app) {
  const { db, cfg } = app;
  const claude = makeClaude(app);
  const sync = makeSync(app);
  const synced = new Map(); // projet → dernière mise à jour du dépôt par la page IA
  const busy = new Set(); // comptes avec une réponse en cours (une à la fois chacun)
  let running = 0;        // réponses en cours, tous comptes confondus

  const page = async (res, session, current, mode = 'claude') => {
    const conversations = await listConversations(db, session.userId, mode);
    const messages = current ? await conversationMessages(db, current.id) : [];
    const provider = await userProvider(db, session.userId);
    html(res, chatPage({
      email: session.email, mode, priced: await isPriced(db, session.userId), conversations, current, messages, catalog: catalogOf(provider),
      model: isModel(current?.model, provider) ? current.model : await chatModel(db, session.userId),
      max: CHAT_MAX_MESSAGE, project: lastProject(messages), limits: { files: FILES.perMessage, maxMb: Object.fromEntries(Object.entries(FILES.maxBytes).map(([k, v]) => [k, Math.round(v / 1048576)])) },
    }));
  };

  router.get('/chat', async ({ res, session }) => page(res, session, null, 'claude'));
  router.get('/support', async ({ res, session }) => page(res, session, null, 'support'));
  // Une conversation s'ouvre dans sa page : celle du Support sous /support, l'assistant classique sous /chat
  const open = (mode) => async ({ res, params, session }) => {
    const current = await getConversation(db, session.userId, params.id);
    if (!current) throw new HttpError(404, 'Conversation introuvable');
    if (current.mode !== mode) return redirect(res, `/${current.mode === 'support' ? 'support' : 'chat'}/${current.id}`);
    await page(res, session, current, mode);
  };
  router.get('/chat/:id', open('claude'));
  router.get('/support/:id', open('support'));

  // Projets dont l'utilisateur peut joindre le code : les siens, et ceux où il est administrateur de l'équipe
  router.get('/api/chat/projects', async ({ res, session }) => {
    const out = [];
    for (const p of await accessibleProjects(db, session.userId)) {
      const row = await db.prepare('SELECT id, user_id, team_id, name, profile_json FROM projects WHERE id = ?').get(p.id);
      const access = await accessOn(db, row, session.userId);
      if (access === 'owner' || access === 'admin') out.push({ id: Number(row.id), name: row.name, analyzed: !!row.profile_json });
    }
    json(res, { projects: out });
  });
  registerChatFileRoutes(router, app);

  router.get('/api/chat/conversations', async ({ res, session, url }) => json(res, { conversations: await listConversations(db, session.userId, url.searchParams.get('mode')) }));
  router.get('/api/chat/conversations/:id', async ({ res, params, session }) => {
    const conversation = await getConversation(db, session.userId, params.id);
    if (!conversation) throw new HttpError(404, 'Conversation introuvable');
    json(res, { conversation, messages: await conversationMessages(db, conversation.id) });
  });

  router.post('/api/chat/conversations/:id/delete', async ({ res, params, session }) => {
    const c = await getConversation(db, session.userId, params.id);
    if (!c) throw new HttpError(404, 'Conversation introuvable');
    removeAttachmentFiles(cfg, session.userId, await conversationAttachments(db, c.id));
    await db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(c.id);
    await db.prepare('DELETE FROM chat_conversations WHERE id = ? AND user_id = ?').run(c.id, session.userId);
    json(res, { ok: true });
  }, { limit: 'chat' });

  router.post('/api/chat/conversations/:id/rename', async ({ req, res, params, session }) => {
    const c = await getConversation(db, session.userId, params.id);
    if (!c) throw new HttpError(404, 'Conversation introuvable');
    const title = String((await readBody(req)).title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) throw new HttpError(400, 'Donne un titre à la conversation', { expose: true });
    await db.prepare('UPDATE chat_conversations SET title = ? WHERE id = ? AND user_id = ?').run(title, c.id, session.userId);
    json(res, { ok: true, title });
  }, { limit: 'chat' });

  // Envoi d'un message. Réponse : des lignes JSON — meta (conversation), delta (texte au fil de l'écriture), ping, puis done ou error.
  router.post('/api/chat/send', async ({ req, res, session }) => {
    const userId = session.userId;
    const b = await readBody(req);
    const ids = [...new Set((Array.isArray(b.attachments) ? b.attachments : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length > FILES.perMessage) throw new HttpError(400, `${FILES.perMessage} pièces jointes au plus par message`, { expose: true });
    const message = String(b.message ?? '').replace(/\r\n?/g, '\n').trim() || (ids.length || b.projectId ? 'Voici les pièces jointes.' : '');
    if (!message) throw new HttpError(400, 'Écris un message', { expose: true });
    if (message.length > CHAT_MAX_MESSAGE) throw new HttpError(400, `Message trop long (${CHAT_MAX_MESSAGE} caractères au plus)`, { expose: true });

    let conv = null;
    if (b.conversationId != null && b.conversationId !== '') {
      conv = await getConversation(db, userId, b.conversationId);
      if (!conv) throw new HttpError(404, 'Conversation introuvable');
    }
    const provider = await userProvider(db, userId);
    const model = normalizeModel(b.model, isModel(conv?.model, provider) ? conv.model : await chatModel(db, userId), provider);
    // Pièces jointes : les siennes, téléversées et pas encore envoyées. Projet : un projet dont il peut lire le code (propriétaire ou administrateur d'équipe).
    const pending = ids.length
      ? await db.prepare(`SELECT * FROM chat_attachments WHERE user_id = ? AND message_id IS NULL AND kind <> 'project' AND id IN (${ids.map(() => '?').join(',')})`).all(userId, ...ids)
      : [];
    if (pending.length !== ids.length) throw new HttpError(404, 'Pièce jointe introuvable : joins-la de nouveau.', { expose: true });
    // Mode : celui de la conversation ; pour une nouvelle conversation, celui de la page d'où elle part
    const mode = conv ? conv.mode : b.mode === 'support' ? 'support' : 'claude';
    if (mode === 'support' && b.projectId != null && b.projectId !== '') throw new HttpError(400, 'Le Support ne lit pas le code d\'un projet : décris le problème, ou joins une capture d\'écran.', { expose: true });
    let project = null;
    if (b.projectId != null && b.projectId !== '') {
      project = await getProject(app, Number(b.projectId), { userId });
      needAccess(project.access, 'admin', 'joindre le code de ce projet');
    }

    // Garde-fous : une réponse à la fois par compte, une charge raisonnable sur la machine, le budget et le plafond du jour
    if (busy.has(userId)) throw new HttpError(409, 'Une réponse est déjà en cours : attends qu\'elle se termine.', { expose: true });
    if (running >= CHAT.maxParallel || (app.loadRatio ?? loadRatio)() > CHAT.loadMax) {
      throw new HttpError(503, 'Le serveur est très sollicité en ce moment : réessaie dans un instant.', { expose: true });
    }
    const budget = await budgetState(db, userId);
    if (budget.blocked) throw new HttpError(429, `Budget IA atteint : ${budget.reason}`, { expose: true });
    const today = (await db.prepare("SELECT COUNT(*) n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id WHERE c.user_id = ? AND m.role = 'assistant' AND m.created_at > ?").get(userId, now() - 86400)).n;
    if (Number(today) >= CHAT.perDay) throw new HttpError(429, `Limite de ${CHAT.perDay} réponses par 24 h atteinte : réessaie plus tard.`, { expose: true });

    busy.add(userId);
    running++;
    let ctrl = null;
    let ping = null;
    const finish = () => { clearInterval(ping); if (busy.delete(userId)) running--; };
    try {
      const at = now();
      if (!conv) {
        const total = Number((await db.prepare('SELECT COUNT(*) n FROM chat_conversations WHERE user_id = ?').get(userId)).n);
        if (total >= CHAT.maxConversations) {
          const old = await db.prepare('SELECT id FROM chat_conversations WHERE user_id = ? ORDER BY updated_at, id LIMIT ?').all(userId, total - CHAT.maxConversations + 1);
          for (const o of old) {
            removeAttachmentFiles(cfg, userId, await conversationAttachments(db, o.id));
            await db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(o.id);
            await db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(o.id);
          }
        }
        const id = Number((await db.prepare('INSERT INTO chat_conversations(user_id, title, model, mode, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)').run(userId, titleOf(message), model, mode, at, at)).lastInsertRowid);
        conv = await getConversation(db, userId, id);
      }
      const earlier = await conversationMessages(db, conv.id);
      const history = earlier.map(({ role, content, attachments }) => ({ role, content: `${attachmentsNote(attachments)}${content}` }));
      const userMessageId = Number((await db.prepare('INSERT INTO chat_messages(conversation_id, role, content, created_at) VALUES(?, ?, ?, ?)').run(conv.id, 'user', message, at)).lastInsertRowid);
      if (ids.length) await db.prepare(`UPDATE chat_attachments SET message_id = ?, conversation_id = ? WHERE user_id = ? AND message_id IS NULL AND id IN (${ids.map(() => '?').join(',')})`).run(userMessageId, conv.id, userId, ...ids);
      if (project) await db.prepare("INSERT INTO chat_attachments(user_id, conversation_id, message_id, kind, name, project_id, created_at) VALUES(?, ?, ?, 'project', ?, ?, ?)").run(userId, conv.id, userMessageId, project.name, project.id, at);
      await db.prepare('UPDATE chat_conversations SET model = ?, updated_at = ? WHERE id = ?').run(model, at, conv.id);
      const sent = (await conversationMessages(db, conv.id)).find((m) => m.id === userMessageId);
      if (b.model !== undefined) await setSetting(db, userId, 'chat_model', model);

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      const write = (o) => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(o)}\n`); };
      write({ type: 'meta', conversationId: conv.id, title: conv.title, userMessageId, model, attachments: sent?.attachments ?? [] });
      ctrl = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ctrl.abort(); }); // la personne a fermé la page ou cliqué sur « Arrêter »
      ping = setInterval(() => write({ type: 'ping' }), CHAT.pingMs);

      let run = null;
      try {
        // Projet joint : son dépôt (à jour, sinon cloné) devient le dossier de travail de Claude, en lecture seule
        let repo = null;
        if (project) {
          repo = repoDir(cfg, project.userId, project.id);
          const fresh = synced.get(project.id) > Date.now() - CHAT.repoFreshMs;
          if (!existsSync(join(repo, '.git')) || !fresh) {
            write({ type: 'status', text: `Mise à jour du dépôt de « ${project.name} »…` });
            try { await sync(project.userId, project.gitUrl, repo); synced.set(project.id, Date.now()); }
            catch (e) {
              if (!existsSync(join(repo, '.git'))) throw new HttpError(502, `Impossible de récupérer le dépôt de « ${project.name} » : ${String(e.message).slice(0, 160)}`, { expose: true });
              write({ type: 'status', text: 'Dépôt non mis à jour : je lis la dernière copie.' });
            }
          }
        }
        // Fichiers de TOUTE la conversation (les plus récents d'abord, bornés) : Claude peut y revenir d'un message à l'autre
        const files = (await conversationMessages(db, conv.id)).flatMap((m) => m.attachments).filter((a) => a.kind !== 'project').slice(-12);
        run = files.length ? prepareRunDir(cfg, userId, files) : null;
        // Support : Claude lit la documentation d'AiTools (dossier partagé, en lecture seule, sans donnée d'aucun compte)
        const docs = mode === 'support' ? ensureSupportDocs(cfg, { chat: CHAT, files: FILES }) : null;
        const tools = docs || repo || run?.files.length ? ['Read', 'Glob', 'Grep'] : [];
        const prompts = parseCustomPrompts(await getSetting(db, userId, 'prompts_json', ''));
        const text = `${attachmentsNote(sent?.attachments)}${message}`;
        // Orchestration (déterministe, aucun appel au modèle) : sur un dépôt joint ou une question de code, méthode et fiches choisies d'après la demande
        // et le profil du dépôt (stack, commandes, tests…) ; sinon les fiches métier de la prospection. Le Support n'en reçoit pas.
        let repoInfo = null;
        if (repo) { try { repoInfo = repoProfile(repo); } catch (e) { console.warn('[chat] profil du dépôt :', e.message); } }
        const orch = docs ? null : plan(message, { hasRepo: !!repo, profile: repoInfo });
        const base = docs ? supportPrompt({ history, message: text, custom: prompts, model, index: docs.index }) : chatPrompt({ history, message: text, custom: prompts, model, domain: orch.domain });
        const repoFacts = repoInfo ? `\n\n${renderRepoProfile(repoInfo)}` : '';
        const system = `${base.system}${chatContext({ project: project && { name: project.name, profile: project.profile }, files: run?.files ?? [] })}${repoFacts}${orch?.block ?? ''}`;
        const r = await claude(userId, {
          prompt: base.prompt, system, model, maxTurns: tools.length ? (orch?.mode === 'rapide' ? Math.min(6, CHAT.toolTurns) : CHAT.toolTurns) : 1, tools, chat: true, noProfile: !!docs, signal: ctrl.signal, timeoutMs: CHAT.timeoutMs,
          // Dossier de travail : le dépôt joint (celui de son propriétaire), sinon le dossier des fichiers joints ; l'un et l'autre en lecture seule
          ...(docs ? { cwd: docs.dir, allowedRoot: docs.dir, extraDirs: run ? [run.dir] : [] } : repo ? { cwd: repo, repoOwnerId: project.userId, extraDirs: run ? [run.dir] : [] } : run ? { cwd: run.dir, allowedRoot: userChatRoot(cfg, userId) } : {}),
          onDelta: (text) => write({ type: 'delta', text }),
          onTool: (name, input) => write({ type: 'status', text: toolLine(name, input, repo, run, docs) }),
        });
        const content = String(r.text ?? '').trim();
        if (ctrl.signal.aborted) return;
        if (!r.ok || !content) {
          write({ type: 'error', error: friendly(r, content) });
        } else {
          const doneAt = now();
          const id = Number((await db.prepare('INSERT INTO chat_messages(conversation_id, role, content, model, cost_usd, created_at) VALUES(?, ?, ?, ?, ?, ?)').run(conv.id, 'assistant', content, model, Number(r.costUsd) || 0, doneAt)).lastInsertRowid);
          await db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(doneAt, conv.id);
          write({ type: 'done', message: shapeMessage({ id, role: 'assistant', content, model, created_at: doneAt }) });
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        // Pas de liaison Claude valide, bac à sable indisponible, CLI introuvable… : message lisible, détail dans les logs
        console.error('[chat]', e.message);
        if (e.status !== 404) reportError(app, e, { method: 'POST', path: '/api/chat/send', userId, status: e.status ?? null });
        write({ type: 'error', error: e.expose || e.status < 500 ? e.message : "Claude n'a pas pu répondre. Réessaie dans un instant." });
      } finally { run?.cleanup(); }
      res.end();
    } finally {
      finish();
      if (!res.headersSent) void cfg; // les erreurs d'avant le flux passent par le gestionnaire commun (statut HTTP)
    }
  }, { limit: 'chat' });
}

/** Message lisible pour une réponse en échec de Claude (quota, jeton refusé…), sans détail technique. */
function friendly(r, text) {
  const t = `${text} ${r?.subtype ?? ''}`.toLowerCase();
  if (/login|bearer|token|authenticat|credential|401/.test(t)) return "Ton accès Claude n'est plus valide : reconnecte-le depuis Mon compte.";
  if (/rate.?limit|quota|usage limit|too many|429|overloaded/.test(t)) return 'Ton quota Claude est atteint pour le moment : réessaie plus tard.';
  if (r?.subtype === 'error_max_turns') return 'La réponse a été interrompue : reformule ou réessaie.';
  return text ? String(text).slice(0, 300) : "Claude n'a pas répondu. Réessaie dans un instant.";
}

/** Ce que Claude est en train de lire, en une ligne pour l'utilisateur (chemins du dépôt joint ou des fichiers joints, jamais ceux du serveur). */
function toolLine(name, input, repo, run, docs = null) {
  const rel = (p) => {
    const v = String(p ?? '');
    for (const root of [repo, run?.dir, docs?.dir]) if (root && v.startsWith(root)) return v.slice(root.length).replace(/^\/+/, '');
    return v.split('/').pop();
  };
  if (docs && name === 'Read') return `Consulte la documentation : ${rel(input.file_path)}`;
  if (docs) return 'Cherche dans la documentation…';
  if (name === 'Read') return `Lit ${rel(input.file_path)}`;
  if (name === 'Glob') return `Cherche les fichiers « ${String(input.pattern ?? '').slice(0, 60)} »`;
  if (name === 'Grep') return `Cherche « ${String(input.pattern ?? '').slice(0, 60)} » dans le code`;
  return 'Lit le projet…';
}
