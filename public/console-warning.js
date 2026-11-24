// Avertissement dans la console du navigateur (site public et tableau de bord), comme sur Discord : coller ici un texte reçu de quelqu'un
// est la méthode classique pour voler un compte (« self-XSS »). Chargé une seule fois par page (ajax.js ne le relance pas).
(() => {
  // Adresse d'invitation du serveur Discord (si elle change, c'est ici). Vide, le message renvoie au serveur sans lien.
  const DISCORD = 'https://discord.gg/V5heFHy5U4';
  const big = 'color:#d93025;font-size:44px;font-weight:700;-webkit-text-stroke:1px #000;';
  const body = 'font-size:16px;line-height:1.5;';
  const strong = 'font-size:16px;font-weight:700;line-height:1.5;';
  console.log('%cStop !', big);
  console.log('%cCette fenêtre est réservée aux développeurs.', strong);
  console.log('%cSi quelqu\'un t\'a demandé de copier-coller quelque chose ici, c\'est très probablement une arnaque : ça peut lui donner accès à ton compte iaboss, à tes données et à ta clé d\'IA.', body);
  console.log('%cNe colle rien que tu ne comprends pas.', strong);
  console.log(`%cTu sais ce que tu fais ? Alors viens nous parler sur notre serveur Discord${DISCORD ? ` : ${DISCORD}` : ''}.`, body);
})();
