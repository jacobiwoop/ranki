/**
 * Démonstration pas à pas — suit UNE carte sur plusieurs mois et affiche tout
 * ce que le moteur décide, avec ses raisons.
 *
 *   node simulation/expliquer.js
 *
 * Sert à comprendre le système, pas à le tester (voir test/ pour ça).
 */

import { Moteur } from '../src/moteur.js';
import { ProfilUtilisateur } from '../src/notation.js';
import { JOUR_MS } from '../src/planificateur.js';

const LIBELLE = { 1: 'Encore', 2: 'Difficile', 3: 'Correct', 4: 'Facile' };

/**
 * Un utilisateur ayant déjà révisé : ~40 ms par caractère, 600 ms de latence.
 *
 * La dispersion imposée ici est celle observée en conditions réelles, et elle
 * est LARGE : le temps de réflexion dépend surtout de la fraîcheur du souvenir,
 * qui varie énormément d'une carte à l'autre. Entraîner ce profil sur des
 * données trop propres donnerait des seuils irréalistes de quelques dizaines
 * de millisecondes, et une démonstration trompeuse.
 */
function profilRode() {
  const profil = new ProfilUtilisateur();
  let g = 12345;
  const alea = () => ((g = (g * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 150; i++) {
    const longueur = 60 + Math.floor(alea() * 200);
    // Réflexion réelle : de quasi nulle (carte fraîche) à plusieurs secondes.
    const reflexion = 250 + 4200 * Math.pow(alea(), 1.5);
    profil.enregistrer({
      longueur,
      tempsMs: 600 + 40 * longueur + reflexion,
      correcte: true,
    });
  }
  return profil;
}

const SOURCE = [
  '# Démonstration',
  'Q: Quel port utilise HTTPS par défaut ?',
  '- 80', '- [x] 443', '- 8080', '- 22',
].join('\n');

const profil = profilRode();
const moteur = new Moteur({ profil });
moteur.importer(SOURCE);
const carte = moteur.cartes[0];

console.log(`\nCarte suivie : « ${carte.question} »`);
console.log(`Longueur affichée : ${carte.longueur} caractères`);
console.log(`\nCe que le moteur attend de CET utilisateur pour cette longueur :`);
console.log(`  ${Math.round(profil.tempsAttendu(carte.longueur))} ms `
  + `(${Math.round(profil.latence)} ms de latence + ${profil.pente.toFixed(1)} ms/caractère)`);
const s = profil.seuils();
console.log(`  Plus rapide que ${Math.round(s.facile)} ms d'écart  -> Facile`);
console.log(`  Plus lent   que ${Math.round(s.difficile)} ms d'écart  -> Difficile`);

/**
 * Le scénario : on apprend, on consolide, on oublie, on se rattrape.
 * `ecart` = ms de plus (ou de moins) que le temps attendu pour cette longueur.
 */
const SCENARIO = [
  { libelle: 'découverte, on cherche', correcte: true, ecart: +2500, changements: 0 },
  { libelle: 'ça revient, mais lentement', correcte: true, ecart: +1800, changements: 1 },
  { libelle: 'réponse fluide', correcte: true, ecart: +200, changements: 0 },
  { libelle: 'immédiat', correcte: true, ecart: -1500, changements: 0 },
  { libelle: 'oublié !', correcte: false, ecart: +4000, changements: 2 },
  { libelle: 'réappris, hésitant', correcte: true, ecart: +1500, changements: 1 },
  { libelle: 'consolidé', correcte: true, ecart: -800, changements: 0 },
  { libelle: 'automatique', correcte: true, ecart: -2200, changements: 0 },
];

console.log(`\n${'─'.repeat(100)}`);
console.log('Jour │ Ce qui se passe            │ Temps   │ Note déduite │ Raison                        │  S   │ Revoir dans');
console.log('─'.repeat(100));

let jour = 0;
const debut = Date.UTC(2026, 0, 1, 9);

for (const etape of SCENARIO) {
  const instant = debut + jour * JOUR_MS;
  const tempsMs = Math.round(profil.tempsAttendu(carte.longueur) + etape.ecart);

  const avant = moteur.progression(carte.id).etat?.stabilite;
  const { note, raisons, joursProchains } = moteur.repondre(carte.id, {
    correcte: etape.correcte,
    tempsMs,
    nbChangements: etape.changements,
  }, instant);
  const apres = moteur.progression(carte.id).etat.stabilite;

  console.log(
    `${String(jour).padStart(4)} │ ${etape.libelle.padEnd(26)} │ `
    + `${String(tempsMs).padStart(5)}ms │ ${LIBELLE[note].padEnd(12)} │ `
    + `${raisons[0].slice(0, 29).padEnd(29)} │ `
    + `${(avant === undefined ? '—' : avant.toFixed(1)).padStart(4)} │ `
    + `${apres.toFixed(1).padStart(5)} j -> ${joursProchains} j`,
  );

  jour += joursProchains;
}

console.log('─'.repeat(100));
const finale = moteur.progression(carte.id);
const dernierIntervalle = Math.round((finale.prochaine - finale.derniereRevision) / JOUR_MS);
console.log(`\nEn ${jour} jours et ${SCENARIO.length} passages, la carte est passée d'une`);
console.log(`révision quotidienne à une révision tous les ${dernierIntervalle} jours.`);
console.log('\nColonne « S » = stabilité : le nombre de jours que la mémoire tient.');
console.log('C\'est elle qui fixe la date de révision suivante.\n');
