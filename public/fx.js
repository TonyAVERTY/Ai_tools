// Lancement d'une tâche : le bouton « s'enfonce », puis un petit agent Claude pousse une brouette jusqu'au menu « Activité » (en haut à droite),
// qui s'ouvre un instant sur la liste des tâches en cours et à venir, comme la bulle de téléchargement de Chrome.
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
   * L'agent part du bouton `from` et pousse sa brouette jusqu'au menu « Activité » (ou, à défaut, le coin du haut). Résolu à son arrivée.
   * @returns {Promise<void>}
   */
  async function launch(from) {
    const target = [document.querySelector('#jobs .jobs-btn'), document.querySelector('.top-r')].find(visible);
    if (!target) return;
    if (calm() || !from || !from.isConnected) { bump(target); return; }
    const a = center(from);
    const b = center(target);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const dur = Math.round(Math.min(1700, Math.max(950, 650 + dist * 0.8)));
    const flip = dx < 0 ? -1 : 1;
    // Arc : le point de contrôle est au-dessus du milieu du trajet, pour que l'agent « monte » vers la barre du haut
    const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - Math.min(150, 40 + dist * 0.25) };
    const at = (t) => ({
      x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
      y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
    });
    const node = document.createElement('div');
    node.className = 'fx-agent';
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = AGENT;
    document.body.append(node);
    const place = (p, s, extra = '') => `translate(${(p.x - W / 2).toFixed(1)}px, ${(p.y - H / 2).toFixed(1)}px) scaleX(${flip}) scale(${s})${extra}`;

    // Marche : la roue tourne, les jambes alternent, le personnage rebondit
    const cycle = { duration: 380, iterations: Infinity };
    const wheel = node.querySelector('.fx-wheel').animate([{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 520, iterations: Infinity });
    const legA = node.querySelector('.fx-leg-a').animate([{ transform: 'rotate(-24deg)' }, { transform: 'rotate(24deg)' }], { ...cycle, direction: 'alternate', easing: 'ease-in-out' });
    const legB = node.querySelector('.fx-leg-b').animate([{ transform: 'rotate(24deg)' }, { transform: 'rotate(-24deg)' }], { ...cycle, direction: 'alternate', easing: 'ease-in-out' });
    const hop = node.querySelector('.fx-guy').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }], { ...cycle, direction: 'alternate', easing: 'ease-in-out' });
    node.querySelector('.fx-sparkle').animate([{ transform: 'rotate(-10deg)' }, { transform: 'rotate(10deg)' }], { duration: 760, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });

    const steps = 30;
    const frames = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const s = t < 0.08 ? 0.5 + (t / 0.08) * 0.5 : t > 0.9 ? 1 - ((t - 0.9) / 0.1) * 0.55 : 1; // apparition au départ, rétrécit en arrivant
      frames.push({ transform: place(at(ease(t)), s), opacity: t < 0.05 ? t / 0.05 : t > 0.93 ? 1 - (t - 0.93) / 0.07 : 1, offset: t });
    }
    await wait(node.animate(frames, { duration: dur, fill: 'forwards' }));
    bump(target);
    for (const x of [wheel, legA, legB, hop]) x.cancel();
    node.remove();
  }

  window.AiFx = { press, launch, bump };
})();
