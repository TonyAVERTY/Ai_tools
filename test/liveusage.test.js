import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLiveUsage} from '../src/services/liveusage.js';
import {liveJobUsage,addUsage} from '../src/services/jobs.js';
import {startApp} from './helpers/server.js';
test('compteurs du flux : cache, sorties cumulatives et message final sans doublon',()=>{
 const seen=[],track=createLiveUsage(u=>seen.push(u));
 track({type:'stream_event',event:{type:'message_start',message:{id:'a',usage:{input_tokens:100,cache_read_input_tokens:200,cache_creation_input_tokens:30}}}});
 track({type:'stream_event',event:{type:'message_delta',usage:{output_tokens:10}}});
 track({type:'stream_event',event:{type:'message_delta',usage:{output_tokens:25}}});
 track({type:'assistant',message:{id:'a',usage:{input_tokens:100,cache_read_input_tokens:200,cache_creation_input_tokens:30,output_tokens:25}}});
 assert.deepEqual(seen.at(-1),{tokensIn:330,tokensOut:25});assert.equal(seen.length,3);
 track({type:'stream_event',event:{type:'message_start',message:{id:'b',usage:{input_tokens:50}}}});
 track({type:'stream_event',event:{type:'message_delta',usage:{output_tokens:5}}});
 assert.deepEqual(seen.at(-1),{tokensIn:380,tokensOut:30});
});
test('usage provisoire conservé, résultat final compté une seule fois et appels cumulés',()=>{
 const ctx={usage:{tokensIn:0,tokensOut:0,costUsd:0},persistUsage(){}};
 const live=liveJobUsage(ctx);
 live.update({tokensIn:100,tokensOut:10});live.update({tokensIn:100,tokensOut:20});
 assert.equal(ctx.usage.tokensIn+ctx.usage.tokensOut,120);
 const r={tokensIn:100,tokensOut:30,costUsd:.02};live.finish(r);addUsage(ctx,r);
 assert.deepEqual(ctx.usage,{tokensIn:100,tokensOut:30,costUsd:.02});
 addUsage(ctx,{tokensIn:10,tokensOut:5,costUsd:.01});
 assert.equal(ctx.usage.tokensIn+ctx.usage.tokensOut,145);
 const cancelled=liveJobUsage(ctx);cancelled.update({tokensIn:50,tokensOut:7});
 assert.equal(ctx.usage.tokensIn+ctx.usage.tokensOut,202);
});
test('activité légère : mesures fraîches, isolation et annulation sans requête de quota',async()=>{
 let external=0;
 const s=await startApp({fetch:async()=>{external++;throw new Error('Quota indisponible');}});
 try{
  const owner=await s.newUser(), other=await s.newUser();
  const r=await s.db.prepare("INSERT INTO jobs(user_id,type,status,created_at,progress_json,tokens_in,tokens_out) VALUES(?,'live_test','running',?, ?,100,10)").run(owner.id,Math.floor(Date.now()/1000),JSON.stringify({pct:10,message:'Lecture'}));
  const id=Number(r.lastInsertRowid);
  let snap=await(await owner.get('/api/jobs/activity')).json();
  assert.equal(snap.jobs[0].tokensUsed,110);assert.equal(external,0);
  await s.db.prepare('UPDATE jobs SET tokens_out=50,progress_json=? WHERE id=?').run(JSON.stringify({pct:40,message:'Rédaction'}),id);
  snap=await(await owner.get('/api/jobs/activity')).json();
  assert.equal(snap.jobs[0].tokensUsed,150);assert.equal(snap.jobs[0].progress.pct,40);
  assert.deepEqual((await(await other.get('/api/jobs/activity')).json()).jobs,[]);
  assert.equal((await s.anon.get('/api/jobs/activity')).status,401);
  assert.equal((await owner.post(`/api/jobs/${id}/cancel`)).status,200);
  assert.deepEqual((await(await owner.get('/api/jobs/activity')).json()).jobs,[]);
  assert.equal((await s.db.prepare('SELECT tokens_out FROM jobs WHERE id=?').get(id)).tokens_out,50);
  assert.equal(external,0);
 }finally{await s.close();}
});
