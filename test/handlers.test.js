import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setSetting, getSetting, now } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';
import { makeHandlers, parseProspectLine } from '../src/handlers.js';
import { createProject, saveSecretConfig, getProject, prospectStats, pickVariant } from '../src/projects.js';
import { allowedToSend, buildProspectMail, fillTemplate } from '../src/services/mailer.js';
import { validateSelect, firstValue } from '../src/services/recap.js';
import { validateGitUrl } from '../src/services/git.js';
import { verifyUnsubToken, encrypt } from '../src/crypto.js';
import { addUser } from './helpers/users.js';
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
  const app = { resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
    db,
    cfg: { dataDir: tmp, claudeBin: resolve('test/fixtures/fake-claude.js'), sandbox: { enabled: false, production: false }, secretKey: randomBytes(32), appUrl: 'https://ai.test' },
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
    assert.deepEqual(sent.result, { sent: 1, failed: 0, total: 1 });
    const mail = s.sentMails[0];
    assert.equal(mail.to, 'contact@fournil.fr');
    assert.equal(mail.subject, 'Idée pour Boulangerie Le Fournil');
    assert.match(mail.text, /Bonjour Boulangerie Le Fournil à Rennes/);
    assert.match(mail.text, /fournil\.fr\/contact/);
    assert.match(mail.html, /Bonjour Boulangerie Le Fournil à Rennes/);
    assert.match(mail.html, /Ne plus recevoir de messages/);
    const unsub = /\/u\/([^/]+)\/(\S+)/.exec(mail.headers['List-Unsubscribe']);
    assert.ok(verifyUnsubToken(s.app.cfg.secretKey, decodeURIComponent(unsub[1]), unsub[2].replace('>', '')));
    assert.equal((await prospectStats(s.db, s.id)).sent, 1);

    const again = await run(s, 'send', { count: 5 });
    assert.match(again.error, /aucun prospect/, 'jamais 2 fois le même prospect');

    const ev1 = await run(s, 'evolution', { count: 3, level: 'rapide' });
    assert.match(ev1.error, /Adresse de réception/);
    await setSetting(s.db, s.userId, 'notify_email', 'moi@x.fr');
    const ev = await run(s, 'evolution', { count: 3, level: 'rapide' });
    assert.equal(ev.status, 'done', ev.error);
    assert.equal(s.sentMails.at(-1).to, 'moi@x.fr');
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
    }
    assert.equal(new Set(logs.map((l) => l.message_id)).size, 4, 'Message-ID uniques');
    assert.deepEqual((await s.db.prepare('SELECT variant FROM prospects ORDER BY id').all()).map((r) => r.variant), ['A', 'B', 'A', 'B']);
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
