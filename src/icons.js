// Icônes du design (tracé au trait, 24 x 24) : un sprite SVG par page, appelé par <use href="#i-nom">.
// Partagé par le site public et le tableau de bord. Les dégradés (ruban, 404, anneau de la mise en route) sont dans le même sprite.
const SYMBOLS = {
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"></path><path d="M12 10v4.5M12 17.5v.01"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"></path>',
  ban: '<circle cx="12" cy="12" r="9"></circle><path d="m5.6 5.6 12.8 12.8"></path>',
  box: '<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="M9 4v16M4 12h5"></path>',
  bulb: '<path d="M9 18h6M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"></path>',
  chart: '<path d="M4 20V4M4 20h16M8 15l4-4 3 3 5-6"></path>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"></path>',
  chev: '<path d="m6 9 6 6 6-6"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>',
  db: '<ellipse cx="12" cy="6" rx="8" ry="3"></ellipse><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"></path>',
  dl: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"></path>',
  dot: '<circle cx="12" cy="12" r="4"></circle>',
  down: '<path d="m6 9 6 6 6-6"></path>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="3"></circle>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  gear: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"></path>',
  git: '<circle cx="6" cy="5" r="2.2"></circle><circle cx="6" cy="19" r="2.2"></circle><circle cx="18" cy="8" r="2.2"></circle><path d="M6 7.2v9.6M18 10.2c0 4-6 3-12 6"></path>',
  inbox: '<path d="M3 13h5l1 3h6l1-3h5M5 5h14l2 8v6H3v-6z"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8v.01"></path>',
  key: '<circle cx="8" cy="15" r="4"></circle><path d="m11 12 9-9M16 7l3 3"></path>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>',
  load: '<path d="M12 3a9 9 0 1 0 9 9"></path>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="3"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"></rect><path d="m4 8 8 6 8-6"></path>',
  out: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"></path><path d="M16 8l4 4-4 4M20 12H9"></path>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="3"></rect><path d="M9 4h6v3H9zM9 12h6M9 16h4"></path>',
  pause: '<circle cx="12" cy="12" r="9"></circle><path d="M10 9v6M14 9v6"></path>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5"></path>',
  reply: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10a6 6 0 0 1 6 6v3"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
  send: '<path d="M21 3 10 14"></path><path d="m21 3-7 18-4-7-7-4z"></path>',
  shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6z"></path><path d="m9 12 2.2 2.2L15 10"></path>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"></path>',
  target: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4.5"></circle><path d="M12 12v.01"></path>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path>',
  up: '<path d="m6 15 6-6 6 6"></path>',
  user: '<circle cx="12" cy="8" r="4"></circle><path d="M4.5 20a7.5 7.5 0 0 1 15 0"></path>',
  users: '<circle cx="9" cy="8" r="3.5"></circle><path d="M2.5 20a6.5 6.5 0 0 1 13 0"></path><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"></path>',
  x: '<path d="M6 6l12 12M18 6 6 18"></path>',
};

const gradient = (id, x2) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="#1288b7"></stop><stop offset="1" stop-color="#0db8c5"></stop></linearGradient>`;

export const SPRITE = `<svg class="defs" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
<defs>
${gradient('g-hero', 800)}
${gradient('g-nf', 160)}
${gradient('g-ring', 44)}
</defs>
${Object.entries(SYMBOLS).map(([k, d]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${d}</symbol>`).join('\n')}
</svg>`;

/** Icône du sprite : `ic('check')`, ou `ic('load', 'spin')` pour ajouter une classe. Décorative (le mot est toujours écrit à côté). */
export const ic = (name, cls = '') => `<svg class="ic${cls ? ` ${cls}` : ''}" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"></use></svg>`;
