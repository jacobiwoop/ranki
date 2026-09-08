/**
 * Statistiques — lecture du journal de révisions.
 *
 * Le journal enregistre, pour chaque réponse, ce que le modèle PRÉDISAIT
 * (recuperabiliteAvant) et ce qui s'est réellement passé. C'est ce qui rend
 * la calibration mesurable : on peut prouver que le modèle dit vrai, ou pas.
 */

import { JOUR_MS } from './planificateur.js';

const pourcent = (n, d) => (d === 0 ? null : n / d);

/** Ne garde que les vraies révisions : une première découverte n'est pas un test. */
const revisions = (journal) => journal.filter((e) => !e.premiereVue);

/** Rappel réussi au sens du planificateur : la réponse partielle compte. */
const reussie = (e) => e.reussie ?? e.correcte;

/**
 * Rétention réelle : part de bonnes réponses sur les cartes déjà apprises.
 * C'est la métrique reine. Si la cible est 0,90, cette valeur doit tourner
 * autour de 0,90 — au-dessus, on révise trop ; en dessous, trop peu.
 */
export function retention(journal) {
  const r = revisions(journal);
  return { total: r.length, taux: pourcent(r.filter(reussie).length, r.length) };
}

/**
 * Calibration — le contrôle qualité du modèle de mémoire.
 *
 * On range les révisions par récupérabilité prédite, et on compare la
 * prédiction à la réussite observée. Un modèle honnête colle à la diagonale :
 * parmi les cartes annoncées à 70 % de rappel, environ 70 % doivent réussir.
 *
 * C'est le test qui dit s'il faut réajuster les poids sur cet utilisateur.
 */
export function calibration(journal, nbTranches = 10) {
  const tranches = Array.from({ length: nbTranches }, (_, i) => ({
    borneBasse: i / nbTranches,
    borneHaute: (i + 1) / nbTranches,
    predit: 0, observe: 0, effectif: 0,
  }));

  for (const e of revisions(journal)) {
    const r = e.recuperabiliteAvant;
    if (typeof r !== 'number' || Number.isNaN(r)) continue;
    const i = Math.min(Math.floor(r * nbTranches), nbTranches - 1);
    tranches[i].predit += r;
    tranches[i].observe += reussie(e) ? 1 : 0;
    tranches[i].effectif++;
  }

  const remplies = tranches.filter((t) => t.effectif > 0).map((t) => ({
    ...t,
    predit: t.predit / t.effectif,
    observe: t.observe / t.effectif,
  }));

  // Écart absolu moyen entre prédiction et réalité, pondéré par l'effectif.
  const n = remplies.reduce((s, t) => s + t.effectif, 0);
  const ecart = n === 0 ? null
    : remplies.reduce((s, t) => s + t.effectif * Math.abs(t.predit - t.observe), 0) / n;

  return { tranches: remplies, ecartMoyen: ecart };
}

/** Nombre de cartes à réviser chaque jour à venir — la charge qui s'annonce. */
export function chargePrevisionnelle(progressions, jours = 30, maintenant = Date.now()) {
  const debut = new Date(maintenant).setHours(0, 0, 0, 0);
  const compte = new Array(jours).fill(0);
  let enRetard = 0;
  for (const p of progressions) {
    if (p.prochaine === null) continue;
    const i = Math.floor((p.prochaine - debut) / JOUR_MS);
    if (i < 0) enRetard++;
    else if (i < jours) compte[i]++;
  }
  return { enRetard, parJour: compte };
}

/** Maîtrise par tag : où sont les points faibles. */
export function maitriseParTag(journal) {
  const parTag = new Map();
  for (const e of revisions(journal)) {
    for (const tag of e.tags ?? []) {
      if (!parTag.has(tag)) parTag.set(tag, { tag, total: 0, reussites: 0, tempsTotal: 0 });
      const s = parTag.get(tag);
      s.total++;
      s.tempsTotal += e.tempsMs;
      if (reussie(e)) s.reussites++;
    }
  }
  return [...parTag.values()]
    .map((s) => ({ ...s, taux: s.reussites / s.total, tempsMoyen: s.tempsTotal / s.total }))
    .sort((a, b) => a.taux - b.taux);
}

/**
 * Évolution du temps de réponse sur les bonnes réponses, par tranches.
 * Une notion en cours d'automatisation se répond de plus en plus vite, même
 * quand le taux de réussite, lui, plafonne déjà à 100 %.
 */
export function evolutionTempsReponse(journal, tailleTranche = 50) {
  const justes = journal.filter((e) => e.correcte);
  const points = [];
  for (let i = 0; i < justes.length; i += tailleTranche) {
    const lot = justes.slice(i, i + tailleTranche);
    if (lot.length < Math.min(10, tailleTranche)) break;
    points.push({
      depuis: i,
      tempsMoyenMs: lot.reduce((s, e) => s + e.tempsMs, 0) / lot.length,
      // Normalisé par la longueur : compare des questions de tailles différentes.
      msParCaractere: lot.reduce((s, e) => s + e.tempsMs / Math.max(e.longueur, 1), 0) / lot.length,
    });
  }
  return points;
}

/**
 * Cartes qui résistent. Un fort taux d'échec après plusieurs passages signale
 * le plus souvent une carte mal rédigée (ambiguë, deux notions à la fois)
 * plutôt qu'une notion difficile.
 */
export function cartesProblematiques(journal, { minRevisions = 3, seuil = 0.6 } = {}) {
  const parCarte = new Map();
  for (const e of revisions(journal)) {
    if (!parCarte.has(e.id)) parCarte.set(e.id, { id: e.id, total: 0, echecs: 0 });
    const s = parCarte.get(e.id);
    s.total++;
    if (!reussie(e)) s.echecs++;
  }
  return [...parCarte.values()]
    .filter((s) => s.total >= minRevisions && 1 - s.echecs / s.total < seuil)
    .map((s) => ({ ...s, taux: 1 - s.echecs / s.total }))
    .sort((a, b) => a.taux - b.taux);
}

/** Répartition des notes déduites — pour vérifier que la notation ne dérive pas. */
export function repartitionNotes(journal) {
  const compte = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of journal) compte[e.note]++;
  const total = journal.length || 1;
  return Object.fromEntries(
    Object.entries(compte).map(([n, c]) => [n, { nombre: c, part: c / total }]),
  );
}
