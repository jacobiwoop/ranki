/**
 * Service worker — rend l'application utilisable hors ligne.
 *
 * Stratégie « réseau d'abord, cache en secours » : en ligne on récupère
 * toujours la dernière version (pratique pendant le développement), hors ligne
 * on sert la copie mise en cache. Pour une app de révision dans les
 * transports, c'est exactement ce qu'il faut.
 *
 * Les données de révision, elles, ne passent pas par ici : elles vivent dans
 * IndexedDB et sont donc disponibles hors ligne par construction.
 */

const CACHE = 'revisions-v7';

/*
 * `addAll` est atomique : un seul fichier manquant fait échouer l'installation
 * ENTIÈRE, et l'application perd le hors-ligne sans le moindre message. Cette
 * liste doit donc suivre chaque renommage — c'est arrivé avec `vues/import.js`,
 * devenu `vues/donnees.js`.
 */
const RESSOURCES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './stockage.js',
  './preferences.js',
  './prompt-qcm.js',
  './vues/accueil.js',
  './vues/revision.js',
  './vues/stats.js',
  './vues/donnees.js',
  './vues/jeu.js',
  './vues/reglages.js',
  './manifest.webmanifest',
  './icone.svg',

  // Le jeu : jouable hors ligne une fois les questions préparées.
  './jeu/',
  './jeu/index.html',
  './jeu/style-jeu.css',
  './jeu/jeu.js',
  './jeu/stockage-jeu.js',
  './jeu/agent.js',

  '../src/moteur.js',
  '../src/memoire.js',
  '../src/notation.js',
  '../src/planificateur.js',
  '../src/parseur.js',
  '../src/presentation.js',
  '../src/stats.js',
  '../src/jeu.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(RESSOURCES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((reponse) => {
        // On ne met en cache que ce qui a été servi correctement.
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? caches.match('./index.html'))),
  );
});
