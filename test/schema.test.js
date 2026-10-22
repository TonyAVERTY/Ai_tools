import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS } from '../src/db.js';
import { testDb, USING_MYSQL } from './helpers/db.js';

// Découpe "a, b(c, d), e" sur les virgules de premier niveau
function splitTop(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Tables, colonnes et clés étrangères déclarées par la suite d'instructions des migrations : CREATE TABLE,
// puis DROP TABLE, RENAME TO, ADD COLUMN et ADD CONSTRAINT ... FOREIGN KEY rejoués dans l'ordre (état final).
function parseDdl(statements) {
  const tables = new Map();
  const cascade = (item) => [...item.matchAll(/REFERENCES\s+`?(\w+)`?\s*\([^)]*\)\s*ON DELETE CASCADE/gi)].map((r) => r[1]);
  for (const st of statements) {
    const sql = (typeof st === 'string' ? st : st.sql).replace(/--[^\n]*/g, '').trim();
    let a;
    if ((a = /^DROP TABLE (?:IF EXISTS )?`?(\w+)`?/i.exec(sql))) { tables.delete(a[1]); continue; }
    if ((a = /^ALTER TABLE `?(\w+)`? RENAME TO `?(\w+)`?/i.exec(sql))) { tables.set(a[2], tables.get(a[1])); tables.delete(a[1]); continue; }
    if ((a = /^ALTER TABLE `?(\w+)`? ADD COLUMN `?(\w+)`?/i.exec(sql))) {
      const t = tables.get(a[1]);
      t.columns.add(a[2]); t.refs = [...t.refs, ...cascade(sql)].sort();
      continue;
    }
    if ((a = /^ALTER TABLE `?(\w+)`? ADD CONSTRAINT/i.exec(sql))) {
      const t = tables.get(a[1]);
      t.refs = [...t.refs, ...cascade(sql)].sort();
      continue;
    }
    const m = /CREATE TABLE (?:IF NOT EXISTS )?`?(\w+)`?\s*\(/i.exec(sql);
    if (!m) continue;
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < sql.length && depth > 0; i++) { if (sql[i] === '(') depth++; else if (sql[i] === ')') depth--; }
    const columns = new Set(), refs = [];
    for (const item of splitTop(sql.slice(start, i - 1)).map((x) => x.trim())) {
      refs.push(...cascade(item));
      if (/^(?:PRIMARY\s+KEY|UNIQUE|KEY\s+\w+\s*\(|INDEX|CONSTRAINT|FOREIGN\s+KEY|CHECK)/i.test(item)) continue;
      columns.add(item.match(/^`?(\w+)`?/)[1]);
    }
    tables.set(m[1], { columns, refs: refs.sort() });
  }
  return tables;
}

const ddl = (dialect) => parseDdl(MIGRATIONS.flatMap((m) => m[dialect]));

// Tables volontairement hors du périmètre d'un utilisateur : liste d'opposition (RGPD) et états OAuth éphémères
const NOT_OWNED = new Set(['blacklist', 'oauth_states', 'users', 'admin_audit']);
const shape = (tables) => Object.fromEntries([...tables].map(([t, v]) => [t, { columns: [...v.columns].sort(), refs: v.refs }]));

test('schémas SQLite et MySQL : mêmes tables et mêmes colonnes', () => {
  const sqlite = ddl('sqlite');
  const mysql = ddl('mysql');
  assert.ok(sqlite.size >= 10, 'le parseur doit voir les tables');
  assert.deepEqual([...mysql.keys()].sort(), [...sqlite.keys()].sort());
  for (const [t, v] of sqlite) assert.deepEqual([...mysql.get(t).columns].sort(), [...v.columns].sort(), `colonnes de ${t}`);
});

test('schémas : mêmes clés étrangères ON DELETE CASCADE des deux côtés', () => {
  const s = shape(ddl('sqlite')), m = shape(ddl('mysql'));
  for (const t of Object.keys(s)) assert.deepEqual(m[t].refs, s[t].refs, `FK de ${t}`);
  assert.deepEqual(m.prospects.refs, ['projects']);
  assert.deepEqual(m.prospect_notes.refs, ['prospects']);
  assert.deepEqual(m.projects.refs, ['users']);
  assert.deepEqual(m.jobs.refs, ['projects', 'users']);
});

test('multi-tenant : toute table métier descend d\'un utilisateur par cascade (donc la suppression de compte efface tout)', () => {
  for (const dialect of ['sqlite', 'mysql']) {
    const tables = ddl(dialect);
    const owned = (t, seen = new Set()) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return tables.get(t).refs.some((p) => p === 'users' || owned(p, seen));
    };
    for (const t of tables.keys()) {
      if (NOT_OWNED.has(t)) continue;
      assert.ok(owned(t), `${dialect} : ${t} n'est rattachée à aucun utilisateur`);
    }
    assert.ok(!tables.has('settings'), 'plus de réglages globaux');
    assert.ok(tables.get('user_settings').columns.has('user_id'));
  }
});

test('MySQL : InnoDB, utf8mb4, migrations rejouables', () => {
  for (const m of MIGRATIONS) {
    for (const sql of m.mysql.filter((x) => /CREATE TABLE/i.test(x))) {
      assert.match(sql, /ENGINE=InnoDB/);
      assert.match(sql, /CHARSET=utf8mb4/);
      assert.match(sql, /IF NOT EXISTS/, 'migration rejouable');
    }
    assert.ok(m.name);
  }
});

test('la base réellement migrée correspond au DDL déclaré', async () => {
  const db = await testDb();
  const declared = shape(ddl(db.dialect));
  const live = {};
  if (db.dialect === 'sqlite') {
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'").all();
    for (const { name } of tables) live[name] = (await db.query(`PRAGMA table_info(${name})`)).map((c) => c.name).sort();
  } else {
    const rows = await db.query(`SELECT table_name t, column_name c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name <> 'schema_migrations'`);
    for (const r of rows) (live[r.t ?? r.T] ||= []).push(r.c ?? r.C);
    for (const k of Object.keys(live)) live[k].sort();
  }
  assert.deepEqual(live, Object.fromEntries(Object.entries(declared).map(([t, v]) => [t, v.columns])));
  const v = await db.prepare('SELECT COUNT(*) n, MAX(version) v FROM schema_migrations').get();
  assert.equal(v.n, MIGRATIONS.length);
  assert.equal(v.v, MIGRATIONS.length);
  if (USING_MYSQL) {
    const t = await db.query("SELECT engine e FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'prospects'");
    assert.equal(t[0].e ?? t[0].ENGINE, 'InnoDB');
  }
});
