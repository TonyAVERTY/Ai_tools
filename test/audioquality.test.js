import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cleanAudio,inspectAudio,parseAudioReport,audioSpectrum} from '../src/services/audioquality.js';
import {prepareVoice,cleanVoice,audioDuration} from '../src/services/voiceover.js';
const ffmpeg=process.env.FFMPEG_AUDIO_TEST||'ffmpeg', cfg={ffmpegBin:ffmpeg};
const available=spawnSync(ffmpeg,['-version']).status===0;
const run=(args)=>{const r=spawnSync(ffmpeg,args,{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stderr;};
test('contrôle audio : silence, saturation et rapport absent refusés',()=>{
 assert.throws(()=>parseAudioReport('mean_volume: -inf dB\nmax_volume: -inf dB'),/voix absente/);
 assert.throws(()=>parseAudioReport('mean_volume: -10 dB\nmax_volume: 0 dB'),/saturation/);
 assert.throws(()=>parseAudioReport('aucune mesure'),/voix absente/);
 assert.deepEqual(parseAudioReport('mean_volume: -20 dB\nmax_volume: -2 dB'),{meanDb:-20,peakDb:-2,noiseFloorDb:null});
});
test('FFmpeg réel : nettoyage, niveau, rejet du silence, durée et spectrogramme', {skip:!available&&'FFmpeg absent'}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),'audio-qa-test-'));let prepared;
 try{
  const input=join(dir,'source.wav'),output=join(dir,'clean.wav'),silent=join(dir,'silent.wav');
  run(['-v','error','-y','-f','lavfi','-i','aevalsrc=0.12*sin(2*PI*440*t)+0.02*sin(2*PI*50*t):s=48000:d=3',input]);
  const report=await cleanAudio(cfg,input,output);
  assert.ok(report.cleaned&&report.meanDb>-30&&report.peakDb<-.1);
  const band=(file,frequency)=>Number([...run(['-hide_banner','-i',file,'-af',`bandpass=f=${frequency}:width_type=h:width=15,volumedetect`,'-f','null','-']).matchAll(/mean_volume:\s*([-\d.]+)/g)].at(-1)[1]);
  const before=band(input,440)-band(input,50),after=band(output,440)-band(output,50);
  assert.ok(after>before+3,`Rapport signal/ronflement : ${before} -> ${after}`);
  assert.ok(Math.abs(await audioDuration(cfg,input)-await audioDuration(cfg,output))<.1);
  await audioSpectrum(cfg,output,join(dir,'spectrum.png'));
  assert.ok(existsSync(join(dir,'spectrum.png')));
  run(['-v','error','-y','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','1',silent]);
  await assert.rejects(inspectAudio(cfg,silent),/voix absente/);
  prepared=await prepareVoice({cfg,segments:[{t:0,text:'Une phrase de test.'}],voice:{provider:'piper',voice:'test'},seconds:5,synth:async()=>readFileSync(input)});
  assert.ok(prepared.placed[0].file.endsWith('.clean.wav'));
  assert.ok(prepared.placed[0].audioReport.cleaned);
  assert.ok(prepared.placed[0].dur>2.9&&prepared.placed[0].dur<3.1);
 }finally{cleanVoice(prepared);rmSync(dir,{recursive:true,force:true});}
});
