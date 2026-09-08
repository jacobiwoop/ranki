/**
 * Notation déduite — le cœur de ce qui nous distingue d'Anki.
 *
 * Anki demande à l'utilisateur de s'auto-noter de 1 à 4. Ici on ne demande
 * rien : on observe. La note est reconstruite à partir de signaux objectifs.
 *
 *   1 Encore     · réponse fausse
 *   2 Difficile  · juste, mais laborieux, hésitant, ou probablement deviné
 *   3 Correct    · juste, à son rythme habituel
 *   4 Facile     · juste et nettement plus vite que d'habitude
 *
 * Toute la subtilité est dans « son rythme habituel ». Un temps de réponse
 * brut ne veut rien dire :
 *
 *   - une question longue prend du temps à LIRE, avant même de réfléchir ;
 *   - « 4 secondes » est lent pour l'un, rapide pour l'autre ;
 *   - un téléphone qu'on repose fausse tout.
 *
 * D'où ProfilUtilisateur, qui apprend en continu la relation entre longueur du
 * texte et temps de réponse propre à CET utilisateur, et juge chaque réponse
 * à l'aune de ses propres habitudes plutôt que d'un seuil arbitraire.
 */

export const ENCORE = 1;
export const DIFFICILE = 2;
export const CORRECT = 3;
export const FACILE = 4;

export const REGLAGES = {
  /** En deçà, on n'a pas assez de données : on retombe sur les seuils absolus. */
  echantillonMinimal: 20,
  /** Nombre de réponses conservées pour calibrer le profil. */
  fenetre: 200,
  /** Au-delà, l'utilisateur a été interrompu : la mesure n'a plus de sens. */
  plafondMs: 60_000,
  /** En deçà, le clic est trop rapide pour être une lecture : réflexe ou erreur. */
  plancherMs: 250,

  /** Repli quand le profil n'est pas encore calibré (ms de réflexion pure). */
  seuilFacileMs: 1_500,
  seuilDifficileMs: 5_000,
  /** Vitesse de lecture initiale, réajustée dès que les données arrivent. */
  msParCaractere: 45,
  latenceMs: 600,

  /** Quantiles de découpe : sous p33 « facile », au-dessus de p66 « difficile ». */
  quantileFacile: 0.33,
  quantileDifficile: 0.66,

  /**
   * Zone morte autour du rythme habituel — simple garde-fou.
   *
   * Les quantiles sont un classement RELATIF : à eux seuls ils rangeraient un
   * tiers des bonnes réponses en « Difficile » même si les écarts se comptaient
   * en millisecondes. Cette marge impose un écart absolu minimal.
   *
   * Elle reste VOLONTAIREMENT petite. `simulation/balayage.js` montre que la
   * dispersion réelle des temps est large (elle vient de la mémoire, pas du
   * bruit moteur), si bien qu'élargir la zone morte ne fait que dégrader le
   * rendement : 4,91 cartes acquises pour 100 révisions à 0 ms, 4,84 à 100 ms,
   * 4,40 à 700 ms — pendant que la note « Difficile » se raréfie.
   * On ne garde donc qu'un plancher contre les distributions dégénérées.
   */
  margeMinimaleMs: 100,

  /** Un temps de réflexion sous ce seuil sur une carte jamais réussie sent le hasard. */
  seuilDevinageMs: 900,

  /**
   * Score minimal pour qu'une réponse partielle compte comme un rappel.
   *
   * En dessous, c'est un oubli (« Encore ») ; au-dessus mais sous le score
   * plein, c'est au mieux « Difficile » — on a retrouvé l'essentiel, pas tout.
   * Une réponse partielle ne peut jamais valoir « Correct » ou « Facile » :
   * le temps de réponse ne rachète pas une réponse incomplète.
   *
   * Fixé à la moitié, et pas plus haut : sur une question à deux bonnes
   * réponses — le cas le plus courant — les seuls scores possibles sont 1,
   * 0,5 et 0. Un seuil supérieur rendrait le crédit partiel inopérant là où
   * on l'attend le plus.
   */
  seuilPartiel: 0.5,
};

/** Quantile d'un tableau déjà trié, par interpolation linéaire. */
function quantile(triees, q) {
  if (triees.length === 0) return NaN;
  const pos = (triees.length - 1) * q;
  const bas = Math.floor(pos);
  const haut = Math.ceil(pos);
  if (bas === haut) return triees[bas];
  return triees[bas] + (triees[haut] - triees[bas]) * (pos - bas);
}

/**
 * Profil de vitesse d'un utilisateur.
 *
 * Modèle : temps ≈ latence + pente × longueur_du_texte.
 * On l'ajuste par moindres carrés sur les bonnes réponses récentes, puis on
 * regarde le RÉSIDU de chaque nouvelle réponse — l'écart à ce qu'on attendait
 * d'elle vu sa longueur. Un résidu très négatif = anormalement rapide = facile.
 *
 * Travailler sur le résidu plutôt que sur le temps brut neutralise d'un coup
 * l'effet de la longueur du texte ET les différences entre utilisateurs.
 */
export class ProfilUtilisateur {
  constructor(reglages = REGLAGES) {
    this.reglages = reglages;
    /** @type {{longueur:number, tempsMs:number}[]} */
    this.echantillons = [];
    this.latence = reglages.latenceMs;
    this.pente = reglages.msParCaractere;
    this.residusTries = [];
  }

  /** N'apprend que sur les bonnes réponses : une erreur ne mesure pas une vitesse. */
  enregistrer({ longueur, tempsMs, correcte }) {
    const { plafondMs, plancherMs, fenetre } = this.reglages;
    if (!correcte) return;
    if (tempsMs > plafondMs || tempsMs < plancherMs) return;

    this.echantillons.push({ longueur, tempsMs });
    if (this.echantillons.length > fenetre) this.echantillons.shift();
    this.recalibrer();
  }

  get calibre() {
    return this.echantillons.length >= this.reglages.echantillonMinimal;
  }

  /** Régression linéaire simple, puis distribution des résidus. */
  recalibrer() {
    if (!this.calibre) return;
    const n = this.echantillons.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const { longueur, tempsMs } of this.echantillons) {
      sx += longueur; sy += tempsMs;
      sxy += longueur * tempsMs; sxx += longueur * longueur;
    }
    const denom = n * sxx - sx * sx;

    // denom ≈ 0 : toutes les questions font la même longueur, la pente n'est
    // pas identifiable. On garde alors la vitesse de lecture par défaut.
    if (Math.abs(denom) > 1e-9) {
      const pente = (n * sxy - sx * sy) / denom;
      // Une pente négative ou absurde signale un échantillon trop bruité :
      // lire plus de texte ne peut pas rendre plus rapide.
      if (pente > 0 && pente < 500) {
        this.pente = pente;
        this.latence = (sy - pente * sx) / n;
      }
    }

    this.residusTries = this.echantillons
      .map(({ longueur, tempsMs }) => tempsMs - this.tempsAttendu(longueur))
      .sort((a, b) => a - b);
  }

  tempsAttendu(longueur) {
    return this.latence + this.pente * longueur;
  }

  /** Écart entre le temps réellement pris et celui attendu pour cette longueur. */
  residu(longueur, tempsMs) {
    return tempsMs - this.tempsAttendu(longueur);
  }

  seuils() {
    const { quantileFacile, quantileDifficile } = this.reglages;
    return {
      facile: quantile(this.residusTries, quantileFacile),
      difficile: quantile(this.residusTries, quantileDifficile),
    };
  }

  /** Sérialisable tel quel : c'est ce qu'on stockera dans le navigateur. */
  toJSON() {
    return { echantillons: this.echantillons, latence: this.latence, pente: this.pente };
  }

  static depuisJSON(donnees, reglages = REGLAGES) {
    const p = new ProfilUtilisateur(reglages);
    if (donnees) {
      p.echantillons = donnees.echantillons ?? [];
      p.latence = donnees.latence ?? reglages.latenceMs;
      p.pente = donnees.pente ?? reglages.msParCaractere;
      p.recalibrer();
    }
    return p;
  }
}

/**
 * Déduit la note d'une réponse.
 *
 * @param {object} rep
 * @param {boolean} rep.correcte          toutes les bonnes cases, et elles seules
 * @param {number}  [rep.score]           0 à 1 ; par défaut déduit de `correcte`
 * @param {number}  rep.tempsMs           de l'affichage à la validation
 * @param {number}  rep.longueur          caractères affichés (question + propositions)
 * @param {number}  [rep.nbChangements]   cases cochées puis décochées avant validation
 * @param {number}  [rep.nbPropositions]
 * @param {boolean} [rep.reponsesMultiples]
 * @param {{nbRevisions:number, nbReussites:number}} [rep.historique]
 * @param {ProfilUtilisateur} rep.profil
 * @returns {{note:number, raisons:string[]}} la note et sa justification
 */
export function noter({
  correcte,
  score,
  tempsMs,
  longueur,
  nbChangements = 0,
  nbPropositions = 4,
  reponsesMultiples = false,
  historique = { nbRevisions: 0, nbReussites: 0 },
  profil,
}) {
  const R = profil?.reglages ?? REGLAGES;
  const raisons = [];
  const note0a1 = score ?? (correcte ? 1 : 0);

  if (note0a1 <= 0) return { note: ENCORE, raisons: ['réponse fausse'] };

  // Réponse partielle : on a retrouvé une partie seulement. Le chronomètre ne
  // dit plus rien d'utile ici — répondre vite à moitié ne vaut pas mieux que
  // lentement. Seul compte ce qui manque.
  if (note0a1 < 1) {
    const part = `${Math.round(note0a1 * 100)} % de la réponse`;
    return note0a1 >= R.seuilPartiel
      ? { note: DIFFICILE, raisons: [`partiellement juste (${part})`] }
      : { note: ENCORE, raisons: [`trop incomplet (${part})`] };
  }

  // Interruption : le chronomètre ne mesure plus une performance cognitive.
  // On ne peut ni récompenser ni pénaliser — note neutre.
  if (tempsMs > R.plafondMs) {
    return { note: CORRECT, raisons: ['temps aberrant, mesure ignorée'] };
  }

  const attendu = profil?.calibre ? profil.tempsAttendu(longueur)
                                  : R.latenceMs + R.msParCaractere * longueur;
  const reflexion = Math.max(0, tempsMs - attendu);

  let note;
  if (profil?.calibre) {
    const { facile, difficile } = profil.seuils();
    const residu = profil.residu(longueur, tempsMs);
    // Il faut franchir le quantile ET s'écarter d'une marge absolue : sinon on
    // sanctionnerait des différences qui ne veulent rien dire.
    const marge = R.margeMinimaleMs;
    if (residu <= Math.min(facile, -marge)) {
      note = FACILE; raisons.push('nettement plus rapide que ton habitude');
    } else if (residu >= Math.max(difficile, marge)) {
      note = DIFFICILE; raisons.push('plus lent que ton habitude');
    } else {
      note = CORRECT; raisons.push('rythme habituel');
    }
  } else {
    if (reflexion <= R.seuilFacileMs) { note = FACILE; raisons.push('réponse immédiate'); }
    else if (reflexion >= R.seuilDifficileMs) { note = DIFFICILE; raisons.push('réponse lente'); }
    else { note = CORRECT; raisons.push('rythme normal'); }
    raisons.push('profil non calibré, seuils par défaut');
  }

  // Hésitation : cocher puis décocher trahit une incertitude que le seul
  // chronomètre ne voit pas — on peut être rapide ET hésitant.
  if (nbChangements >= 2 && note > DIFFICILE) {
    note = DIFFICILE;
    raisons.push(`${nbChangements} changements d'avis`);
  } else if (nbChangements === 1 && note === FACILE) {
    note = CORRECT;
    raisons.push("un changement d'avis");
  }

  // Devinage : sur un QCM à choix unique, le hasard paie 1 fois sur
  // nbPropositions. Juste + quasi instantané + jamais réussie auparavant, c'est
  // le profil du coup de chance. La créditer « Facile » enverrait la carte à
  // trois semaines alors qu'elle n'est pas sue du tout.
  const jamaisReussie = historique.nbReussites === 0;
  if (
    !reponsesMultiples &&
    nbPropositions >= 3 &&
    jamaisReussie &&
    historique.nbRevisions > 0 &&
    tempsMs - attendu < 0 &&
    reflexion < R.seuilDevinageMs &&
    note > DIFFICILE
  ) {
    note = DIFFICILE;
    raisons.push('probable devinage (jamais réussie + quasi instantané)');
  }

  return { note, raisons };
}
