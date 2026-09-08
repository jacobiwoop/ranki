/**
 * Présentation — l'ordre dans lequel les propositions sont affichées.
 *
 * Si l'ordre ne change jamais, on finit par mémoriser « c'est la deuxième »
 * au lieu du contenu. La carte semble sue, l'algorithme l'espace, et le jour
 * de l'examen les propositions sont dans un autre ordre : plus rien.
 *
 * Le mélange est DÉTERMINISTE, dérivé de l'identifiant de la carte et du
 * numéro de passage. Deux conséquences voulues :
 *
 *   - à un passage donné, l'ordre est stable : rafraîchir la page ou revenir
 *     en arrière ne redistribue pas les propositions sous les doigts ;
 *   - d'un passage à l'autre, il change.
 *
 * Rien n'est stocké : l'ordre se recalcule à l'identique quand il le faut.
 */

/** Mélangeur pseudo-aléatoire déterministe (mulberry32) à partir d'une graine. */
function generateur(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage FNV-1a d'une chaîne — même fonction que pour les identifiants. */
function graineDepuis(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Mélange de Fisher-Yates, piloté par un générateur déterministe. */
export function melanger(tableau, graine) {
  const rand = generateur(graine);
  const t = [...tableau];
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
}

export const LETTRES = 'ABCDEFGH';

/**
 * Prépare une carte pour l'affichage.
 *
 * @param {object} carte
 * @param {number} tour   numéro de passage (progression.nbRevisions)
 * @param {boolean} melange  passer false pour conserver l'ordre du fichier
 * @param {number} variante  graine propre à la séance. Sans elle, une carte
 *   jamais répondue garde son tour à 0 et donc le MÊME ordre de propositions
 *   d'un lancement à l'autre : brassé une fois, puis figé.
 * @returns {{propositions: object[], bonnes: number[], lettres: string}}
 *   propositions : dans l'ordre à afficher, chacune enrichie de sa lettre et
 *   de son rang d'origine dans le fichier (utile pour les corrections).
 */
export function preparerAffichage(carte, tour = 0, melange = true, variante = 0) {
  const rangs = carte.propositions.map((_, i) => i);
  const estOrdre = carte.type === 'ordre';

  let ordre = rangs;
  if (melange) {
    ordre = melanger(rangs, graineDepuis(`${carte.id}:${tour}:${variante}`));
    // Sur une question de classement, tomber sur l'ordre d'origine donnerait
    // la réponse toute faite. On retire alors avec une autre graine.
    let essai = 0;
    while (estOrdre && rangs.length > 1
           && ordre.every((r, i) => r === i) && essai < 8) {
      ordre = melanger(rangs, graineDepuis(`${carte.id}:${tour}:${variante}:${++essai}`));
    }
  }

  const propositions = ordre.map((rang, i) => ({
    ...carte.propositions[rang],
    lettre: LETTRES[i],
    rangOrigine: rang,
  }));

  if (estOrdre) {
    // Pas de « bonnes cases » ici : c'est la séquence entière qui est jugée.
    return { type: 'ordre', propositions, bonnes: [], lettres: '' };
  }

  const bonnes = propositions
    .map((p, i) => (p.correcte ? i : -1))
    .filter((i) => i >= 0);

  return {
    type: 'qcm',
    propositions,
    bonnes,
    lettres: bonnes.map((i) => LETTRES[i]).join(''),
  };
}

/**
 * Vérifie un QCM.
 *
 * @param {number[]} choisies  index des propositions cochées, dans l'ordre AFFICHÉ
 * @param {number[]} bonnes    tel que renvoyé par preparerAffichage
 * @param {string} bareme
 *   'partiel' (défaut) — crédite ce qui est trouvé, déduit ce qui est coché à tort ;
 *   'strict'           — tout ou rien, comme un barème d'examen sans point partiel.
 * @returns {{score:number, correcte:boolean, oublies:number[], enTrop:number[]}}
 *   `score` va de 0 à 1 ; `correcte` n'est vrai qu'à score plein.
 */
export function verifier(choisies, bonnes, bareme = 'partiel') {
  const c = new Set(choisies);
  const b = new Set(bonnes);
  const oublies = bonnes.filter((i) => !c.has(i));
  const enTrop = choisies.filter((i) => !b.has(i));
  const parfait = oublies.length === 0 && enTrop.length === 0;

  let score;
  if (bareme === 'strict' || parfait) {
    score = parfait ? 1 : 0;
  } else {
    // Cocher au hasard ne doit rien rapporter : chaque case fausse annule une
    // case juste. Tout cocher « pour être sûr » retombe donc à zéro.
    const trouvees = bonnes.length - oublies.length;
    score = Math.max(0, (trouvees - enTrop.length) / bonnes.length);
  }

  return { score, correcte: parfait, oublies, enTrop };
}

/**
 * Vérifie une question de type « ordre » (classer, chronologie, empilement).
 *
 * @param {number[]} rangsChoisis  rangs d'origine, dans l'ordre proposé par l'utilisateur
 * @param {string} bareme
 *   'paires' (défaut) — proportion de paires correctement ordonnées entre elles.
 *                       Intervertir deux voisines coûte peu ; tout inverser
 *                       donne zéro. C'est la mesure la plus juste.
 *   'positions'       — proportion d'éléments à leur place exacte. Plus sévère :
 *                       décaler toute la liste d'un cran donne 0 alors que
 *                       l'ordre relatif est parfait.
 *   'strict'          — tout ou rien.
 * @returns {{score:number, correcte:boolean, malPlaces:number[]}}
 */
export function verifierOrdre(rangsChoisis, bareme = 'paires') {
  const n = rangsChoisis.length;
  const malPlaces = rangsChoisis
    .map((rang, position) => (rang === position ? -1 : position))
    .filter((p) => p >= 0);
  const parfait = malPlaces.length === 0;

  let score;
  if (bareme === 'strict' || parfait || n < 2) {
    score = parfait ? 1 : 0;
  } else if (bareme === 'positions') {
    score = (n - malPlaces.length) / n;
  } else {
    let concordantes = 0;
    let total = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        total++;
        if (rangsChoisis[i] < rangsChoisis[j]) concordantes++;
      }
    }
    score = total === 0 ? 1 : concordantes / total;
  }

  return { score, correcte: parfait, malPlaces };
}
