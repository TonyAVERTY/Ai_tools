// Une durée par étape : le pourcentage animé d'un appel IA n'est pas une vitesse de travail.
const median = (xs) => { const s=xs.filter(Number.isFinite).sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null; };
const parse = (s, fallback={}) => {try{return JSON.parse(s||'null')||fallback;}catch{return fallback;}};
const phase = (type,message='') => {
 if(type!=='promo_video')return 'work';
 if(/cadrage|lisibilité/i.test(message))return 'layout';
 if(/montage|synchronisation/i.test(message))return 'motion';
 if(/Ajout de la voix/i.test(message))return 'mix';
 if(/Rendu de la vidéo/i.test(message))return 'render';
 if(/^Voix/i.test(message))return 'voice';
 return 'compose';
};
function defaults(job) {
 const p=parse(job.params_json), model=String(parse(job.progress_json).model||'').toLowerCase();
 const factor=/opus|fable/.test(model)?1.8:/sonnet/.test(model)?1.3:1;
 if(job.type==='promo_video'){
  const frames=Math.max(30,Math.min(1800,(Number(p.fps)||30)*(Number(p.seconds)||15)));
  const voice=[true,1,'1','true','on'].includes(p.voice), duration=Number(p.seconds)||15;
  return {compose:240*factor*Math.sqrt(duration/15),voice:voice?Math.max(30,duration*2):0,render:frames*.3*(p.format==='carre'?.5625:1),mix:voice?10:0,layout:120*factor,motion:120*factor};
 }
 const count=Math.max(1,Math.min(100,Number(p.count)||Number(p.target)||1));
 return {work:({analyze:180,audit:240,evolution:240,prospect:300,template:90,send:60,followup:60}[job.type]||120)*factor*(job.type==='prospect'?Math.max(1,count/20):1)};
}
function spans(job) {
 if(job.phaseDurations)return job.phaseDurations;
 const entries=parse(job.log_json,[]), out={};let current=job.type==='promo_video'?'compose':'work', at=Number(job.started_at)*1000;
 if(!entries.length){
  const base=defaults(job),total=Object.values(base).reduce((a,b)=>a+b,0),duration=Math.max(0,job.finished_at-job.started_at);
  return Object.fromEntries(Object.entries(base).map(([k,v])=>[k,total?duration*v/total:0]));
 }
 for(const e of entries){
  if(e.kind!=='progress')continue;
  const next=phase(job.type,e.text);
  if(next!==current){out[current]=(out[current]||0)+Math.max(0,(e.at-at)/1000);current=next;at=e.at;}
 }
 const end=Number(job.finished_at)*1000;
 if(end>at)out[current]=(out[current]||0)+(end-at)/1000;
 return out;
}
export function estimateJob(job, history=[], clock=Date.now()/1000) {
 if(job.status!=='running'||!job.started_at)return null;
 const baseline=defaults(job), keys=Object.keys(baseline), samples=history.filter(h=>h.status==='done'&&h.finished_at>h.started_at&&h.type===job.type&&(h.phaseDurations||parse(h.log_json,[]).length));
 const expected={...baseline};
 for(const key of keys){
  const ratios=samples.map(h=>{const prior=defaults(h)[key], actual=spans(h)[key];return prior>0&&actual>0?actual/prior:null;}).filter(x=>x!=null);
  if(ratios.length)expected[key]=baseline[key]*median(ratios);
 }
 const entries=parse(job.log_json,[]), progress=parse(job.progress_json), current=phase(job.type,progress.message);
 let start=Number(job.started_at), previous=job.type==='promo_video'?'compose':'work', run=[];
 for(const e of entries){
  if(e.kind!=='progress')continue;
  const next=phase(job.type,e.text);
  if(next!==previous){start=e.at/1000;run=[];previous=next;}
  if(next===current)run.push(e);
 }
 const elapsed=Math.max(0,clock-start), index=Math.max(0,keys.indexOf(current));
 let remaining=Math.max(expected[current]*.15,expected[current]-elapsed);
 // Les images sont des unités réelles : utiliser leur débit mesuré sur CETTE vidéo.
 if(current==='render'){
  const units=run.map(e=>{const m=/image (\d+)\/(\d+)/.exec(e.text);return m?{done:Number(m[1]),total:Number(m[2]),at:e.at/1000}:null;}).filter(Boolean);
  const last=units.at(-1);let first=units[0];
  for(let i=1;i<units.length;i++)if(units[i].done<units[i-1].done)first=units[i];
  if(last&&first&&last.done>first.done&&last.at>first.at)remaining=Math.max(0,(last.total-last.done)*(last.at-first.at)/(last.done-first.done)-(clock-last.at));
 }
 const future=keys.slice(index+1).reduce((n,k)=>n+expected[k],0);
 const seconds=Math.max(1,Math.ceil(remaining+future));
 return {remainingSeconds:seconds,estimatedAt:clock,expectedFinishAt:clock+seconds,source:samples.length?'history':'initial',samples:samples.length,revised:elapsed>(expected[current]||0)};
}
const caches=new WeakMap();
export async function attachJobEta(db,jobs){
 if(!caches.has(db))caches.set(db,new Map());
 const cache=caches.get(db);
 for(const job of jobs){
  if(job.status!=='running')continue;
  const key=`${job.user_id}/${job.type}`;
  if(!cache.has(key)||cache.get(key).expires<Date.now()){
   const history=await db.prepare("SELECT type,params_json,progress_json,log_json,started_at,finished_at,status FROM jobs WHERE user_id=? AND type=? AND status='done' AND finished_at>started_at ORDER BY id DESC LIMIT 30").all(job.user_id,job.type);
   cache.set(key,{expires:Date.now()+30_000,history:history.map(h=>({...h,phaseDurations:spans(h),log_json:undefined}))});
   if(cache.size>200)cache.delete(cache.keys().next().value);
  }
  job.eta=estimateJob(job,cache.get(key).history);
 }
 return jobs;
}
