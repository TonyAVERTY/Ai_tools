// Handlers des jobs en arrière-plan.
import { now, getSetting, setSetting } from './db.js';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractJson } from './services/claude.js';
import { getProvider } from './services/providers/index.js';
import { withUserLock } from './services/userlock.js';
import { tidyTemplateText, acceptReview, fillBody, fillSubject, styleProblems } from './services/mailcheck.js';
import { checkSense, acceptSenseFix, SenseUnavailable, SENSE_BATCH } from './services/mailsense.js';
import { addUsage, jobContext, liveJobUsage } from './services/jobs.js';
import { syncRepo } from './services/git.js';
import { normalizeModel, defaultModelOf, tierEquivalent, modelFamily } from './services/models.js';
import { analyzePrompt, prospectPrompt, templatePrompt, reviewMailPrompt, fixStylePrompt, followupTemplatePrompt, evolutionPrompt, linkedinPostPrompt, instagramPrompt, inspirationPrompt, newsletterPrompt, hookPrompt, auditPrompt, promoPrompt, rolePrompt, parseCustomPrompts, LEVELS } from './services/prompts.js';
import { VOICE_PROVIDERS, parseVoiceParams, extractVoiceScript, prepareVoice, cleanVoice, mixVoice, synthesize, langName } from './services/voiceover.js';
import { PROMO, FORMATS, SCENE_REFUSED, SceneError, parsePromoParams, extractScene, promoSupported, renderPromo } from './services/promovideo.js';
import { reviewPromo } from './services/promoqa.js';
import { createJobStream } from './services/jobstream.js';
import { reserveVideo, finishVideo, removeVideo, countVideos, keepScene, takeScene, getVoiceKey, getVoiceRegion } from './promo.js';
import { linkedinAccount, saveDraft, recentDrafts } from './linkedin.js';
import { saveDraft as saveContent, recentBodies, cleanHashtags, INSTAGRAM_FORMATS, LIMITS as CONTENT } from './contentdrafts.js';
import { extractVisual, renderStill, stillSupported, TOOLS as STILL_TOOLS } from './services/stillimage.js';
import { reviewStill, reviewVerdict as stillVerdict } from './services/stillqa.js';
import { followupCandidates, followupSubject, isBusinessHours } from './services/followup.js';
import { EMAIL_RE, createTransport, buildProspectMail, allowedToSend, makeMessageId, mailVars, SAMPLE_PERSON } from './services/mailer.js';
import { unsubToken } from './crypto.js';
import { resolveCredentials, markLinkInvalid, userProvider, saveRefreshedAuth } from './claudelink.js';
import { userRepoRoot, userChatRoot } from './users.js';
import { quotaAlerts, budgetState } from './services/budget.js';
import { notify } from './services/notify.js';
import { quotaFor, recordUsage, planLimitMessage } from './services/plans.js';
import { getUser } from './users.js';
import { pinSmtp, pinGit } from './netguard.js';
import { sendPause, pauseMessage, evaluateSending } from './services/abuse.js';
import { verifyAddress, defaultMx } from './services/verify.js';
import { evolutionMail } from './services/mailhtml.js';
import { gitCredentialFor } from './gitservers.js';
import { ROLE_TASKS, roleById, MAX_NOTES } from './services/roles.js';
import { getProject, repoDir, sentSince, getTemplate, saveTemplate, pickVariant } from './projects.js';
import { getProfile, profileBlock } from './userprofile.js';
import { repoProfile, renderRepoProfile } from './services/repoprofile.js';
import { billingQuotesPrompt, billingRefinePrompt, billingDocsPrompt } from './services/prompts.js';
import { getBilling, listDocs, getDoc, replaceOptions, updateDocContent, replaceFinals, getBrandRow, saveBrand, saveBrandReview, brandForRender } from './billingdata.js';
import { brandPrompt, parseBrand, resolveBrand } from './services/billingbrand.js';
import { fetchGoogleFont, rasterSvg } from './services/brandassets.js';
import { reviewDocument, sampleValues } from './services/billingreview.js';
import { renderDocumentPdf } from './services/billingpdf.js';
import { legalComplete, normalizeContent, DOC_KINDS, LAYOUTS } from './services/billing.js';

// Constats du dépôt cloné (profil établi par le code, mis en cache par commit) ; vide si le dossier est illisible : un job ne doit jamais échouer pour ça
function factsOf(dir) {
  try { return renderRepoProfile(repoProfile(dir)); } catch (e) { console.warn('[repoprofile]', e.message); return ''; }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Annulé')); }, { once: true });
});

// Les callbacks du flux Claude (onText, onTurn) sont synchrones : leurs écritures en base passent par une file
// ordonnée, attendue à la fin de la phase (flush). Une erreur d'écriture fait échouer le job au lieu de se perdre.
function makeSink() {
  let chain = Promise.resolve();
  return {
    push(fn) { chain = chain.then(fn); chain.catch(() => {}); },
    flush: () => chain,
  };
}

/**
 * Ce que Claude est en train de faire, en une phrase pour l'écran (null = rien à montrer). Jamais de contenu sensible :
 * une recherche web est affichée telle quelle (c'est le sujet du projet), une page lue seulement par son nom d'hôte.
 */
export function toolActivity(name, input = {}) {
  const clip = (t, n = 70) => { const v = String(t ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
  if (name === 'WebSearch' && input.query) return `Recherche web : « ${clip(input.query)} »`;
  if (name === 'WebFetch' && input.url) { try { return `Lecture du site ${new URL(input.url).hostname.replace(/^www\./, '')}`; } catch { return 'Lecture d\'une page web'; } }
  if (name === 'Read' && input.file_path) return `Lecture de ${clip(String(input.file_path).split('/').slice(-2).join('/'), 50)}`;
  if (name === 'Grep' || name === 'Glob') return 'Recherche dans le code';
  return null;
}

// Avancement d'une phase Claude : de `from` à `to` % au fil des messages, sur `maxTurns` au plus (estimation)
const turnPct = (from, to, n, maxTurns) => Math.round(from + (to - from) * Math.min(1, n / Math.max(1, maxTurns)));

/**
 * Un appel Claude d'un seul tour ne dit rien tant qu'il n'a pas fini : on fait avancer le pourcentage au fil du temps (jamais au-delà de `to`),
 * pour que l'utilisateur voie que ça tourne. Le vrai résultat ramène ensuite la tâche à 100 %.
 */
export async function creeping(ctx, message, from, fn, { to = 90, ms = 45_000 } = {}) {
  const t0 = Date.now();
  const tick = () => ctx.progress({ message, pct: Math.round(from + (to - from) * (1 - Math.exp(-(Date.now() - t0) / ms))) }).catch(() => {});
  const timer = setInterval(tick, 2000);
  try { return await fn(); } finally { clearInterval(timer); }
}

// Une page web peut tenter de faire enregistrer "javascript:…" : seules les URLs http(s) sont gardées
export function httpUrl(v) {
  const s = String(v ?? '').trim();
  if (!/^https?:\/\/[^\s<>"]+$/i.test(s)) return null;
  try { return new URL(s).protocol.startsWith('http') ? s.slice(0, 300) : null; } catch { return null; }
}

export function parseProspectLine(line) {
  const m = /^\s*PROSPECT\s+(\{.*\})\s*$/.exec(line);
  if (!m) return null;
  let p;
  try { p = JSON.parse(m[1]); } catch { return null; }
  const email = String(p.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !p.company) return null;
  const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max));
  const score = Math.max(1, Math.min(10, Math.round(Number(p.score) || 5)));
  return {
    company: str(p.company, 200), email, website: httpUrl(p.website), city: str(p.city, 100),
    sector: str(p.sector, 100), hook: str(p.hook, 400), source: httpUrl(p.source), score,
  };
}

/**
 * Ligne de diagnostic d'un appel à Claude qui a répondu en erreur (« Not logged in », quota…). Aucune valeur secrète :
 * seulement le mode, la présence et la forme du secret (longueur, caractères), le bac à sable et ce que contient le dossier de travail.
 */
export function claudeDiagnostic({ userId, cred, cfg, cwd, r }) {
  const secrets = Object.entries(cred.secretEnv || {}).map(([name, v]) => {
    const s = String(v ?? '');
    const clean = /^[\x21-\x7e]+$/.test(s); // un jeton ne contient ni espace ni caractère de contrôle
    return `${name}(len=${s.length},${clean ? 'propre' : 'CARACTERES_PARASITES'})`;
  });
  let ctx = 'aucun';
  if (cwd) {
    try { ctx = readdirSync(cwd).filter((f) => /^(\.claude|\.mcp\.json|CLAUDE\.md)$/.test(f)).join(',') || 'rien'; }
    catch { ctx = 'illisible'; }
  }
  const sb = cfg.sandbox || {};
  if (cred.authFile) secrets.push(`fichier_de_connexion(len=${String(cred.authFile).length})`);
  return `[claude] échec user=${Number(userId)} mode=${cred.mode} secret=${secrets.join(',') || 'AUCUN'} `
    + `bac_a_sable=${sb.enabled ? 'oui' : 'non'}${sb.production ? '(prod)' : ''} fichiers_claude_du_depot=${ctx} subtype=${r.subtype}`;
}

/**
 * Tout appel à Claude passe par ici. Le secret est relu pour le user_id du job (jamais un autre), l'exécution se fait
 * dans le bac à sable avec un environnement assaini, et le quota remonté par le CLI est enregistré pour CET utilisateur.
 */
export function makeClaude(app) {
  const { db, cfg } = app;
  const claude = async (userId, o, cred) => {
    const provider = getProvider(cred.provider);
    const jc = jobContext.getStore();
    if (jc && o.model) jc.model = o.model; // le job sait quel modèle sert vraiment
    // Profil de l'utilisateur (secteur, métier…) : une donnée de plus dans les consignes système, sauf pour le Support (qui répond d'après la documentation)
    const system = o.noProfile ? o.system : `${o.system ?? ''}${profileBlock(await getProfile(db, userId))}` || undefined;
    // Accès refusé par Claude (jeton expiré, clé révoquée) : la liaison devient invalide et l'interface demande de se reconnecter
    const refused = async () => { if (await markLinkInvalid(db, userId)) console.warn(`[claude] accès refusé : liaison de l'utilisateur ${Number(userId)} marquée invalide`); };
    let r;
    let renewedAuth = null;
    let hasOutput = false;
    const stream = jc?.log ? createJobStream(jc.log, [...Object.values(cred.secretEnv || {}), ...(cred.secrets || [])]) : null;
    const usage = jc?.usage ? liveJobUsage(jc) : null;
    let usageTimer = null, pendingUsage = null;
    const flushUsage = () => { clearTimeout(usageTimer); usageTimer = null; if (pendingUsage) { usage?.update(pendingUsage); pendingUsage = null; } };
    jc?.log?.('model', `Modèle : ${o.model || 'haiku'}`);
    try {
      r = await provider.run({
        bin: provider.bin(cfg, cred.mode), ...o, system,
        onUsage: (u) => { pendingUsage = u; if (!usageTimer) usageTimer = setTimeout(flushUsage, 500); o.onUsage?.(u); },
        onDelta: stream ? (text) => { hasOutput = true; stream.delta(text); o.onDelta?.(text); } : o.onDelta,
        onActivity: jc ? (text) => { jc.log?.('activity', text); o.onActivity?.(text); } : o.onActivity,
        onText: (text) => { hasOutput = true; stream?.block(text); o.onText?.(text); },
        onTool: (name, input) => { jc?.log?.('tool', toolActivity(name, input) || `Outil : ${name}`); o.onTool?.(name, input); },
        onTurn: (n) => { jc?.log?.('turn', `Claude · étape ${n}`); o.onTurn?.(n); },
        sandbox: cfg.sandbox, secretEnv: cred.secretEnv,
        // Connexion de compte : le fichier à utiliser, les jetons à masquer, et la mise à jour que le CLI en fait (jetons renouvelés)
        ...(cred.authFile ? { authFile: cred.authFile, secrets: cred.secrets, onAuthFile: (text) => { renewedAuth = text; }, workRoot: join(cfg.dataDir, 'run') } : {}),
        // Les clones lus sont ceux du propriétaire du projet (page IA : projet d'équipe joint, accès vérifié par l'appelant) ;
        // les pièces jointes lues en plus sont toujours dans le dossier de CET utilisateur.
        allowedRoot: o.allowedRoot ?? userRepoRoot(cfg, o.repoOwnerId ?? userId),
        extraRoot: userChatRoot(cfg, userId),
      });
    } catch (e) {
      stream?.finish();
      flushUsage();
      if (renewedAuth) await saveRefreshedAuth(app, userId, cred.linkedAt, renewedAuth);
      if (provider.isAuthRefusal(e.message)) await refused();
      throw e;
    }
    stream?.finish();
    flushUsage();
    if (renewedAuth) await saveRefreshedAuth(app, userId, cred.linkedAt, renewedAuth);
    usage?.finish(r);
    if (!hasOutput && r.text) jc?.log?.('output', r.text);
    if (!r.ok) {
      console.warn(claudeDiagnostic({ userId, cred, cfg, cwd: o.cwd, r }));
      // Un message d'erreur d'authentification est court ; un long texte (analyse tronquée qui parle d'un « 401 » dans le code) n'en est pas un
      if (r.subtype !== 'error_max_turns' && String(r.text ?? '').length < 400 && provider.isAuthRefusal(`${r.text} ${r.subtype}`)) await refused();
    }
    // État du quota d'abonnement (session 5h + semaine), affiché dans la carte « Consommation Claude ». Une clé API n'en a pas.
    const w = cred.mode === 'api_key' ? null : provider.rateLimitWindows(r.rateLimit);
    if (w) {
      await setSetting(db, userId, 'claude_rate_limit_json', JSON.stringify({ at: now(), ...w }));
      for (const a of await quotaAlerts(db, userId, w)) {
        // notify ne lève jamais : un Discord indisponible ne fait pas échouer le job
        await notify(app, userId, 'quota', {
          title: `Quota Claude : ${a.level}+ % (${a.label})`,
          level: a.level >= 95 ? 'error' : 'warn',
          description: `${Math.round(a.utilization * 100)} % utilisé sur la ${a.label}.`,
        });
      }
    }
    return r;
  };
  return async (userId, o) => {
    const cred = await resolveCredentials(app, userId); // refuse sans liaison valide (dernier garde-fou)
    if (!cred.authFile) return claude(userId, o, cred);
    // Connexion de compte : un seul exécutable à la fois par utilisateur (le CLI renouvelle ses jetons, à usage unique), les tâches s'enchaînent.
    // Les identifiants sont relus DANS la file : le job précédent a pu renouveler le fichier.
    return withUserLock(userId, async () => claude(userId, o, await resolveCredentials(app, userId)), { signal: o.signal });
  };
}

/** Clone ou met à jour le dépôt d'un projet avec le jeton git de SON propriétaire (jamais celui d'un autre). */
// Plusieurs jobs d'un même compte peuvent tourner en même temps (multi jobs) : deux synchronisations du même dépôt ne se chevauchent jamais.
const syncing = new Map(); // dossier du dépôt → fin de la synchronisation en cours

export function makeSync(app) {
  return async (userId, url, dir) => {
    const cred = await gitCredentialFor(app, userId, url); // le token de SON hôte seulement, jamais celui d'un autre
    const run = async () => (app.syncRepo || syncRepo)(url, dir, cred?.token ?? null, { pin: await pinGit(app, userId, url), scheme: cred?.scheme, user: cred?.user });
    const before = syncing.get(dir) || Promise.resolve();
    const mine = before.catch(() => {}).then(run);
    const tail = mine.catch(() => {});
    syncing.set(dir, tail);
    tail.then(() => { if (syncing.get(dir) === tail) syncing.delete(dir); });
    return mine;
  };
}

// Rondes de contrôle des agents (2 agents par ronde, plusieurs centaines de milliers de tokens) : la scène, la voix et le rendu gardent leurs 3 essais
const REVIEW_ROUNDS = 2;

export function makeHandlers(app, { claude = makeClaude(app) } = {}) {
  const { db, cfg } = app;
  // Dépôts Git (GitHub ou serveur perso) : l'hôte est revérifié à chaque synchronisation, git se connecte à l'adresse vérifiée
  const sync = makeSync(app);
  // Identité du projet pour ses documents (couleurs, police, logo) : Claude lit le dépôt, le code vérifie et garde ce qui est valide.
  // Jamais bloquant : sans dépôt lisible ou en cas d'échec, les documents gardent leur mise en page standard.
  const ensureBrand = async (ctx, { userId, project, model, refresh = false }) => {
    const existing = await getBrandRow(db, project.id, userId);
    if (existing && !refresh) return existing;
    try {
      await ctx.progress({ message: 'Claude lit le dépôt pour retrouver le style du projet…', pct: 6 });
      const full = await getProject(app, project.id, { userId, secrets: true });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, full.gitUrl, dir);
      const { prompt, system } = brandPrompt({ projectName: project.name, profile: project.profile, siteUrl: project.siteUrl });
      const r = await claude(userId, { prompt, system, cwd: dir, model, maxTurns: 14, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal });
      addUsage(ctx, r);
      if (!r.ok) throw new Error(`lecture du dépôt impossible (${r.subtype})`);
      const resolved = await resolveBrand(parseBrand(extractJson(r.text)), dir, {
        fetchFont: app.fetchFont || ((family, weight) => fetchGoogleFont(family, weight)),
        rasterSvg: (svg) => (app.rasterSvg || rasterSvg)(svg, cfg),
      });
      await saveBrand(db, project.id, userId, resolved);
    } catch (e) {
      if (ctx.signal?.aborted) throw e;
      // Une ancienne identité reste valable ; sinon on enregistre « aucune » pour ne pas relancer la lecture à chaque génération
      if (!existing) await saveBrand(db, project.id, userId, { brand: { source: 'default', primary: '', notes: `Style du projet non lu : ${String(e.message).slice(0, 120)}` }, assets: {} });
    }
    return getBrandRow(db, project.id, userId);
  };

  // Relecture des documents définitifs : l'IA regarde le rendu PDF de chacun, demande des corrections, les relit (trois essais au plus) ;
  // au dernier essai le document est livré avec les défauts restants. Un échec de la relecture ne bloque jamais la génération.
  const reviewBillingDocs = async (ctx, { userId, project, legal, model }) => {
    let row = await getBrandRow(db, project.id, userId);
    if (!row) { await saveBrand(db, project.id, userId, { brand: { source: 'default', primary: '' }, assets: {} }); row = await getBrandRow(db, project.id, userId); }
    const docs = (await listDocs(db, project.id, userId)).filter((d) => d.kind !== 'quote_option');
    let adjust = row.adjust || {};
    const report = [];
    for (const [i, doc] of docs.entries()) {
      const base = 91 + Math.round((i / docs.length) * 8);
      try {
        const res = await (app.reviewBillingDoc || reviewDocument)({
          kind: doc.kind, content: doc.content, legal, brand: row.brand, adjust,
          render: (content, adj) => renderDocumentPdf({ kind: doc.kind, content, legal, layout: doc.layout, values: sampleValues(doc.kind), brand: brandForRender(row, adj) }),
          runAgent: async (options) => { const result = await claude(userId, options); addUsage(ctx, result); return result; },
          extraRoot: userChatRoot(cfg, userId), model, signal: ctx.signal,
          onProgress: (p) => ctx.progress({ message: p.message, pct: base }),
        });
        adjust = res.adjust;
        if (JSON.stringify(res.content) !== JSON.stringify(doc.content)) await updateDocContent(db, doc.id, userId, { ...res.content, layout: doc.layout }, doc.refinement);
        report.push({ kind: doc.kind, approved: res.approved, rounds: res.rounds, skipped: res.skipped, issues: res.issues });
      } catch (e) {
        if (ctx.signal?.aborted) throw e;
        report.push({ kind: doc.kind, approved: false, rounds: 0, skipped: `Relecture impossible : ${String(e.message).slice(0, 160)}`, issues: [] });
      }
    }
    await saveBrandReview(db, project.id, userId, { adjust, review: { at: Math.floor(Date.now() / 1000), docs: report } });
    return report;
  };
  // Consignes modifiées par l'utilisateur (Réglages) : celles du compte qui lance le job
  const custom = async (userId) => parseCustomPrompts(await getSetting(db, userId, 'prompts_json'));
  // Modèles choisis dans les Réglages (liste de services/models.js ; toute autre valeur retombe sur Haiku)
  const modelOf = async (userId, key) => { const pv = await userProvider(db, userId); return normalizeModel(await getSetting(db, userId, key, defaultModelOf(pv)), undefined, pv); };
  // Rédaction (mails, relances, posts) : son propre réglage ; à défaut, le comportement d'avant (Haiku, et le modèle d'analyse pour LinkedIn)
  const writeModel = async (userId, legacy) => normalizeModel(await getSetting(db, userId, 'write_model', ''), legacy, await userProvider(db, userId));
  const inHours = () => (app.isBusinessHours || isBusinessHours)();

  // Forme d'un modèle tout juste généré : s'il manque l'appel ou la politesse, ou s'il propose des réponses toutes faites, l'IA le corrige UNE fois.
  // La correction n'est retenue que si elle garde les adresses, n'ajoute aucune variable et réduit le nombre de défauts ; sinon le texte reste tel quel
  // (l'aperçu signale les défauts qui restent). Une annulation ou un accès perdu remontent ; toute autre panne est sans effet.
  // Avant tout contenu public (post, newsletter, vidéo) : l'IA cherche sur le web ce qui fait percer les contenus du secteur du projet et ce que font les grandes entreprises
  // reconnues de ce secteur. Le web SEUL (jamais avec le dépôt : une page piégée ne doit pas pouvoir exfiltrer du code). Une recherche en échec ne fait pas échouer le contenu.
  async function researchInspiration(ctx, { userId, project, model, kind, direction = '', from = 8, to = 22 }) {
    const label = "Recherche d'inspiration dans ton secteur…";
    try {
      await ctx.progress({ message: label, pct: from });
      const rp = inspirationPrompt({ kind, projectName: project.name, profile: project.profile, target: project.target || {}, direction, site: project.siteUrl });
      const rr = await creeping(ctx, label, from, () => claude(userId, { prompt: rp.prompt, system: rp.system, model, maxTurns: 12, tools: STILL_TOOLS.research, signal: ctx.signal }), { to });
      addUsage(ctx, rr);
      return (String(rr.text ?? '').match(/<inspiration>([\s\S]*?)<\/inspiration>/i) || [])[1]?.trim().replace(/\n{3,}/g, '\n\n').slice(0, 900) ?? '';
    } catch (e) { if (ctx.signal?.aborted) throw e; return ''; }
  }

  async function mendStyle(ctx, userId, model, kind, body) {
    const problems = styleProblems(body);
    if (!problems.length) return { body, fixed: [] };
    try {
      const { prompt, system } = fixStylePrompt({ kind, body, problems });
      const r = await claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal });
      addUsage(ctx, r);
      const fixed = tidyTemplateText(String(extractJson(r.text)?.body ?? ''));
      const left = fixed ? styleProblems(fixed) : problems;
      if (fixed && left.length < problems.length && acceptSenseFix(body, fixed, { slack: 12 })) return { body: fixed, fixed: problems.filter((p) => !left.includes(p)) };
    } catch (e) {
      if (ctx.signal?.aborted || e.status === 403) throw e;
    }
    return { body, fixed: [] };
  }

  /**
   * Relecture de la forme par l'IA (langue, ponctuation, signature) : facultative, retenue seulement si elle ne change ni variables ni adresses.
   * Même relecture pour le premier mail et pour la relance : la personne ne voit jamais un texte que l'IA n'a pas relu.
   */
  async function reviewTemplate(ctx, userId, model, mail, label) {
    let corrections = [];
    let reviewed = false;
    await ctx.progress({ message: `Relecture ${label} par l'IA…`, pct: 80 });
    try {
      const rp = reviewMailPrompt(mail);
      const rr = await creeping(ctx, `Relecture ${label} par l'IA…`, 80, () => claude(userId, { prompt: rp.prompt, system: rp.system, model, maxTurns: 1, tools: [], signal: ctx.signal }), { to: 98, ms: 20_000 });
      addUsage(ctx, rr);
      const fixed = extractJson(rr.text);
      if (acceptReview(mail, fixed)) {
        mail = { subject: fixed.subject.trim(), subjectB: mail.subjectB ? String(fixed.subject_b).replace(/\s+/g, ' ').trim() : '', body: tidyTemplateText(fixed.body) };
        corrections = (Array.isArray(fixed.corrections) ? fixed.corrections : []).map((c) => String(c).trim().slice(0, 100)).filter(Boolean).slice(0, 6);
        reviewed = true;
      }
    } catch (e) {
      if (ctx.signal?.aborted || e.status === 403) throw e; // annulation, ou accès à l'IA perdu : on ne l'avale pas
    }
    return { mail, corrections, reviewed };
  }

  /**
   * Contrôle du sens d'un modèle tout juste écrit, rempli avec l'exemple fictif de l'aperçu : « Pour {entreprise_nom} » ne veut rien dire.
   * Une correction sûre (mêmes variables, texte proche) remplace le corps avant l'enregistrement. IA indisponible : le modèle est gardé,
   * l'aperçu et l'envoi le contrôleront de toute façon.
   * @returns {Promise<{mail: object, checked: boolean, problem: string|null, fixed: boolean}>}
   */
  async function senseGate(ctx, userId, model, kind, mail, project) {
    const vars = mailVars(SAMPLE_PERSON, { fromName: project.smtp?.fromName || '' }, project.siteUrl);
    const item = { id: 1, subject: kind === 'initial' ? fillSubject(mail.subject, vars) : '', body: fillBody(mail.body, vars).replace(/\n{3,}/g, '\n\n').trim() };
    await ctx.progress({ message: "L'IA vérifie que le texte veut dire quelque chose…", pct: 96 });
    try {
      const { verdicts, run } = await checkSense({ claude, userId, model, signal: ctx.signal, kind, template: mail.body, items: [item] });
      addUsage(ctx, run);
      const v = verdicts.get(1);
      if (v.ok) return { mail, checked: true, problem: null, fixed: false };
      if (v.fixBody) return { mail: { ...mail, body: tidyTemplateText(v.fixBody) }, checked: true, problem: v.problem, fixed: true };
      return { mail, checked: true, problem: v.problem, fixed: false };
    } catch (e) {
      if (ctx.signal?.aborted || !(e instanceof SenseUnavailable)) throw e;
      return { mail, checked: false, problem: null, fixed: false };
    }
  }

  // Premier mail ou relance : mêmes plafonds, mêmes délais, même journal
  async function sendMails(ctx, kind) {
    // Une relance mise en file à 17h55 ne doit pas partir à 19h si le worker était occupé
    if (kind === 'followup' && !inHours()) return { sent: 0, failed: 0, total: 0, postponed: true };
    const userId = ctx.job.user_id;
    const pause = await sendPause(db, userId);
    if (pause) throw new Error(pauseMessage(pause)); // la désinscription et la liste d'opposition restent appliquées ci-dessous
    const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
    const template = await getTemplate(db, project.id, kind, { validatedOnly: true });
    if (!template) throw new Error(kind === 'followup' ? 'Modèle de relance non validé' : 'Modèle de mail non validé');
    if (!project.smtp) throw new Error("Aucun SMTP : configure-en un pour ce projet, ou dans les Réglages");

    const day = now() - 86400;
    const candidates = kind === 'followup'
      ? await followupCandidates(db, project)
      : await db.prepare(`SELECT * FROM prospects WHERE project_id = ? AND status = 'new'
          AND email NOT IN (SELECT email FROM blacklist) ORDER BY score DESC, id LIMIT 100`).all(project.id);
    // Plafond mensuel du plan : on n'envoie que ce qui reste (le reste attend, rien n'est perdu)
    const user = await getUser(db, userId);
    const mq = await quotaFor(db, user, 'mails');
    if (!mq.unlimited && mq.remaining <= 0) throw new Error(planLimitMessage(user, mq));
    const n0 = allowedToSend({
      requested: ctx.params.count,
      available: candidates.length,
      projectCap: project.dailyMailCap,
      sentTodayProject: await sentSince(db, day, userId, project.id),
      globalCap: Number(await getSetting(db, userId, 'global_daily_cap', '100')),
      sentTodayGlobal: await sentSince(db, day, userId),
    });
    const n = mq.unlimited ? n0 : Math.min(n0, mq.remaining);
    if (n === 0) throw new Error(kind === 'followup' ? 'Plafond quotidien atteint ou aucune relance due' : 'Plafond quotidien atteint ou aucun prospect à contacter');

    // Chaque mail est relu par l'IA de la personne avant de partir (le texte rempli a-t-il un sens ?) : sans IA utilisable, rien ne part
    const budget = await budgetState(db, userId);
    if (budget.blocked) throw new Error(`Budget IA atteint : ${budget.reason}. Aucun mail n'est parti : chaque mail est relu par ton IA avant l'envoi.`);
    const senseModel = await writeModel(userId, 'haiku');
    const sense = new Map(); // id du prospect -> avis de l'IA sur son mail rempli
    let unclear = 0, unclearRow = 0, senseStop = null, firstProblem = null;

    const transport = (app.createTransport || createTransport)(await pinSmtp(app, userId, project.smtp));
    await transport.verify();
    const minDelay = Number(await getSetting(db, userId, 'send_delay_min', '20')) * 1000;
    const maxDelay = Number(await getSetting(db, userId, 'send_delay_max', '60')) * 1000;
    const log = db.prepare(`INSERT INTO mail_log(project_id, prospect_id, email, sent_at, error, kind, variant, subject, message_id, body)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Le texte du mail tel qu'il est rempli pour ce prospect (sans le pied de page) : gardé dans le journal pour la page Mails
    const bodyFor = (c) => fillBody(template.body, mailVars(c, project.smtp, project.siteUrl)).replace(/\n{3,}/g, '\n\n').trim().slice(0, 10_000);
    const markInitial = db.prepare('UPDATE prospects SET status = ?, sent_at = ?, variant = ? WHERE id = ?');
    const markFollowup = db.prepare('UPDATE prospects SET followup_at = ? WHERE id = ?');
    const markBounced = db.prepare("UPDATE prospects SET status = 'bounced' WHERE id = ?");
    const original = db.prepare("SELECT subject, message_id FROM mail_log WHERE prospect_id = ? AND kind = 'initial' AND error IS NULL ORDER BY id LIMIT 1");
    const current = db.prepare('SELECT status, followup_at FROM prospects WHERE id = ?');
    const markInvalid = db.prepare("UPDATE prospects SET status = 'invalid' WHERE id = ? AND status = 'new'");
    const mxCache = new Map();
    const readReceipt = (await getSetting(db, userId, 'read_receipt', '0')) === '1';
    const footer = (await getSetting(db, userId, 'mail_footer', '1')) !== '0'; // pied de page : actif sauf retrait explicite dans les Réglages
    let sent = 0, failed = 0, invalid = 0;
    await ctx.progress({ sent, failed, total: n, message: `0/${n} ${kind === 'followup' ? 'relances envoyées' : 'envoyés'}`, pct: 0 });

    // Les adresses refusées par la vérification ne comptent pas dans le lot : on continue dans la liste jusqu'à `n` envois tentés
    for (const [at, p] of candidates.entries()) {
      if (sent + failed >= n) break;
      if (await ctx.cancelled()) break;
      if (kind === 'followup' && !inHours()) break; // le reste repartira au prochain créneau
      // Re-vérifie juste avant l'envoi : désinscription, réponse arrivée pendant le batch…
      if (await db.prepare('SELECT 1 FROM blacklist WHERE email = ?').get(p.email)) continue;
      if (kind === 'followup') {
        const c = await current.get(p.id);
        if (c.status !== 'sent' || c.followup_at) continue;
      }
      if (kind === 'initial') {
        // Adresse mal formée, jetable ou sans serveur de réception : on ne l'essaie pas (un rejet abîme la réputation d'envoi)
        const v = await verifyAddress(p.email, { resolveMx: app.resolveMx || defaultMx, cache: mxCache });
        if (!v.ok) {
          await markInvalid.run(p.id);
          await log.run(project.id, p.id, p.email, now(), `Adresse non envoyée : ${v.reason}`, kind, null, null, null, null);
          invalid++;
          continue;
        }
      }
      // Relecture du sens par lots : ce prospect et les suivants pas encore relus
      if (!sense.has(p.id)) {
        const items = candidates.slice(at, at + SENSE_BATCH).filter((c) => !sense.has(c.id)).map((c) => {
          const vars = mailVars(c, project.smtp, project.siteUrl);
          return { id: c.id, subject: kind === 'initial' ? fillSubject(template.subject, vars) : '', body: fillBody(template.body, vars).replace(/\n{3,}/g, '\n\n').trim() };
        });
        await ctx.progress({ sent, failed, total: n, message: "Relecture des mails par l'IA…", pct: Math.round(((sent + failed) / n) * 100) });
        try {
          const { verdicts, run } = await checkSense({ claude, userId, model: senseModel, signal: ctx.signal, kind, template: template.body, items });
          addUsage(ctx, run);
          for (const [id, v] of verdicts) sense.set(id, v);
        } catch (e) {
          if (!(e instanceof SenseUnavailable)) throw e;
          senseStop = e.message;
          break; // rien d'autre ne part tant que l'IA ne peut pas relire
        }
      }
      const verdict = sense.get(p.id);
      if (!verdict.ok) {
        await log.run(project.id, p.id, p.email, now(), `Non envoyé : le texte n'a pas de sens (${verdict.problem})`, kind, null, null, null, bodyFor(p));
        firstProblem ??= verdict.problem;
        unclear++;
        if (++unclearRow >= SENSE_BATCH) break; // un lot entier refusé : c'est le modèle lui-même qui est en cause
        continue;
      }
      unclearRow = 0;
      const unsubUrl = `${cfg.appUrl}/u/${encodeURIComponent(p.email)}/${unsubToken(cfg.secretKey, p.email)}`;
      let variant = null, subject, inReplyTo;
      if (kind === 'initial') {
        variant = await pickVariant(db, project.id, template);
        subject = variant === 'B' ? template.subject_b : template.subject;
      } else {
        const orig = await original.get(p.id);
        subject = followupSubject(template, orig);
        inReplyTo = orig?.message_id;
      }
      const mail = buildProspectMail({
        template, prospect: p, smtp: project.smtp, site: project.siteUrl, unsubUrl, subject, inReplyTo,
        messageId: makeMessageId(project.smtp.fromEmail), readReceipt, footer, html: !!template.html,
      });
      try {
        await transport.sendMail(mail);
        await log.run(project.id, p.id, p.email, now(), null, kind, variant, mail.subject, mail.messageId, bodyFor(p));
        await recordUsage(db, userId, 'mail');
        if (kind === 'initial') await markInitial.run('sent', now(), variant, p.id);
        else await markFollowup.run(now(), p.id);
        sent++;
      } catch (e) {
        await log.run(project.id, p.id, p.email, now(), String(e.message).slice(0, 500), kind, variant, mail.subject, mail.messageId, bodyFor(p));
        if (/^5\d\d/.test(String(e.responseCode))) await markBounced.run(p.id);
        failed++;
      }
      const label = kind === 'followup' ? 'relances envoyées' : 'envoyés';
      await ctx.progress({ sent, failed, total: n, message: `${sent + failed}/${n} ${label}`, pct: Math.round(((sent + failed) / n) * 100) });
      if (sent + failed < n) await sleep(minDelay + Math.random() * (maxDelay - minDelay), ctx.signal).catch(() => {});
    }
    transport.close();
    await evaluateSending(app, userId); // trop de rejets : le compte passe en pause d'envoi
    if (sent + failed === 0 && (senseStop || unclear)) {
      throw new Error(senseStop
        ? `Relecture par l'IA impossible : ${senseStop}. Aucun mail n'est parti : relance quand ton IA répond de nouveau`
        : `Aucun mail n'est parti : ton IA juge que le texte n'a pas de sens (${firstProblem}). Ouvre « Aperçu » : elle y propose une version corrigée du modèle`);
    }
    return { sent, failed, total: n, ...(invalid ? { invalid } : {}), ...(unclear ? { unclear } : {}), ...(senseStop ? { waiting: senseStop } : {}) };
  }

  // Tâche d'un poste (Commerce, Communication, Finance…) : un livrable Markdown écrit à partir de la fiche du projet.
  // `repo` : lecture du dépôt (Read / Glob / Grep) ; `web` : recherche et lecture de pages ; sinon un seul tour, sans outil.
  const roleTask = (task) => async (ctx) => {
    const userId = ctx.job.user_id;
    const project = await getProject(app, ctx.job.project_id, { userId });
    if (!project.profile) throw new Error("Analyse le projet d'abord");
    const role = roleById(task.role);
    const notes = String(ctx.params.notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTES);
    const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
    let dir = null;
    if (task.repo) {
      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);
    }
    await ctx.progress({ message: `${task.label} : Claude rédige…`, pct: 10 });
    const { prompt, system } = rolePrompt({ role, task, projectName: project.name, profile: project.profile, target: project.target || {}, notes, custom: await custom(userId), model, repoFacts: dir ? factsOf(dir) : '' });
    const maxTurns = task.repo ? 14 : task.web ? 10 : 1;
    const sink = makeSink();
    let turn = 0;
    const r = await claude(userId, {
      prompt, system, model, maxTurns, signal: ctx.signal,
      ...(dir ? { cwd: dir } : {}),
      tools: task.repo ? ['Read', 'Glob', 'Grep'] : task.web ? ['WebSearch', 'WebFetch'] : [],
      onTurn: (n) => { turn = n; sink.push(() => ctx.progress({ message: `${task.label} · étape ${n}…`, pct: turnPct(10, 95, n, maxTurns) })); },
      onTool: (name, input) => { const a = toolActivity(name, input); if (a) sink.push(() => ctx.progress({ message: `${task.label} : ${a}`, pct: turnPct(10, 95, turn, maxTurns) })); },
    });
    await sink.flush();
    addUsage(ctx, r);
    if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);
    return { markdown: r.text.trim(), task: task.id, role: task.role, notes };
  };

  return {
    ...Object.fromEntries(ROLE_TASKS.map((t) => [t.job, roleTask(t)])),
    async analyze(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      await ctx.progress({ message: 'Récupération du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      const commit = await sync(userId, project.gitUrl, dir);

      await ctx.progress({ message: 'Analyse du code par Claude…', pct: 10 });
      const model = await modelOf(userId, 'analyze_model');
      const { prompt, system } = analyzePrompt(project.name, await custom(userId), model, factsOf(dir));
      const sink = makeSink();
      let turn = 0;
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns: 20, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => { turn = n; sink.push(() => ctx.progress({ message: `Lecture du code par Claude (étape ${n})…`, pct: turnPct(10, 95, n, 20) })); },
        onTool: (name, input) => { const a = toolActivity(name, input); if (a) sink.push(() => ctx.progress({ message: a, pct: turnPct(10, 95, turn, 20) })); },
      });
      await sink.flush();
      addUsage(ctx, r);
      if (!r.ok) {
        // « success » + is_error : Claude a répondu par une erreur (quota, jeton, API). Son texte (déjà masqué) dit laquelle.
        const said = String(r.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
        throw new Error(`Analyse incomplète (${r.subtype})${said ? ` : ${said}` : ''}`);
      }
      const profile = extractJson(r.text);
      if (!profile.resume || !profile.cible) throw new Error('Fiche projet incomplète');
      const { cible, ...rest } = profile;
      await db.prepare('UPDATE projects SET profile_json = ?, profile_commit = ?, profile_at = ?, target_json = ?, target_validated = 0 WHERE id = ?')
        .run(JSON.stringify(rest), commit, now(), JSON.stringify(cible), project.id);
      return { commit };
    },

    async prospect(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile || !project.targetValidated) throw new Error('Valide la cible du projet avant de prospecter');
      const count = Math.max(1, Math.min(50, Math.floor(Number(ctx.params.count) || 10)));

      // Domaines déjà connus de ce projet : Claude ne les recherche pas une 2e fois. La liste d'opposition,
      // commune à tous les comptes, n'entre pas dans le prompt (elle est appliquée à l'insertion, ci-dessous).
      const user = await getUser(db, userId);
      const pq = await quotaFor(db, user, 'prospects');
      let room = pq.unlimited ? Infinity : pq.remaining;
      let capped = false;
      const exclude = (await db.prepare(`
        SELECT DISTINCT substr(email, instr(email, '@') + 1) d FROM prospects WHERE project_id = ?
        LIMIT 300`).all(project.id)).map((r) => r.d);

      // Deux requêtes plutôt qu'un INSERT ... SELECT sans FROM (non portable) ; l'unicité (projet, email) reste garantie par la base
      const optedOut = db.prepare('SELECT 1 FROM blacklist WHERE email = ?');
      const insert = db.prepare(`INSERT OR IGNORE INTO prospects(project_id, company, email, website, city, sector, hook, source, score, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const sink = makeSink();
      let found = 0;
      let pending = '';
      let turns = 0;
      let message = 'Recherche en cours…';
      const recent = []; // derniers prospects ajoutés, montrés en direct dans la carte de la recherche
      const maxTurns = Math.min(80, count * 3 + 10);
      // Le plus avancé des deux : prospects trouvés, ou messages de Claude consommés
      const report = () => ctx.progress({
        found, target: count, message, recent,
        pct: Math.min(99, Math.max(Math.round((found / count) * 100), turnPct(0, 90, turns, maxTurns))),
      });
      const onText = (text) => {
        pending += text + '\n';
        const lines = pending.split('\n');
        pending = lines.pop();
        const parsed = lines.map(parseProspectLine).filter(Boolean);
        if (!parsed.length) return;
        sink.push(async () => {
          for (const p of parsed) {
            if (await optedOut.get(p.email)) continue;
            if (room <= 0) { capped = true; continue; }
            const res = await insert.run(project.id, p.company, p.email, p.website, p.city, p.sector, p.hook, p.source, p.score, now());
            if (res.changes) {
              room--;
              found++;
              message = `${found}/${count} — ${p.company}`;
              recent.push({ company: p.company, city: p.city || '' });
              if (recent.length > 5) recent.shift();
              await report();
            }
          }
        });
      };
      await report();
      const model = await modelOf(userId, 'prospect_model');
      const { prompt, system } = prospectPrompt({ profile: project.profile, target: project.target, count, exclude, custom: await custom(userId), model });
      const r = await claude(userId, {
        prompt, system, model, tools: ['WebSearch', 'WebFetch'],
        maxTurns, onText, signal: ctx.signal,
        onTurn: (n) => { turns = n; sink.push(report); },
        onTool: (name, input) => { const a = toolActivity(name, input); if (a) { message = a; sink.push(report); } },
      });
      onText('\n');
      await sink.flush();
      addUsage(ctx, r);
      return { found, requested: count, stoppedBy: r.subtype, ...(capped ? { capped: true } : {}) };
    },

    async template(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      await ctx.progress({ message: 'Rédaction du modèle par Claude…', pct: 40 });
      const model = await writeModel(userId, 'haiku');
      const { prompt, system } = templatePrompt({ profile: project.profile, target: project.target || {}, senderName: project.smtp?.fromName, site: project.siteUrl, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Rédaction du modèle par Claude…', 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.subject || !t.body) throw new Error('Modèle de mail invalide');
      // Objet B (test A/B) : gardé seulement s'il est écrit, différent de l'objet A et d'une longueur d'objet
      const sb = String(t.subject_b ?? '').replace(/\s+/g, ' ').trim();
      const subjectB = sb && sb.length <= 120 && sb.toLowerCase() !== String(t.subject).trim().toLowerCase() ? sb : '';
      let mail = { subject: String(t.subject).trim(), subjectB, body: tidyTemplateText(t.body) };
      // Relecture par l'IA (langue, ponctuation, signature), puis contrôle du sens : le modèle n'est enregistré, donc montré, qu'après
      const rv = await reviewTemplate(ctx, userId, model, mail, 'du mail');
      const { corrections, reviewed } = rv;
      mail = rv.mail;
      const mended = await mendStyle(ctx, userId, model, 'initial', mail.body);
      mail = { ...mail, body: mended.body };
      const gate = await senseGate(ctx, userId, model, 'initial', mail, project);
      mail = gate.mail;
      await saveTemplate(db, project.id, 'initial', mail);
      return { ok: true, reviewed, corrections, senseChecked: gate.checked, ...(gate.fixed ? { senseFixed: gate.problem } : {}), ...(mended.fixed.length ? { styleFixed: mended.fixed } : {}) };
    },

    async followup_template(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      if (!project.profile) throw new Error('Analyse le projet d\'abord');
      await ctx.progress({ message: 'Rédaction de la relance par Claude…', pct: 40 });
      const model = await writeModel(userId, 'haiku');
      const { prompt, system } = followupTemplatePrompt({ profile: project.profile, senderName: project.smtp?.fromName, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Rédaction de la relance par Claude…', 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const t = extractJson(r.text);
      if (!t.body) throw new Error('Modèle de relance invalide');
      // Comme le premier mail : relecture de la forme, correction de style, contrôle du sens, PUIS enregistrement
      // La relance n'a pas d'objet à elle (« Re: » + celui du premier mail) : la relecture en demande un, on lui en donne un d'attente qui est ignoré ensuite
      const rv = await reviewTemplate(ctx, userId, model, { subject: 'Relance', subjectB: '', body: tidyTemplateText(t.body) }, 'de la relance');
      const mended = await mendStyle(ctx, userId, model, 'followup', rv.mail.body);
      const gate = await senseGate(ctx, userId, model, 'followup', { subject: '', subjectB: '', body: mended.body }, project);
      await saveTemplate(db, project.id, 'followup', { subject: '', body: gate.mail.body });
      return { ok: true, reviewed: rv.reviewed, corrections: rv.corrections, senseChecked: gate.checked, ...(gate.fixed ? { senseFixed: gate.problem } : {}), ...(mended.fixed.length ? { styleFixed: mended.fixed } : {}) };
    },

    // Facturation : trois exemples de devis. Claude écrit le texte et propose les lignes ; les mentions légales et les totaux viennent du code.
    async billing_quotes(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const { legal } = await getBilling(db, project.id, userId);
      if (!legalComplete(legal)) throw new Error("Complète d'abord les informations légales du projet");
      if ((await listDocs(db, project.id, userId)).some((d) => d.kind === 'quote_option' && d.status === 'validated')) throw new Error('Un devis est déjà validé : recommence depuis le début pour en générer de nouveaux');
      const model = await writeModel(userId, 'sonnet');
      await ensureBrand(ctx, { userId, project, model, refresh: true });
      await ctx.progress({ message: 'Claude rédige trois exemples de devis…', pct: 12 });
      const { prompt, system } = billingQuotesPrompt({ projectName: project.name, profile: project.profile, legal, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Claude rédige trois exemples de devis…', 12, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const raw = extractJson(r.text);
      const options = (Array.isArray(raw.options) ? raw.options : []).map((o) => normalizeContent(o, 'devis')).filter(Boolean).slice(0, 3);
      if (options.length < 3) throw new Error("Claude n'a pas produit trois devis exploitables : réessaie");
      options.forEach((o, i) => { o.layout = LAYOUTS[i][0]; }); // trois mises en page différentes, dans l'ordre
      await replaceOptions(db, project.id, userId, options);
      return { ok: true };
    },

    // Facturation : affiner un exemple de devis ou un document selon la demande de l'utilisateur
    async billing_refine(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const doc = await getDoc(db, ctx.params.docId, userId);
      if (!doc || doc.projectId !== project.id) throw new Error('Document introuvable');
      const request = String(ctx.params.request ?? '').trim().slice(0, 800);
      if (request.length < 3) throw new Error('Décris ce que tu veux changer');
      const { legal } = await getBilling(db, project.id, userId);
      const kind = doc.kind === 'quote_option' ? 'devis' : doc.kind;
      await ctx.progress({ message: 'Claude affine le document selon ta demande…', pct: 8 });
      const model = await writeModel(userId, 'sonnet');
      const { prompt, system } = billingRefinePrompt({ projectName: project.name, profile: project.profile, legal, kind, content: doc.content, request, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Claude affine le document selon ta demande…', 8, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const next = normalizeContent(extractJson(r.text), kind === 'acompte' ? 'acompte' : kind);
      if (!next) throw new Error("Claude n'a pas produit un document exploitable : réessaie");
      next.layout = doc.layout; // la mise en page choisie ne change pas en route
      if (kind === 'acompte' || kind === 'facture') next.lines = doc.content.lines; // les lignes et les prix viennent du devis validé
      await updateDocContent(db, doc.id, userId, next, request);
      // Un devis définitif modifié : l'acompte et la facture reprennent ses lignes, et sont à revalider si elles ont changé
      if (kind === 'devis' && doc.kind === 'devis') {
        for (const other of (await listDocs(db, project.id, userId)).filter((d) => d.kind === 'acompte' || d.kind === 'facture')) {
          if (JSON.stringify(other.content.lines) !== JSON.stringify(next.lines)) await updateDocContent(db, other.id, userId, { ...other.content, lines: next.lines }, other.refinement);
        }
      }
      return { ok: true };
    },

    // Facturation : à partir du devis validé, les quatre modèles de documents (devis, acompte, facture finale, avoir)
    async billing_docs(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const quote = (await listDocs(db, project.id, userId)).find((d) => d.kind === 'quote_option' && d.status === 'validated');
      if (!quote) throw new Error("Valide d'abord un devis");
      const { legal } = await getBilling(db, project.id, userId);
      const model = await writeModel(userId, 'sonnet');
      await ensureBrand(ctx, { userId, project, model }); // l'identité du projet, lue une fois puis réutilisée
      await ctx.progress({ message: 'Claude prépare le devis, l\'acompte, la facture finale et l\'avoir…', pct: 10 });
      const { prompt, system } = billingDocsPrompt({ projectName: project.name, profile: project.profile, legal, quote: quote.content, custom: await custom(userId), model });
      const r = await creeping(ctx, 'Claude prépare le devis, l\'acompte, la facture finale et l\'avoir…', 8, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const raw = extractJson(r.text);
      const out = {};
      for (const { key } of DOC_KINDS) {
        // Les lignes viennent du devis validé (sauf l'avoir, qui peut ne reprendre qu'une partie) : Claude écrit les textes, pas les chiffres
        const withLines = { ...(raw?.[key] && typeof raw[key] === 'object' ? raw[key] : {}), lines: key === 'avoir' && Array.isArray(raw?.avoir?.lines) && raw.avoir.lines.length ? raw.avoir.lines : quote.content.lines };
        const c = normalizeContent(withLines, key);
        if (!c || !raw?.[key]) throw new Error(`Claude n'a pas produit le document « ${key} » : réessaie`);
        c.layout = quote.layout;
        if (key !== 'avoir') c.lines = quote.content.lines;
        out[key] = c;
      }
      out.facture.deposit_percent = out.acompte.deposit_percent;
      await replaceFinals(db, project.id, userId, out);
      const review = await reviewBillingDocs(ctx, { userId, project, legal, model });
      return { ok: true, review };
    },

    // Brouillon de post LinkedIn : direction facultative ; sans elle Claude choisit l'angle. Rien n'est publié ici.
    async linkedin_post(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile) throw new Error("Analyse le projet d'abord");
      const account = await linkedinAccount(db, project.id);
      if (!account) throw new Error("Connecte LinkedIn à ce projet d'abord");
      const direction = String(ctx.params.direction ?? '').trim().slice(0, 500);
      const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
      const inspiration = await researchInspiration(ctx, { userId, project, model, kind: 'linkedin', direction, from: 5, to: 35 });
      const { prompt, system } = linkedinPostPrompt({
        profile: project.profile, target: project.target || {}, direction, previous: await recentDrafts(db, project.id), author: account.name, custom: await custom(userId), model, inspiration,
      });
      await ctx.progress({ message: direction ? 'Rédaction du post selon ta direction…' : 'Claude choisit un angle et rédige le post…', pct: 40 });
      const r = await creeping(ctx, direction ? 'Rédaction du post selon ta direction…' : 'Claude choisit un angle et rédige le post…', 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      let body = '';
      try { body = String(extractJson(r.text).post ?? ''); } catch { body = ''; }
      body = body.replace(/\r\n/g, '\n').trim().slice(0, 3000);
      if (body.length < 50) throw new Error('Claude n\'a pas produit de post exploitable : réessaie');
      return { ok: true, postId: await saveDraft(db, project.id, { body, direction }) };
    },

    // Post Instagram : légende, hashtags, texte alternatif et image. Claude cherche d'abord sur le web ce qui fonctionne dans le secteur du projet (grandes marques,
    // formats qui performent), lit le dépôt (lecture seule) pour retrouver le vrai design (couleurs, polices, logo, écrans), dessine l'image en HTML/CSS fixe
    // que Chromium rend en PNG, puis un directeur artistique indépendant juge le PNG. Trois essais au plus : un document refusé au rendu ou une image notée
    // en dessous du seuil repart avec des corrections précises ; au dernier essai le post est livré avec les constats du contrôle.
    async instagram_post(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile) throw new Error("Analyse le projet d'abord");
      const sup = (app.stillSupported || stillSupported)(cfg);
      if (!sup.ok) throw new Error(sup.reason);
      const direction = String(ctx.params.direction ?? '').trim().slice(0, CONTENT.direction);
      const formatKey = INSTAGRAM_FORMATS[ctx.params.format] ? ctx.params.format : 'carre';
      const format = INSTAGRAM_FORMATS[formatKey];
      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);
      // Dessiner une image de designer demande au moins un modèle de milieu de gamme : un petit modèle (Haiku) produit des mises en page qui débordent et sans finition
      const provider = await userProvider(db, userId);
      const chosen = await writeModel(userId, await modelOf(userId, 'analyze_model'));
      const model = provider === 'claude' && modelFamily(chosen) === 'haiku' ? tierEquivalent('sonnet', provider) : chosen;
      const previous = await recentBodies(db, project.id, 'instagram');
      const ATTEMPTS = 3;
      const field = (text, tag) => (String(text ?? '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1]?.trim() ?? '';
      let fix = null;
      let previousVisual = '';
      // Phase 1 : le web SEUL, ce qui marche dans le secteur
      const inspiration = await researchInspiration(ctx, { userId, project, model, kind: 'instagram', direction });
      // Phase 2 : le dépôt SEUL (lecture) pour le vrai design, puis le dessin
      for (let attempt = 1; ; attempt++) {
        const first = attempt === 1;
        const label = first ? 'Lecture du design du projet et conception du post…' : `Amélioration de l'image (essai ${attempt}/${ATTEMPTS})…`;
        const from = first ? 25 : 30 + (attempt - 2) * 8;
        await ctx.progress({ message: label, pct: from });
        const { prompt, system } = instagramPrompt({
          projectName: project.name, profile: project.profile, target: project.target || {}, direction, previous, site: project.siteUrl, format,
          custom: await custom(userId), model, fix, previousVisual, inspiration,
        });
        const sink = makeSink();
        const maxTurns = first ? 20 : 14;
        const r = await creeping(ctx, label, from, () => claude(userId, {
          prompt, system, cwd: dir, model, maxTurns, tools: STILL_TOOLS.design, signal: ctx.signal,
          onTurn: (n) => sink.push(() => ctx.progress({ message: `${label} · étape ${n}`, pct: turnPct(from, 60, n, maxTurns) })),
        }), { to: 60 });
        await sink.flush();
        addUsage(ctx, r);
        const caption = field(r.text, 'legende').replace(/\r\n/g, '\n').slice(0, CONTENT.caption);
        if (caption.length < 40) throw new Error(`Claude n'a pas produit de légende exploitable (${r.subtype}) : réessaie`);
        const html = extractVisual(r.text);
        const meta = { hashtags: cleanHashtags(field(r.text, 'hashtags')), alt: field(r.text, 'alt').replace(/\s+/g, ' ').slice(0, CONTENT.alt), format: formatKey, width: format.width, height: format.height, inspiration };
        let png;
        try {
          await ctx.progress({ message: 'Rendu de l\'image…', pct: 66 });
          png = await (app.renderStill || renderStill)({ cfg, html, width: format.width, height: format.height, signal: ctx.signal });
          if (png.length > CONTENT.image) throw new SceneError(`L'image pèse trop lourd (${png.length} octets) : simplifie les dégradés et les formes.`);
        } catch (e) {
          if (!(e instanceof SceneError)) throw e;
          if (attempt >= ATTEMPTS) throw new Error(`L'image écrite par Claude ne passe pas au rendu : ${e.message}`);
          fix = e.message;
          previousVisual = html;
          continue;
        }
        // Le directeur artistique regarde l'image rendue. Un contrôle en panne ne bloque pas la livraison, mais le post le dit.
        let review = null;
        let reviewNote = '';
        try {
          await ctx.progress({ message: 'Contrôle par un directeur artistique…', pct: 80 });
          review = await (app.reviewStill || reviewStill)({
            png, width: format.width, height: format.height, caption, direction, brand: inspiration, model, extraRoot: userChatRoot(cfg, userId), signal: ctx.signal,
            runAgent: async (options) => { const result = await claude(userId, options); addUsage(ctx, result); return result; },
          });
        } catch (e) {
          if (ctx.signal?.aborted) throw e;
          reviewNote = 'Le contrôle qualité de l\'image n\'a pas pu être fait : relis-la avec attention avant de publier.';
        }
        if (review && !review.approved && attempt < ATTEMPTS) { fix = stillVerdict(review); previousVisual = html; continue; }
        const notes = review && !review.approved ? review.issues.filter((x) => x.severity !== 'minor').map((x) => x.problem) : [];
        const id = await saveContent(db, project.id, 'instagram', {
          direction, body: caption, image: png,
          extra: { ...meta, ...(review ? { score: review.score } : {}), ...(notes.length ? { toCheck: notes.slice(0, 5) } : {}), ...(reviewNote ? { toCheck: [reviewNote] } : {}), attempts: attempt },
        });
        return { ok: true, draftId: id, attempts: attempt, ...(review ? { score: review.score } : {}) };
      }
    },

    // Newsletter : objet, texte d'aperçu et corps en Markdown, à relire puis à copier ou télécharger. Rien n'est envoyé ici.
    async newsletter(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile) throw new Error("Analyse le projet d'abord");
      const direction = String(ctx.params.direction ?? '').trim().slice(0, CONTENT.direction);
      const label = direction ? 'Rédaction de la newsletter selon ta direction…' : 'Claude choisit un sujet et rédige la newsletter…';
      const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
      const inspiration = await researchInspiration(ctx, { userId, project, model, kind: 'newsletter', direction, from: 5, to: 35 });
      await ctx.progress({ message: label, pct: 40 });
      const { prompt, system } = newsletterPrompt({
        projectName: project.name, profile: project.profile, target: project.target || {}, direction, previous: await recentBodies(db, project.id, 'newsletter'),
        site: project.siteUrl, custom: await custom(userId), model, inspiration,
      });
      const r = await creeping(ctx, label, 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }));
      addUsage(ctx, r);
      const field = (tag) => (String(r.text ?? '').match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')) || [])[1]?.trim() ?? '';
      const subject = field('objet').replace(/\s+/g, ' ').slice(0, CONTENT.subject);
      const body = field('texte').replace(/\r\n/g, '\n').slice(0, CONTENT.newsletter);
      if (!subject || body.length < 200) throw new Error("Claude n'a pas produit de newsletter exploitable : réessaie");
      return { ok: true, draftId: await saveContent(db, project.id, 'newsletter', { direction, title: subject, body, extra: { preview: field('apercu').replace(/\s+/g, ' ').slice(0, CONTENT.preview), inspiration } }) };
    },

    // Vidéo de promotion : Claude écrit une scène animée, Chromium la rend image par image, ffmpeg produit le MP4.
    // Trois tentatives au plus ; le rendu et les deux revues du MP4 doivent tous être acceptés avant livraison.
    async promo_video(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      if (!project.profile) throw new Error("Analyse le projet d'abord");
      const sup = (app.promoSupported || promoSupported)(cfg);
      if (!sup.ok) throw new Error(sup.reason);
      const params = parsePromoParams(ctx.params);
      if (params.error) throw new Error(params.error);
      const vp = parseVoiceParams(ctx.params);
      if (vp.error) throw new Error(vp.error);
      const voice = vp.voice;
      if ((await countVideos(db, userId)) >= PROMO.maxVideos) throw new Error(`Tu as déjà ${PROMO.maxVideos} vidéos : supprime-en une avant d'en produire une autre.`);
      const fmt = FORMATS[params.format];
      const model = await writeModel(userId, await modelOf(userId, 'analyze_model'));
      const video = await reserveVideo(app, { userId, projectId: project.id, subject: params.subject, fps: params.fps, seconds: params.seconds, format: params.format, width: fmt.width, height: fmt.height, platform: params.platform });
      const sink = makeSink();
      try {
        // « Corriger » relance le job avec le verdict du contrôle et la dernière scène refusée
        let fix = String(ctx.params.fix ?? '').slice(0, 6000) || null;
        let previousScene = fix ? takeScene(cfg, userId, ctx.params.fixScene) : '';
        // Une seule recherche, avant la première conception ; une correction repart de la scène refusée, sans refaire de recherche
        const inspiration = fix ? '' : await researchInspiration(ctx, { userId, project, model, kind: 'promo', direction: params.subject, from: 3, to: 8 });
        for (let attempt = fix ? 2 : 1; ; attempt++) {
          await ctx.progress({ message: attempt === 1 ? (params.subject ? 'Claude conçoit la vidéo sur ton sujet…' : 'Claude conçoit la vidéo de présentation du projet…') : 'Claude corrige la scène…', pct: attempt === 1 ? 8 : 40 });
          const { prompt, system } = promoPrompt({
            projectName: project.name, profile: project.profile, target: project.target || {}, subject: params.subject, style: params.style, site: project.siteUrl,
            seconds: params.seconds, fps: params.fps, format: params.format, width: fmt.width, height: fmt.height, custom: await custom(userId), model, fix, previousScene, inspiration, platform: params.platform,
            voice: voice && { ...voice, langName: langName(voice.lang) },
          });
          const r = await creeping(ctx, attempt === 1 ? (params.subject ? 'Claude conçoit la vidéo sur ton sujet…' : 'Claude conçoit la vidéo de présentation du projet…') : 'Claude corrige la scène…', attempt === 1 ? 8 : 40, () => claude(userId, { prompt, system, model, maxTurns: 1, tools: [], signal: ctx.signal }), { to: 44 });
          addUsage(ctx, r);
          if (!r.ok) throw new Error(`La vidéo n'a pas pu être conçue (${r.subtype})${r.text ? ` : ${String(r.text).replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`);
          let prepared = null;
          const voiceSegments = [];
          try {
            const html = extractScene(r.text);
            previousScene = html;
            let notes = [];
            if (voice) {
              // La voix est préparée AVANT le rendu : un service de voix en panne ou un script trop long ne coûte pas les images
              await ctx.progress({ message: 'Voix : lecture des phrases…', pct: 44 });
              const key = VOICE_PROVIDERS[voice.provider].keyed ? await getVoiceKey(app, userId, voice.provider) : null;
              if (VOICE_PROVIDERS[voice.provider].keyed && !key) throw new Error(`Aucune clé API ${VOICE_PROVIDERS[voice.provider].label.split(' (')[0]} : ajoute-la dans l'onglet Promotion du projet`);
              const region = VOICE_PROVIDERS[voice.provider].region ? await getVoiceRegion(app, userId, voice.provider) : null;
              const synth = app.synthVoice || synthesize;
              voiceSegments.push(...extractVoiceScript(html, params.seconds));
              prepared = await (app.prepareVoice || prepareVoice)({
                cfg, segments: voiceSegments, voice, seconds: params.seconds, synth: (o) => synth({ ...o, key, region }, { cfg }), signal: ctx.signal,
                onProgress: ({ done, total, stage }) => sink.push(() => ctx.progress({ message: `Voix : ${stage==='clean'?'nettoyage et contrôle de la phrase':'phrase'} ${Math.min(done + 1, total)}/${total}`, pct: 44 })),
              });
              await sink.flush();
              if (prepared.overflow > 0.15) {
                const msg = `La voix dure ${prepared.overflow.toFixed(1)} s de plus que la vidéo (${params.seconds} s) : raccourcis les phrases ou avance leurs instants "t".`;
                throw new SceneError(msg);
              }
              const shifted = prepared.placed.find((part, i) => Math.abs(part.start - voiceSegments[i].t) > 0.15);
              if (shifted) {
                throw new SceneError(`Désynchronisation voix/texte : une phrase doit être repoussée à ${shifted.start.toFixed(2)} s. Raccourcis les phrases précédentes et garde les textes visibles pendant toute leur lecture ; aucun décalage de plus de 0,15 s n'est accepté.`);
              }
            }
            const out = await (app.renderPromo || renderPromo)({
              cfg, html, fps: params.fps, seconds: params.seconds, width: fmt.width, height: fmt.height, out: video.path, signal: ctx.signal,
              // Aucun essai ne peut contourner le contrôle de publication.
              quality: 'strict',
              onProgress: ({ done, total }) => sink.push(() => ctx.progress({ message: `Rendu de la vidéo : image ${done}/${total}`, pct: 45 + Math.round((done / total) * 53) })),
            });
            await sink.flush();
            let bytes = out.bytes;
            if (prepared) {
              await ctx.progress({ message: 'Ajout de la voix à la vidéo…', pct: 99 });
              await (app.mixVoice || mixVoice)({ cfg, videoPath: video.path, placed: prepared.placed, seconds: params.seconds, signal: ctx.signal });
              bytes = statSync(video.path).size;
            }
            const quality = await (app.reviewPromo || reviewPromo)({
              cfg, videoPath: video.path, seconds: params.seconds, width: fmt.width, height: fmt.height,
              voiceSegments, placed: prepared?.placed || [], model, extraRoot: userChatRoot(cfg, userId), signal: ctx.signal,
              final: attempt >= REVIEW_ROUNDS, // dernière ronde : les agents avertissent au lieu de bloquer
              onProgress: (p) => sink.push(() => ctx.progress({ message: typeof p === 'string' ? p : p.message, pct: 99 })),
              runAgent: async (options) => { const result = await claude(userId, options); addUsage(ctx, result); return result; },
            });
            await sink.flush();
            await finishVideo(db, video.id, bytes);
            // Livrée avec avertissements : on garde la scène pour que « Corriger » reparte d'elle
            if (quality.warnings?.length) keepScene(cfg, userId, ctx.job.id, previousScene);
            notes = [...notes, ...(out.notes || [])];
            return { ok: true, videoId: video.id, frames: out.frames, attempts: attempt, qualityReviews: quality.reviews, ...(quality.warnings?.length ? { qualityWarnings: quality.warnings } : {}), ...(voice ? { voice: voice.voice } : {}), ...(notes.length ? { notes } : {}) };
          } catch (e) {
            await sink.flush().catch(() => {});
            if (!(e instanceof SceneError)) throw e;
            if (attempt >= 3) {
              keepScene(cfg, userId, ctx.job.id, previousScene);
              throw new Error(`${SCENE_REFUSED}${e.message}`);
            }
            fix = e.message;
          } finally { cleanVoice(prepared); }
        }
      } catch (e) {
        await removeVideo(app, { id: video.id, user_id: userId });
        throw e;
      }
    },

    send: (ctx) => sendMails(ctx, 'initial'),
    followup: (ctx) => sendMails(ctx, 'followup'),

    async evolution(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId, secrets: true });
      const count = Math.max(1, Math.min(20, Math.floor(Number(ctx.params.count) || 5)));
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      const to = await getSetting(db, userId, 'notify_email');
      const smtp = cfg.systemSmtp; // le résultat part de l'adresse d'iaboss (SMTP du serveur), pas de celle du projet
      if (!to) throw new Error('Adresse de réception non configurée (Réglages)');
      if (!smtp) throw new Error("Le serveur ne peut pas envoyer de mail (SMTP du serveur non configuré) : demande à l'administrateur");

      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);

      await ctx.progress({ message: `Recherche de ${count} évolutions (${level})…`, pct: 10 });
      const { prompt, system } = evolutionPrompt({ projectName: project.name, profile: project.profile, count, level, custom: await custom(userId), repoFacts: factsOf(dir) });
      const { maxTurns } = LEVELS[level];
      const model = tierEquivalent(LEVELS[level].model, await userProvider(db, userId));
      const sink = makeSink();
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => sink.push(() => ctx.progress({ message: `Recherche de ${count} évolutions (${level}) · étape ${n}…`, pct: turnPct(10, 90, n, maxTurns) })),
      });
      await sink.flush();
      addUsage(ctx, r);
      if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);

      await ctx.progress({ message: 'Envoi par mail…', pct: 95 });
      const transport = (app.createTransport || createTransport)(await pinSmtp(app, null, smtp));
      await transport.sendMail({
        from: smtp.fromEmail, to,
        subject: `[iaboss] ${count} évolutions pour ${project.name}`,
        text: r.text,
        html: evolutionMail({ markdown: r.text, projectName: project.name, count, appUrl: cfg.appUrl }),
      });
      transport.close();
      return { markdown: r.text, sentTo: to };
    },

    // Audit du dépôt : rapport en lecture seule (Read / Glob / Grep), gardé dans le résultat du job
    async audit(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const level = LEVELS[ctx.params.level] ? ctx.params.level : 'normal';
      await ctx.progress({ message: 'Mise à jour du repo…', pct: 3 });
      const dir = repoDir(cfg, userId, project.id);
      await sync(userId, project.gitUrl, dir);
      await ctx.progress({ message: `Audit du code (${level})…`, pct: 10 });
      const { prompt, system } = auditPrompt({ projectName: project.name, level, custom: await custom(userId), repoFacts: factsOf(dir) });
      const { maxTurns } = LEVELS[level];
      const model = tierEquivalent(LEVELS[level].model, await userProvider(db, userId));
      const sink = makeSink();
      const r = await claude(userId, {
        prompt, system, cwd: dir, model, maxTurns, tools: ['Read', 'Glob', 'Grep'], signal: ctx.signal,
        onTurn: (n) => sink.push(() => ctx.progress({ message: `Audit du code (${level}) · étape ${n}…`, pct: turnPct(10, 95, n, maxTurns) })),
      });
      await sink.flush();
      addUsage(ctx, r);
      if (!r.text?.trim()) throw new Error(`Pas de résultat (${r.subtype})`);
      return { markdown: r.text, level };
    },

    // Accroche d'un prospect : régénérée à partir de son site ; ville et secteur complétés s'ils manquaient
    async hook(ctx) {
      const userId = ctx.job.user_id;
      const project = await getProject(app, ctx.job.project_id, { userId });
      const prospect = await db.prepare('SELECT * FROM prospects WHERE id = ? AND project_id = ?').get(Number(ctx.params.prospectId), project.id);
      if (!prospect) throw new Error('Prospect introuvable');
      await ctx.progress({ message: `Lecture du site de ${prospect.company}…`, pct: 20 });
      const model = await modelOf(userId, 'prospect_model');
      const { prompt, system } = hookPrompt({ profile: project.profile, prospect, custom: await custom(userId), model });
      // Sans site, Claude n'a rien à lire : pas d'outil web, l'accroche s'appuie sur la fiche du prospect
      const r = await claude(userId, {
        prompt, system, model,
        tools: prospect.website ? ['WebFetch'] : [], maxTurns: prospect.website ? 6 : 1, signal: ctx.signal,
      });
      addUsage(ctx, r);
      let out = {};
      try { out = extractJson(r.text); } catch { out = {}; }
      const hook = String(out.hook ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (hook.length < 15) throw new Error("Claude n'a pas produit d'accroche exploitable : réessaie");
      const city = String(out.city ?? '').trim().slice(0, 100);
      const sector = String(out.sector ?? '').trim().slice(0, 100);
      await db.prepare('UPDATE prospects SET hook = ?, city = COALESCE(NULLIF(city, \'\'), ?), sector = COALESCE(NULLIF(sector, \'\'), ?) WHERE id = ?')
        .run(hook, city || null, sector || null, prospect.id);
      return { prospectId: prospect.id, hook };
    },
  };
}


