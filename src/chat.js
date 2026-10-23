// Page IA : conversations avec Claude, depuis le compte Claude de l'utilisateur (même accès que les jobs, voir makeClaude).
// Chaque message part vers Claude sans aucun outil (ni fichiers, ni web, ni commandes) ; la réponse revient en flux (une ligne JSON par événement).
// Les conversations sont privées : propres à chaque compte, supprimées avec lui.
import { HttpError, json, readBody, html } from './http.js';
import { now, getSetting, setSetting } from './db.js';
import { makeClaude } from './handlers.js';
import { chatPrompt, parseCustomPrompts, CHAT_MAX_MESSAGE } from './services/prompts.js';
import { normalizeModel } from './services/models.js';
import { renderMarkdown } from './services/markdown.js';
import { budgetState } from './services/budget.js';
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
};

const titleOf = (text) => {
  const line = String(text).split('\n').map((l) => l.trim()).find(Boolean) || 'Conversation';
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
};

const shapeConv = (c) => ({ id: Number(c.id), title: c.title, model: c.model, updatedAt: Number(c.updated_at), createdAt: Number(c.created_at) });
export const shapeMessage = (m) => ({
  id: Number(m.id), role: m.role, content: m.content, model: m.model || null, createdAt: Number(m.created_at),
  ...(m.role === 'assistant' ? { html: renderMarkdown(m.content) } : {}),
});

export async function listConversations(db, userId) {
  return (await db.prepare('SELECT * FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC').all(userId)).map(shapeConv);
}

export async function getConversation(db, userId, id) {
  const c = await db.prepare('SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?').get(Number(id) || 0, userId);
  return c ? shapeConv(c) : null;
}

export async function conversationMessages(db, convId) {
  return (await db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id').all(Number(convId))).map(shapeMessage);
}

export const chatModel = async (db, userId) => normalizeModel(await getSetting(db, userId, 'chat_model', CHAT.defaultModel), CHAT.defaultModel);

export function registerChatRoutes(router, app) {
  const { db, cfg } = app;
  const claude = makeClaude(app);
  const busy = new Set(); // comptes avec une réponse en cours (une à la fois chacun)
  let running = 0;        // réponses en cours, tous comptes confondus

  const page = async (res, session, current) => {
    const conversations = await listConversations(db, session.userId);
    const messages = current ? await conversationMessages(db, current.id) : [];
    html(res, chatPage({
      email: session.email, conversations, current, messages, model: current?.model ?? await chatModel(db, session.userId),
      max: CHAT_MAX_MESSAGE,
    }));
  };

  router.get('/chat', async ({ res, session }) => page(res, session, null));
  router.get('/chat/:id', async ({ res, params, session }) => {
    const current = await getConversation(db, session.userId, params.id);
    if (!current) throw new HttpError(404, 'Conversation introuvable');
    await page(res, session, current);
  });

  router.get('/api/chat/conversations', async ({ res, session }) => json(res, { conversations: await listConversations(db, session.userId) }));
  router.get('/api/chat/conversations/:id', async ({ res, params, session }) => {
    const conversation = await getConversation(db, session.userId, params.id);
    if (!conversation) throw new HttpError(404, 'Conversation introuvable');
    json(res, { conversation, messages: await conversationMessages(db, conversation.id) });
  });

  router.post('/api/chat/conversations/:id/delete', async ({ res, params, session }) => {
    const c = await getConversation(db, session.userId, params.id);
    if (!c) throw new HttpError(404, 'Conversation introuvable');
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
    const message = String(b.message ?? '').replace(/\r\n?/g, '\n').trim();
    if (!message) throw new HttpError(400, 'Écris un message', { expose: true });
    if (message.length > CHAT_MAX_MESSAGE) throw new HttpError(400, `Message trop long (${CHAT_MAX_MESSAGE} caractères au plus)`, { expose: true });

    let conv = null;
    if (b.conversationId != null && b.conversationId !== '') {
      conv = await getConversation(db, userId, b.conversationId);
      if (!conv) throw new HttpError(404, 'Conversation introuvable');
    }
    const model = normalizeModel(b.model, conv?.model ?? await chatModel(db, userId));

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
            await db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(o.id);
            await db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(o.id);
          }
        }
        const id = Number((await db.prepare('INSERT INTO chat_conversations(user_id, title, model, created_at, updated_at) VALUES(?, ?, ?, ?, ?)').run(userId, titleOf(message), model, at, at)).lastInsertRowid);
        conv = await getConversation(db, userId, id);
      }
      const history = (await conversationMessages(db, conv.id)).map(({ role, content }) => ({ role, content }));
      const userMessageId = Number((await db.prepare('INSERT INTO chat_messages(conversation_id, role, content, created_at) VALUES(?, ?, ?, ?)').run(conv.id, 'user', message, at)).lastInsertRowid);
      await db.prepare('UPDATE chat_conversations SET model = ?, updated_at = ? WHERE id = ?').run(model, at, conv.id);
      if (b.model !== undefined) await setSetting(db, userId, 'chat_model', model);

      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      const write = (o) => { if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(o)}\n`); };
      write({ type: 'meta', conversationId: conv.id, title: conv.title, userMessageId, model });
      ctrl = new AbortController();
      res.on('close', () => { if (!res.writableEnded) ctrl.abort(); }); // la personne a fermé la page ou cliqué sur « Arrêter »
      ping = setInterval(() => write({ type: 'ping' }), CHAT.pingMs);

      const { system, prompt } = chatPrompt({ history, message, custom: parseCustomPrompts(await getSetting(db, userId, 'prompts_json', '')), model });
      try {
        const r = await claude(userId, {
          prompt, system, model, maxTurns: 1, tools: [], chat: true, signal: ctrl.signal, timeoutMs: CHAT.timeoutMs,
          onDelta: (text) => write({ type: 'delta', text }),
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
        if (!e.status) reportError(app, e, { method: 'POST', path: '/api/chat/send', userId });
        write({ type: 'error', error: e.expose || e.status < 500 ? e.message : "Claude n'a pas pu répondre. Réessaie dans un instant." });
      }
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
