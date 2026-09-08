/**
 * Modèle de mémoire — la courbe d'oubli et l'évolution de l'état d'une carte.
 *
 * On reprend la structure de FSRS (Free Spaced Repetition Scheduler), qui
 * décrit une carte par deux nombres :
 *
 *   S — stabilité : nombre de jours au bout desquels la probabilité de rappel
 *       retombe à 90 %. C'est la « solidité » du souvenir.
 *   D — difficulté : de 1 (trivial) à 10 (coriace). Propre à la carte.
 *
 * Dont on déduit à tout instant :
 *
 *   R — récupérabilité : probabilité de retrouver l'information maintenant.
 *
 * Pourquoi ne pas inventer notre propre courbe : la forme de l'oubli humain
 * est un résultat expérimental, pas un choix de conception. Notre valeur
 * ajoutée est ailleurs (voir notation.js), pas ici.
 */

/**
 * Paramètres de la courbe d'oubli, en loi de puissance.
 * DECAY = -0,5 et FACTOR choisis pour que R(S) = 0,9 exactement.
 */
export const DECAY = -0.5;
export const FACTOR = 19 / 81; // ≈ 0,2345

/**
 * Poids du modèle.
 *
 * ⚠️ Ce sont les valeurs par défaut publiées de FSRS-5, retranscrites comme
 * point de départ. Elles proviennent d'un ajustement sur un très large corpus
 * de révisions réelles. Deux conséquences :
 *
 *  1. À vérifier contre l'implémentation de référence avant de s'y fier pour
 *     de la planification sérieuse — je les ai écrites de mémoire.
 *  2. Elles ne sont qu'une amorce : dès que l'historique de l'utilisateur est
 *     assez fourni, l'objectif est de les réajuster sur SES données (c'est le
 *     « à notre sauce » — voir calibration.js, à venir).
 *
 * La structure des formules, elle, est fiable et testée ci-dessous.
 */
export const POIDS_DEFAUT = [
  0.40255, 1.18385, 3.173, 15.69105, // w0-w3 : stabilité initiale par note
  7.1949, 0.5345,                    // w4-w5 : difficulté initiale
  1.4604, 0.0046,                    // w6-w7 : évolution de la difficulté
  1.54575, 0.1192, 1.01925,          // w8-w10 : gain de stabilité en réussite
  1.9395, 0.11, 0.29605, 2.2698,     // w11-w14 : stabilité après un échec
  0.2315, 2.9898,                    // w15-w16 : malus « difficile », bonus « facile »
  0.51655, 0.6621,                   // w17-w18 : révisions le jour même
];

const S_MIN = 0.01;
const D_MIN = 1;
const D_MAX = 10;

const borner = (x, min, max) => Math.min(max, Math.max(min, x));

/**
 * Probabilité de se rappeler la carte après `jours` jours sans la revoir.
 * R(0) = 1, décroît vers 0. Vaut 0,9 quand jours = S.
 */
export function recuperabilite(stabilite, jours) {
  if (jours <= 0) return 1;
  return Math.pow(1 + (FACTOR * jours) / Math.max(stabilite, S_MIN), DECAY);
}

/**
 * Inverse de la précédente : dans combien de jours R tombera-t-il à
 * `retentionCible` ? C'est la date de la prochaine révision.
 */
export function intervalle(stabilite, retentionCible = 0.9) {
  const r = borner(retentionCible, 0.5, 0.995);
  return (Math.max(stabilite, S_MIN) / FACTOR) * (Math.pow(r, 1 / DECAY) - 1);
}

/** Difficulté attribuée à une carte jamais vue, selon la note obtenue. */
function difficulteInitiale(note, w) {
  return borner(w[4] - Math.exp(w[5] * (note - 1)) + 1, D_MIN, D_MAX);
}

/** État d'une carte vue pour la première fois. */
export function etatInitial(note, poids = POIDS_DEFAUT) {
  const w = poids;
  return {
    stabilite: Math.max(w[note - 1], S_MIN),
    difficulte: difficulteInitiale(note, w),
  };
}

/**
 * Nouvelle difficulté après une révision.
 *
 * Deux mécanismes empilés : une variation proportionnelle à l'écart de la note
 * à « Correct », amortie près des bornes ; puis un rappel vers la difficulté
 * d'une carte facile, qui empêche une carte de rester définitivement marquée
 * comme infernale après quelques mauvais jours. C'est précisément ce qui
 * manquait à SM-2 et provoquait son « trou noir ».
 */
function majDifficulte(difficulte, note, w) {
  const delta = -w[6] * (note - 3);
  const amortie = difficulte + delta * ((10 - difficulte) / 9);
  const rappelee = w[7] * difficulteInitiale(4, w) + (1 - w[7]) * amortie;
  return borner(rappelee, D_MIN, D_MAX);
}

/** Stabilité après une réussite. */
function stabiliteReussite(stabilite, difficulte, r, note, w) {
  const malusDifficile = note === 2 ? w[15] : 1;
  const bonusFacile = note === 4 ? w[16] : 1;
  const gain =
    Math.exp(w[8]) *
    (11 - difficulte) *
    Math.pow(stabilite, -w[9]) *
    (Math.exp(w[10] * (1 - r)) - 1) *
    malusDifficile *
    bonusFacile;
  return Math.max(stabilite * (1 + gain), S_MIN);
}

/**
 * Stabilité après un échec.
 * Elle s'effondre, mais pas à zéro : une carte déjà travaillée se réapprend
 * plus vite qu'une carte neuve. Et elle ne peut jamais *augmenter* après un
 * oubli — d'où le plafonnement final.
 */
function stabiliteEchec(stabilite, difficulte, r, w) {
  const apres =
    w[11] *
    Math.pow(difficulte, -w[12]) *
    (Math.pow(stabilite + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r));
  return borner(apres, S_MIN, stabilite);
}

/**
 * Stabilité lors d'une reprise le jour même (carte ratée puis refaite dans la
 * foulée). Elle progresse à peine : réussir 30 secondes après avoir vu la
 * réponse ne prouve rien sur la mémoire à long terme.
 */
function stabiliteMemeJour(stabilite, note, w) {
  const s = stabilite * Math.exp(w[17] * (note - 3 + w[18]));
  return Math.max(s, S_MIN);
}

/**
 * Fait évoluer l'état d'une carte après une révision.
 *
 * @param {{stabilite:number, difficulte:number}|null} etat  null = carte neuve
 * @param {number} note        1 Encore · 2 Difficile · 3 Correct · 4 Facile
 * @param {number} joursEcoules  depuis la dernière révision
 * @returns {{stabilite:number, difficulte:number, recuperabiliteAvant:number}}
 */
export function reviser(etat, note, joursEcoules, poids = POIDS_DEFAUT) {
  const w = poids;
  if (!Number.isInteger(note) || note < 1 || note > 4) {
    throw new RangeError(`Note invalide : ${note} (attendu 1 à 4)`);
  }

  if (!etat) {
    return { ...etatInitial(note, w), recuperabiliteAvant: 1 };
  }

  const r = recuperabilite(etat.stabilite, joursEcoules);
  const difficulte = majDifficulte(etat.difficulte, note, w);

  let stabilite;
  if (joursEcoules < 1) {
    stabilite = stabiliteMemeJour(etat.stabilite, note, w);
  } else if (note === 1) {
    stabilite = stabiliteEchec(etat.stabilite, etat.difficulte, r, w);
  } else {
    stabilite = stabiliteReussite(etat.stabilite, etat.difficulte, r, note, w);
  }

  return { stabilite, difficulte, recuperabiliteAvant: r };
}
