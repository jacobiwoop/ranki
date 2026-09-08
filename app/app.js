/**
 * Point d'entrée — assemble le moteur, la persistance et les trois vues.
 *
 * Le moteur importé ici est exactement celui que couvrent les 154 tests :
 * aucune réimplémentation, aucune étape de compilation.
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
  afficherVue('revision');
}

const contexte = { moteur, preferences, enregistreur, rafraichirOnglets, lancerSeance };
const vues = {
  accueil: creerVueAccueil(contexte),
  revision: creerVueRevision(contexte),
  stats: creerVueStats(contexte),
  jeu: creerVueJeu(contexte),
  reglages: creerVueReglages(contexte),
};

let nomCourant = null;
let vueCourante = null;

function afficherVue(nom) {
  if (vueCourante) vueCourante.demonter();
  nomCourant = nom;
  vueCourante = vues[nom];
  conteneur.innerHTML = '';
  onglets.forEach((o) => o.classList.toggle('actif', o.dataset.vue === nom));
  vueCourante.monter(conteneur);
}

/**
 * Redessine la vue courante, ou bascule vers une autre.
 * Après un import, l'écran de révision doit reconstruire sa file : les
 * nouvelles cartes n'existaient pas quand la séance a commencé.
 */
function rafraichirOnglets(cible) {
  afficherVue(cible ?? nomCourant);
}

onglets.forEach((o) => o.addEventListener('click', () => afficherVue(o.dataset.vue)));

// Une application mobile peut être tuée sans préavis dès qu'elle passe en
// arrière-plan : on vide la file d'écriture à ce moment précis.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') enregistreur.forcer();
});
window.addEventListener('pagehide', () => enregistreur.forcer());

// Sans carte, il n'y a rien à réviser : on ouvre les réglages, où vit l'import.
afficherVue(moteur.cartes.length === 0 ? 'reglages' : 'accueil');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .catch((e) => console.warn('Service worker non enregistré :', e));
}
