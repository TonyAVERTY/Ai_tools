// Boîte à outils et scène de référence des vidéos de promotion. Claude écrit la scène (un document HTML dont window.renderFrame(t) place tout à partir du
// temps) ; ce module lui donne ce qui fait la différence entre une diapositive terne et un vrai motion design :
//  - PROMO_STYLES : des directions artistiques complètes (couleurs en valeurs précises, traitement du fond), pour ne jamais partir d'un fond blanc vide ;
//  - PROMO_EXAMPLE : une scène complète et dessinée, qui montre les proportions, le mouvement continu et la structure à reprendre (le contenu vient du projet).
// Tout est versionné avec le code : aucune scène n'est jamais produite sans ces règles.

/** Directions artistiques. `fond` : dégradé du fond ; `encre` : texte ; `doux` : texte secondaire ; `a` et `b` : accents ; `carte` : surfaces. */
export const PROMO_STYLES = {
  sombre: { label: 'Sombre et lumineux', fond: ['#0a0f24', '#1a2250'], encre: '#f5f7ff', doux: '#a9b4e0', a: '#5b8cff', b: '#2dd4bf', carte: '#ffffff1a', note: 'fond nuit profond, halos de couleur qui dérivent, texte clair' },
  degrade: { label: 'Dégradé vif', fond: ['#4f46e5', '#db2777'], encre: '#ffffff', doux: '#ffe4f1', a: '#fde047', b: '#ffffff', carte: '#ffffff26', note: 'grand dégradé saturé, formes blanches translucides, accent jaune' },
  clair: { label: 'Clair et net', fond: ['#f4f7ff', '#dfe8ff'], encre: '#0b1230', doux: '#4a5578', a: '#2563eb', b: '#f97316', carte: '#ffffff', note: 'fond clair teinté (jamais blanc pur), cartes blanches ombrées, accents francs' },
  chaud: { label: 'Chaud et humain', fond: ['#2b1408', '#7a2e0e'], encre: '#fff6ec', doux: '#f3c9a5', a: '#ffb347', b: '#ff6b5e', carte: '#ffffff1f', note: 'tons chauds de cuivre et de braise, formes arrondies, accents orangés' },
};
export const PROMO_STYLE_IDS = ['auto', ...Object.keys(PROMO_STYLES)];

/** Direction retenue : celle demandée, sinon une direction stable choisie d'après le projet (même projet, même allure, sauf demande contraire). */
export function pickStyle(id, seed = '') {
  if (PROMO_STYLES[id]) return { id, ...PROMO_STYLES[id] };
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ids = Object.keys(PROMO_STYLES);
  const pick = ids[h % ids.length];
  return { id: pick, ...PROMO_STYLES[pick] };
}

/** Les couleurs de la direction, écrites pour le prompt (valeurs exactes à reprendre telles quelles). */
export function styleBrief(st) {
  return `Direction artistique imposée : « ${st.label} » (${st.note}).
Couleurs exactes : fond en dégradé ${st.fond[0]} → ${st.fond[1]} (jamais de fond blanc uni) ; texte ${st.encre} ; texte secondaire ${st.doux} ; accent 1 ${st.a} ; accent 2 ${st.b} ; surfaces ${st.carte}.`;
}

/**
 * Scène de référence : un plan d'accroche (texte cinétique), un plan « produit » (maquette d'écran qui monte), un plan « bénéfices » (3 lignes avec icônes
 * dessinées), un plan final (nom + adresse). Les proportions sont en U = 1 % du petit côté de l'image : la même scène tient en vertical, en paysage et en carré.
 * Le TEXTE de la scène (« PRODUIT », « Exemple… ») est un emplacement : le vrai contenu vient toujours du projet.
 */
export const PROMO_EXAMPLE = String.raw`<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:#0a0f24;font-family:system-ui,"Helvetica Neue",Arial,sans-serif}
#root{position:absolute;inset:0;overflow:hidden}
.abs{position:absolute;left:0;top:0;will-change:transform,opacity}
</style></head><body><div id="root"></div><script>
// ====== BOÎTE À OUTILS (à reprendre telle quelle) ======
const W=innerWidth,H=innerHeight,U=Math.min(W,H)/100,PORTRAIT=H>W,CX=W/2; // 1 U = 1 % du petit côté de l'image
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),lerp=(a,b,k)=>a+(b-a)*k;
const E={out:k=>1-Math.pow(1-k,3),inOut:k=>k<.5?4*k*k*k:1-Math.pow(-2*k+2,3)/2,expo:k=>k>=1?1:1-Math.pow(2,-10*k),
  back:k=>{const c=1.70158;return 1+(c+1)*Math.pow(k-1,3)+c*Math.pow(k-1,2)},
  elastic:k=>k<=0?0:k>=1?1:Math.pow(2,-10*k)*Math.sin((k*10-.75)*(2*Math.PI/3))+1};
const seg=(t,a,b)=>clamp((t-a)/(b-a));                    // progression 0→1 entre a et b secondes
const pulse=(t,a,b)=>Math.sin(seg(t,a,b)*Math.PI);        // 0→1→0
const root=document.getElementById('root');
// el() crée un élément ABSOLU en haut à gauche et mesure sa taille tout de suite (n._w, n._h) : on le place ensuite UNIQUEMENT avec put().
function el(tag,css,parent,html){const n=document.createElement(tag);n.className='abs';Object.assign(n.style,css||{});if(html!=null)n.innerHTML=html;(parent||root).appendChild(n);n._w=n.offsetWidth;n._h=n.offsetHeight;return n}
function put(n,{x=0,y=0,s=1,r=0,o=1,blur=0}={}){n.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) rotate('+r.toFixed(2)+'deg) scale('+s.toFixed(3)+')';n.style.opacity=o.toFixed(3);n.style.filter=blur>.1?'blur('+blur.toFixed(1)+'px)':'none';n.style.visibility=o<=.003?'hidden':'visible'}
function words(text,css){return text.split(' ').map(w=>el('div',Object.assign({whiteSpace:'nowrap',fontWeight:'800'},css),root,w))}
function flow(ws,y,size,gap,maxW){const rows=[[]];let w=0;ws.forEach(n=>{n.style.fontSize=size+'px';n._w=n.offsetWidth;if(w+n._w>maxW&&rows[rows.length-1].length){rows.push([]);w=0}rows[rows.length-1].push(n);w+=n._w+gap});
  rows.forEach((r,i)=>{const tw=r.reduce((a,n)=>a+n._w,0)+gap*(r.length-1);let x=CX-tw/2;r.forEach(n=>{n._x=x;n._y=y+i*size*1.15;x+=n._w+gap})});return rows.length*size*1.15}
// ====== DIRECTION ARTISTIQUE (couleurs exactes données dans la consigne) ======
const C={f1:'#0a0f24',f2:'#1a2250',ink:'#f5f7ff',soft:'#a9b4e0',a:'#5b8cff',b:'#2dd4bf',card:'rgba(255,255,255,.10)',onA:'#06112a'}; // onA : texte posé sur la couleur d'accent
// ====== FOND VIVANT (toujours présent, ne s'arrête jamais) ======
const bg=el('div',{width:W+'px',height:H+'px',background:'linear-gradient(160deg,'+C.f1+','+C.f2+')'});
const ORB=[[.2,.25,.9,C.a],[.85,.7,1.0,C.b],[.55,.95,.8,C.a]];
const orbs=ORB.map(([x,y,r,c])=>el('div',{width:W*r+'px',height:W*r+'px',borderRadius:'50%',background:'radial-gradient(circle,'+c+'66,transparent 68%)'}));
const grid=el('div',{width:W+'px',height:H+7*6*U+'px',backgroundImage:'linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px)',backgroundSize:6*U+'px '+6*U+'px'});
// ====== PLAN 1 (0–5 s) : ACCROCHE, texte cinétique mot par mot ======
const kick=el('div',{padding:1.6*U+'px '+3.4*U+'px',borderRadius:'99px',background:C.card,color:C.soft,fontSize:3.6*U+'px',fontWeight:'700',letterSpacing:'.04em',whiteSpace:'nowrap'},root,'EXEMPLE · remplace par le sujet');
const hook=words('Le problème, dit avec les mots du public',{color:C.ink});hook[3].style.color=C.b;
const hookSize=(PORTRAIT?11:8)*U,hookH=flow(hook,0,hookSize,2.6*U,W*.88);
const bar=el('div',{width:22*U+'px',height:1.3*U+'px',borderRadius:'99px',background:C.b});
// ====== PLAN 2 (5–12 s) : LE PRODUIT, maquette d'écran qui monte ======
const PW=Math.min(56*U,H*.78/1.85),PH=PW*1.85,PX=PORTRAIT?CX:W*.3; // en paysage, la maquette passe à gauche et le texte à droite
const phone=el('div',{width:PW+'px',height:PH+'px',borderRadius:PW*.13+'px',background:'#0d1330',border:PW*.03+'px solid #e8edff',boxShadow:'0 '+4*U+'px '+10*U+'px rgba(0,0,0,.45)',overflow:'hidden',boxSizing:'border-box'});
const rows=[0,1,2].map(i=>el('div',{width:PW*.78+'px',height:PH*.15+'px',borderRadius:PW*.06+'px',background:i==0?C.a:C.card,left:PW*.11+'px',top:PH*(.16+i*.2)+'px'},phone,'<div style="position:absolute;left:12%;top:30%;width:50%;height:14%;border-radius:9px;background:rgba(255,255,255,.8)"></div><div style="position:absolute;left:12%;top:58%;width:30%;height:12%;border-radius:9px;background:rgba(255,255,255,.4)"></div>'));
const cap=el('div',{color:C.ink,fontSize:(PORTRAIT||W===H?5.6:7)*U+'px',fontWeight:'800',textAlign:PORTRAIT?'center':'left',width:(PORTRAIT?Math.min(W*.84,70*U):W*.4)+'px',lineHeight:'1.15',overflowWrap:'anywhere'},root,'PRODUIT : ce que c’est, en une phrase');
// ====== PLAN 3 (12–19 s) : BÉNÉFICES, 3 lignes avec icône dessinée ======
const head3=el('div',{color:C.soft,fontSize:4.4*U+'px',fontWeight:'700',whiteSpace:'nowrap',letterSpacing:'.03em'},root,'Ce que ça change');
const RW=PORTRAIT?W*.9:Math.min(W*.7,130*U),RH=(PORTRAIT?15:13)*U;
const feats=['Premier bénéfice concret','Deuxième bénéfice concret','Troisième bénéfice concret'].map((txt,i)=>{
  const row=el('div',{width:RW+'px',height:RH+'px',borderRadius:5*U+'px',background:C.card});
  const ic=el('div',{width:9*U+'px',height:9*U+'px',borderRadius:'50%',background:i==1?C.b:C.a,left:3*U+'px',top:3*U+'px'},row,'<svg viewBox="0 0 24 24" width="100%" height="100%"><path class="ck" d="M6 12.5l4 4 8-9" fill="none" stroke="'+C.onA+'" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="20" stroke-dashoffset="20"/></svg>');
  el('div',{left:15*U+'px',top:RH/2-3.4*U+'px',color:C.ink,fontSize:5*U+'px',fontWeight:'700',whiteSpace:'normal',width:RW-18*U+'px',lineHeight:'1.15'},row,txt);
  return {row,ic,ck:ic.querySelector('.ck')}});
// ====== PLAN 4 (19–25 s) : FINAL, nom + promesse + adresse ======
const name=el('div',{color:C.ink,fontSize:(PORTRAIT?15:12)*U+'px',fontWeight:'900',whiteSpace:'normal',width:W*.86+'px',textAlign:'center',overflowWrap:'anywhere',letterSpacing:'-.02em'},root,'PRODUIT');
const tag=el('div',{color:C.soft,fontSize:5*U+'px',fontWeight:'600',whiteSpace:'normal',width:W*.86+'px',textAlign:'center'},root,'La promesse, en une ligne');
const url=el('div',{padding:2.6*U+'px '+6*U+'px',borderRadius:'99px',background:C.a,color:C.onA,fontSize:5.2*U+'px',fontWeight:'800',whiteSpace:'normal',maxWidth:W*.76+'px',boxSizing:'border-box',overflowWrap:'anywhere',textAlign:'center'},root,'adresse-du-site.fr');
// Empilement depuis les hauteurs réelles : un nom sur deux lignes ne chevauche jamais la promesse.
const FINAL_GAP=6*U,FINAL_H=name._h+tag._h+url._h+2*FINAL_GAP,FINAL_Y=(H-FINAL_H)/2;
// ====== LA SCÈNE : tout est une fonction de t, rien d'autre ======
window.renderFrame=function(t){
  // fond vivant : halos qui dérivent, grille qui défile, respiration lente
  const cam=1+.04*Math.sin(t*.35);put(bg);
  orbs.forEach((o,i)=>put(o,{x:W*ORB[i][0]-W*ORB[i][2]/2+Math.sin(t*.5+i*2)*6*U,y:H*ORB[i][1]-W*ORB[i][2]/2+Math.cos(t*.4+i)*8*U,s:cam}));
  put(grid,{y:-(t*2.4*U)%(6*U)});
  // plan 1 : accroche
  const k1=seg(t,-.6,0),out1=E.inOut(seg(t,4.4,5)); // accroche déjà présente sur la première image
  put(kick,{x:CX-kick._w/2,y:H*.5-hookH/2-12*U+(1-E.out(k1))*3*U,o:E.out(k1)*(1-out1)});
  hook.forEach((n,i)=>{const k=E.back(seg(t,.35+i*.2,.95+i*.2));put(n,{x:n._x,y:H*.5-hookH/2+n._y+(1-k)*9*U-out1*7*U+Math.sin(t*1.3+i*.6)*.5*U,s:.6+.4*k,o:clamp(k)*(1-out1),blur:(1-clamp(k))*6})});
  put(bar,{x:CX-11*U,y:H*.5+hookH/2+4*U,s:1,o:(1-out1)*seg(t,1.8,2.2)});bar.style.width=22*U*E.expo(seg(t,1.8,2.8))+'px';
  // plan 2 : produit
  const in2=seg(t,5,6.4),out2=E.inOut(seg(t,11.4,12.1));
  put(phone,{x:PX-PW/2,y:lerp(H*1.05,H*.5-PH/2-(PORTRAIT?6*U:0),E.out(in2))-out2*H*.25,r:lerp(-8,0,E.expo(in2))+Math.sin(t*1.3)*.8,o:E.out(in2)*(1-out2)});
  rows.forEach((r,i)=>{const k=E.back(seg(t,6+i*.35,6.8+i*.35));put(r,{x:(1-k)*PW*.5,y:Math.sin(t*1.6+i)*.6*U,o:clamp(k)})});
  put(cap,{x:PORTRAIT?CX-cap._w/2:W*.52,y:(PORTRAIT?H*.5+PH/2-2*U:H*.5-cap._h/2)+(1-E.out(seg(t,6.6,7.4)))*4*U+Math.sin(t*1.2)*.5*U,o:E.out(seg(t,6.6,7.4))*(1-out2)});
  // plan 3 : bénéfices
  const out3=seg(t,18.3,19);
  put(head3,{x:CX-head3._w/2,y:H*.5-RH*2.3,o:E.out(seg(t,12.1,12.8))*(1-out3)});
  feats.forEach((f,i)=>{const s0=12.6+i*1.6,k=E.back(seg(t,s0,s0+.7)),o=clamp(k)*(1-out3);
    put(f.row,{x:CX-RW/2+(1-k)*8*U,y:H*.5-RH*1.35+i*(RH*1.25)+Math.sin(t*1.4+i*1.7)*.5*U,o});f.ck.style.strokeDashoffset=20*(1-E.out(seg(t,s0+.35,s0+.9)));
    put(f.ic,{s:1+.1*pulse(t,s0+.3,s0+1)})});
  // plan 4 : final
  const in4=seg(t,19.2,20.1);
  put(name,{x:CX-name._w/2,y:FINAL_Y+(1-E.expo(in4))*6*U+Math.sin(t*1.2)*.6*U,s:.85+.15*E.back(in4),o:E.out(in4)});
  put(tag,{x:CX-tag._w/2,y:FINAL_Y+name._h+FINAL_GAP+(1-E.out(seg(t,19.6,20.4)))*3*U+Math.sin(t*1.2+.5)*.5*U,o:E.out(seg(t,19.6,20.4))});
  put(url,{x:CX-url._w/2,y:FINAL_Y+name._h+tag._h+2*FINAL_GAP+Math.sin(t*1.2+1)*.5*U,s:1+.04*Math.sin(t*3),o:E.out(seg(t,20.2,21))});
};
</script></body></html>`;


const lumOf = (hex) => { const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

/** La scène de référence aux couleurs de la direction choisie (mêmes proportions, même structure). */
export function exampleFor(st, seconds = 25) {
  const duration = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Number(seconds) : 25;
  const onA = lumOf(st.a) > 0.55 ? '#0b1230' : '#ffffff';
  const C = `const C={f1:'${st.fond[0]}',f2:'${st.fond[1]}',ink:'${st.encre}',soft:'${st.doux}',a:'${st.a}',b:'${st.b}',card:'${st.carte}',onA:'${onA}'};`;
  return PROMO_EXAMPLE
    .replace('window.renderFrame=function(t){', `window.renderFrame=function(t){\n  t = Math.max(0, Math.min(${duration}, t)) * 25 / ${duration}; // une seule conversion : ne recale pas chaque constante séparément\n`)
    .replace(/const C=\{[^}]*\};/, C)
    .replace('background:#0a0f24;', `background:${st.fond[0]};`);
}

