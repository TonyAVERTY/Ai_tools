// Lecture de la boîte de réception (IMAP) : rattache les réponses et les bounces aux prospects.
// Aucun token Claude : uniquement des en-têtes de mails.
import { now } from '../db.js';
import { getProject } from '../projects.js';
import { notify } from './notify.js';
import { pinImap } from '../netguard.js';
import { evaluateSending } from './abuse.js';

// Webmails grand public : une réponse d'un autre @gmail.com ne dit rien sur l'entreprise
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.fr', 'yahoo.com', 'hotmail.fr', 'hotmail.com', 'outlook.fr', 'outlook.com',
  'live.fr', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'neuf.fr',
  'laposte.net', 'bbox.fr', 'gmx.fr', 'gmx.com', 'aol.com', 'protonmail.com', 'proton.me',
]);

const MSGID_RE = /<[^<>\s@]+@[^<>\s]+>/g;
const ids = (s) => String(s || '').match(MSGID_RE) || [];
const HEADER_FIELDS = ['references', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'precedence', 'content-type'];

// En-têtes bruts (Buffer) → { nom: valeur } avec les lignes repliées dépliées
export function parseHeaders(raw) {
  const out = {};
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
  for (const line of text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

/** @returns {{type: 'reply'|'auto'|'bounce', from: string, ids: string[]}} */
export function classify(msg) {
  const h = msg.headers || {};
  const from = String(msg.from || '').toLowerCase();
  const subject = String(msg.subject || '').trim();
  const refs = [...new Set([...ids(msg.inReplyTo), ...ids(h.references)])];

  const bounce = /^(mailer-daemon|postmaster)@/.test(from)
    || /report-type=["']?delivery-status/i.test(h['content-type'] || '')
    || /^(undeliver|delivery status notification|mail delivery failed|returned mail|non remis|échec de (la )?remise)/i.test(subject);
  if (bounce) return { type: 'bounce', from, ids: [...new Set([...refs, ...ids(msg.body)])] };

  const auto = (h['auto-submitted'] && !/^no$/i.test(h['auto-submitted']))
    || h['x-autoreply'] || h['x-autorespond']
    || /^(auto_reply|bulk|junk|list)$/i.test(h.precedence || '')
    || /^(absence|out of office|automatic reply|réponse automatique|auto:|autoreply|abwesend)/i.test(subject);
  if (auto) return { type: 'auto', from, ids: refs };

  return { type: 'reply', from, ids: refs };
}

/** Applique une liste de messages aux prospects du projet. Idempotent. */
export async function applyMessages(db, projectId, messages, { at = now() } = {}) {
  const res = { replies: 0, bounces: 0, ignored: 0 };
  const byMsgId = db.prepare('SELECT prospect_id FROM mail_log WHERE project_id = ? AND message_id = ? AND prospect_id IS NOT NULL LIMIT 1');
  const byEmail = db.prepare('SELECT id FROM prospects WHERE project_id = ? AND email = ? LIMIT 1');
  const byDomain = db.prepare("SELECT id FROM prospects WHERE project_id = ? AND status = 'sent' AND substr(email, instr(email, '@') + 1) = ?");
  const markReply = db.prepare("UPDATE prospects SET status = 'replied', replied_at = ?, reply_subject = ? WHERE id = ? AND status = 'sent'");
  const markBounce = db.prepare("UPDATE prospects SET status = 'bounced' WHERE id = ? AND status = 'sent'");
  const blacklist = db.prepare("INSERT OR IGNORE INTO blacklist(email, reason, created_at) SELECT email, 'bounce', ? FROM prospects WHERE id = ?");

  const fromIds = async (list) => {
    for (const id of list) { const r = await byMsgId.get(projectId, id); if (r) return r.prospect_id; }
    return null;
  };

  for (const msg of messages) {
    const c = classify(msg);
    if (c.type === 'bounce') {
      const pid = await fromIds(c.ids);
      if (pid && (await markBounce.run(pid)).changes) { await blacklist.run(at, pid); res.bounces++; } else res.ignored++;
      continue;
    }
    if (c.type === 'auto') { res.ignored++; continue; }

    // Réponse : 1) fil de discussion, 2) même adresse, 3) même domaine pro (un seul prospect en attente dessus)
    let pid = (await fromIds(c.ids)) ?? (await byEmail.get(projectId, c.from))?.id ?? null;
    if (!pid) {
      const domain = c.from.split('@')[1];
      if (domain && !GENERIC_DOMAINS.has(domain)) {
        const rows = await byDomain.all(projectId, domain);
        if (rows.length === 1) pid = rows[0].id;
      }
    }
    if (pid && (await markReply.run(at, String(msg.subject || '').slice(0, 300), pid)).changes) res.replies++;
    else res.ignored++;
  }
  return res;
}

/** Lit les nouveaux messages de INBOX depuis le dernier UID vu. */
export async function fetchInbox(creds, state, { since, max = 500 }) {
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: creds.host, port: creds.port, secure: creds.port === 993,
    auth: { user: creds.user, pass: creds.pass }, logger: false,
    ...(creds.servername ? { servername: creds.servername } : {}),
    socketTimeout: 60_000, connectionTimeout: 15_000,
  });
  // Sans écouteur, une erreur réseau tardive (timeout après un échec d'auth) ferait planter tout le serveur
  client.on('error', () => {});
  try {
    await client.connect();
  } catch (e) {
    client.close();
    throw e;
  }
  const out = { messages: [], uidValidity: null, lastUid: 0 };
  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    const uidValidity = String(client.mailbox.uidValidity);
    let lastUid = state?.uidValidity === uidValidity ? Number(state.lastUid || 0) : 0;
    const found = lastUid
      ? await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
      : await client.search({ since }, { uid: true });
    // "N:*" renvoie toujours au moins le dernier message, même déjà vu
    const uids = (found || []).filter((u) => u > lastUid).sort((a, b) => a - b).slice(-max);

    if (uids.length) {
      // Pas d'autre commande IMAP possible pendant cette boucle
      for await (const m of client.fetch(uids.join(','), { uid: true, envelope: true, headers: HEADER_FIELDS }, { uid: true })) {
        out.messages.push({
          uid: m.uid,
          from: m.envelope?.from?.[0]?.address || '',
          subject: m.envelope?.subject || '',
          inReplyTo: m.envelope?.inReplyTo || '',
          headers: parseHeaders(m.headers),
        });
      }
      // Les bounces citent notre Message-ID dans le corps : on lit seulement leur début
      for (const msg of out.messages) {
        if (classify(msg).type !== 'bounce') continue;
        const full = await client.fetchOne(String(msg.uid), { source: { maxLength: 100_000 } }, { uid: true });
        msg.body = full?.source ? full.source.toString('utf8') : '';
      }
      lastUid = Math.max(lastUid, ...uids);
    }
    out.uidValidity = uidValidity;
    out.lastUid = lastUid;
  } finally {
    lock?.release();
    await client.logout().catch(() => {});
  }
  return out;
}

/** Vérifie la boîte d'un projet et mémorise l'état (dernier UID, erreurs, compteurs). */
export async function checkInbox(app, userId, projectId) {
  const { db } = app;
  const project = await getProject(app, projectId, { userId, secrets: true });
  if (!project.imap) throw new Error('Boîte IMAP non configurée');
  const state = project.inbox || {};
  const firstSent = (await db.prepare('SELECT MIN(sent_at) t FROM mail_log WHERE project_id = ?').get(project.id)).t;
  const since = new Date(((firstSent || now()) - 86400) * 1000);
  const at = now();
  const save = (s) => db.prepare('UPDATE projects SET inbox_json = ? WHERE id = ?').run(JSON.stringify(s), project.id);
  try {
    // Hôte vérifié à CHAQUE lecture et connexion à l'adresse vérifiée (pas de rebinding DNS entre les deux)
    const imap = await pinImap(app, userId, project.imap);
    const r = await (app.fetchInbox || fetchInbox)(imap, state, { since });
    const res = await applyMessages(db, project.id, r.messages, { at });
    await save({
      uidValidity: r.uidValidity, lastUid: r.lastUid, lastCheck: at, lastOk: at, lastError: null,
      replies: (state.replies || 0) + res.replies, bounces: (state.bounces || 0) + res.bounces,
    });
    if (res.bounces) await evaluateSending(app, userId); // les rejets arrivent ici : vérifie le taux du compte
    if (res.replies) {
      const who = await db.prepare('SELECT company, email, reply_subject FROM prospects WHERE project_id = ? AND replied_at = ? LIMIT 10').all(project.id, at);
      await notify(app, userId, 'reply', {
        title: `${project.name} · ${res.replies} réponse(s) de prospect`, level: 'ok',
        description: who.map((p) => `**${p.company}** (${p.email}) : ${p.reply_subject || 'sans objet'}`).join('\n'),
      });
    }
    return res;
  } catch (e) {
    const msg = String(e.responseText || e.message || e).slice(0, 300);
    await save({ ...state, lastCheck: at, lastError: msg });
    throw new Error(`IMAP : ${msg}`);
  }
}
