/**
 * Persistance du jeu — base IndexedDB SÉPARÉE de celle de la révision.
 *
 * Séparer les bases, et pas seulement les tables, garantit qu'une opération sur
 * le jeu ne peut structurellement pas toucher aux dates de révision. « Tout
 * effacer » côté jeu ne fait pas disparaître des mois de travail, et
 * inversement l'export de révision ne trimballe pas 3 000 questions de quiz.
 */

const BASE = 'millionnaire';
const TABLE = 'etat';
const CLE = 'unique';

function ouvrir() {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE, 1);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(TABLE)) db.createObjectStore(TABLE);
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

async function transaction(mode, action) {
  const db = await ouvrir();
  return new Promise((resoudre, rejeter) => {
    const t = db.transaction(TABLE, mode);
    const r = action(t.objectStore(TABLE));
    t.oncomplete = () => { db.close(); resoudre(r?.result); };
    t.onerror = () => { db.close(); rejeter(t.error); };
  });
}

/**
 * @returns {Promise<{banque: object[], vues: [string, number][], parties: number,
 *   historique: object[]}|null>}
 */
export const lire = () => transaction('readonly', (t) => t.get(CLE));
export const ecrire = (etat) => transaction('readwrite', (t) => t.put(etat, CLE));
export const effacer = () => transaction('readwrite', (t) => t.delete(CLE));

export const ETAT_VIDE = { banque: [], vues: [], parties: 0, historique: [] };

/**
 * Écriture différée : une partie enchaîne les mises à jour, on ne veut pas
 * une transaction par clic. Le vidage est forcé quand l'onglet disparaît —
 * seul moment où le système peut tuer l'application sans préavis.
 */
export function creerEnregistreur(instantane, delai = 800) {
  let minuteur = null;
  const forcer = () => {
    clearTimeout(minuteur);
    minuteur = null;
    return ecrire(instantane());
  };
  return {
    demander() {
      if (minuteur) return;
      minuteur = setTimeout(forcer, delai);
    },
    forcer,
  };
}
