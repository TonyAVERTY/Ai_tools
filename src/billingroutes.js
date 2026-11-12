// Facturation : recap des projets, informations légales, trois exemples de devis (Claude), choix et affinage, puis les quatre documents (devis, acompte,
// facture finale, avoir) à valider un par un. Seuls les projets DONT LE COMPTE EST PROPRIÉTAIRE sont concernés ; tout est filtré par compte.
import { HttpError, html, json, redirect, readBody } from './http.js';
import { enqueue, latestJobs } from './services/jobs.js';
import { getProject, repoDir } from './projects.js';
import { userAccountingSettings } from './accountingroutes.js';
import { getBilling, saveLegal, listDocs, getDoc, setChosen, validateDoc, resetDocs, billingOverview, otherLegals, getBrandRow, brandForRender } from './billingdata.js';
import { LEGAL_KEYS, normalizeLegal, legalComplete, legalMissing, billingStage, renderDocument, suggestFromRepo, buildSuggestions } from './services/billing.js';
import { billingOverviewPage, billingProjectBody } from './billingviews.js';
import { renderDocumentPdf } from './services/billingpdf.js';
import { issueDocument, listInvoices, listClients, getInvoice, invoiceDir, IssueError } from './billingissue.js';
import { DOC_BY_KEY } from './services/billing.js';
import { slug } from './services/accounting.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BILLING_JOBS = ['billing_quotes', 'billing_refine', 'billing_docs'];
const refuse = (status, msg) => new HttpError(status, msg, { expose: true });

export function registerBillingRoutes(router, app, { aiOpts = {} } = {}) {
  const { db, cfg } = app;

  /** Un projet dont le compte est propriétaire (un membre d'équipe n'a pas à y toucher : les informations légales sont celles du propriétaire). */
  const mine = async (ctx, secrets = false) => {
    const p = await getProject(app, Number(ctx.params.id), { userId: ctx.session.userId, secrets });
    if (p.access !== 'owner') throw new HttpError(404, 'Projet introuvable', { expose: true });
    return p;
  };
  const back = (id, q = '') => `/p/${id}/facturation${q}`;

  /** Tâches de facturation en cours pour le compte, par projet. */
  const runningByProject = async (userId) => {
    const rows = await db.prepare(`SELECT project_id, type FROM jobs WHERE user_id = ? AND type IN (${BILLING_JOBS.map(() => '?').join(',')}) AND status IN ('queued','running')`).all(userId, ...BILLING_JOBS);
    const m = new Map();
    for (const r of rows) m.set(Number(r.project_id), { ...(m.get(Number(r.project_id)) || {}), [r.type]: { status: 'running' } });
    return m;
  };

  // ---------- Recap de tous les projets ----------
  router.get('/facturation', async ({ res, session }) => {
    const userId = session.userId;
    const projects = await db.prepare('SELECT id, name, git_url, profile_json FROM projects WHERE user_id = ? ORDER BY LOWER(name)').all(userId);
    const overview = await billingOverview(db, userId);
    const running = await runningByProject(userId);
    const rows = projects.map((p) => {
      const b = overview.get(Number(p.id));
      const legal = b?.legal || normalizeLegal({}).values;
      const stage = billingStage({ legal, docs: b?.docs || [], chosen: b?.chosen ?? null, jobs: running.get(Number(p.id)) || {} });
      let resume = '';
      try { resume = JSON.parse(p.profile_json || 'null')?.resume || ''; } catch { resume = ''; }
      return { id: Number(p.id), name: p.name, gitUrl: p.git_url, resume, stage, missing: legalMissing(legal).length };
    });
    html(res, billingOverviewPage({ email: session.email, rows }));
  });

  // ---------- Un projet : informations légales, devis, documents ----------
  /** Les arguments de la page de facturation d'un projet (page propre ou onglet « Facturation » de la page projet). */
  const projectArgs = async (ctx) => {
    const { url, session } = ctx;
    const userId = session.userId;
    const p = await mine(ctx, true);
    const billing = await getBilling(db, p.id, userId);
    const docs = await listDocs(db, p.id, userId);
    const jobsAll = await latestJobs(db, p.id);
    const jobs = Object.fromEntries(BILLING_JOBS.filter((t) => jobsAll[t]).map((t) => [t, jobsAll[t]]));
    // Valeurs proposées (code, analyse, comptabilité) pour les champs encore vides ; elles ne sont enregistrées que si l'utilisateur valide le formulaire
    const acc = await userAccountingSettings(db, userId);
    const suggestions = buildSuggestions({
      others: await otherLegals(db, userId, p.id),
      repo: suggestFromRepo(repoDir(cfg, userId, p.id)), profile: p.profile, accounting: { vat: acc.vat, regime: acc.regime }, smtpEmail: p.smtp?.fromEmail || '', accountEmail: session.email,
    });
    const verify = url.searchParams.has('verif');
    const errors = verify || billing.exists ? normalizeLegal(billing.legal).errors : {};
    const stage = billingStage({ legal: billing.legal, docs, chosen: billing.chosen, jobs });
    return {
      email: session.email, project: { id: p.id, name: p.name, gitUrl: p.gitUrl }, legal: billing.legal, saved: billing.exists, errors: verify || billing.exists ? errors : {}, suggestions,
      docs, brand: await getBrandRow(db, p.id, userId), invoices: await listInvoices(db, userId, p.id), clients: await listClients(db, userId, p.id), selectedKind: url.searchParams.get('type') || '', selectedClientId: Number(url.searchParams.get('client')) || null, chosen: billing.chosen, stage, jobs, flash: { ok: url.searchParams.get('ok'), error: url.searchParams.get('e') },
    };
  };
  app.billingTab = async (ctx) => billingProjectBody({ ...(await projectArgs(ctx)), inTab: true });
  router.get('/facturation/projet/:id', async (ctx) => redirect(ctx.res, `/p/${ctx.params.id}/facturation${ctx.url.search}`));

  // Enregistre les informations légales (même incomplètes : rien n'est perdu)
  router.post('/facturation/projet/:id/legal', async (ctx) => {
    const p = await mine(ctx);
    const b = await readBody(ctx.req);
    const { errors } = await saveLegal(db, p.id, ctx.session.userId, Object.fromEntries(LEGAL_KEYS.map((k) => [k, b[k]])));
    redirect(ctx.res, back(p.id, Object.keys(errors).length ? '?verif=1&ok=legal_incomplet#legal' : '?ok=legal'));
  }, { limit: 'compta' });

  const startJob = async (ctx, p, type, params = {}) => {
    const r = await enqueue(db, { userId: p.userId, projectId: p.id, type, params }, aiOpts);
    if (r.existing) throw refuse(409, 'Une demande est déjà en cours pour ce projet : attends sa fin.');
    return r;
  };

  // Génère trois exemples de devis (sans devis déjà validé)
  router.post('/facturation/projet/:id/generer', async (ctx) => {
    const p = await mine(ctx);
    const userId = ctx.session.userId;
    const { legal } = await getBilling(db, p.id, userId);
    if (!legalComplete(legal)) throw refuse(400, "Complète d'abord les informations légales du projet.");
    if ((await listDocs(db, p.id, userId)).some((d) => d.kind === 'quote_option' && d.status === 'validated')) throw refuse(400, 'Un devis est déjà validé : recommence depuis le début pour en générer de nouveaux.');
    await startJob(ctx, p, 'billing_quotes');
    redirect(ctx.res, back(p.id, '?ok=quotes#devis'));
  }, { limit: 'compta' });

  // Choisit l'un des trois exemples
  router.post('/facturation/projet/:id/choisir', async (ctx) => {
    const p = await mine(ctx);
    const b = await readBody(ctx.req);
    const doc = (await listDocs(db, p.id, ctx.session.userId)).find((d) => d.kind === 'quote_option' && d.variant === Number(b.variant));
    if (!doc) throw refuse(404, 'Exemple introuvable.');
    if (doc.status === 'validated') throw refuse(400, 'Ce devis est déjà validé.');
    await setChosen(db, p.id, ctx.session.userId, doc.variant);
    redirect(ctx.res, back(p.id, '#devis'));
  }, { limit: 'compta' });

  // Affine un exemple de devis (le choisi) ou l'un des quatre documents
  router.post('/facturation/projet/:id/affiner', async (ctx) => {
    const p = await mine(ctx);
    const userId = ctx.session.userId;
    const b = await readBody(ctx.req);
    const doc = await getDoc(db, b.doc, userId);
    if (!doc || doc.projectId !== p.id) throw refuse(404, 'Document introuvable.');
    const request = String(b.request ?? '').trim();
    if (request.length < 3) throw refuse(400, 'Décris ce que tu veux changer.');
    if (doc.kind === 'quote_option') {
      if (doc.status === 'validated') throw refuse(400, 'Ce devis est validé : recommence depuis le début pour le changer.');
      if ((await getBilling(db, p.id, userId)).chosen !== doc.variant) throw refuse(400, "Choisis d'abord cet exemple.");
    }
    await startJob(ctx, p, 'billing_refine', { docId: doc.id, request: request.slice(0, 800) });
    redirect(ctx.res, back(p.id, `?ok=refine#${doc.kind === 'quote_option' ? 'devis' : 'documents'}`));
  }, { limit: 'compta' });

  // Valide : l'exemple choisi (Claude prépare alors les quatre documents), ou l'un des quatre documents
  router.post('/facturation/projet/:id/valider', async (ctx) => {
    const p = await mine(ctx);
    const userId = ctx.session.userId;
    const b = await readBody(ctx.req);
    const doc = await getDoc(db, b.doc, userId);
    if (!doc || doc.projectId !== p.id) throw refuse(404, 'Document introuvable.');
    const jobs = await latestJobs(db, p.id);
    if (['queued', 'running'].includes(jobs.billing_refine?.status) || ['queued', 'running'].includes(jobs.billing_docs?.status)) throw refuse(409, 'Une demande est en cours : attends sa fin avant de valider.');
    if (doc.kind === 'quote_option') {
      if ((await getBilling(db, p.id, userId)).chosen !== doc.variant) throw refuse(400, "Choisis d'abord cet exemple.");
      await validateDoc(db, doc.id, userId);
      try { await startJob(ctx, p, 'billing_docs'); } catch (e) { await db.prepare("UPDATE billing_docs SET status = 'draft', validated_at = NULL WHERE id = ?").run(doc.id); throw e; }
      return redirect(ctx.res, back(p.id, '?ok=docs#documents'));
    }
    await validateDoc(db, doc.id, userId);
    redirect(ctx.res, back(p.id, '?ok=valide#documents'));
  }, { limit: 'compta' });

  // Relance la préparation des quatre documents (après une erreur, par exemple)
  router.post('/facturation/projet/:id/documents', async (ctx) => {
    const p = await mine(ctx);
    const docs = await listDocs(db, p.id, ctx.session.userId);
    if (!docs.some((d) => d.kind === 'quote_option' && d.status === 'validated')) throw refuse(400, "Valide d'abord un devis.");
    await startJob(ctx, p, 'billing_docs');
    redirect(ctx.res, back(p.id, '?ok=docs#documents'));
  }, { limit: 'compta' });

  // Tout recommencer : exemples et documents effacés, informations légales conservées
  router.post('/facturation/projet/:id/recommencer', async (ctx) => {
    const p = await mine(ctx);
    const jobs = await latestJobs(db, p.id);
    if (BILLING_JOBS.some((t) => ['queued', 'running'].includes(jobs[t]?.status))) throw refuse(409, 'Une demande est en cours : attends sa fin.');
    await resetDocs(db, p.id, ctx.session.userId);
    redirect(ctx.res, back(p.id, '?ok=reset'));
  }, { limit: 'compta' });

  // ---------- PDF : le modèle d'un document (variables laissées vides), puis les vrais documents émis ----------
  const sendPdf = (res, data, name) => {
    res.writeHead(200, {
      'Content-Type': 'application/pdf', 'Content-Length': data.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `attachment; filename="${name}"`, 'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.end(data);
  };

  router.get('/facturation/documents/:id/pdf', async ({ res, params, session }) => {
    const doc = await getDoc(db, params.id, session.userId);
    if (!doc || doc.kind === 'quote_option') throw refuse(404, 'Document introuvable.');
    const billing = await getBilling(db, doc.projectId, session.userId);
    if (!legalComplete(billing.legal)) throw refuse(400, 'Complète les informations légales du projet.');
    sendPdf(res, renderDocumentPdf({ kind: doc.kind, content: doc.content, legal: billing.legal, layout: doc.layout, brand: brandForRender(await getBrandRow(db, doc.projectId, session.userId)) }), `modele-${slug(DOC_BY_KEY[doc.kind].label)}.pdf`);
  }, { limit: 'compta' });

  // Émet un document validé : numéro, PDF et, pour une facture, ligne « à encaisser » dans la Comptabilité
  router.post('/facturation/projet/:id/emettre', async (ctx) => {
    const p = await mine(ctx);
    const userId = ctx.session.userId;
    const b = await readBody(ctx.req);
    const doc = await getDoc(db, b.doc, userId);
    if (!doc || doc.projectId !== p.id || doc.kind === 'quote_option') throw refuse(404, 'Document introuvable.');
    const billing = await getBilling(db, p.id, userId);
    try {
      const r = await issueDocument(app, { userId, project: { id: p.id, name: p.name }, doc, legal: billing.legal, raw: b });
      redirect(ctx.res, back(p.id, `?ok=${doc.kind === 'devis' ? 'emis_devis' : 'emis'}&n=${encodeURIComponent(r.number)}#emis`));
    } catch (e) {
      if (!(e instanceof IssueError)) throw e;
      redirect(ctx.res, back(p.id, `?e=${encodeURIComponent(e.message)}#generer`));
    }
  }, { limit: 'compta' });

  router.get('/facturation/factures/:id/pdf', async ({ res, params, session }) => {
    const inv = await getInvoice(db, session.userId, params.id);
    const path = inv && join(invoiceDir(cfg, session.userId, inv.id), inv.pdf_file);
    if (!inv || !existsSync(path)) throw refuse(404, 'Document introuvable.');
    sendPdf(res, readFileSync(path), inv.pdf_file);
  }, { limit: 'compta' });

  // État pour le suivi (public/facturation.js) : la page se recharge quand une tâche se termine
  router.get('/api/facturation/:id/state', async (ctx) => {
    const p = await mine(ctx);
    const userId = ctx.session.userId;
    const docs = await listDocs(db, p.id, userId);
    const jobsAll = await latestJobs(db, p.id);
    const jobs = Object.fromEntries(BILLING_JOBS.filter((t) => jobsAll[t]).map((t) => [t, jobsAll[t]]));
    const active = BILLING_JOBS.map((t) => jobs[t]).find((j) => j && ['queued', 'running'].includes(j.status));
    const rev = `${docs.map((d) => `${d.id}:${d.updatedAt}:${d.status}`).join(',')}|${BILLING_JOBS.map((t) => `${jobs[t]?.id}:${jobs[t]?.status}`).join(',')}`;
    json(ctx.res, { busy: !!active, message: active?.progress?.message || '', pct: active?.progress?.pct ?? null, rev });
  });

  // Aperçu d'un document : HTML autonome, servi dans un cadre isolé (aucun script, aucun réseau)
  router.get('/facturation/documents/:id/apercu', async ({ res, params, session }) => {
    const doc = await getDoc(db, params.id, session.userId);
    if (!doc) throw new HttpError(404, 'Document introuvable', { expose: true });
    const { legal } = await getBilling(db, doc.projectId, session.userId);
    const kind = doc.kind === 'quote_option' ? 'devis' : doc.kind;
    const body = renderDocument({ kind, content: doc.content, legal, layout: doc.layout, brand: brandForRender(await getBrandRow(db, doc.projectId, session.userId)) });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      'X-Frame-Options': 'SAMEORIGIN',
    });
    res.end(body);
  }, { limit: 'compta' });
}
