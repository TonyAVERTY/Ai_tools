import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setSetting, getSetting, now } from '../src/db.js';
import { toolActivity } from '../src/handlers.js';
import { testDb } from './helpers/db.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';
import { makeHandlers, parseProspectLine } from '../src/handlers.js';
import { createProject, saveSecretConfig, getProject, prospectStats, pickVariant } from '../src/projects.js';
import { allowedToSend, buildProspectMail, fillTemplate } from '../src/services/mailer.js';
import { validateSelect, firstValue } from '../src/services/recap.js';
import { validateGitUrl } from '../src/services/git.js';
import { verifyUnsubToken, encrypt, encryptJson } from '../src/crypto.js';
import { addUser, TEST_SECRET_KEY } from './helpers/users.js';
import { makeClaudeBin } from './helpers/claude-bin.js';

async function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'aitools-'));
  const src = join(tmp, 'src-repo');
  execFileSync('git', ['init', '-q', '-b', 'main', src]);
  writeFileSync(join(src, 'README.md'), '# MonEspacePro\n');
  execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'init', '--allow-empty']);
  execFileSync('git', ['-C', src, 'add', '.']);
  execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'readme']);
  const db = await testDb();
  const sentMails = [];
  const app = { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }], resolveMx: async () => [{ exchange: 'mx.test', priority: 10 }],
    db,
    cfg: { dataDir: tmp, claudeBin: resolve('test/fixtures/fake-claude.js'), sandbox: { enabled: false, production: false }, secretKey: TEST_SECRET_KEY, appUrl: 'https://ai.test',
      systemSmtp: { host: 'smtp.serveur', port: 587, user: 'srv', pass: 'p', fromEmail: 'aitools@serveur.test' } }, // mails d'iaboss (évolutions…)
    // syncRepo refuse file:// (clones d'URL fournies par l'utilisateur : https seulement) : le test clone le dépôt local à la place
    syncRepo: async (url, dir) => {
      if (existsSync(join(dir, '.git'))) execFileSync('git', ['-C', dir, 'pull', '-q']);
      else execFileSync('git', ['clone', '-q', '--depth', '1', url, dir]);
      return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD']).toString().trim();
    },
    createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sentMails.push(m); }, close() {} }),
  };
  const userId = await addUser(db);
  await setSetting(db, userId, 'send_delay_min', '0');
  await setSetting(db, userId, 'send_delay_max', '0');
  const id = await createProject(app, { userId, name: 'MonEspacePro', gitUrl: `file://${src}` });
  const worker = new Worker(db, makeHandlers(app), { log: { error: (...a) => console.error(...a) } });
  return { tmp, db, app, id, userId, worker, sentMails };
}

const run = async (s, type, params) => { await enqueue(s.db, { userId: s.userId, projectId: s.id, type, params }); await s.worker.tick(); return (await latestJobs(s.db, s.id))[type]; };

test('flux complet : analyse → cible → prospection → modèle → envoi → évolution', async () => {
  const s = await setup();
  try {
    const a = await run(s, 'analyze');
    assert.equal(a.status, 'done', a.error);
    let p = await getProject(s.app, s.id, { userId: s.userId });
    assert.equal(p.profile.resume, 'Cartes de fidélité digitales.');
    assert.equal(p.target.zone, 'Bretagne');
    assert.equal(p.profile.facturation.legal_name, 'Atelier Averty', 'l\'analyse garde les informations d\'éditeur trouvées pour la Facturation');
    assert.equal(p.targetValidated, false);
    assert.match(p.profileCommit, /^[0-9a-f]{40}$/);
    const rl = JSON.parse(await getSetting(s.db, s.userId, 'claude_rate_limit_json'));
    assert.equal(rl.fiveHour.utilization, 0.33, 'quota Claude (session) enregistré après l\'appel');
    assert.equal(rl.sevenDay.utilization, 0.5, 'quota Claude (semaine) enregistré après l\'appel');

    const refused = await run(s, 'prospect', { count: 3 });
    assert.match(refused.error, /Valide la cible/);

    await s.db.prepare('UPDATE projects SET target_validated = 1 WHERE id = ?').run(s.id);
    await s.db.prepare("INSERT INTO blacklist(email, created_at) VALUES('hello@zen.fr', ?)").run(now());
    const pr = await run(s, 'prospect', { count: 3 });
    assert.equal(pr.status, 'done', pr.error);
    assert.equal(pr.result.found, 1, 'email invalide rejeté + blacklisté ignoré');
    assert.equal((await prospectStats(s.db, s.id)).new, 1);

    const t = await run(s, 'template');
    assert.equal(t.status, 'done', t.error);
    const noValid = await run(s, 'send', { count: 5 });
    assert.match(noValid.error, /non validé/);

    await s.db.prepare("UPDATE templates SET status = 'validated' WHERE project_id = ? AND kind = 'initial'").run(s.id);
    const noSmtp = await run(s, 'send', { count: 5 });
    assert.match(noSmtp.error, /SMTP/);

    await saveSecretConfig(s.app, s.id, 'smtp_enc', { host: 'smtp.x', port: 587, user: 'u', pass: 'secret', fromEmail: 'tony@x.fr', fromName: 'Tony' }, 'pass');
    const sent = await run(s, 'send', { count: 5 });
    assert.equal(sent.status, 'done', sent.error);
    assert.deepEqual(sent.result, { sent: 1, failed: 0, total: 1, model: 'haiku' });
    const mail = s.sentMails[0];
    assert.equal(mail.to, 'contact@fournil.fr');
    assert.equal(mail.subject, 'Idée pour Boulangerie Le Fournil');
    assert.match(mail.text, /Bonjour Boulangerie Le Fournil à Rennes/);
    assert.match(mail.text, /fournil\.fr\/contact/);
    assert.equal(mail.html, undefined, 'mail classique : texte seulement, sans HTML');
    assert.equal(mail.headers['List-Unsubscribe'], undefined, 'aucun en-tête de désabonnement invisible');
    assert.match(mail.text, /Pour ne plus être contacté/);
    const unsub = /\/u\/([^/\s]+)\/(\S+)/.exec(mail.text);
    assert.ok(verifyUnsubToken(s.app.cfg.secretKey, decodeURIComponent(unsub[1]), unsub[2]));
    assert.equal((await prospectStats(s.db, s.id)).sent, 1);

    const again = await run(s, 'send', { count: 5 });
    assert.match(again.error, /aucun prospect/, 'jamais 2 fois le même prospect');

    const ev1 = await run(s, 'evolution', { count: 3, level: 'rapide' });
    assert.match(ev1.error, /Adresse de réception/);
    await setSetting(s.db, s.userId, 'notify_email', 'moi@x.fr');
    const ev = await run(s, 'evolution', { count: 3, level: 'rapide' });
    assert.equal(ev.status, 'done', ev.error);
    assert.equal(s.sentMails.at(-1).to, 'moi@x.fr');
    assert.equal(s.sentMails.at(-1).from, 'aitools@serveur.test', 'les mails d\'iaboss partent du SMTP du serveur, pas de celui du projet');
    assert.match(s.sentMails.at(-1).text, /Export CSV/);
    assert.match(s.sentMails.at(-1).html, /class|style/, 'version HTML mise en forme');
    assert.match(s.sentMails.at(-1).html, /Export CSV/);
    assert.equal(ev.progress.pct, 95, 'avancement remonté jusqu\'au mail');

    const usage = (await s.db.prepare('SELECT SUM(cost_usd) c FROM jobs').get()).c;
    assert.ok(usage > 0);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('parseProspectLine ne garde que des URLs http(s)', () => {
  const p = parseProspectLine('PROSPECT {"company":"X","email":"a@b.fr","website":"javascript:alert(1)","source":"https://ok.fr/contact"}');
  assert.equal(p.website, null);
  assert.equal(p.source, 'https://ok.fr/contact');
  assert.equal(parseProspectLine('PROSPECT {"company":"X","email":"a@b.fr","website":"https://a.fr\\" onclick=x"}').website, null);
  assert.equal(parseProspectLine('PROSPECT {"company":"X","email":"a@b.fr","website":"data:text/html,x"}').website, null);
});

test('parseProspectLine filtre les lignes invalides', () => {
  assert.equal(parseProspectLine('blabla'), null);
  assert.equal(parseProspectLine('PROSPECT {cassé'), null);
  assert.equal(parseProspectLine('PROSPECT {"company":"A","email":"x"}'), null);
  assert.equal(parseProspectLine('PROSPECT {"email":"a@b.fr"}'), null);
  const p = parseProspectLine('PROSPECT {"company":"A","email":" A@B.FR ","score":42}');
  assert.equal(p.email, 'a@b.fr');
  assert.equal(p.score, 10);
});

test('plafonds d\'envoi anti-abus', () => {
  const base = { requested: 50, available: 80, projectCap: 30, sentTodayProject: 0, globalCap: 100, sentTodayGlobal: 0 };
  assert.equal(allowedToSend(base), 30);
  assert.equal(allowedToSend({ ...base, sentTodayProject: 25 }), 5);
  assert.equal(allowedToSend({ ...base, projectCap: 9999, requested: 9999, available: 9999 }), 100);
  assert.equal(allowedToSend({ ...base, sentTodayGlobal: 100 }), 0);
  assert.equal(allowedToSend({ ...base, available: 3 }), 3);
  assert.throws(() => allowedToSend({ ...base, requested: 0 }));
  assert.throws(() => allowedToSend({ ...base, requested: 'abc' }));
});

test('modèle de mail', () => {
  assert.equal(fillTemplate('Salut {{ entreprise }} {{inconnu}}!', { entreprise: 'X' }), 'Salut X !');
  const m = buildProspectMail({
    template: { subject: 'Pour {{entreprise}}', body: 'Hey' },
    prospect: { company: 'Y', email: 'y@y.fr' }, smtp: { fromEmail: 'a@a.fr', fromName: 'To"ny' }, unsubUrl: 'https://u',
  });
  assert.equal(m.from, '"Tony" <a@a.fr>');
  assert.match(m.text, /Pour ne plus être contacté : https:\/\/u/);
});

test('récap : seules les requêtes SELECT passent', () => {
  assert.equal(validateSelect('SELECT COUNT(*) FROM users;'), 'SELECT COUNT(*) FROM users');
  assert.equal(validateSelect('  '), null);
  assert.ok(validateSelect('WITH a AS (SELECT 1) SELECT * FROM a'));
  assert.throws(() => validateSelect('DELETE FROM users'));
  assert.throws(() => validateSelect('SELECT 1; DROP TABLE users'));
  assert.throws(() => validateSelect('SELECT * FROM a INTO OUTFILE "/tmp/x"'));
  assert.equal(firstValue([{ n: '12.5' }]), 12.5);
  assert.equal(firstValue([]), 0);
});

test('URL Git Forgejo', () => {
  assert.equal(validateGitUrl('https://git.tony-averty.dev/Tony/AiTools.git', 'git.tony-averty.dev'), 'https://git.tony-averty.dev/Tony/AiTools.git');
  assert.throws(() => validateGitUrl('http://git.tony-averty.dev/Tony/A.git'), /https/);
  assert.throws(() => validateGitUrl('https://user:pw@git.tony-averty.dev/Tony/A.git'), /identifiants/);
  assert.throws(() => validateGitUrl('https://github.com/Tony/A.git', 'git.tony-averty.dev'), /doit être/);
  assert.throws(() => validateGitUrl('https://git.tony-averty.dev/a/b/c/d'), /Format/);
});

test('envoi : Message-ID journalisé et objets A/B alternés équitablement', async () => {
  const s = await setup();
  try {
    await saveSecretConfig(s.app, s.id, 'smtp_enc', { host: 'smtp.x', port: 587, user: 'u', pass: 'p', fromEmail: 'tony@codebzh.fr' }, 'pass');
    await s.db.prepare(`INSERT INTO templates(project_id, kind, subject, subject_b, body, status, updated_at)
      VALUES(?, 'initial', 'Objet A {{entreprise}}', 'Objet B {{entreprise}}', 'Bonjour', 'validated', ?)`).run(s.id, now());
    for (const n of [1, 2, 3, 4]) {
      await s.db.prepare("INSERT INTO prospects(project_id, company, email, score, created_at) VALUES(?, ?, ?, ?, ?)").run(s.id, `Ent${n}`, `c${n}@ent${n}.fr`, 10 - n, now());
    }
    const job = await run(s, 'send', { count: 4 });
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(s.sentMails.map((m) => m.subject), ['Objet A Ent1', 'Objet B Ent2', 'Objet A Ent3', 'Objet B Ent4']);
    const logs = await s.db.prepare("SELECT * FROM mail_log WHERE kind = 'initial' ORDER BY id").all();
    assert.equal(logs.length, 4);
    for (const [i, l] of logs.entries()) {
      assert.equal(l.message_id, s.sentMails[i].messageId);
      assert.match(l.message_id, /^<[^@\s]+@codebzh\.fr>$/);
      assert.equal(l.subject, s.sentMails[i].subject);
      assert.equal(l.body, 'Bonjour', 'le texte envoyé est gardé pour la page Mails');
    }
    assert.equal(new Set(logs.map((l) => l.message_id)).size, 4, 'Message-ID uniques');
    assert.deepEqual((await s.db.prepare('SELECT variant FROM prospects ORDER BY id').all()).map((r) => r.variant), ['A', 'B', 'A', 'B']);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

// SMTP d'un projet : le sien, et rien d'autre (un projet n'envoie jamais depuis l'adresse d'un autre ni depuis celle du serveur)
test('SMTP par projet, sans repli sur un SMTP commun', async () => {
  const s = await setup();
  try {
    await s.db.prepare(`INSERT INTO templates(project_id, kind, subject, body, status, updated_at) VALUES(?, 'initial', 'Salut {{entreprise}}', 'Bonjour', 'validated', ?)`).run(s.id, now());
    const addProspect = (n) => s.db.prepare('INSERT INTO prospects(project_id, company, email, score, created_at) VALUES(?, ?, ?, 5, ?)').run(s.id, `E${n}`, `c${n}@e${n}.fr`, now());
    const asSource = async () => (await getProject(s.app, s.id, { userId: s.userId })).smtpSource;

    // Aucun SMTP de projet : refus clair, rien ne part (même si le serveur a le sien)
    assert.equal(await asSource(), null);
    assert.equal((await getProject(s.app, s.id, { userId: s.userId })).hasSmtp, false);
    await addProspect(1);
    let job = await run(s, 'send', { count: 1 });
    assert.equal(job.status, 'error');
    assert.match(job.error, /Aucun SMTP/);
    assert.equal(s.sentMails.length, 0);

    // Un ancien réglage « SMTP global » restant en base n'est plus lu
    await setSetting(s.db, s.userId, 'smtp_enc', encryptJson(s.app.cfg.secretKey, { host: 'smtp.reglages', port: 587, user: 'r', pass: 'p', fromEmail: 'reglages@codebzh.fr' }));
    assert.equal(await asSource(), null);
    job = await run(s, 'send', { count: 1 });
    assert.equal(job.status, 'error');
    assert.equal(s.sentMails.length, 0);

    // SMTP propre au projet : les mails du projet partent de son adresse
    await saveSecretConfig(s.app, s.id, 'smtp_enc', { host: 'smtp.projet', port: 587, user: 'u', pass: 'p', fromEmail: 'projet@codebzh.fr' }, 'pass');
    assert.equal(await asSource(), 'project');
    job = await run(s, 'send', { count: 1 });
    assert.equal(job.status, 'done', job.error);
    assert.equal(s.sentMails.at(-1).from, 'projet@codebzh.fr');
    // L'IMAP réutilise les identifiants du SMTP du projet
    await saveSecretConfig(s.app, s.id, 'imap_enc', { host: 'imap.x', port: 993, user: '', pass: '' }, 'pass');
    const q = await getProject(s.app, s.id, { userId: s.userId, secrets: true });
    assert.equal(q.imap.user, 'u');
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('sans objet B : tout part en A', async () => {
  const db = await testDb();
  assert.equal(await pickVariant(db, 1, { subject_b: null }), 'A');
  assert.equal(await pickVariant(db, 1, { subject_b: '' }), 'A');
});

test('analyse : modèle économique (Haiku) par défaut, Sonnet uniquement sur demande', async () => {
  const s = await setup();
  const spyFile = join(s.tmp, 'models.log');
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { MODEL_SPY_FILE: spyFile } });
  try {
    const a = await run(s, 'analyze');
    assert.equal(a.status, 'done', a.error);
    await setSetting(s.db, s.userId, 'analyze_model', 'sonnet');
    const a2 = await run(s, 'analyze');
    assert.equal(a2.status, 'done', a2.error);
    assert.deepEqual(readFileSync(spyFile, 'utf8').trim().split('\n'), ['haiku', 'sonnet']);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('modèle et consignes de sa gamme : le prompt de la gamme du modèle choisi (et ce modèle) arrivent à Claude, pour chaque tâche', async () => {
  const s = await setup();
  const spyFile = join(s.tmp, 'prompts.log');
  s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { fixture: 'spy-claude.js', env: { PROMPT_SPY_FILE: spyFile } });
  // Dernier appel de rédaction (la relecture et la correction de forme, qui suivent un modèle de mail, ont leur propre prompt)
  const last = () => JSON.parse(readFileSync(spyFile, 'utf8').trim().split('\n').filter((l) => !l.includes('RELECTURE DU MAIL') && !l.includes('CORRECTION DE FORME') && !l.includes('CONTRÔLE DU SENS')).pop());
  try {
    assert.equal((await run(s, 'analyze')).status, 'done'); // le modèle de mail s'écrit à partir de la fiche du projet
    await setSetting(s.db, s.userId, 'prompts_json', JSON.stringify({ '*': { template: 'email de prospection MARQUE-COMMUNE' }, haiku: { template: 'email de prospection MARQUE-HAIKU' }, opus: { template: 'email de prospection MARQUE-OPUS' } }));
    // rédaction : Haiku par défaut
    const tj = await run(s, 'template'); assert.equal(tj.status, 'done', tj.error);
    assert.equal(last().model, 'haiku');
    assert.match(last().prompt, /MARQUE-HAIKU/);
    // modèle précis de la gamme Opus
    await setSetting(s.db, s.userId, 'write_model', 'claude-opus-5-5');
    assert.equal((await run(s, 'template')).status, 'done');
    assert.equal(last().model, 'claude-opus-5-5');
    assert.match(last().prompt, /MARQUE-OPUS/);
    assert.doesNotMatch(last().prompt, /MARQUE-HAIKU/);
    // gamme sans texte propre : « tous les modèles »
    await setSetting(s.db, s.userId, 'write_model', 'claude-sonnet-5-5');
    assert.equal((await run(s, 'template')).status, 'done');
    assert.match(last().prompt, /MARQUE-COMMUNE/);
    // sans personnalisation : consignes par défaut de la gamme
    await setSetting(s.db, s.userId, 'prompts_json', '');
    await setSetting(s.db, s.userId, 'write_model', 'haiku');
    assert.equal((await run(s, 'template')).status, 'done');
    assert.match(last().prompt, /Reste sous 150 mots/);
    await setSetting(s.db, s.userId, 'write_model', 'claude-fable-5-1');
    assert.equal((await run(s, 'template')).status, 'done');
    assert.match(last().prompt, /excellent commercial/);
    // analyse : son propre réglage, sa propre gamme ; un identifiant hors catalogue retombe sur Haiku
    await setSetting(s.db, s.userId, 'analyze_model', 'claude-opus-4-8');
    assert.equal((await run(s, 'analyze')).status, 'done');
    assert.equal(last().model, 'claude-opus-4-8');
    assert.match(last().prompt, /Remonte à l'intention du produit/);
    await setSetting(s.db, s.userId, 'analyze_model', '--dangerously-skip-permissions');
    assert.equal((await run(s, 'analyze')).status, 'done');
    assert.equal(last().model, 'haiku');
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('quota Claude serré : alerte Discord à 80 %, pas en dessous', async () => {
  const s = await setup();
  const sent = [];
  s.app.fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 204 }; };
  const hook = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz-ABC_123';
  await setSetting(s.db, s.userId, 'discord_webhook_enc', encrypt(s.app.cfg.secretKey, hook));
  try {
    const a = await run(s, 'analyze'); // fake-claude : 33 % / 50 % par défaut
    assert.equal(a.status, 'done', a.error);
    assert.equal(sent.length, 0, 'sous le seuil : pas d\'alerte');

    s.app.cfg.claudeBin = makeClaudeBin(s.tmp, { env: { FAKE_FIVE_HOUR: '0.84' } });
    const a2 = await run(s, 'analyze');
    assert.equal(a2.status, 'done', a2.error);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, hook);
    assert.match(sent[0].body.embeds[0].title, /80\+ % \(session Claude \(5 h\)\)/);

    // reste au-dessus de 80 % : pas de redite
    const a3 = await run(s, 'analyze');
    assert.equal(a3.status, 'done', a3.error);
    assert.equal(sent.length, 1);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('audit du dépôt, accroche régénérée, consignes personnalisées transmises à Claude', async () => {
  const s = await setup();
  try {
    assert.equal((await run(s, 'analyze')).status, 'done');
    // Audit : rapport Markdown en lecture seule, gardé dans le résultat du job
    const au = await run(s, 'audit', { level: 'rapide' });
    assert.equal(au.status, 'done', au.error);
    assert.match(au.result.markdown, /## Constats[\s\S]*src\/a\.js:1/);
    // Accroche : remplace l'ancienne, complète la ville / le secteur manquants sans écraser ceux qui existent
    const pid = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, website, city, hook, status, created_at) VALUES(?, 'Boulangerie Le Fournil', 'c@fournil.fr', 'https://fournil.fr', 'Vern', 'ancienne accroche', 'new', ?)").run(s.id, now())).lastInsertRowid);
    const h = await run(s, 'hook', { prospectId: pid });
    assert.equal(h.status, 'done', h.error);
    const row = await s.db.prepare('SELECT hook, city, sector FROM prospects WHERE id = ?').get(pid);
    assert.match(row.hook, /Fournil : des fournées/);
    assert.equal(row.city, 'Vern', 'la ville renseignée n\'est pas écrasée');
    assert.equal(row.sector, 'boulangerie', 'le secteur manquant est complété');
    // Un prospect d'un autre projet n'est jamais touché
    const other = await run(s, 'hook', { prospectId: 999999 });
    assert.match(other.error, /Prospect introuvable/);
    // Consignes personnalisées : elles font partie du prompt reçu par Claude (CRASH fait échouer la fausse CLI), le défaut non
    assert.equal((await run(s, 'template')).status, 'done');
    await setSetting(s.db, s.userId, 'prompts_json', JSON.stringify({ '*': { template: 'CRASH' } }));
    assert.equal((await run(s, 'template')).status, 'error', 'la consigne personnalisée est bien transmise');
    await setSetting(s.db, s.userId, 'prompts_json', '');
    assert.equal((await run(s, 'template')).status, 'done', 'retour au défaut');
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
});

test('activité de Claude en direct : recherche web, site lu (nom d\'hôte seulement), fichier lu ; rien pour le reste', () => {
  assert.equal(toolActivity('WebSearch', { query: 'boulangerie  artisanale\nRennes' }), 'Recherche web : « boulangerie artisanale Rennes »');
  assert.equal(toolActivity('WebFetch', { url: 'https://www.exemple.fr/contact?token=secret#x' }), 'Lecture du site exemple.fr');
  assert.equal(toolActivity('WebFetch', { url: 'pas une url' }), "Lecture d'une page web");
  assert.equal(toolActivity('Read', { file_path: '/data/repos/1/src/app.js' }), 'Lecture de src/app.js');
  assert.equal(toolActivity('Grep', { pattern: 'x' }), 'Recherche dans le code');
  assert.equal(toolActivity('Bash', { command: 'ls' }), null);
  assert.ok(toolActivity('WebSearch', { query: 'x'.repeat(300) }).length <= 90);
});

