import { test } from 'node:test';
import assert from 'node:assert/strict';
import { now } from '../src/db.js';
import { EXPORTED, EXCLUDED, exportAccount } from '../src/services/dataexport.js';
import { startApp } from './helpers/server.js';

// Export complet du compte (RGPD art. 15 et 20) : toutes les tables classées, aucun secret, rien d'un autre compte, 3 exports par heure.

const form = { form: true };

test('chaque table de la base est exportée ou exclue avec une raison : une nouvelle table oblige à décider', async () => {
  const s = await startApp();
  try {
    const tables = (await s.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()).map((r) => r.name);
    const unknown = tables.filter((t) => !(t in EXPORTED) && !(t in EXCLUDED));
    assert.deepEqual(unknown, [], 'tables à classer dans src/services/dataexport.js (EXPORTED ou EXCLUDED)');
    for (const [t, why] of Object.entries(EXCLUDED)) assert.ok(why.length > 20, `raison de l'exclusion de ${t}`);
    for (const t of Object.keys(EXPORTED)) assert.ok(tables.includes(t), `${t} existe`);
  } finally { await s.close(); }
});

async function seed(s, u, tag) {
  const t = now();
  const p = Number((await s.db.prepare('INSERT INTO projects(user_id, name, git_url, smtp_enc, created_at) VALUES(?, ?, ?, ?, ?)').run(u.id, `Projet ${tag}`, 'https://git.test/x.git', 'v1:SMTP-SECRET', t)).lastInsertRowid);
  const pr = Number((await s.db.prepare("INSERT INTO prospects(project_id, company, email, created_at) VALUES(?, ?, ?, ?)").run(p, `Société ${tag}`, `contact-${tag}@prospect.test`, t)).lastInsertRowid);
  await s.db.prepare('INSERT INTO prospect_notes(prospect_id, body, created_at) VALUES(?, ?, ?)').run(pr, `note ${tag}`, t);
  await s.db.prepare('INSERT INTO mail_log(project_id, prospect_id, email, sent_at, subject) VALUES(?, ?, ?, ?, ?)').run(p, pr, `contact-${tag}@prospect.test`, t, `objet ${tag}`);
  await s.db.prepare("INSERT INTO accounting_entries(user_id, kind, entry_date, label, amount_cents, doc_name, doc_mime, doc_size, doc_file, created_at, updated_at) VALUES(?, 'income', '2026-01-01', ?, 1000, '', '', 0, '', ?, ?)").run(u.id, `ligne ${tag}`, t, t);
  const c = Number((await s.db.prepare("INSERT INTO chat_conversations(user_id, title, model, created_at, updated_at) VALUES(?, ?, 'm', ?, ?)").run(u.id, `conv ${tag}`, t, t)).lastInsertRowid);
  await s.db.prepare("INSERT INTO chat_messages(conversation_id, role, content, created_at) VALUES(?, 'user', ?, ?)").run(c, `message ${tag}`, t);
  await s.db.prepare("INSERT INTO api_tokens(user_id, name, token_hash, prefix, scopes, created_at) VALUES(?, ?, ?, 'iaboss_', 'read', ?)").run(u.id, `jeton ${tag}`, `HASH-SECRET-${tag}`, t);
}

test('l\'export contient les données du compte, sans secret ni donnée d\'un autre compte', async () => {
  const s = await startApp();
  try {
    const a = await s.newUser({ admin: false }); const b = await s.newUser({ admin: false });
    await seed(s, a, 'AAA'); await seed(s, b, 'BBB');
    await s.db.prepare("UPDATE users SET totp_enabled = 1, totp_secret_enc = 'v1:TOTP-SECRET', totp_recovery = '[\"RECOVERY-HASH\"]', claude_link_json = '{\"secret_enc\":\"LINK-SECRET\"}' WHERE id = ?").run(a.id);
    const doc = await exportAccount(s.db, a.id);
    const text = JSON.stringify(doc);
    assert.equal(doc.format, 'iaboss-export-v1');
    for (const need of ['Projet AAA', 'Société AAA', 'contact-AAA@prospect.test', 'note AAA', 'objet AAA', 'ligne AAA', 'conv AAA', 'message AAA', 'jeton AAA', a.email]) assert.ok(text.includes(need), need);
    for (const never of ['BBB', b.email, 'SMTP-SECRET', 'TOTP-SECRET', 'RECOVERY-HASH', 'LINK-SECRET', 'HASH-SECRET', 'token_hash', 'smtp_enc']) assert.ok(!text.includes(never), `absent : ${never}`);
    assert.equal(doc.data.users.length, 1);
    assert.equal(doc.data.users[0].totp_enabled, 1);
    assert.deepEqual(Object.keys(doc.data.api_tokens[0]).sort(), ['created_at', 'id', 'last_used_at', 'name', 'prefix', 'scopes', 'user_id']);
  } finally { await s.close(); }
});

test('POST /account/export : fichier JSON à télécharger, réservé au compte connecté, 3 par heure, origine contrôlée', async () => {
  const s = await startApp({ rateLimit: true });
  try {
    const u = await s.newUser({ admin: false });
    await seed(s, u, 'ZZZ');
    assert.notEqual((await s.anon.post('/account/export', {}, form)).status, 200, 'sans compte');
    assert.equal((await u.post('/account/export', {}, { ...form, origin: 'https://evil.example' })).status, 403, 'autre origine');
    const r = await u.post('/account/export', {}, form);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="iaboss-donnees-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.ok(JSON.stringify(await r.json()).includes('Projet ZZZ'));
    await u.post('/account/export', {}, form); await u.post('/account/export', {}, form);
    assert.equal((await u.post('/account/export', {}, form)).status, 429, 'quatrième export dans l\'heure');
    const page = await (await u.get('/account', { headers: { accept: 'text/html' } })).text();
    assert.match(page, /id="donnees"[\s\S]*Télécharger mes données/);
  } finally { await s.close(); }
});

test('réglages clé / valeur : les secrets chiffrés (lignes, pas colonnes) et tout texte chiffré sont retirés, les préférences restent', async () => {
  const s = await startApp();
  try {
    const u = await s.newUser({ admin: false });
    const enc = 'v1:QUJDREVGR0hJSktM:TU5PUFFSU1RVVldY:WVo0NTY3ODkw';
    const put = (k, v) => s.db.prepare('INSERT INTO user_settings(user_id, `key`, value) VALUES(?, ?, ?)').run(u.id, k, v);
    await put('github_token_enc', enc); await put('discord_webhook_enc', enc); await put('elevenlabs_enc', enc);
    await put('notify_channels_json', JSON.stringify([{ type: 'slack', url_enc: enc }]));
    await put('git_servers_json', JSON.stringify([{ host: 'git.test', token_enc: enc }]));
    await put('autre_reglage_json', JSON.stringify({ secret_cache: enc })); // clé sans nom suspect : arrêté par le filet sur le texte chiffré
    await put('acc_regime', 'micro'); await put('mail_footer', '1');
    const doc = await exportAccount(s.db, u.id);
    const text = JSON.stringify(doc);
    assert.ok(!text.includes('QUJDREVGR0hJSktM') && !text.includes('WVo0NTY3ODkw'), 'aucun secret chiffré dans l\'export');
    const keys = doc.data.user_settings.map((r) => r.key);
    for (const k of ['github_token_enc', 'discord_webhook_enc', 'elevenlabs_enc', 'notify_channels_json', 'git_servers_json']) assert.ok(!keys.includes(k), `${k} retiré`);
    assert.ok(keys.includes('acc_regime') && keys.includes('mail_footer'), 'les préférences restent');
    assert.equal(doc.data.user_settings.find((r) => r.key === 'autre_reglage_json').value, '[secret chiffré : non exporté]');
  } finally { await s.close(); }
});
