/**
 * Persistance locale — IndexedDB.
 *
 * Tout reste sur l'appareil : aucun serveur, aucun compte. La contrepartie est
 * qu'une synchronisation entre téléphone et PC passe par l'export/import d'un
 * fichier de sauvegarde (voir la vue « Cartes »).
 *
 * On stocke un unique enregistrement contenant l'état complet du moteur.
 * C'est volontairement rustique : à l'échelle de quelques milliers de cartes,
 * sérialiser l'ensemble coûte quelques millisecondes, et cela nous épargne
 * toute une gestion de migrations de schéma.
 */

const BASE = 'revisions';
const MAGASIN = 'etat';
const CLE = 'courant';

function ouvrir() {
  return new Promise((resoudre, rejeter) => {
    const requete = indexedDB.open(BASE, 1);
    requete.onupgradeneeded = () => {
      const db = requete.result;
      if (!db.objectStoreNames.contains(MAGASIN)) db.createObjectStore(MAGASIN);
    };
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

function transaction(db, mode, action) {
  return new Promise((resoudre, rejeter) => {
    const tx = db.transaction(MAGASIN, mode);
    const requete = action(tx.objectStore(MAGASIN));
    requete.onsuccess = () => resoudre(requete.result);
    requete.onerror = () => rejeter(requete.error);
  });
}

export async function lire() {
  try {
    const db = await ouvrir();
    const donnees = await transaction(db, 'readonly', (m) => m.get(CLE));
    db.close();
    return donnees ?? null;
  } catch (e) {
    console.warn('Lecture impossible, on repart de zéro :', e);
    return null;
  }
}

export async function ecrire(donnees) {
  const db = await ouvrir();
  await transaction(db, 'readwrite', (m) => m.put(donnees, CLE));
  db.close();
}

export async function effacer() {
  const db = await ouvrir();
  await transaction(db, 'readwrite', (m) => m.delete(CLE));
  db.close();
}

/**
 * Enregistrement différé.
 *
 * On sauvegarde après chaque réponse, mais en regroupant les écritures
 * rapprochées : enchaîner vingt cartes ne doit pas déclencher vingt
 * transactions. `forcer()` vide la file immédiatement — indispensable quand
 * l'application passe en arrière-plan, moment où le système peut la tuer.
 */
export function creerEnregistreur(obtenirDonnees, delai = 600) {
  let minuteur = null;
  let enCours = null;

  const vider = async () => {
    minuteur = null;
    enCours = ecrire(obtenirDonnees()).catch((e) => console.error('Sauvegarde échouée', e));
    await enCours;
  };

  return {
    demander() {
      if (minuteur) clearTimeout(minuteur);
      minuteur = setTimeout(vider, delai);
    },
    async forcer() {
      if (minuteur) { clearTimeout(minuteur); await vider(); }
      await enCours;
    },
  };
}
