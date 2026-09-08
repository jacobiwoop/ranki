/**
 * Point d'entrée — assemble le moteur, la persistance et les vues.
 *
 * Le moteur importé ici est exactement celui que couvrent les tests : aucune
 * réimplémentation, aucune étape de compilation.
 *
 * Les onglets sont de VRAIS onglets. Chaque vue garde son propre conteneur,
 * monté une seule fois ; changer d'onglet ne fait que masquer l'un et montrer
 * l'autre. Trois conséquences, toutes voulues :
 *
 *   - on retrouve la vue exactement dans l'état où on l'a laissée : recueils
 *     dépliés, position de défilement, formulaire à moitié rempli ;
 *   - une génération de questions lancée dans l'onglet Jeu continue pendant
 *     qu'on consulte ses progrès ailleurs ;
 *   - plus de clignotement à chaque bascule.
 *
 * En contrepartie, une vue affichée peut être devenue périmée pendant son
 * absence — d'où `reprendre()`, appelée à chaque retour pour se remettre à jour.
 */

import { Moteur } from '../src/moteur.js';
import { creerEnregistreur, lire } from './stockage.js';
import { fusionner } from './preferences.js';
import { creerVueAccueil } from './vues/accueil.js';
import { creerVueRevision } from './vues/revision.js';
import { creerVueStats } from './vues/stats.js';
import { creerVueJeu } from './vues/jeu.js';
import { creerVueReglages } from './vues/reglages.js';

const conteneur = document.getElementById('vue');
const onglets = [...document.querySelectorAll('.onglet')];

const donnees = await lire();
const moteur = donnees ? Moteur.depuisJSON(donnees) : new Moteur();
// Les préférences d'affichage voyagent avec la sauvegarde sans passer par le
// moteur, qui n'a pas à connaître les questions de confort visuel.
const preferences = fusionner(donnees?.preferences);
const enregistreur = creerEnregistreur(() => ({ ...moteur.toJSON(), preferences }));

/** Lance une séance avec des options précises, puis bascule sur la révision. */
function lancerSeance(options) {
  vues.revision.configurer(options);
  afficherVue('revision', { forcer: true });
}

const contexte = { moteur, preferences, enregistreur, rafraichirOnglets, lancerSeance };
const vues = {
  accueil: creerVueAccueil(contexte),
  revision: creerVueRevision(contexte),
  stats: creerVueStats(contexte),
  jeu: creerVueJeu(contexte),
  reglages: creerVueReglages(contexte),
};

/** Un panneau par vue, créé à la demande et conservé ensuite. */
const panneaux = new Map();
let nomCourant = null;

function panneau(nom) {
  if (panneaux.has(nom)) return panneaux.get(nom);
  // Le premier panneau chasse le « Chargement… » du HTML statique. Les suivants
  // s'ajoutent à côté : on n'efface plus rien, c'est tout l'intérêt.
  if (panneaux.size === 0) conteneur.innerHTML = '';
  const element = document.createElement('section');
  element.className = 'panneau';
  element.dataset.vue = nom;
  element.hidden = true;
  conteneur.appendChild(element);
  panneaux.set(nom, element);
  return element;
}

/** Position de défilement par onglet, pour revenir là où on était. */
const defilements = new Map();

async function afficherVue(nom, { forcer = false } = {}) {
  if (nomCourant === nom && !forcer) return;
  if (nomCourant) defilements.set(nomCourant, window.scrollY);

  const cible = panneau(nom);
  for (const [autre, element] of panneaux) element.hidden = autre !== nom;
  onglets.forEach((o) => o.classList.toggle('actif', o.dataset.vue === nom));
  nomCourant = nom;

  const vue = vues[nom];
  if (!cible.dataset.monte) {
    cible.dataset.monte = '1';
    await vue.monter(cible);
  } else if (forcer) {
    // Remontage complet : la vue doit repartir de zéro (nouvelle séance).
    cible.innerHTML = '';
    await vue.monter(cible);
  } else {
    // Retour sur un onglet déjà monté : il a pu vieillir pendant son absence.
    await vue.reprendre?.();
  }

  window.scrollTo(0, forcer ? 0 : (defilements.get(nom) ?? 0));
}

/**
 * Bascule vers un onglet, ou remet à jour celui qui est affiché.
 * Après un import, l'écran de révision doit reconstruire sa file : les
 * nouvelles cartes n'existaient pas quand la séance a commencé.
 */
function rafraichirOnglets(cible) {
  const nom = cible ?? nomCourant;
  if (nom === nomCourant) { vues[nom].reprendre?.(); return; }
  afficherVue(nom);
}

onglets.forEach((o) => o.addEventListener('click', () => afficherVue(o.dataset.vue)));

// Une application mobile peut être tuée sans préavis dès qu'elle passe en
// arrière-plan : on vide la file d'écriture à ce moment précis.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') enregistreur.forcer();
});
window.addEventListener('pagehide', () => {
  enregistreur.forcer();
  // Seul moment où l'on démonte : la page disparaît pour de bon.
  for (const vue of Object.values(vues)) vue.demonter?.();
});

// Sans carte, il n'y a rien à réviser : on ouvre les réglages, où vit l'import.
await afficherVue(moteur.cartes.length === 0 ? 'reglages' : 'accueil');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .catch((e) => console.warn('Service worker non enregistré :', e));
}
