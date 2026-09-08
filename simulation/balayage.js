/**
 * Balayage de la zone morte (`margeMinimaleMs`).
 *
 *   node simulation/balayage.js
 *
 * La zone morte empêche de sanctionner des écarts de temps insignifiants chez
 * un utilisateur régulier. Mais trop large, elle aveugle la notation : tout
 * devient « Correct ». On cherche la valeur qui garde le meilleur rendement
 * (cartes apprises par révision dépensée) sans réintroduire le défaut.
 *
 * Chaque ligne est une campagne complète de 180 jours, à graine identique :
 * les écarts observés viennent du réglage, pas du hasard.
 */

import { REGLAGES } from '../src/notation.js';
import { calibration } from '../src/stats.js';
import { simuler } from './simuler.js';

const MARGES = [0, 100, 150, 200, 300, 500, 700, 1000, 1500, 3000];
const GRAINES = [7, 21, 99]; // trois apprenants, pour ne pas surinterpréter un cas

const pc = (x) => `${(x * 100).toFixed(1)} %`;
const moy = (t) => t.reduce((a, b) => a + b, 0) / t.length;

console.log('\nBalayage de la zone morte — moyenne sur 3 apprenants synthétiques\n');
console.log('  marge │ rendement │ rétention │ calibration │ discriminant │ % Difficile');
console.log('  ──────┼───────────┼───────────┼─────────────┼──────────────┼─────────────');

const resultats = [];

for (const marge of MARGES) {
  const reglages = { ...REGLAGES, margeMinimaleMs: marge };
  const campagnes = GRAINES.map((g) => {
    const r = simuler('deduite', g, reglages);
    const journal = r.moteur.journal;
    const acquises = r.cartes
      .filter((c) => r.apprenant.vraie.get(c.id).stabilite >= 30).length;
    const justes = journal.filter((e) => !e.premiereVue);
    const moyenneR = (n) => {
      const v = r.parNoteDeduite.get(n);
      return v.length ? moy(v) : NaN;
    };
    return {
      rendement: (acquises / journal.length) * 100,
      retention: justes.filter((e) => e.correcte).length / justes.length,
      calibration: calibration(journal).ecartMoyen,
      discriminant: moyenneR(4) - moyenneR(2),
      partDifficile: journal.filter((e) => e.note === 2).length / journal.length,
    };
  });

  const r = {
    marge,
    rendement: moy(campagnes.map((c) => c.rendement)),
    retention: moy(campagnes.map((c) => c.retention)),
    calibration: moy(campagnes.map((c) => c.calibration)),
    discriminant: moy(campagnes.map((c) => c.discriminant)),
    partDifficile: moy(campagnes.map((c) => c.partDifficile)),
  };
  resultats.push(r);

  const nombre = (x, n) => (Number.isNaN(x) ? 'n/a' : pc(x)).padStart(n);
  console.log(
    `  ${String(marge).padStart(5)} │ `
    + `${r.rendement.toFixed(2).padStart(9)} │ `
    + `${nombre(r.retention, 9)} │ `
    + `${nombre(r.calibration, 11)} │ `
    + `${nombre(r.discriminant, 12)} │ `
    + `${nombre(r.partDifficile, 11)}`,
  );
}

const meilleur = resultats.reduce((a, b) => (b.rendement > a.rendement ? b : a));
console.log(`\n  Meilleur rendement : marge = ${meilleur.marge} ms `
  + `(${meilleur.rendement.toFixed(2)} cartes acquises / 100 révisions)`);
console.log(`  Valeur actuellement retenue dans notation.js : ${REGLAGES.margeMinimaleMs} ms\n`);
console.log('  Lecture : une marge nulle laisse les quantiles ranger un tiers des bonnes');
console.log('  réponses en « Difficile » par construction ; une marge trop large fait');
console.log('  disparaître la note « Difficile » et la notation perd son intérêt.\n');
