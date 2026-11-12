// Plateformes cibles d'une vidéo de promotion : le préréglage (format, images par seconde, durée) que le formulaire applique quand on coche
// une plateforme, et la consigne donnée à l'IA qui écrit la scène (zones masquées par l'interface, accroche).
//
// Les valeurs de `format`, `fps` et `seconds` doivent rester dans les bornes de PROMO et dans FORMATS (test/promo-platforms.test.js).
// Les marges des zones masquées sont une consigne de prudence, pas une mesure officielle : TikTok renvoie à un gabarit dans son outil
// publicitaire, et les pourcentages de Meta sont relayés par des tiers. À ajuster si une plateforme publie ses marges.

export const PLATFORMS = {
  instagram: {
    label: 'Instagram Reels', format: 'vertical', fps: 30, seconds: 20,
    brief: "Instagram Reels, au format vertical. L'interface de l'application recouvre le haut et surtout le bas de l'image : n'y place ni texte ni élément important (garde libres environ 14 % en haut, 35 % en bas et 6 % de chaque côté). Le produit et l'accroche apparaissent dès les deux premières secondes. La vidéo se comprend sans le son. Un seul appel à l'action, au dernier plan.",
  },
  tiktok: {
    label: 'TikTok', format: 'vertical', fps: 30, seconds: 15,
    brief: "TikTok, au format vertical. L'interface recouvre le bas et le côté droit de l'image : n'y place ni texte ni élément important (garde libres environ 15 % en haut, 30 % en bas, 12 % à droite et 6 % à gauche). La proposition du produit est claire dans les trois premières secondes et l'accroche tient dans les six premières. Textes courts, la vidéo se comprend sans le son. Un seul appel à l'action, au dernier plan.",
  },
  youtube_shorts: {
    label: 'YouTube Shorts', format: 'vertical', fps: 30, seconds: 30,
    brief: "YouTube Shorts, au format vertical. Le titre, les boutons et le bas de l'application recouvrent l'image : garde libres environ 15 % en haut, 25 % en bas et 12 % à droite. L'accroche et le produit apparaissent dès les deux premières secondes. La vidéo se comprend sans le son. Un seul appel à l'action, au dernier plan.",
  },
  linkedin: {
    label: 'LinkedIn', format: 'carre', fps: 30, seconds: 20,
    brief: "LinkedIn, au format carré, vu dans le fil d'actualité et souvent sans le son : le texte à l'écran porte le message, dans un ton sobre et professionnel. Le bénéfice principal apparaît dès les premières secondes. Garde environ 8 % de marge tout autour. Un seul appel à l'action, au dernier plan.",
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS);
