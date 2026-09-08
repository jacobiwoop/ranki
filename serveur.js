/**
 * Serveur statique minimal, sans dépendance.
 *
 *   npm start   →  http://localhost:8123
 *
 * Les modules ES et les service workers refusent de fonctionner depuis
 * `file://` ; il faut donc servir le dossier en HTTP. `localhost` est traité
 * comme une origine sécurisée par les navigateurs : le service worker et
 * l'installation PWA fonctionnent sans certificat.
 *
 * La racine servie est `srs/` afin que l'application (`/app/`) puisse importer
 * le moteur (`/src/`) — le même code que celui couvert par les tests.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.qcm': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let chemin = decodeURIComponent(url.pathname);

  if (chemin === '/') {
    res.writeHead(302, { Location: '/app/' });
    return res.end();
  }
  if (chemin.endsWith('/')) chemin += 'index.html';

  // Empêche de remonter hors de la racine servie (../../etc/passwd).
  const cible = join(RACINE, normalize(chemin).replace(/^(\.\.[/\\])+/, ''));
  if (!cible.startsWith(RACINE)) {
    res.writeHead(403).end('Interdit');
    return;
  }

  try {
    const infos = await stat(cible);
    if (!infos.isFile()) throw new Error('pas un fichier');
    res.writeHead(200, {
      'Content-Type': TYPES[extname(cible)] ?? 'application/octet-stream',
      // Pendant le développement, on veut voir ses modifications immédiatement.
      'Cache-Control': 'no-cache',
    });
    createReadStream(cible).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Introuvable : ${chemin}`);
  }
}).listen(PORT, () => {
  console.log(`\n  Application  →  http://localhost:${PORT}`);
  console.log('  Ctrl+C pour arrêter.\n');
});
