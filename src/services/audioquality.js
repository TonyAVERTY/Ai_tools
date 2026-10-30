import {spawn} from 'node:child_process';
import {SceneError} from './promovideo.js';

export const VOICE_FILTER='highpass=f=65,afftdn=nr=8:nf=-40,loudnorm=I=-16:TP=-1.5:LRA=11';
function command(cfg,args,signal){
 return new Promise((resolve,reject)=>{
  const child=spawn(cfg.ffmpegBin||'ffmpeg',args,{stdio:['ignore','ignore','pipe'],signal,timeout:60_000});
  let log='';child.stderr.on('data',chunk=>{log=(log+chunk).slice(-16000);});
  child.on('error',reject);child.on('close',code=>code===0?resolve(log):reject(new Error('Le traitement audio FFmpeg a échoué : '+log.trim().split('\n').at(-1))));
 });
}
export function parseAudioReport(log){
 const last=(pattern)=>[...log.matchAll(pattern)].at(-1)?.[1];
 const meanDb=Number(last(/mean_volume:\s*([-\w.]+)/g)),peakDb=Number(last(/max_volume:\s*([-\w.]+)/g));
 const raw=last(/Noise floor dB:\s*([-\w.]+)/g);
 if(!Number.isFinite(meanDb)||!Number.isFinite(peakDb)||meanDb<-60)throw new SceneError('Contrôle audio : voix absente, silencieuse ou trop faible. Régénère une voix intelligible.');
 if(peakDb>=-0.05)throw new SceneError('Contrôle audio : saturation détectée sur la voix. Réduis le niveau avant livraison.');
 return {meanDb,peakDb,noiseFloorDb:raw!=null&&Number.isFinite(Number(raw))?Number(raw):null};
}
export async function inspectAudio(cfg,file,{signal}={}){
 const log=await command(cfg,['-hide_banner','-nostats','-i',file,'-map','0:a:0','-vn','-af','astats=metadata=0:reset=0,volumedetect','-f','null','-'],signal);
 return parseAudioReport(log);
}
export async function cleanAudio(cfg,input,output,{signal}={}){
 const source=await inspectAudio(cfg,input,{signal});
 await command(cfg,['-v','error','-y','-i',input,'-map','0:a:0','-vn','-af',VOICE_FILTER,'-ar','48000','-ac','1','-c:a','pcm_s16le',output],signal);
 return {...await inspectAudio(cfg,output,{signal}),source,cleaned:true,noiseReductionDb:8,normalizationLufs:-16};
}
export async function audioSpectrum(cfg,videoPath,output,signal){
 await command(cfg,['-v','error','-y','-i',videoPath,'-filter_complex','[0:a:0]showspectrumpic=s=960x360:legend=1[s]','-map','[s]','-frames:v','1',output],signal);
}
