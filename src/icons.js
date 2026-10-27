// Icônes du design (tracé au trait, 24 x 24) : un sprite SVG par page, appelé par <use href="#i-nom">.
// Partagé par le site public et le tableau de bord. Les dégradés (ruban, 404, anneau de la mise en route) sont dans le même sprite.
// Logos de marque (discord, slack, telegram) : tracés Simple Icons v13.21, licence CC0 ; pleins et en currentColor, donc suivent le thème.
const SYMBOLS = {
  alert: '<path d="M12 3.5 2.8 19.5h18.4z"></path><path d="M12 10v4.5M12 17.5v.01"></path>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"></path>',
  ban: '<circle cx="12" cy="12" r="9"></circle><path d="m5.6 5.6 12.8 12.8"></path>',
  box: '<rect x="4" y="4" width="16" height="16" rx="4"></rect><path d="M9 4v16M4 12h5"></path>',
  bulb: '<path d="M9 18h6M10 21h4"></path><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"></path>',
  discord: '<path fill="currentColor" stroke="none" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"></path>',
  slack: '<path fill="currentColor" stroke="none" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"></path>',
  telegram: '<path fill="currentColor" stroke="none" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"></path>',
  chart: '<path d="M4 20V4M4 20h16M8 15l4-4 3 3 5-6"></path>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"></path>',
  chev: '<path d="m6 9 6 6 6-6"></path>',
  clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"></path><rect x="4" y="8" width="16" height="12" rx="3"></rect><path d="M16 14h.01"></path>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"></path><path d="M9 8h6M9 12h6"></path>',
  clip: '<path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"></path>',
  file: '<path d="M7 3h7l5 5v13H7z"></path><path d="M14 3v5h5M10 13h6M10 17h6"></path>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2.5"></rect><path d="m10 9.5 5 2.5-5 2.5z"></path>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="2.5"></rect><path d="M8 20h8M12 16v4"></path>',
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
  help: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9.6a2.6 2.6 0 1 1 3.7 2.3c-.8.4-1.2 1-1.2 1.9"></path><path d="M12 17h.01"></path>',
  globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"></path>',
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
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"></rect>',
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
