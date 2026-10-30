import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startApp} from './helpers/server.js';
import {Worker,addUsage,latestJobs} from '../src/services/jobs.js';
import {addProject} from './helpers/users.js';

test('relance privée : mêmes paramètres, ancien échec conservé et double clic sans doublon',async()=>{
 const s=await startApp();
 try {
  const owner=await s.newUser(), other=await s.newUser();
  const params={subject:'Vidéo originale',voice:true,voiceName:'fr'};
  const source=await s.db.prepare("INSERT INTO jobs(user_id,type,status,params_json,created_at,error,tokens_in,tokens_out) VALUES(?,?,'error',?,?,'Erreur originale',120,30)").run(owner.id,'console_retry_test',JSON.stringify(params),Math.floor(Date.now()/1000));
  const id=Number(source.lastInsertRowid);
  assert.equal((await other.post(`/api/jobs/${id}/retry`)).status,404);
  assert.equal((await s.anon.post(`/api/jobs/${id}/retry`)).status,401);
  const before=await(await owner.get('/api/system')).json();
  assert.equal(before.jobs.find(j=>j.id===id)?.tokensUsed,150);
  const replies=await Promise.all([owner.post(`/api/jobs/${id}/retry`,{}),owner.post(`/api/jobs/${id}/retry`,{params:{subject:'modifié'}})]);
  assert.ok(replies.every(r=>r.status===200));
  const results=await Promise.all(replies.map(r=>r.json()));
  assert.equal(results[0].id,results[1].id);
  const fresh=await s.db.prepare('SELECT * FROM jobs WHERE id=?').get(results[0].id);
  assert.equal(fresh.status,'queued');assert.deepEqual(JSON.parse(fresh.params_json),params);
  assert.equal((await s.db.prepare('SELECT status FROM jobs WHERE id=?').get(id)).status,'error');
  const after=await(await owner.get('/api/system')).json();
  assert.ok(after.jobs.some(j=>j.id===fresh.id));
  assert.ok(!after.jobs.some(j=>j.id===id));
  assert.equal((await owner.post(`/api/jobs/${fresh.id}/retry`)).status,409);
  const state=await(await owner.get(`/api/jobs/${id}/log`)).json();
  assert.equal(state.tokensUsed,150);
 }finally{await s.close();}
});
test('tokens cumulés entre appels, disponibles pendant le job et après échec',async()=>{
 const s=await startApp();
 try {
  const owner=await s.newUser();
  const pid=await addProject(s.db,owner.id,{name:'Tokens',gitUrl:'https://github.com/u/test.git'});
  const r=await s.db.prepare("INSERT INTO jobs(user_id,project_id,type,status,created_at) VALUES(?,?,'token_test','running',1)").run(owner.id,pid);
  const id=Number(r.lastInsertRowid);
  const worker=new Worker(s.db,{token_test:async ctx=>{
   addUsage(ctx,{tokensIn:100,tokensOut:40});
   await new Promise(r=>setTimeout(r,20));
   const active=await(await owner.get(`/api/jobs/${id}/log`)).json();
   assert.equal(active.tokensUsed,140);
   addUsage(ctx,{tokensIn:60,tokensOut:20});
   throw new Error('Erreur après consommation');
  }},{log:{error(){}}});
  await worker.runJob(await s.db.prepare('SELECT * FROM jobs WHERE id=?').get(id));
  const job=(await latestJobs(s.db,pid)).token_test;
  assert.equal(job.status,'error');assert.equal(job.tokensUsed,220);
  assert.equal((await(await owner.get(`/api/jobs/${id}/log`)).json()).tokensUsed,220);
 }finally{await s.close();}
});
