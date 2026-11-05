// Prospects : ajout manuel, modification, suppression, et aperçu du mail tel que le prospect le recevra.
// Accès : le propriétaire du projet ou un membre de l'équipe qui le partage (même règle que les notes et les statuts). Un prospect d'un autre compte est « introuvable ».
import { randomBytes } from 'node:crypto';
import { HttpError, json, readBody, asBool } from './http.js';
import { now, getSetting } from './db.js';
import { accessOn } from './teams.js';
import { getProject, getTemplate } from './projects.js';
import { getUser } from './users.js';
import { EMAIL_RE, buildProspectMail, fillTemplate, mailVars } from './services/mailer.js';
import { reviewMail, fillBody, fillSubject } from './services/mailcheck.js';
import { checkSense, proposeSentence, SenseUnavailable } from './services/mailsense.js';
import { makeClaude } from './handlers.js';
import { budgetState } from './services/budget.js';
import { normalizeModel } from './services/models.js';
import { userProvider } from './claudelink.js';
import { followupSubject } from './services/followup.js';
import { quotaFor, planLimitError, withUserLock } from './services/plans.js';
import { unsubToken } from './crypto.js';

export const MAX_SCORE = 10;
const VARS = ['entreprise', 'ville', 'accroche', 'expediteur', 'site'];

const httpUrl = (v, max = 300) => {
  const s = String(v ?? '').trim();
  if (!/^https?:\/\/[^\s<>"]+$/i.test(s)) return null;
  try { return new URL(s).protocol.startsWith('http') ? s.slice(0, max) : null; } catch { return null; }
};

/** Corps d'un formulaire → champs propres d'un prospect, ou une erreur lisible. Un champ absent de `b` n'est pas touché (`partial`). */
export function cleanProspect(b = {}, { partial = false } = {}) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const text = (k, max) => String(b[k] ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (has('email') || !partial) {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 200) return { error: 'Adresse email invalide.' };
    out.email = email;
  }
  if (has('company') || !partial) {
    const company = text('company', 200);
    if (!company) {
      if (partial) return { error: "Le nom de l'entreprise est obligatoire." };
      out.company = out.email.split('@')[1]; // sans nom : le domaine de l'adresse, comme à l'import CSV
    } else out.company = company;
  }
  if (has('website')) {
    const raw = String(b.website ?? '').trim();
    out.website = raw ? (httpUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)) : null;
    if (raw && !out.website) return { error: 'Adresse du site invalide (attendu : https://exemple.fr).' };
  }
  if (has('city')) out.city = text('city', 100) || null;
  if (has('sector')) out.sector = text('sector', 100) || null;
  if (has('hook')) out.hook = text('hook', 400) || null;
  if (has('score')) {
    const raw = String(b.score ?? '').trim();
    if (!raw) out.score = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1 || n > MAX_SCORE) return { error: `Score : un nombre de 1 à ${MAX_SCORE}.` };
      out.score = Math.round(n);
    }
  }
  if (has('source')) out.source = text('source', 300) || null;
  return { fields: out };
}

// Exemple fictif de l'aperçu quand aucun prospect n'est choisi
const SAMPLE_PERSON = { company: 'Boulangerie Le Fournil', email: 'contact@lefournil.exemple', city: 'Rennes', hook: 'Vos fournées au levain naturel ont de quoi séduire les gourmands du centre-ville.', source: 'https://lefournil.exemple/contact' };

export function registerProspectRoutes(router, app, { project }) {
  const { db, cfg } = app;
  const LIMIT = { limit: 'prospect_write' };

  // Prospect + droits (404 si le projet n'est ni le sien ni partagé avec lui)
  const owned = async ({ params, session }) => {
    const row = await db.prepare('SELECT x.*, p.user_id owner_id, p.team_id FROM prospects x JOIN projects p ON p.id = x.project_id WHERE x.id = ?').get(Number(params.id));
    if (!row || !(await accessOn(db, { user_id: row.owner_id, team_id: row.team_id }, session.userId))) throw new HttpError(404, 'Prospect introuvable');
    return row;
  };
  // Adresse refusée sans dire pourquoi : la liste d'opposition est commune à tous les comptes et ne doit révéler aucune adresse précise
  const REFUSED = 'Cette adresse ne peut pas être ajoutée (déjà présente dans ce projet, ou à ne pas contacter).';
  const taken = async (projectId, email, exceptId = null) => {
    const dup = await db.prepare('SELECT id FROM prospects WHERE project_id = ? AND email = ?').get(projectId, email);
    if (dup && Number(dup.id) !== Number(exceptId)) return true;
    return !!(await db.prepare('SELECT 1 FROM blacklist WHERE email = ?').get(email));
  };

  // ---------- Ajouter un prospect à la main ----------
  router.post('/api/projects/:id/prospects', async (ctx) => {
    const p = await project(ctx);
    const b = await readBody(ctx.req);
    const c = cleanProspect(b);
    if (c.error) throw new HttpError(400, c.error, { expose: true });
    const f = c.fields;
    const id = await withUserLock(p.userId, async () => {
      if (await taken(p.id, f.email)) throw new HttpError(409, REFUSED, { expose: true });
      const u = await getUser(db, p.userId);
      const q = await quotaFor(db, u, 'prospects');
      if (!q.unlimited && q.remaining <= 0) throw planLimitError(u, q, { wanted: 1, note: "Le prospect n'a pas été ajouté." });
      const at = now();
      const label = new Date(at * 1000).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
      const r = await db.prepare(`INSERT INTO prospects(project_id, company, email, website, city, sector, score, source, hook, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p.id, f.company, f.email, f.website ?? null, f.city ?? null, f.sector ?? null, f.score ?? null,
        // RGPD : l'origine de la donnée est toujours renseignée
        f.source || `Ajout manuel du ${label}`, f.hook ?? null, at);
      return Number(r.lastInsertRowid);
    });
    json(ctx.res, { ok: true, id });
  }, LIMIT);

  // ---------- Modifier un prospect ----------
  router.post('/api/prospects/:id/update', async (ctx) => {
    const row = await owned(ctx);
    const b = await readBody(ctx.req);
    const c = cleanProspect(b, { partial: true });
    if (c.error) throw new HttpError(400, c.error, { expose: true });
    const f = c.fields;
    if (f.email !== undefined && f.email !== row.email) {
      // L'historique d'envoi, les réponses et les relances sont rattachés à l'adresse : on ne la change que tant que personne n'a été contacté.
      if (row.status !== 'new') throw new HttpError(400, "L'adresse ne peut plus être modifiée une fois le prospect contacté : l'historique des mails y est rattaché. Ajoute un nouveau prospect avec la bonne adresse.", { expose: true });
      if (await taken(row.project_id, f.email, row.id)) throw new HttpError(409, REFUSED, { expose: true });
    } else delete f.email;
    const keys = Object.keys(f);
    if (!keys.length) throw new HttpError(400, 'Rien à modifier.', { expose: true });
    await db.prepare(`UPDATE prospects SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => f[k]), row.id);
    json(ctx.res, { ok: true });
  }, LIMIT);

  // ---------- Supprimer un prospect ----------
  // Ses notes partent avec lui. L'historique des mails déjà envoyés reste dans la page Mails (journal d'envoi du projet), détaché du prospect.
  router.post('/api/prospects/:id/delete', async (ctx) => {
    const row = await owned(ctx);
    await db.prepare('UPDATE mail_log SET prospect_id = NULL WHERE prospect_id = ?').run(row.id);
    await db.prepare('DELETE FROM prospect_notes WHERE prospect_id = ?').run(row.id);
    await db.prepare('DELETE FROM prospects WHERE id = ?').run(row.id);
    json(ctx.res, { ok: true });
  }, LIMIT);

  // ---------- Aperçu du mail ----------
  // Le mail est construit par le même code que l'envoi réel ; rien n'est envoyé ni enregistré. Le HTML est servi dans un cadre isolé (jeton court, à usage de son auteur).
  const previews = new Map(); // jeton -> { userId, html, exp }
  const keep = (userId, html) => {
    const t = now();
    for (const [k, v] of previews) if (v.exp < t) previews.delete(k);
    const mine = [...previews].filter(([, v]) => v.userId === userId);
    while (mine.length >= 20) previews.delete(mine.shift()[0]);
    const token = randomBytes(18).toString('base64url');
    previews.set(token, { userId, html, exp: t + 900 });
    return token;
  };

  router.post('/api/projects/:id/template/preview', async (ctx) => {
    const p = await getProject(app, Number(ctx.params.id), { userId: ctx.session.userId, secrets: true });
    const b = await readBody(ctx.req);
    const kind = b.kind === 'followup' ? 'followup' : 'initial';
    const body = String(b.body ?? '').slice(0, 10_000);
    if (!body.trim()) throw new HttpError(400, "Le corps du mail est vide : rien à prévisualiser. Écris-le ou clique « Générer avec l'IA ».", { expose: true });
    const variant = b.variant === 'B' && String(b.subjectB ?? '').trim() ? 'B' : 'A';
    const template = { subject: String(variant === 'B' ? b.subjectB : b.subject ?? '').trim().slice(0, 300), body };
    let prospect = null;
    if (b.prospectId != null && b.prospectId !== '') {
      prospect = await db.prepare('SELECT * FROM prospects WHERE id = ? AND project_id = ?').get(Number(b.prospectId), p.id);
      if (!prospect) throw new HttpError(404, 'Prospect introuvable');
    }
    const sample = !prospect;
    const person = prospect || SAMPLE_PERSON;
    const smtp = { fromName: p.smtp?.fromName || '', fromEmail: p.smtp?.fromEmail || 'vous@votre-domaine.fr' };
    // Relance : l'objet vide devient « Re: » + objet du premier mail, comme à l'envoi
    let subject = template.subject;
    if (kind === 'followup') {
      const first = await getTemplate(db, p.id, 'initial');
      subject = followupSubject(template, { subject: fillTemplate(first?.subject || '', { entreprise: person.company, ville: person.city || '', accroche: person.hook || '', expediteur: smtp.fromName, site: p.siteUrl }) });
    }
    const unsubUrl = prospect ? `${cfg.appUrl}/u/${encodeURIComponent(person.email)}/${unsubToken(cfg.secretKey, person.email)}` : `${cfg.appUrl}/u/exemple`;
    const footer = (await getSetting(db, p.userId, 'mail_footer', '1')) !== '0'; // l'aperçu montre ce qui partira, pied de page compris ou non
    const mail = buildProspectMail({ template: { ...template, subject }, prospect: person, smtp, site: p.siteUrl, unsubUrl, subject, readReceipt: false, footer, html: asBool(b.html) });
    // Points d'attention : ce qu'on ne voit pas toujours à la relecture
    const warnings = [];
    const used = [...String(template.subject + ' ' + body).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
    for (const v of new Set(used)) if (!VARS.includes(v)) warnings.push(`La variable {{${v}}} n'existe pas : elle sera remplacée par du vide.`);
    if (kind === 'initial' && used.includes('accroche') && !person.hook) warnings.push("Ce prospect n'a pas d'accroche : {{accroche}} restera vide.");
    if (used.includes('ville') && !person.city) warnings.push('Ce prospect n\'a pas de ville : {{ville}} restera vide.');
    if (used.includes('expediteur') && !smtp.fromName) warnings.push("Le nom d'expéditeur n'est pas réglé (Configuration du projet) : {{expediteur}} restera vide.");
    if (used.includes('site') && !p.siteUrl) warnings.push("Aucun site n'est renseigné pour ce projet (section En-tête) : {{site}} restera vide.");
    if (!p.smtp?.fromEmail) warnings.push("Aucune adresse d'envoi n'est réglée pour ce projet : l'expéditeur affiché est un exemple.");
    if (!mail.subject) warnings.push("L'objet est vide.");
    const review = reviewMail({ subject: template.subject, body, facts: JSON.stringify([p.profile, p.target]) });
    warnings.push(...review.errors, ...review.warnings);
    if (!footer) warnings.push('Le pied de page est retiré (Réglages → Garde-fous) : ce mail part sans lien « Ne plus recevoir de messages » ni origine de l\'adresse.');
    json(ctx.res, {
      ok: true, kind, variant, sample, footer, hasB: !!String(b.subjectB ?? '').trim() && kind === 'initial',
      from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, warnings,
      // Valeurs des variables dans ce mail : l'aperçu s'en sert pour retrouver, dans le modèle, la phrase que la personne sélectionne
      vars: mailVars(person, smtp, p.siteUrl),
      html: !!mail.html, url: mail.html ? `/api/preview/${keep(ctx.session.userId, mail.html)}` : null,
      note: sample ? 'Exemple fictif : choisis un de tes prospects pour voir le mail réel.' : null,
    });
  }, { limit: 'preview' });

  // Contrôle du sens (aperçu) : l'IA de la personne dit si le mail, une fois rempli, veut dire quelque chose, et propose un MODÈLE corrigé.
  // Rien n'est modifié ni envoyé : la correction n'est appliquée que par un clic de la personne. Les jobs d'un projet partagé utilisent l'accès du propriétaire.
  const claude = makeClaude(app);
  router.post('/api/projects/:id/template/sense', async (ctx) => {
    const p = await getProject(app, Number(ctx.params.id), { userId: ctx.session.userId, secrets: true });
    const b = await readBody(ctx.req);
    const kind = b.kind === 'followup' ? 'followup' : 'initial';
    const body = String(b.body ?? '').slice(0, 10_000);
    if (!body.trim()) throw new HttpError(400, "Le corps du mail est vide : rien à relire. Écris-le ou clique « Générer avec l'IA ».", { expose: true });
    let prospect = null;
    if (b.prospectId != null && b.prospectId !== '') {
      prospect = await db.prepare('SELECT * FROM prospects WHERE id = ? AND project_id = ?').get(Number(b.prospectId), p.id);
      if (!prospect) throw new HttpError(404, 'Prospect introuvable');
    }
    const vars = mailVars(prospect || SAMPLE_PERSON, { fromName: p.smtp?.fromName || '' }, p.siteUrl);
    const item = {
      id: 1,
      subject: kind === 'initial' ? fillSubject(String(b.subject ?? '').trim().slice(0, 300), vars) : '',
      body: fillBody(body, vars).replace(/\n{3,}/g, '\n\n').trim(),
    };
    const budget = await budgetState(db, p.userId);
    if (budget.blocked) return json(ctx.res, { ok: true, unavailable: true, reason: `Budget IA atteint : ${budget.reason}` });
    const model = normalizeModel(await getSetting(db, p.userId, 'write_model', ''), 'haiku', await userProvider(db, p.userId));
    try {
      const { verdicts } = await checkSense({ claude, userId: p.userId, model, kind, template: body, items: [item] });
      const v = verdicts.get(1);
      json(ctx.res, {
        ok: true, sense: v.ok, problem: v.problem || null,
        fixBody: v.fixBody || null,
        // Le texte corrigé tel que le prospect le lirait, pour que la personne juge avant d'appliquer
        fixedText: v.fixBody ? fillBody(v.fixBody, vars).replace(/\n{3,}/g, '\n\n').trim() : null,
      });
    } catch (e) {
      if (!(e instanceof SenseUnavailable)) throw e;
      json(ctx.res, { ok: true, unavailable: true, reason: e.message });
    }
  }, { limit: 'sense' });

  // Changer une phrase : la personne a sélectionné une phrase de l'aperçu ; `start` et `end` sont sa position dans le modèle (calculée par la page).
  // L'IA propose une autre phrase au même rôle ; rien n'est modifié : la page n'applique la proposition que sur un clic.
  router.post('/api/projects/:id/template/rephrase', async (ctx) => {
    const p = await getProject(app, Number(ctx.params.id), { userId: ctx.session.userId, secrets: true });
    const b = await readBody(ctx.req);
    const kind = b.kind === 'followup' ? 'followup' : 'initial';
    const body = String(b.body ?? '').slice(0, 10_000);
    const start = Number(b.start), end = Number(b.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > body.length || end - start > 600 || !body.slice(start, end).trim()) {
      throw new HttpError(400, 'Phrase introuvable dans le modèle : sélectionne-la de nouveau', { expose: true });
    }
    let prospect = null;
    if (b.prospectId != null && b.prospectId !== '') {
      prospect = await db.prepare('SELECT * FROM prospects WHERE id = ? AND project_id = ?').get(Number(b.prospectId), p.id);
      if (!prospect) throw new HttpError(404, 'Prospect introuvable');
    }
    const vars = mailVars(prospect || SAMPLE_PERSON, { fromName: p.smtp?.fromName || '' }, p.siteUrl);
    const avoid = (Array.isArray(b.avoid) ? b.avoid : []).slice(-5).map((a) => String(a ?? '').slice(0, 700)).filter(Boolean);
    const budget = await budgetState(db, p.userId);
    if (budget.blocked) return json(ctx.res, { ok: true, unavailable: true, reason: `Budget IA atteint : ${budget.reason}` });
    const model = normalizeModel(await getSetting(db, p.userId, 'write_model', ''), 'haiku', await userProvider(db, p.userId));
    try {
      const r = await proposeSentence({ claude, userId: p.userId, model, kind, template: body, sentence: body.slice(start, end), avoid, facts: JSON.stringify([p.profile, p.target]).slice(0, 4000) });
      json(ctx.res, { ok: true, sentence: r.sentence, shown: fillBody(r.sentence, vars).trim() });
    } catch (e) {
      if (!(e instanceof SenseUnavailable)) throw e;
      json(ctx.res, { ok: true, unavailable: true, reason: e.message });
    }
  }, { limit: 'sense' });

  router.get('/api/preview/:token', async ({ res, params, session }) => {
    const v = previews.get(String(params.token));
    if (!v || v.userId !== session.userId || v.exp < now()) throw new HttpError(404, 'Aperçu expiré : relance-le.');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      // Mail HTML (styles en ligne) : ni script, ni réseau, ni lien actif ; seul notre propre cadre isolé peut l'afficher
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      'X-Frame-Options': 'SAMEORIGIN',
    });
    res.end(v.html);
  });
}
