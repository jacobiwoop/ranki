/**
 * Simulation — banc d'essai du moteur sur 6 mois de révisions.
 *
 * On fabrique un apprenant synthétique dont on connaît la VRAIE mémoire
 * (inaccessible au moteur, évidemment). Le moteur ne voit que ce que verrait
 * l'application : juste/faux et temps de réponse. On peut alors vérifier des
 * choses qu'aucun test unitaire ne prouve :
 *
 *   1. La rétention obtenue atteint-elle la cible ?
 *   2. Les probabilités annoncées sont-elles honnêtes (calibration) ?
 *   3. Et surtout : la note DÉDUITE du temps de réponse porte-t-elle vraiment
 *      de l'information sur l'état réel de la mémoire ?
 *
 * Le point 3 est l'expérience décisive. On compare la notation déduite à une
 * notation « aveugle » qui ignore le temps (juste = Correct, faux = Encore).
 * Si les deux se valent, mesurer le temps de réponse ne sert à rien.
 *
 *   node simulation/simuler.js
 */

import { recuperabilite } from '../src/memoire.js';
import { Moteur } from '../src/moteur.js';
import { JOUR_MS, REGLAGES_PLAN } from '../src/planificateur.js';
import { CORRECT, ENCORE, ProfilUtilisateur, REGLAGES } from '../src/notation.js';
import { calibration, chargePrevisionnelle, repartitionNotes, retention } from '../src/stats.js';

/** Générateur pseudo-aléatoire déterministe : deux exécutions donnent le même résultat. */
function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NB_CARTES = 300;
const JOURS = 180;
const NB_PROPOSITIONS = 4;

/** Fabrique un jeu de cartes de longueurs et difficultés variées. */
function fabriquerCartes(rand) {
  return Array.from({ length: NB_CARTES }, (_, i) => {
    const longueur = 60 + Math.floor(rand() * 240);
    return {
      id: `c${i}`,
      question: 'q'.repeat(Math.floor(longueur / 2)),
      propositions: Array.from({ length: NB_PROPOSITIONS }, (_, k) => ({
        texte: 'p', correcte: k === 0,
      })),
      explication: '', source: '', section: 'sim',
      tags: [['réseau', 'crypto', 'web'][i % 3]],
      reponsesMultiples: false,
      longueur,
      // Connue de la simulation seule : le moteur doit la retrouver tout seul.
      difficulteVraie: 1 + rand() * 9,
    };
  });
}

/**
 * La mémoire réelle de l'apprenant, que le moteur cherche à modéliser.
 * Modèle volontairement différent du sien : si les deux coïncidaient, la
 * simulation ne prouverait que sa cohérence interne, pas sa justesse.
 */
class Apprenant {
  constructor(cartes, rand) {
    this.rand = rand;
    this.vraie = new Map(cartes.map((c) => [c.id, {
      stabilite: 0, difficulte: c.difficulteVraie, derniereVue: null,
    }]));
    // Ses caractéristiques personnelles de vitesse, à retrouver par le profil.
    this.latence = 700;
    this.msParCaractere = 38;
  }

  recuperabiliteVraie(id, maintenant) {
    const v = this.vraie.get(id);
    if (v.stabilite === 0 || v.derniereVue === null) return 0;
    return recuperabilite(v.stabilite, (maintenant - v.derniereVue) / JOUR_MS);
  }

  /**
   * Répond à une carte. Renvoie ce que l'application observerait, plus la
   * vérité cachée pour l'analyse.
   */
  repondre(carte, maintenant) {
    const v = this.vraie.get(carte.id);
    const R = this.recuperabiliteVraie(carte.id, maintenant);

    const rappelReel = this.rand() < R;
    // À défaut de savoir, on coche au hasard : 1 chance sur 4 de tomber juste.
    const devine = !rappelReel && this.rand() < 1 / NB_PROPOSITIONS;
    const correcte = rappelReel || devine;

    let reflexion;
    if (rappelReel) {
      // Plus le souvenir est frais, plus la réponse est immédiate.
      reflexion = 250 + 4200 * Math.pow(1 - R, 1.5) + (this.rand() - 0.5) * 700;
    } else if (devine) {
      reflexion = 200 + this.rand() * 700; // on devine vite
    } else {
      reflexion = 1500 + this.rand() * 3500; // on cherche, en vain
    }

    const tempsMs = Math.max(
      300,
      this.latence + this.msParCaractere * carte.longueur + reflexion,
    );
    const nbChangements = rappelReel ? (this.rand() < 0.05 ? 1 : 0)
                                     : (this.rand() < 0.45 ? 2 : 1);

    // Mise à jour de la vraie mémoire. Revoir la bonne réponse instruit un peu,
    // même après une erreur — d'où la remontée partielle plutôt qu'un retour à zéro.
    const facteur = 1.3 + 1.2 * ((10 - v.difficulte) / 9);
    if (rappelReel) v.stabilite = Math.max(1, (v.stabilite || 1) * facteur);
    else v.stabilite = Math.max(0.6, v.stabilite * 0.35 + 0.4);
    v.derniereVue = maintenant;

    return { correcte, tempsMs, nbChangements, R, rappelReel, devine };
  }
}

/** Déroule une campagne complète. `mode` : 'deduite' ou 'aveugle'. */
export function simuler(mode, graine = 7, reglagesNotation = REGLAGES) {
  const rand = alea(graine);
  const cartes = fabriquerCartes(rand);
  const apprenant = new Apprenant(cartes, alea(graine + 1));
  const moteur = new Moteur({
    cartes,
    profil: new ProfilUtilisateur(reglagesNotation),
    reglages: { ...REGLAGES_PLAN, limiteNouvelles: 15, limiteRevisions: 120 },
  });

  const debut = Date.UTC(2026, 0, 1, 9, 0, 0);
  const parNoteDeduite = new Map([[1, []], [2, []], [3, []], [4, []]]);
  const chargeQuotidienne = [];

  for (let jour = 0; jour < JOURS; jour++) {
    const maintenant = debut + jour * JOUR_MS;
    const session = moteur.demarrerSeance(maintenant);
    let vues = 0;

    while (session.courante() && vues < 400) {
      const carte = session.courante();
      // Chaque réponse consomme du temps : les cartes d'une même séance ne sont
      // pas toutes horodatées à la seconde près.
      const instant = maintenant + vues * 12_000;
      const rep = apprenant.repondre(carte, instant);

      // Témoin : on n'exploite que juste/faux, comme le ferait une app naïve.
      // La note imposée doit remonter jusqu'au modèle de mémoire, sinon le
      // témoin réviserait exactement comme le mode déduit et ne prouverait rien.
      const noteImposee = mode === 'aveugle'
        ? (rep.correcte ? CORRECT : ENCORE)
        : undefined;
      const { note } = moteur.repondre(carte.id, { ...rep, noteImposee }, instant);

      // On archive la VRAIE récupérabilité en regard de la note déduite :
      // c'est la mesure du pouvoir informatif de la notation.
      parNoteDeduite.get(note).push(rep.R);

      session.avancer(rep.correcte);
      vues++;
    }
    chargeQuotidienne.push(vues);
  }

  return { moteur, apprenant, cartes, parNoteDeduite, chargeQuotidienne };
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

const pc = (x) => (x === null || Number.isNaN(x) ? '  n/a' : `${(x * 100).toFixed(1)} %`);
const moyenne = (t) => (t.length ? t.reduce((a, b) => a + b, 0) / t.length : NaN);

export function rapport(titre, r) {
  const { moteur, apprenant, cartes, parNoteDeduite, chargeQuotidienne } = r;
  const ret = retention(moteur.journal);
  const cal = calibration(moteur.journal);
  const notes = repartitionNotes(moteur.journal);

  const stabilitesVraies = cartes.map((c) => apprenant.vraie.get(c.id).stabilite);
  const acquises = stabilitesVraies.filter((s) => s >= 30).length;

  console.log(`\n${'═'.repeat(66)}\n  ${titre}\n${'═'.repeat(66)}`);
  console.log(`  Révisions totales      ${moteur.journal.length}`);
  console.log(`  Charge moyenne / jour  ${moyenne(chargeQuotidienne).toFixed(1)} cartes`);
  console.log(`  Rétention obtenue      ${pc(ret.taux)}   (cible ${pc(REGLAGES_PLAN.retentionCible)})`);
  console.log(`  Écart de calibration   ${pc(cal.ecartMoyen)}   (plus c'est bas, mieux c'est)`);
  console.log(`  Cartes réellement acquises (stabilité ≥ 30 j) : ${acquises}/${cartes.length}`);

  console.log('\n  Récupérabilité RÉELLE moyenne, par note déduite');
  console.log('  ┌────────────┬──────────┬───────────────────────┐');
  console.log('  │ note       │ effectif │ R vraie moyenne       │');
  console.log('  ├────────────┼──────────┼───────────────────────┤');
  const libelles = { 1: 'Encore', 2: 'Difficile', 3: 'Correct', 4: 'Facile' };
  const moyennes = [];
  for (const n of [1, 2, 3, 4]) {
    const vals = parNoteDeduite.get(n);
    const m = moyenne(vals);
    moyennes.push(m);
    const barre = Number.isNaN(m) ? '' : '█'.repeat(Math.round(m * 20));
    console.log(`  │ ${libelles[n].padEnd(10)} │ ${String(vals.length).padStart(8)} │ `
      + `${pc(m).padStart(6)} ${barre.padEnd(14)}│`);
  }
  console.log('  └────────────┴──────────┴───────────────────────┘');

  const croissante = moyennes
    .filter((m) => !Number.isNaN(m))
    .every((m, i, t) => i === 0 || m >= t[i - 1]);
  console.log(`  Notes ordonnées selon l'état réel de la mémoire : ${croissante ? 'OUI ✓' : 'NON ✗'}`);

  const ecart = moyennes[3] - moyennes[1];
  console.log(`  Écart « Facile » − « Difficile » : ${pc(ecart)}  `
    + `← pouvoir discriminant de la notation`);

  console.log('\n  Répartition des notes  '
    + [1, 2, 3, 4].map((n) => `${libelles[n]} ${pc(notes[n].part)}`).join(' · '));

  return {
    retention: ret.taux,
    calibration: cal.ecartMoyen,
    ecartNotes: ecart,
    croissante,
    revisions: moteur.journal.length,
    acquises,
    // Le vrai critère : combien de cartes apprises pour 100 cartes révisées.
    // Une méthode qui apprend plus en révisant plus n'aurait rien prouvé.
    rendement: (acquises / moteur.journal.length) * 100,
  };
}

// Exécuté seulement en ligne de commande : ce module est aussi importé par
// balayage.js, qui ne veut pas déclencher le rapport complet.
const lanceDirectement = process.argv[1]?.endsWith('simuler.js');
if (!lanceDirectement) {
  // rien : les fonctions sont exportées, l'appelant décide
} else {

console.log(`\nSimulation : ${NB_CARTES} cartes, ${JOURS} jours, apprenant synthétique.`);
console.log('Le moteur ne connaît ni la difficulté réelle des cartes ni la mémoire de l\'apprenant.');

const deduite = rapport('NOTATION DÉDUITE (temps de réponse + hésitations)', simuler('deduite'));
const aveugle = rapport('TÉMOIN — NOTATION AVEUGLE (juste/faux seulement)', simuler('aveugle'));

console.log(`\n${'═'.repeat(66)}\n  VERDICT\n${'═'.repeat(66)}`);
const ligne = (nom, a, b, mieux) => {
  const gagnant = mieux(a.brut, b.brut) ? '  ← déduite' : '  ← témoin';
  console.log(`  ${nom.padEnd(22)} ${a.txt.padStart(8)}  contre ${b.txt.padStart(8)}${gagnant}`);
};
const v = (x, txt) => ({ brut: x, txt });

ligne('Calibration (erreur)', v(deduite.calibration, pc(deduite.calibration)),
  v(aveugle.calibration, pc(aveugle.calibration)), (a, b) => a < b);
ligne('Rétention', v(deduite.retention, pc(deduite.retention)),
  v(aveugle.retention, pc(aveugle.retention)), (a, b) => a > b);
ligne('Cartes acquises', v(deduite.acquises, `${deduite.acquises}`),
  v(aveugle.acquises, `${aveugle.acquises}`), (a, b) => a > b);
ligne('Révisions dépensées', v(deduite.revisions, `${deduite.revisions}`),
  v(aveugle.revisions, `${aveugle.revisions}`), (a, b) => a < b);
ligne('Acquises / 100 rév.', v(deduite.rendement, deduite.rendement.toFixed(2)),
  v(aveugle.rendement, aveugle.rendement.toFixed(2)), (a, b) => a > b);

console.log(`\n  Pouvoir discriminant de la notation : ${pc(deduite.ecartNotes)} d'écart entre`);
console.log('  « Facile » et « Difficile ». Le témoin ne produit que deux notes :');
console.log('  il ne distingue pas une carte tout juste sue d\'une carte maîtrisée.');

const charge = chargePrevisionnelle(
  [...simuler('deduite').moteur.progressions.values()], 14,
  Date.UTC(2026, 0, 1) + JOURS * JOUR_MS,
);
console.log(`\n  Charge des 14 prochains jours : ${charge.parJour.join(' ')}`);
console.log(`  En retard : ${charge.enRetard}\n`);

}
