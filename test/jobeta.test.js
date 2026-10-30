import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateJob} from '../src/services/jobeta.js';
const event=(t,text)=>({kind:'progress',at:t*1000,text});
const params=JSON.stringify({fps:30,seconds:30,format:'vertical',voice:false});
const history={type:'promo_video',status:'done',started_at:100,finished_at:910,params_json:params,progress_json:'{}',log_json:JSON.stringify([event(100,'Claude conçoit'),event(400,'Rendu de la vidéo : image 1/900'),event(760,'Agent de contrôle : cadrage et lisibilité'),event(820,'Agent de contrôle : montage et synchronisation')])};
const job={...history,status:'running',finished_at:null,log_json:'[]'};
test('prévision dès 0 %, historique calibré et compte à rebours',()=>{
 const start=estimateJob(job,[history],100),later=estimateJob(job,[history],200);
 assert.equal(start.remainingSeconds,810);assert.equal(later.remainingSeconds,710);
 assert.equal(start.source,'history');assert.equal(start.samples,1);
 assert.equal(estimateJob({...job,status:'queued'},[history],100),null);
 assert.equal(estimateJob({...job,status:'done'},[history],100),null);
});
test('rendu : vitesse réelle, contrôles finaux inclus et adaptation à un ralentissement',()=>{
 const render={...job,progress_json:JSON.stringify({pct:71,message:'Rendu de la vidéo : image 450/900'}),log_json:JSON.stringify([event(100,'Claude conçoit'),event(400,'Rendu de la vidéo : image 1/900'),event(580,'Rendu de la vidéo : image 450/900')])};
 const half=estimateJob(render,[history],580);
 assert.ok(half.remainingSeconds>=330&&half.remainingSeconds<=332);
 assert.ok(half.remainingSeconds<estimateJob(job,[history],100).remainingSeconds);
 const slow={...render,log_json:JSON.stringify([event(100,'Claude conçoit'),event(400,'Rendu de la vidéo : image 1/900'),event(800,'Rendu de la vidéo : image 450/900')])};
 assert.ok(estimateJob(slow,[history],800).remainingSeconds>half.remainingSeconds);
 const nearlyDone={...render,progress_json:JSON.stringify({pct:98,message:'Rendu de la vidéo : image 900/900'}),log_json:JSON.stringify([event(400,'Rendu de la vidéo : image 1/900'),event(760,'Rendu de la vidéo : image 900/900')])};
 assert.ok(estimateJob(nearlyDone,[history],760).remainingSeconds>=150);
});
test('demande : durée, fps et voix augmentent la prévision, sans historique inventé',()=>{
 const initial=estimateJob(job,[],100);
 const larger=estimateJob({...job,params_json:JSON.stringify({seconds:60,fps:30,voice:true})},[],100);
 assert.equal(initial.source,'initial');assert.ok(larger.remainingSeconds>initial.remainingSeconds);
 const square=estimateJob({...job,params_json:JSON.stringify({seconds:30,fps:30,format:'carre'})},[],100);
 assert.ok(square.remainingSeconds<initial.remainingSeconds);
});
