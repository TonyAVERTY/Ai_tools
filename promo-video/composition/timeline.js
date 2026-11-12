// Montage MonEspacePro : tout est fonction du temps t (en secondes).
// render(t) est appelé image par image par render.mjs ; ?t=12.5 fige l'image à 12,5 s.
// ?p=ig (Reels) ou ?p=tt (TikTok) change les zones de sécurité ; ?guides=1 les affiche.
const Q = new URLSearchParams(location.search);
const P = Q.get('p') === 'tt' ? 'tt' : 'ig';

// Zones de sécurité. IG : marges tirées du guide Reels de Meta relayé par des tiers (haut 14 %, bas 35 %, côtés 6 %),
// appliquées par prudence au texte. TT : hypothèse (haut 210, bas 480, droite 140) à confirmer avec le gabarit officiel TikTok.
const G = P === 'tt'
  ? { left: 60, right: 140, top: 210, textBottomMax: 1440, visBottom: 1440 }
  : { left: 65, right: 65, top: 270, textBottomMax: 1248, visBottom: 1300 };
const TW = 1080 - G.left - G.right;          // largeur utile du texte
const CX = G.left + TW / 2;                  // centre horizontal du texte
const TEXT_H = 330;                          // hauteur réservée au titre
const VT = G.top + TEXT_H, VB = G.visBottom; // zone du visuel
const VH = VB - VT, CY = (VT + VB) / 2;
const K = P === 'tt' ? 1.2 : 1.45;           // objets hauts : on les laisse déborder sous la zone d'interface
const PEEK = VH * K, PCY = VT + PEEK / 2 + 6;

const GREEN = '#0E7A66', GREEN_L = '#EAF6F2', YELLOW = '#F2B544', BG = '#F6F6F3';
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const eOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const eBack = (x) => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const eInOut = (x) => { x = clamp(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

// Scènes : début, fin (s), fond, entrée.
const SC = [
  { id: 's1', a: 0.0, b: 2.4, bg: GREEN, enter: null },
  { id: 's2', a: 2.4, b: 5.8, bg: BG, enter: 'top' },
  { id: 's3', a: 5.8, b: 9.6, bg: GREEN, enter: 'right' },
  { id: 's4', a: 9.6, b: 13.4, bg: GREEN_L, enter: 'circle' },
  { id: 's5', a: 13.4, b: 17.4, bg: YELLOW, enter: 'left' },
  { id: 's6', a: 17.4, b: 20.6, bg: GREEN, enter: 'flash' },
  { id: 's7', a: 20.6, b: 23.4, bg: BG, enter: 'bottom' },
  { id: 's8', a: 23.4, b: 27.0, bg: GREEN, enter: 'circle' },
];
const DURATION = SC[SC.length - 1].b;

// ---------- texte : mots qui claquent un par un ----------
// lines : [[ [mot, début local, classe?], ... ], ...]
function buildText(el, lines, { dark = true, size = 128, y = G.top, w = TW, x = G.left } = {}) {
  el.classList.toggle('light', !dark);
  el.style.cssText += `left:${x}px;top:${y}px;width:${w}px;font-size:${size}px`;
  el.innerHTML = '';
  el._words = [];
  lines.forEach((line, i) => {
    line.forEach(([txt, t0, cls], j) => {
      const s = document.createElement('span');
      s.className = 'w' + (cls ? ' ' + cls : '');
      s.textContent = txt + (j < line.length - 1 ? ' ' : '');
      el.appendChild(s); el._words.push({ s, t0 });
    });
    if (i < lines.length - 1) el.appendChild(document.createElement('br'));
  });
}
function showText(el, lt, from = -9, to = 99) {
  const vis = lt >= from && lt < to;
  el.style.display = vis ? 'block' : 'none';
  if (!vis) return;
  for (const { s, t0 } of el._words) {
    const p = (lt - from - t0) / 0.2;
    const k = eBack(p);
    s.style.opacity = p > 0 ? Math.min(1, p * 6) : 0;
    s.style.transform = `scale(${1.45 - 0.45 * k})`;
  }
}

// ---------- images ----------
function put(el, { w, h, x = 0, y = 0, s = 1, r = 0, o = 1, cx = CX, cy = CY }) {
  const nat = el.naturalWidth / el.naturalHeight || 1;
  const H = h ?? w / nat, W = w ?? h * nat;
  el.style.width = W + 'px'; el.style.height = H + 'px';
  el.style.left = (cx - W / 2) + 'px'; el.style.top = (cy - H / 2) + 'px';
  el.style.opacity = o;
  el.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${s})`;
}
const hide = (el) => { el.style.opacity = 0; };
const shake = (lt, t0, amp = 8, dur = .22) => { const p = (lt - t0) / dur; return p > 0 && p < 1 ? Math.sin(p * 40) * amp * (1 - p) : 0; };
const punch = (lt, t0, from = 1.12, dur = .3) => { const p = (lt - t0) / dur; return p < 0 ? 1 : 1 + (from - 1) * (1 - eBack(p)); };

function burst(parent, lt, t0, cx, cy, n = 10, dist = 260, key = 'b') {
  parent._d = parent._d || {};
  if (!parent._d[key]) {
    parent._d[key] = [];
    for (let i = 0; i < n; i++) { const d = document.createElement('div'); d.className = 'dot'; parent.appendChild(d); parent._d[key].push(d); }
  }
  parent._d[key].forEach((d, i) => {
    const p = (lt - t0) / 0.55, a = (i / n) * Math.PI * 2 + 0.3, r = 16 + (i % 3) * 8;
    d.style.display = p > 0 && p < 1 ? 'block' : 'none';
    d.style.width = d.style.height = r + 'px';
    d.style.left = (cx + Math.cos(a) * dist * eOut(p) - r / 2) + 'px';
    d.style.top = (cy + Math.sin(a) * dist * eOut(p) - r / 2) + 'px';
    d.style.opacity = 1 - p;
  });
}
function ring(el, lt, t0, cx, cy, size = 520) {
  const p = (lt - t0) / 0.5;
  el.style.opacity = p > 0 && p < 1 ? 1 - p : 0;
  const d = size * (0.3 + 0.9 * eOut(p));
  el.style.width = el.style.height = d + 'px';
  el.style.left = (cx - d / 2) + 'px'; el.style.top = (cy - d / 2) + 'px';
}

// ---------- scènes ----------
function s1(lt) {
  const sc = $('s1');
  showText($('s1t'), lt);
  const swap = 1.0;
  const c7 = $('s1card'), c8 = $('s1card2');
  const H = PEEK, base = { h: H, cy: PCY, y: 0 };
  const bob = Math.sin(lt * 3) * 6;
  const k = lt < swap ? 1 + 0.03 * lt : punch(lt, swap, 1.14, .35);
  const dx = shake(lt, swap, 10);
  put(c7, { ...base, s: k, r: -3, x: dx, y: bob, o: lt < swap ? 1 : 0 });
  put(c8, { ...base, s: k, r: -3, x: dx, y: bob, o: lt >= swap ? 1 : 0 });
  const chip = $('s1plus'), cp = (lt - (swap + .05)) / .3;
  chip.style.opacity = cp > 0 ? 1 : 0;
  chip.style.transform = `translate(${CX + 40}px,${PCY - H / 2 + 120}px) scale(${.6 + .4 * eBack(cp)}) rotate(6deg)`;
  burst(sc, lt, swap, CX, VT + 380, 12, 330, 'a');
}

function s2(lt) {
  showText($('s2t'), lt);
  const card = $('s2card');
  const cardW = Math.min(900, TW);
  const cy = VT + 285;
  const drop = eBack(lt / .45);
  const words = [[1.0, 'Oubliée.'], [1.8, 'Perdue.'], [2.6, 'Jamais pleine.']];
  let sh = 0;
  for (const [t0] of words) sh += shake(lt, t0, 10);
  put(card, { w: cardW, cy, y: -900 * (1 - drop) + sh, r: -5 + 3 * Math.min(1, lt / 3) });
  const cur = [...words].reverse().find(([t0]) => lt >= t0);
  const big = $('s2big'), st = $('s2strike');
  if (cur) {
    const [t0, txt] = cur;
    big.textContent = txt; big.style.fontSize = '124px'; big.style.color = '#1C1C19';
    const p = (lt - t0) / .18;
    big.style.opacity = 1;
    const sc = 1.4 - .4 * eBack(p);
    big.style.transform = `scale(${sc})`;
    big.style.left = '0px'; big.style.top = '0px';
    const bw = big.offsetWidth, bh = big.offsetHeight, by = cy + 340;
    big.style.left = (CX - bw / 2) + 'px'; big.style.top = (by - bh / 2) + 'px';
    const sp = clamp((lt - t0 - .25) / .2);
    st.style.opacity = sp > 0 ? 1 : 0;
    st.style.width = (bw + 40) * eOut(sp) + 'px';
    st.style.left = (CX - bw / 2 - 20) + 'px'; st.style.top = (by - 8) + 'px';
    st.style.transform = 'rotate(-3deg)';
  } else { big.style.opacity = 0; st.style.opacity = 0; }
}

function s3(lt) {
  const sc = $('s3');
  showText($('s3a'), lt, -9, 1.9); showText($('s3b'), lt, 1.9, 99);
  const poster = $('s3poster');
  const H = VH * 1.08, CYP = VT + H / 2 + 6;
  const k = lt < 1.9 ? 1 : punch(lt, 1.9, 1.1, .3);
  put(poster, { h: H, cy: CYP, y: 0, r: 3, s: k, x: shake(lt, 1.9, 8) });
  // faisceau du scan : deux allers-retours sur la zone du QR
  const beam = $('s3beam'), W = H * poster.naturalWidth / poster.naturalHeight;
  const bp = clamp((lt - .35) / 1.4);
  const sweep = Math.abs(((bp * 2) % 2) - 1);
  beam.style.opacity = bp > 0 && bp < 1 ? 1 : 0;
  beam.style.width = W * .52 + 'px';
  beam.style.left = (CX - W * .26) + 'px';
  beam.style.top = (CYP - H / 2 + H * (.34 + .36 * sweep)) + 'px';
  const chip = $('s3chip'), cp = (lt - 2.2) / .3;
  chip.style.opacity = cp > 0 ? 1 : 0;
  chip.style.transform = `translate(${CX - 230}px,${VT + H - 150}px) scale(${.6 + .4 * eBack(cp)}) rotate(-4deg)`;
}

function s4(lt) {
  showText($('s4t'), lt);
  const art = $('s4art'), ph = $('s4phone');
  const t1 = 1.7;
  const a = clamp((lt - t1) / .3);
  const pop = eBack(lt / .35);
  put(art, { w: TW, cy: VT + 330, s: .6 + .4 * pop, x: -1300 * eInOut(a), o: lt < .02 ? 0 : 1, y: 0 });
  const H = PEEK;
  const pp = eOut((lt - t1) / .5);
  put(ph, { h: H, cy: PCY, y: 900 * (1 - pp), r: 0, s: punch(lt, t1 + .5, 1.06, .3), o: lt >= t1 ? 1 : 0 });
}

function s5(lt) {
  const sc = $('s5');
  showText($('s5a'), lt, -9, 1.3); showText($('s5b'), lt, 1.3, 2.6); showText($('s5c'), lt, 2.6, 99);
  const p1 = $('s5p1'), p2 = $('s5p2'), ok = $('s5ok'), beam = $('s5beam');
  const H = PEEK;
  // phase 1 : scanner
  put(p1, { h: H, cy: PCY, y: 0, s: lt < 1.3 ? 1 : .9, o: lt < 1.3 ? 1 : 0, x: lt < .3 ? 900 * (1 - eOut(lt / .3)) : 0 });
  const W1 = H * p1.naturalWidth / p1.naturalHeight;
  const bp = clamp((lt - .4) / .8), sw = Math.abs(((bp * 2) % 2) - 1);
  beam.style.opacity = bp > 0 && bp < 1 && lt < 1.3 ? 1 : 0;
  beam.style.width = W1 * .55 + 'px'; beam.style.left = (CX - W1 * .275) + 'px';
  beam.style.top = (PCY - H / 2 + H * (.3 + .25 * sw)) + 'px';
  // phase 2 : montant
  put(p2, { h: H, cy: PCY, y: 0, s: punch(lt, 1.3, 1.1, .3), o: lt >= 1.3 && lt < 2.6 ? 1 : 0, r: -2 });
  // phase 3 : crédité
  put(ok, { w: Math.min(880, TW), cy: VT + 330, s: punch(lt, 2.6, 1.25, .35), o: lt >= 2.6 ? 1 : 0, r: 2 });
  ring($('s5ring'), lt, 2.6, CX, VT + 330, 700);
  burst(sc, lt, 2.6, CX, VT + 330, 12, 380, 'c');
}

function s6(lt) {
  const sc = $('s6');
  showText($('s6a'), lt, -9, 1.75); showText($('s6b'), lt, 1.75, 99);
  const H = PEEK;
  const steps = [[0, 7], [.45, 8], [.9, 9], [1.35, 10]];
  const cur = [...steps].reverse().find(([t0]) => lt >= t0);
  for (const n of [7, 8, 9, 10]) {
    const el = $('s6c' + n), t0 = steps.find(s => s[1] === n)[0];
    const on = cur[1] === n;
    put(el, { h: H, cy: PCY, y: 0, s: on ? punch(lt, t0, n === 10 ? 1.2 : 1.1, .3) : 1, o: on ? 1 : 0, x: on ? shake(lt, t0, n === 10 ? 14 : 8) : 0, r: n === 10 ? -2 : -3 });
  }
  for (const [t0, n] of steps.slice(1)) ring($('s6ring'), lt, t0, CX, VT + 330, n === 10 ? 760 : 420);
  burst(sc, lt, 1.35, CX, VT + 330, 14, 400, 'd');
}

function s7(lt) {
  showText($('s7t'), lt);
  const f = $('s7f'), img = $('s7img');
  const H = PEEK, W = Math.min(TW * .66, 560);
  const e = eBack(lt / .4);
  f.style.width = W + 'px'; f.style.height = H + 'px';
  f.style.left = (CX - W / 2) + 'px'; f.style.top = (VT + 50) + 'px';
  f.style.transform = `scale(${.7 + .3 * e}) rotate(${-2 + 2 * eOut(lt / .6)}deg)`;
  f.style.opacity = clamp(lt / .1);
  const inner = W - 32;
  img.style.width = inner + 'px';
  const imgH = inner * 1730 / 1178;
  img.style.top = -Math.max(0, imgH - (H - 32)) * eInOut((lt - .5) / 2.2) + 'px';
  img.style.left = '0px';
  const d = $('s7demo');
  d.style.opacity = lt > .6 ? 1 : 0;
  d.style.transform = `translate(${CX - 190}px,${VT - 14}px)`;
}

function s8(lt) {
  const logo = $('s8logo'), name = $('s8name'), price = $('s8price'), sub = $('s8sub'), cta = $('s8cta');
  let y = G.top;
  const e1 = eBack(lt / .35);
  put(logo, { h: 170, cy: y + 85, s: .5 + .5 * e1, o: clamp(lt / .1) });
  y += 190;
  if (!name._built) { buildText(name, [[['MonEspace', 0], ['Pro', 0, 'y']]], { dark: false, size: 96, y, w: TW }); name._built = true; }
  name.innerHTML = ''; name._words = [];
  const nm = document.createElement('span'); nm.className = 'w'; nm.innerHTML = 'MonEspace<span style="color:#F2B544">Pro</span>';
  name.appendChild(nm); name._words.push({ s: nm, t0: .05 });
  name.style.top = y + 'px';
  showText(name, lt);
  y += 120;
  const n = Math.round(19 * eOut((lt - .3) / .8));
  price.style.cssText += `left:${G.left}px;top:${y}px;width:${TW}px`;
  price.innerHTML = `<span style="font-size:70px;font-weight:700">Dès </span>${lt > .3 ? n : ''} €<span style="font-size:70px;font-weight:700">/mois</span>`;
  price.style.opacity = lt > .3 ? 1 : 0;
  price.style.transform = `scale(${lt > 1.1 ? punch(lt, 1.1, 1.08, .3) : 1})`;
  y += 215;
  sub.style.cssText += `left:${G.left}px;top:${y}px;width:${TW}px;line-height:1.15`;
  sub.innerHTML = 'Sans engagement.<br>Prêt en quelques minutes.';
  sub.style.opacity = clamp((lt - 1.2) / .2);
  y += 175;
  const cp = (lt - 1.9) / .35;
  cta.style.opacity = cp > 0 ? 1 : 0;
  const cw = cta.offsetWidth, ch = cta.offsetHeight;
  const pulse = lt > 2.4 ? 1 + .03 * Math.sin((lt - 2.4) * 7) : 1;
  cta.style.transform = `translate(${CX - cw / 2}px,${y}px) scale(${(.6 + .4 * eBack(cp)) * pulse})`;
}

// ---------- texte des scènes (vouvoiement, comme le site) ----------
function init() {
  const L = (a, b) => [a, b];
  buildText($('s1t'), [[['1 ', -.3], ['scan', -.3, 'y']], [['=', .25], ['1 ', .25], ['tampon', .45, 'y']]], { dark: false, size: 150 });
  buildText($('s2t'), [[['Votre', 0], ['carte', .12]], [['en', .3], ['carton', .42, 'r'], ['?', .5]]], { size: 128 });
  buildText($('s3a'), [[['Le', 0], ['client', .1]], [['scanne', .3, 'y']]], { dark: false, size: 132 });
  buildText($('s3b'), [[['Aucune', 0], ['appli', .12, 'y']], [['à', .3], ['installer', .4]]], { dark: false, size: 132 });
  buildText($('s4t'), [[['La', 0], ['carte', .1], ['arrive', .2, 'y']], [['dans', .4], ['son', .5], ['Wallet', .6, 'y']]], { size: 118 });
  buildText($('s5a'), [[['Vous', 0], ['scannez', .15]]], { size: 132 });
  buildText($('s5b'), [[['Vous', 0], ['saisissez', .12]], [['le', .3], ['montant', .4]]], { size: 126 });
  buildText($('s5c'), [[['Crédité', 0]], [['en', .25], ['un', .3], ['scan', .4]]], { size: 132 });
  buildText($('s6a'), [[['Le', 0], ['10e', .15, 'y']], [['tampon', .3], ['?', .4]]], { dark: false, size: 132 });
  buildText($('s6b'), [[['Viennoiserie', 0, 'y']], [['offerte', .2, 'y']]], { dark: false, size: 132 });
  buildText($('s7t'), [[['Et', 0], ['vous', .1], ['voyez', .2]], [['qui', .35], ['revient', .45, 'y']]], { size: 118 });
  SC.forEach((s, i) => { const el = $(s.id); el.style.background = s.bg; el.style.zIndex = i + 1; });
  const scenes = { s1, s2, s3, s4, s5, s6, s7, s8 };
  SC.forEach(s => s.fn = scenes[s.id]);
  if (Q.get('guides')) {
    const g = (l, t, w, h) => { const d = document.createElement('div'); d.className = 'guide'; d.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${h}px`; $('cv').appendChild(d); };
    g(G.left, G.top, TW, G.textBottomMax - G.top);
  }
}

function enterTransform(s, lt) {
  const el = $(s.id);
  const p = clamp(lt / .28), e = eOut(p);
  el.style.transform = 'none'; el.style.clipPath = 'none';
  switch (s.enter) {
    case 'top': el.style.transform = `translateY(${-1920 * (1 - e)}px)`; break;
    case 'bottom': el.style.transform = `translateY(${1920 * (1 - e)}px)`; break;
    case 'right': el.style.transform = `translateX(${1080 * (1 - e)}px)`; break;
    case 'left': el.style.transform = `translateX(${-1080 * (1 - e)}px)`; break;
    case 'circle': el.style.clipPath = p < 1 ? `circle(${e * 1500}px at 50% 55%)` : 'none'; break;
  }
}

window.render = function (t) {
  t = Math.min(Math.max(t, 0), DURATION - 0.001);
  SC.forEach((s, i) => {
    const el = $(s.id);
    const next = SC[i + 1];
    // une scène reste dessinée tant que la suivante n'a pas fini d'entrer
    const on = t >= s.a && t < (next ? next.a + .32 : 1e9);
    el.classList.toggle('on', on);
    if (!on) return;
    const lt = t - s.a;
    enterTransform(s, lt);
    s.fn(Math.min(lt, s.b - s.a + .3));
  });
  // flash : cut vers la récompense (et petit éclat à chaque entrée de scène)
  let f = 0;
  SC.forEach(s => { const p = (t - s.a) / .14; if (s.enter === 'flash' && p > 0 && p < 1) f = Math.max(f, .8 * (1 - p)); });
  const p6 = (t - (17.4 + 1.35)) / .15; if (p6 > 0 && p6 < 1) f = Math.max(f, .6 * (1 - p6));
  const p1 = (t - 1.0) / .1; if (p1 > 0 && p1 < 1) f = Math.max(f, .35 * (1 - p1));
  $('flash').style.opacity = f;
};
window.DURATION = DURATION;

const imgs = [...document.images];
Promise.all([document.fonts.ready, ...imgs.map(i => i.decode().catch(() => {}))]).then(() => {
  init();
  window.READY = true;
  if (Q.get('t') !== null) window.render(parseFloat(Q.get('t')));
});
