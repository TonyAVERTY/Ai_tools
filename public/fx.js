// Lancement d'une tâche : le bouton « s'enfonce », puis deux traits pointillés bleus (un vertical, un horizontal) le relient au menu « Activité »
// (en haut à droite), qui s'ouvre sur la liste des tâches en cours et à venir comme la bulle de téléchargement de Chrome ; un petit agent Claude
// marche le long des traits en poussant une brouette jusqu'à la ligne de la nouvelle tâche.
// Tout est dessiné en SVG et animé avec l'API Web Animations : aucun attribut de style dans le balisage (CSP). Aucun écouteur global : le module ne fait rien tant qu'on ne l'appelle pas.
(() => {
  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 132;
  const H = 76;

  // L'agent : un petit personnage rond coiffé d'une étincelle, qui pousse une brouette portant un colis.
  const AGENT = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="${NS}" focusable="false">
    <ellipse class="fx-shadow" cx="66" cy="72" rx="52" ry="3.5"></ellipse>
    <g class="fx-barrow">
      <path class="fx-handle" d="M62 40 L38 44 M62 46 L38 48"></path>
      <path class="fx-leg" d="M70 56 L66 70"></path>
      <path class="fx-tray" d="M58 36 L114 36 L103 58 L68 58 Z"></path>
      <g class="fx-parcel"><rect x="72" y="22" width="24" height="16" rx="3"></rect><path d="M84 22 V38 M72 30 H96"></path></g>
      <path class="fx-leg" d="M104 58 L112 62"></path>
      <g class="fx-wheel"><circle class="fx-tire" cx="112" cy="63" r="9"></circle><path class="fx-spoke" d="M112 54 V72 M103 63 H121 M105.6 56.6 L118.4 69.4 M118.4 56.6 L105.6 69.4"></path><circle class="fx-hub" cx="112" cy="63" r="2.2"></circle></g>
    </g>
    <g class="fx-guy">
      <path class="fx-limb fx-leg-a" d="M24 54 L18 70"></path>
      <path class="fx-limb fx-leg-b" d="M32 54 L38 70"></path>
      <circle class="fx-body" cx="28" cy="40" r="15"></circle>
      <path class="fx-limb" d="M38 44 L50 43"></path>
      <circle class="fx-eye" cx="22.5" cy="38" r="3.2"></circle><circle class="fx-eye" cx="33.5" cy="38" r="3.2"></circle>
      <circle class="fx-pupil" cx="23.5" cy="38.4" r="1.4"></circle><circle class="fx-pupil" cx="34.5" cy="38.4" r="1.4"></circle>
      <path class="fx-smile" d="M23 45 Q28 49 33 45"></path>
      <g class="fx-sparkle"><path d="M28 12 V24 M22 14 L34 22 M34 14 L22 22 M21 18 H35"></path></g>
    </g>
  </svg>`;

  const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; };
  const visible = (el) => !!el && !el.hidden && !el.closest('[hidden]') && el.getBoundingClientRect().width > 0;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
  const wait = (anim) => anim.finished.catch(() => {});

  /** Le bouton s'enfonce et une onde part de son centre. Sans mouvement (réglage système) : rien. */
  function press(el) {
    if (!el || calm() || !el.isConnected) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.92)', offset: 0.35 }, { transform: 'scale(1.04)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 340, easing: 'ease-out' });
    const r = el.getBoundingClientRect();
    const ring = document.createElement('span');
    ring.className = 'fx-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.style.left = `${r.left + r.width / 2}px`;
    ring.style.top = `${r.top + r.height / 2}px`;
    ring.style.width = ring.style.height = `${Math.max(r.width, r.height)}px`;
    document.body.append(ring);
    wait(ring.animate([{ transform: 'translate(-50%, -50%) scale(.4)', opacity: 0.55 }, { transform: 'translate(-50%, -50%) scale(1.7)', opacity: 0 }], { duration: 520, easing: 'ease-out' })).then(() => ring.remove());
  }

  function bump(el) {
    if (!el || calm()) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'scale(.96)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
  }

  /**
   * Deux traits pointillés bleus (un vertical, un horizontal) relient le bouton `from` à la destination `to` (la ligne de la tâche dans le menu
   * « Activité », à défaut le bouton Activité) ; l'agent marche le long du trait en poussant sa brouette, puis y dépose son colis. Résolu à son arrivée.
   * @param {HTMLElement} from
   * @param {HTMLElement|null} [to]
   * @returns {Promise<void>}
   */
  async function launch(from, to = null) {
    const target = [to, document.querySelector('#jobs .jobs-btn'), document.querySelector('.top-r')].find(visible);
    if (!target) return;
    if (calm() || !from || !from.isConnected) { bump(document.querySelector('#jobs .jobs-btn') || target); return; }
    const fr = from.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const end = { x: tr.left + tr.width / 2 < fr.left + fr.width / 2 ? tr.right : tr.left, y: tr.top + tr.height / 2 }; // bord de la cible tourné vers le bouton
    const goesUp = end.y < fr.top + fr.height / 2;
    const a0 = { x: fr.left + fr.width / 2, y: goesUp ? fr.top : fr.bottom };
    const sy = end.y < a0.y ? -1 : 1;
    const sx = end.x < a0.x ? -1 : 1;
    const lv = Math.abs(end.y - a0.y); // trait vertical : du bouton jusqu'à la hauteur de la cible
    const lh = Math.abs(end.x - a0.x); // trait horizontal : jusqu'à la cible
    const total = lv + lh;
    if (total < 8) { bump(target); return; }
    const dur = Math.round(Math.min(2200, Math.max(1100, 700 + total * 0.9)));

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'fx-trail');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', String(innerWidth));
    svg.setAttribute('height', String(innerHeight));
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', 'fx-dash');
    const dotA = document.createElementNS(NS, 'circle');
    dotA.setAttribute('class', 'fx-dot');
    dotA.setAttribute('r', '5');
    dotA.setAttribute('cx', String(a0.x));
    dotA.setAttribute('cy', String(a0.y));
    const dotB = document.createElementNS(NS, 'circle');
    dotB.setAttribute('class', 'fx-dot');
    dotB.setAttribute('r', '5');
    dotB.setAttribute('cx', String(end.x));
    dotB.setAttribute('cy', String(end.y));
    dotB.style.opacity = '0';
    svg.append(path, dotA, dotB);
    const node = document.createElement('div');
    node.className = 'fx-agent';
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = AGENT;
    document.body.append(svg, node);

    // Marche : la roue tourne, les jambes alternent, le personnage rebondit
    const cycle = { duration: 380, iterations: Infinity };
    const loops = [
      node.querySelector('.fx-wheel').animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 520, iterations: Infinity }),
      node.querySelector('.fx-leg-a').animate([{ transform: 'rotate(-24deg)' }, { transform: 'rotate(24deg)' }], { ...cycle, direction: 'alternate', easing: 'ease-in-out' }),
      node.querySelector('.fx-leg-b').animate([{ transform: 'rotate(24deg)' }, { transform: 'rotate(-24deg)' }], { ...cycle, direction: 'alternate', easing: 'ease-in-out' }),
      node.querySelector('.fx-guy').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }], { ...cycle, direction: 'alternate', easing: 'ease-in-out' }),
      node.querySelector('.fx-sparkle').animate([{ transform: 'rotate(-10deg)' }, { transform: 'rotate(10deg)' }], { duration: 760, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }),
    ];

    // Une seule horloge pour le trait et l'agent : le trait s'allonge exactement jusqu'où l'agent est arrivé
    await new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - t0) / dur);
        const d = ease(t) * total;
        const x = d <= lv ? a0.x : a0.x + sx * (d - lv);
        const y = d <= lv ? a0.y + sy * d : end.y;
        path.setAttribute('d', d <= lv ? `M${a0.x} ${a0.y} V${y}` : `M${a0.x} ${a0.y} V${end.y} H${x}`);
        const scale = t < 0.06 ? 0.5 + (t / 0.06) * 0.5 : t > 0.92 ? 1 - ((t - 0.92) / 0.08) * 0.6 : 1; // apparaît au départ, rétrécit en arrivant
        node.style.transform = `translate(${(x - W / 2).toFixed(1)}px, ${(y - H / 2).toFixed(1)}px) scaleX(${d > lv ? sx : 1}) scale(${scale.toFixed(3)})`;
        node.style.opacity = String(t > 0.95 ? (1 - t) / 0.05 : 1);
        if (t < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    dotB.style.opacity = '1';
    for (const l of loops) l.cancel();
    node.remove();
    bump(target);
    // Les traits restent un instant, puis s'effacent
    await wait(svg.animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }));
    svg.remove();
  }

  window.AiFx = { press, launch, bump };
})();
