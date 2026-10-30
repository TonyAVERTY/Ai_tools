import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewTimes, parseVideoReview, reviewPromo } from '../src/services/promoqa.js';

test('voix : troisième agent sur spectrogramme, défaut audio bloquant',async()=>{
 const root=mkdtempSync(join(tmpdir(),'audio-review-'));
 const roles=[];
 const options={cfg:{},videoPath:'final.mp4',seconds:3,width:720,height:720,extraRoot:root,audioReport:{meanDb:-20,peakDb:-2},captureFrame:async()=>{},captureSpectrum:async()=>{},runAgent:async o=>{
  const isAudio=o.prompt.includes('Examine le rapport de niveau sonore');
  roles.push(isAudio?'audio':'video');
  for(const f of o.prompt.matchAll(/\d+\.\d{3} s : (.+\.(?:jpg|png))/g))o.onTool('Read',{file_path:f[1]});
  return {ok:true,text:JSON.stringify({approved:!isAudio,issues:isAudio?[{severity:'major',time:1,problem:'Bruit continu visible dans la pause',fix:'Régénérer et nettoyer la voix'}]:[]})};
 }};
 try{
  await assert.rejects(reviewPromo(options),/Bruit continu/);
  assert.deepEqual(roles,['video','video','audio']);
  assert.deepEqual(readdirSync(root),[]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('échantillonnage borné, fin et voisinage des phrases', () => {
  const t = reviewTimes(15, [{ t: 3 }]);
  assert.ok(t.includes(2.85) && t.includes(3.15) && t.includes(14.9));
  assert.ok(t.includes(0) && t.every((v, i) => i === 0 || v > t[i - 1]));
  assert.ok(reviewTimes(60, Array.from({ length: 20 }, (_, i) => ({ t: i * 3 }))).length <= 64);
  assert.throws(() => reviewTimes(NaN));
});

test('verdict strict et refus même si approved=true avec un défaut majeur', () => {
  assert.equal(parseVideoReview('{"approved":true,"issues":[]}', 'layout').approved, true);
  assert.equal(parseVideoReview(JSON.stringify({ approved: true, issues: [{ severity: 'major', time: 1, problem: 'Titre coupé', fix: 'Réduire le titre' }] }), 'layout').approved, false);
  for (const text of ['{}', '{"approved":"true","issues":[]}', '{"approved":true,"issues":[{}]}', 'pas de JSON']) assert.throws(() => parseVideoReview(text, 'motion'));
});

test('deux agents indépendants lisent le MP4, et les images sont nettoyées', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-test-'));
  const prompts = [];
  try {
    const r = await reviewPromo({ cfg: {}, videoPath: 'final.mp4', seconds: 3, width: 720, height: 720, extraRoot: root, captureFrame: async () => {}, runAgent: async (o) => {
      prompts.push(o.prompt);
      for (const file of o.prompt.matchAll(/\d+\.\d{3} s : (.+\.jpg)/g)) o.onTool('Read', { file_path: file[1] });
      return { ok: true, text: '{"approved":true,"issues":[]}' };
    } });
    assert.equal(r.reviews.length, 2);
    assert.equal(prompts.length, 2);
    assert.notEqual(prompts[0], prompts[1]);
    assert.deepEqual(readdirSync(root), []);
    await assert.rejects(reviewPromo({ cfg: {}, videoPath: 'final.mp4', seconds: 3, extraRoot: root, captureFrame: async () => {}, runAgent: async () => ({ ok: true, text: '{"approved":true,"issues":[]}' }) }), /pas inspecté/);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('refus de rendu et panne technique nettoient aussi les captures', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-refusal-'));
  const options = { cfg: {}, videoPath: 'final.mp4', seconds: 3, width: 720, height: 720, extraRoot: root, captureFrame: async () => {} };
  try {
    await assert.rejects(reviewPromo({ ...options, runAgent: async (o) => {
      for (const file of o.prompt.matchAll(/\d+\.\d{3} s : (.+\.jpg)/g)) o.onTool('Read', { file_path: file[1] });
      return { ok: true, text: JSON.stringify({ approved: false, issues: [{ severity: 'major', time: 1.5, problem: 'Titre masqué', fix: 'Séparer les plans' }] }) };
    } }), /Titre masqué/);
    assert.deepEqual(readdirSync(root), []);
    await assert.rejects(reviewPromo({ ...options, captureFrame: async () => { throw new Error('ffmpeg indisponible'); }, runAgent: async () => { throw new Error('ne doit pas être appelé'); } }), /ffmpeg indisponible/);
    assert.deepEqual(readdirSync(root), []);
    await assert.rejects(reviewPromo({ ...options, signal: AbortSignal.abort(), runAgent: async () => { throw new Error('ne doit pas être appelé'); } }), /Annulé/);
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
