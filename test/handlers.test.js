import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openDb, setSetting, now } from '../src/db.js';
import { Worker, enqueue, latestJobs } from '../src/services/jobs.js';
import { makeHandlers, parseProspectLine } from '../src/handlers.js';
import { createProject, saveSecretConfig, getProject, prospectStats } from '../src/projects.js';
import { allowedToSend, buildProspectMail, fillTemplate } from '../src/services/mailer.js';
import { validateSelect, firstValue } from '../src/services/recap.js';
import { validateGitUrl } from '../src/services/git.js';
import { verifyUnsubToken } from '../src/crypto.js';

function setup() {
  const tmp = mkdtempSync(join(tmpdir(), 'aitools-'));
  const src = join(tmp, 'src-repo');
  execFileSync('git', ['init', '-q', '-b', 'main', src]);
  writeFileSync(join(src, 'README.md'), '# MonEspacePro\n');
  execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'init', '--allow-empty']);
  execFileSync('git', ['-C', src, 'add', '.']);
  execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'readme']);
  const db = openDb(':memory:');
  const sentMails = [];
  const app = {
    db,
    cfg: { dataDir: tmp, claudeBin: resolve('test/fixtures/fake-claude.js'), secretKey: randomBytes(32), appUrl: 'https://ai.test' },
    createTransport: () => ({ verify: async () => true, sendMail: async (m) => { sentMails.push(m); }, close() {} }),
  };
  setSetting(db, 'send_delay_min', '0');
  setSetting(db, 'send_delay_max', '0');
  const id = createProject(app, { name: 'MonEspacePro', gitUrl: `file://${src}` });
  const worker = new Worker(db, makeHandlers(app), { thermalMax: 999, log: { error: (...a) => console.error(...a) } });
  return { tmp, db, app, id, worker, sentMails };
}

const run = async (s, type, params) => { enqueue(s.db, { projectId: s.id, type, params }); await s.worker.tick(); return latestJobs(s.db, s.id)[type]; };

test('flux complet : analyse → cible → prospection → modèle → envoi → évolution', async () => {
  const s = setup();
  try {
    const a = await run(s, 'analyze');
    assert.equal(a.status, 'done', a.error);
    let p = getProject(s.app, s.id);
    assert.equal(p.profile.resume, 'Cartes de fidélité digitales.');
    assert.equal(p.target.zone, 'Bretagne');
    assert.equal(p.targetValidated, false);
    assert.match(p.profileCommit, /^[0-9a-f]{40}$/);

    const refused = await run(s, 'prospect', { count: 3 });
    assert.match(refused.error, /Valide la cible/);

    s.db.prepare('UPDATE projects SET target_validated = 1 WHERE id = ?').run(s.id);
    s.db.prepare("INSERT INTO blacklist(email, created_at) VALUES('hello@zen.fr', ?)").run(now());
    const pr = await run(s, 'prospect', { count: 3 });
    assert.equal(pr.status, 'done', pr.error);
    assert.equal(pr.result.found, 1, 'email invalide rejeté + blacklisté ignoré');
    assert.equal(prospectStats(s.db, s.id).new, 1);

    const t = await run(s, 'template');
    assert.equal(t.status, 'done', t.error);
    const noValid = await run(s, 'send', { count: 5 });
    assert.match(noValid.error, /non validé/);

    s.db.prepare("UPDATE templates SET status = 'validated' WHERE project_id = ? AND kind = 'initial'").run(s.id);
    const noSmtp = await run(s, 'send', { count: 5 });
    assert.match(noSmtp.error, /SMTP/);

    saveSecretConfig(s.app, s.id, 'smtp_enc', { host: 'smtp.x', port: 587, user: 'u', pass: 'secret', fromEmail: 'tony@x.fr', fromName: 'Tony' }, 'pass');
    const sent = await run(s, 'send', { count: 5 });
    assert.equal(sent.status, 'done', sent.error);
    assert.deepEqual(sent.result, { sent: 1, failed: 0, total: 1 });
    const mail = s.sentMails[0];
    assert.equal(mail.to, 'contact@fournil.fr');
    assert.equal(mail.subject, 'Idée pour Boulangerie Le Fournil');
    assert.match(mail.text, /Bonjour Boulangerie Le Fournil à Rennes/);
    assert.match(mail.text, /fournil\.fr\/contact/);
    const unsub = /\/u\/([^/]+)\/(\S+)/.exec(mail.headers['List-Unsubscribe']);
    assert.ok(verifyUnsubToken(s.app.cfg.secretKey, decodeURIComponent(unsub[1]), unsub[2].replace('>', '')));
    assert.equal(prospectStats(s.db, s.id).sent, 1);

    const again = await run(s, 'send', { count: 5 });
    assert.match(again.error, /aucun prospect/, 'jamais 2 fois le même prospect');

    const ev1 = await run(s, 'evolution', { count: 3, level: 'rapide' });
    assert.match(ev1.error, /Adresse de réception/);
    setSetting(s.db, 'notify_email', 'moi@x.fr');
    const ev = await run(s, 'evolution', { count: 3, level: 'rapide' });
    assert.equal(ev.status, 'done', ev.error);
    assert.equal(s.sentMails.at(-1).to, 'moi@x.fr');
    assert.match(s.sentMails.at(-1).text, /Export CSV/);

    const usage = s.db.prepare('SELECT SUM(cost_usd) c FROM jobs').get().c;
    assert.ok(usage > 0);
  } finally { rmSync(s.tmp, { recursive: true, force: true }); }
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
