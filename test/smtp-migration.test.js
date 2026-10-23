// Migration « global_smtp_to_projects » : le SMTP des Réglages est copié dans chaque projet qui n'avait pas le sien, puis supprimé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, setSetting, getSetting } from '../src/db.js';
import { testDb } from './helpers/db.js';
import { addUser, addProject } from './helpers/users.js';

test('SMTP global : copié dans les projets qui n\'avaient pas le leur, puis supprimé ; celui d\'un autre compte n\'est jamais copié', async () => {
  const db = await testDb();
  const a = await addUser(db), b = await addUser(db);
  const sans = await addProject(db, a, { name: 'sans' });
  const avec = await addProject(db, a, { name: 'avec' });
  const chezB = await addProject(db, b, { name: 'b' });
  await db.prepare('UPDATE projects SET smtp_enc = ? WHERE id = ?').run('PROPRE-AU-PROJET', avec);
  await setSetting(db, a, 'smtp_enc', 'GLOBAL-DE-A');

  const m = MIGRATIONS.find((x) => x.name === 'global_smtp_to_projects');
  assert.ok(m, 'migration présente');
  for (const sql of m.sqlite) await db.prepare(sql).run();

  const smtp = async (id) => (await db.prepare('SELECT smtp_enc FROM projects WHERE id = ?').get(id)).smtp_enc;
  assert.equal(await smtp(sans), 'GLOBAL-DE-A');
  assert.equal(await smtp(avec), 'PROPRE-AU-PROJET', 'un SMTP de projet n\'est jamais écrasé');
  assert.equal(await smtp(chezB), null);
  assert.equal(await getSetting(db, a, 'smtp_enc'), null, 'le réglage global disparaît');
});
