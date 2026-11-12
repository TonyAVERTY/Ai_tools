// Modèle pm2 pour iaboss (serveur CloudPanel ou autre) : copie-le à la racine du projet.
//   cp deploy/ecosystem.config.cjs ecosystem.config.cjs && pm2 start ecosystem.config.cjs && pm2 save
// Mise à jour : git pull && npm ci --omit=dev && pm2 restart iaboss
// Le port, l'adresse publique et les secrets viennent du fichier .env (voir .env.example). Node 22.13 au moins.
module.exports = {
  apps: [{
    name: 'iaboss',
    script: 'src/server.js',
    cwd: __dirname,
    node_args: '--env-file=.env --no-warnings=ExperimentalWarning',
    env: { NODE_ENV: 'production' },
    autorestart: true,
    max_memory_restart: '900M',
    kill_timeout: 10000,
    time: true,
  }],
};
