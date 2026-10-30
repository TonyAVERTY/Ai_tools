import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers/server.js';
import { createJobLog, safeLogText, LOG_LIMIT } from '../src/services/joblog.js';
import { Worker } from '../src/services/jobs.js';

test('journal ordonné, sorties sensibles masquées et taille bornée', async () => {
 const snapshots = [];
 const db = { prepare: () => ({ run: async (text) => snapshots.push(JSON.parse(text)) }) };
 const log = createJobLog(db, 1);
 log.append('progress', 'Analyse');log.append('progress', 'Analyse');
 log.append('output', 'api_key=abcdef password: xyz sk-abcdefghijklmnopqrstuv');
 await log.flush();
 assert.equal(snapshots.at(-1).length, 2);
 assert.doesNotMatch(JSON.stringify(snapshots.at(-1)), /abcdef|xyz|sk-abcdefghijkl/);
 for(let i=0;i<20;i++) log.append('output', 'x'.repeat(19_000));
 await log.flush();
 const entries=snapshots.at(-1);
 assert.ok(entries.reduce((n,e)=>n+e.text.length,0)<=LOG_LIMIT);
 assert.ok(entries[0].id>1);
 assert.equal(safeLogText('\x1b[31mbonjour\x1b[0m'),'bonjour');
});

test('console privée, historique conservé, filtre de curseur et sorties du worker', async () => {
 const s=await startApp();
 try {
  const owner=await s.newUser(), other=await s.newUser();
  const insert=await s.db.prepare("INSERT INTO jobs(user_id,type,status,created_at) VALUES(?,?,'running',?)").run(owner.id,'console_test',1);
  const id=Number(insert.lastInsertRowid);
  const row=await s.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const worker=new Worker(s.db,{ console_test:async ctx=>{
    await ctx.progress({message:'Lecture du dépôt',pct:20});
    ctx.log('tool','Lecture : app.js');ctx.log('output','<script>alert(1)</script>');
    return {ok:true};
  }});
  await worker.runJob(row);
  const response=await owner.get(`/api/jobs/${id}/log`);
  assert.equal(response.status,200);
  const state=await response.json();
  assert.equal(state.status,'done');
  assert.ok(state.entries.some(e=>e.text==='Lecture : app.js'));
  assert.ok(state.entries.some(e=>e.text==='Tâche terminée'));
  assert.ok(state.entries.some(e=>e.text==='<script>alert(1)</script>'));
  const tail=await(await owner.get(`/api/jobs/${id}/log?after=${state.entries.at(-1).id}`)).json();
  assert.deepEqual(tail.entries,[]);
  const page=await owner.get(`/jobs/${id}`,{headers:{accept:'text/html'}});
  assert.equal(page.status,200);
  assert.match(await page.text(),/data-job-console/);
  assert.equal((await other.get(`/api/jobs/${id}/log`)).status,404);
  assert.equal((await other.get(`/jobs/${id}`)).status,404);
  assert.equal((await s.anon.get(`/api/jobs/${id}/log`)).status,401);
  const fail=await s.db.prepare("INSERT INTO jobs(user_id,type,status,created_at) VALUES(?,?,'running',?)").run(owner.id,'console_fail',1);
  await new Worker(s.db,{console_fail:async()=>{throw new Error('Erreur de test');}},{log:{error(){}}}).runJob(await s.db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(fail.lastInsertRowid)));
  const failed=await(await owner.get(`/api/jobs/${fail.lastInsertRowid}/log`)).json();
  assert.equal(failed.status,'error');assert.ok(failed.entries.some(e=>e.kind==='error'));
 }finally{await s.close();}
});
