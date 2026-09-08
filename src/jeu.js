/**
 * Moteur du jeu — « Le Millionnaire ».
 *
 * Volontairement étanche au moteur de révision : aucune date n'est touchée,
 * aucun profil de vitesse alimenté, aucune carte créée. On peut y passer la
 * soirée sans dérégler quoi que ce soit.
 *
 * Ce fichier ne connaît ni le DOM ni le stockage : il décide quelle question
 * poser, ce que vaut une réponse, et où l'on en est. L'interface s'y branche.
 */

import { melanger } from './presentation.js';

/** Échelle des gains, telle que la version française de l'émission. */
export const ECHELLE = [
  100, 200, 300, 500, 1_500,
  3_000, 6_000, 12_000, 24_000, 72_000,
  150_000, 300_000, 500_000, 700_000, 1_000_000,
];

/**
 * Rangs (1-indexés) où les gains deviennent définitivement acquis.
 * Ceux de l'émission, gardés tels quels. Seul le second coïncide avec un
 * changement de niveau (Q10 ouvre la difficulté 4) ; le premier tombe au
 * milieu de la difficulté 2, ce qui sécurise tôt — avant que ça devienne
 * sérieux, et c'est bien l'intention d'un filet.
 */
export const PALIERS = [5, 10];

/**
 * Temps de réflexion par rang, en secondes.
 *
 * Un chrono unique serait injuste : une question de difficulté 5 comme
 * « ce poste en /26 joint-il cette adresse ? » demande dix secondes rien que
 * pour être lue, avant tout calcul. On perdrait le million sur un défaut de
 * lecture et non de connaissance.
 */
export const SECONDES_DU_RANG = (rang) => (rang < 5 ? 20 : rang < 10 ? 30 : 45);

/** Niveau visé par un rang, à titre indicatif : trois rangs par niveau. */
export const DIFFICULTE_DU_RANG = (rang) => Math.floor(rang / 3) + 1;

/**
 * Départage deux questions de même difficulté déclarée.
 * L'étiquette du modèle est grossière — cinq valeurs pour 3 000 questions —
 * mais le procédé qui a produit la question porte une information réelle :
 * un « analyser » exige plus qu'un « retourner » sur la même matière.
 */
const POIDS_PROCEDE = {
  originale: 0, durcir: 1, retourner: 1, appliquer: 2, analyser: 3,
};

/**
 * Classe la banque du plus facile au plus difficile, puis la découpe en quinze
 * tranches égales — une par rang.
 *
 * On ne se fie PAS aux étiquettes de difficulté pour composer les rangs. Les
 * mesures sur le pilote montrent une distribution en cloche très instable :
 * selon la formulation du prompt, la difficulté 5 rassemblait 96, 160 ou 191
 * questions pendant que la difficulté 3 en comptait plus de 1 200. Fonder les
 * rangs 13 à 15 sur cette étiquette les affamerait au gré d'un caprice de
 * rédaction. Le classement, lui, reste valable quelle que soit l'échelle : on
 * demande « les 7 % les plus durs », pas « celles étiquetées 5 ».
 *
 * @returns {object[][]} quinze tranches, de la plus facile à la plus difficile
 */
export function classer(banque) {
  const score = (q) => (q.difficulte ?? 3) * 10 + (POIDS_PROCEDE[q.procede] ?? 0);
  // `id` en dernier critère : sans lui l'ordre dépendrait de celui du fichier,
  // et deux banques identiques produiraient des tranches différentes.
  const triee = [...banque].sort((a, b) => score(a) - score(b) || (a.id < b.id ? -1 : 1));

  const tranches = [];
  for (let r = 0; r < ECHELLE.length; r++) {
    const debut = Math.floor((r * triee.length) / ECHELLE.length);
    const fin = Math.floor(((r + 1) * triee.length) / ECHELLE.length);
    tranches.push(triee.slice(debut, fin));
  }
  return tranches;
}

export const RESULTAT = {
  JUSTE: 'juste',
  FAUX: 'faux',
  TEMPS: 'temps',        // chrono écoulé — compte comme une erreur
  INTERROMPU: 'interrompu', // application mise en arrière-plan : non comptabilisé
};

/**
 * Choisit la question d'un rang.
 *
 * Les règles, dans l'ordre :
 *   1. jamais deux fois dans la même partie ;
 *   2. priorité absolue à ce qui n'a jamais été vu ;
 *   3. ensuite la moins récemment vue ;
 *   4. un peu de hasard parmi les meilleures candidates, pour que
 *      l'enchaînement ne sente pas la mécanique.
 *
 * Aucune répétition espacée ici, délibérément : un planificateur ramènerait en
 * priorité ce qu'on rate, et le sommet de l'échelle deviendrait un mur composé
 * uniquement de nos échecs. On cherche de la variété, pas de la mémorisation.
 *
 * @param {object[][]} tranches  sortie de classer(), quinze tranches classées
 * @param {Map<string, number>} vues  id -> numéro de la partie où elle est tombée
 * @param {Set<string>} exclues  déjà posées dans la partie en cours
 * @param {number} rang        0 à 14
 * @param {number} graine      pour rendre le tirage reproductible
 */
export function tirer(tranches, vues, exclues, rang, graine) {
  // Si la tranche visée est épuisée, on déborde sur les voisines plutôt que
  // d'échouer : mieux vaut une question un peu décalée que pas de question.
  let candidates = [];
  for (let ecart = 0; ecart < tranches.length && candidates.length === 0; ecart++) {
    candidates = tranches
      .filter((_, i) => Math.abs(i - rang) <= ecart)
      .flat()
      .filter((q) => !exclues.has(q.id));
  }
  if (candidates.length === 0) return null;

  // La priorité aux inédites doit être ABSOLUE : s'il en reste ne serait-ce
  // qu'une, le hasard ne doit pas pouvoir lui préférer une déjà vue. On isole
  // donc le groupe avant de brasser, au lieu de brasser un classement global.
  const inedites = candidates.filter((q) => !vues.has(q.id));
  const groupe = inedites.length > 0
    ? inedites
    : candidates.sort((a, b) => vues.get(a.id) - vues.get(b.id));

  // Le hasard ne porte que sur une fraction du groupe, jamais sur tout : sur
  // un réservoir abondant on brasse les 20 plus anciennes — assez pour que
  // l'enchaînement ne sente pas la mécanique — mais quand il ne reste que
  // quelques candidates, on prend franchement la plus ancienne.
  const largeur = Math.max(1, Math.min(20, Math.ceil(groupe.length / 4)));
  return melanger(groupe.slice(0, largeur), graine + rang)[0];
}

/**
 * Une partie en cours.
 *
 * L'objet ne mesure pas le temps lui-même — l'interface le fait, et lui
 * transmet le verdict. Garder le chronomètre dehors permet de le figer pendant
 * un joker sans que le moteur ait à connaître les jokers.
 */
export class Partie {
  /**
   * @param {object[]} banque
   * @param {Map<string, number>} vues  historique, modifié au fil de la partie
   * @param {number} numero  numéro de cette partie, sert d'horodatage aux vues
   * @param {number} graine
   */
  constructor(banque, vues, numero, graine = 1) {
    this.banque = banque;
    this.tranches = classer(banque);
    this.vues = vues;
    this.numero = numero;
    this.graine = graine;

    this.rang = 0;
    this.exclues = new Set();
    this.jokers = { moitie: true, changer: true, indice: true };
    this.jokersUtilises = new Set(); // sur la question courante
    this.eteintes = new Set();       // options masquées par le 50:50
    this.terminee = false;
    this.erreurs = 0;
    this.gain = 0;
    this.parcours = [];              // trace, pour le bilan de fin
    this.question = null;

    this.avancer();
  }

  /** Ce qu'on emporte si la partie s'arrête maintenant : le dernier palier franchi. */
  filet() {
    const franchis = PALIERS.filter((p) => p <= this.rang);
    return franchis.length ? ECHELLE[franchis.at(-1) - 1] : 0;
  }

  /**
   * Rang au-dessous duquel une erreur ne peut pas faire redescendre.
   * C'est là tout le sens d'un palier de sécurité : une fois franchi, il
   * devient un plancher. Sans lui, la redescente pourrait tout reprendre.
   */
  plancher() {
    const franchis = PALIERS.filter((p) => p <= this.rang);
    return franchis.length ? franchis.at(-1) : 0;
  }

  /** Somme en jeu sur la question courante. */
  enJeu() {
    return ECHELLE[this.rang];
  }

  secondes() {
    return SECONDES_DU_RANG(this.rang);
  }

  /** Pose la question du rang courant. */
  avancer() {
    const q = tirer(this.tranches, this.vues, this.exclues, this.rang, this.graine);
    if (!q) { this.arreter(); return null; }
    this.exclues.add(q.id);
    this.eteintes = new Set();
    this.jokersUtilises = new Set();
    this.question = q;
    return q;
  }

  /**
   * Enregistre une réponse et fait avancer la partie.
   * @param {number|null} choix  index de l'option, null si le temps est écoulé
   * @param {string} [cause]  RESULTAT.TEMPS ou RESULTAT.INTERROMPU
   */
  repondre(choix, cause = null) {
    if (this.terminee) return null;
    const q = this.question;

    // Interruption : l'utilisateur a reçu un appel, la mesure ne veut rien
    // dire. On repose la même question plutôt que de sanctionner.
    if (cause === RESULTAT.INTERROMPU) {
      return { resultat: RESULTAT.INTERROMPU, question: q };
    }

    const juste = choix !== null && choix === q.bonne;
    const resultat = choix === null ? RESULTAT.TEMPS : (juste ? RESULTAT.JUSTE : RESULTAT.FAUX);

    this.vues.set(q.id, this.numero);
    this.parcours.push({
      id: q.id, rang: this.rang, question: q.question, options: q.options,
      bonne: q.bonne, choix, resultat, explication: q.explication,
      avecJoker: this.jokersUtilises.size > 0,
    });

    const rangAvant = this.rang;

    if (!juste) {
      /*
       * Une erreur ne met pas fin à la partie : elle fait redescendre d'un
       * rang, sans jamais repasser sous le dernier palier franchi. La sanction
       * reste réelle — on perd le terrain gagné — mais on peut se rattraper.
       *
       * La partie ne s'arrête que de deux façons : atteindre le sommet, ou
       * quitter. C'est un jeu d'escalade, pas d'élimination.
       */
      this.erreurs++;
      this.rang = Math.max(this.plancher(), this.rang - 1);
      this.gain = this.filet();
      const suivante = this.avancer();
      return { resultat, question: q, suivante, rangAvant, rangApres: this.rang };
    }

    if (this.rang === ECHELLE.length - 1) {
      this.gain = ECHELLE.at(-1);
      this.terminee = true;
      return { resultat, question: q, gain: this.gain, jackpot: true,
               rangAvant, rangApres: this.rang };
    }

    this.rang++;
    this.gain = this.filet();
    const suivante = this.avancer();
    return { resultat, question: q, suivante, rangAvant, rangApres: this.rang };
  }

  /** L'utilisateur s'arrête : il emporte le rang précédent, pas celui en jeu. */
  arreter() {
    if (this.terminee) return this.gain;
    this.gain = this.rang === 0 ? 0 : ECHELLE[this.rang - 1];
    this.terminee = true;
    return this.gain;
  }

  /**
   * Consomme un joker.
   * @returns {object|null} l'effet, ou null si indisponible
   */
  utiliserJoker(nom) {
    if (this.terminee || !this.jokers[nom]) return null;
    this.jokers[nom] = false;
    this.jokersUtilises.add(nom);
    const q = this.question;

    if (nom === 'moitie') {
      // On éteint deux mauvaises sans bouger les autres : les lettres doivent
      // rester à leur place, sinon on perd le fil de ce qu'on lisait.
      const mauvaises = q.options.map((_, i) => i).filter((i) => i !== q.bonne);
      for (const i of melanger(mauvaises, this.graine + this.rang).slice(0, 2)) {
        this.eteintes.add(i);
      }
      return { eteintes: [...this.eteintes] };
    }

    if (nom === 'changer') {
      // La question écartée reste exclue : on ne veut pas la revoir plus loin
      // dans la même partie.
      const suivante = this.avancer();
      // avancer() a réinitialisé les jokers utilisés ; on le retient quand même,
      // pour que le bilan sache que ce rang a coûté un joker.
      this.jokersUtilises.add('changer');
      return suivante ? { question: suivante } : null;
    }

    return { indice: q.indice ?? null };
  }
}
