/**
 * Planificateur — décide QUOI réviser maintenant, et QUAND revoir ensuite.
 */

import { intervalle, recuperabilite } from './memoire.js';
import { melanger } from './presentation.js';

export const JOUR_MS = 86_400_000;

export const REGLAGES_PLAN = {
  retentionCible: 0.9,
  /**
   * Cartes jamais vues introduites par JOUR — pas par séance.
   * C'est le seul vrai frein à la charge de révision future : chaque nouvelle
   * carte engendre une dizaine de révisions dans les mois qui suivent.
   * Le décompte quotidien est tenu par le moteur (voir Moteur.demarrerSeance).
   */
  limiteNouvelles: 20,
  /** Plafond de révisions par séance, pour ne pas décourager après une pause. */
  limiteRevisions: 200,

  /**
   * Ordre des questions dans la séance.
   *   'risque'    — les plus proches de l'oubli d'abord (défaut, le plus efficace)
   *   'aleatoire' — ordre brassé, stable sur la journée
   */
  ordre: 'risque',
  /** Bornes de sécurité sur l'intervalle calculé. */
  intervalleMinJours: 1,
  intervalleMaxJours: 365 * 5,
  /** Une carte ratée revient après ce nombre d'autres cartes, dans la séance. */
  ecartReprise: 5,
};

/** Fiche de progression d'une carte jamais étudiée. */
export function progressionVierge(id) {
  return {
    id,
    etat: null,           // { stabilite, difficulte } — null tant que jamais vue
    derniereRevision: null,
    prochaine: null,      // horodatage ; null = à introduire
    nbRevisions: 0,
    nbReussites: 0,
    nbEchecs: 0,
  };
}

/**
 * Date de la prochaine révision.
 * L'intervalle brut est arrondi au jour et borné : en dessous d'un jour on
 * n'apporte plus rien, au-delà de quelques années la prédiction ne veut plus
 * dire grand-chose.
 */
export function prochaineRevision(etat, depuis, reglages = REGLAGES_PLAN) {
  const { retentionCible, intervalleMinJours, intervalleMaxJours } = reglages;
  const jours = Math.min(
    Math.max(Math.round(intervalle(etat.stabilite, retentionCible)), intervalleMinJours),
    intervalleMaxJours,
  );
  return { jours, date: depuis + jours * JOUR_MS };
}

export function estDue(progression, maintenant) {
  return progression.prochaine !== null && progression.prochaine <= maintenant;
}

/** Probabilité actuelle de rappel — sert à hiérarchiser l'urgence. */
export function risque(progression, maintenant) {
  if (!progression.etat || progression.derniereRevision === null) return 1;
  const jours = (maintenant - progression.derniereRevision) / JOUR_MS;
  return recuperabilite(progression.etat.stabilite, jours);
}

/**
 * Construit la file d'une séance.
 *
 * Les cartes dues sont classées par récupérabilité croissante : les plus
 * proches de l'oubli d'abord. Réviser une carte encore solide est du temps
 * perdu ; en rater une de peu coûte une remise à zéro de sa stabilité.
 *
 * Les nouvelles cartes sont réparties régulièrement entre les révisions plutôt
 * qu'agglutinées à la fin, où la fatigue les condamnerait.
 */
export function construireFile({
  cartes, progressions, maintenant, reglages = REGLAGES_PLAN,
  section = null, recueil = null, inclureNonDues = false,
}) {
  const { limiteRevisions } = reglages;
  // Travailler un chapitre à la demande, c'est du bachotage assumé : on prend
  // tout ce qu'il contient, y compris ce qui n'est pas encore dû, et le quota
  // quotidien de découvertes ne s'applique pas.
  const limiteNouvelles = inclureNonDues ? limiteRevisions : reglages.limiteNouvelles;

  // Un recueil regroupe plusieurs sections : on peut viser l'un ou l'autre.
  const retenues = cartes.filter((c) =>
    (section === null || c.section === section)
    && (recueil === null || c.recueil === recueil));

  const dues = [];
  const neuves = [];
  for (const carte of retenues) {
    const p = progressions.get(carte.id);
    if (!p || p.prochaine === null) neuves.push(carte);
    else if (inclureNonDues || estDue(p, maintenant)) dues.push(carte);
  }

  /*
   * Toute séance est brassée avant d'être ordonnée.
   *
   * Sans cela, une série lancée deux fois de suite posait exactement les mêmes
   * questions dans exactement le même ordre : les cartes jamais vues ont toutes
   * la même urgence, un tri les laisse donc dans l'ordre du fichier. On finit
   * par retenir la SUITE plutôt que le contenu — le même piège que les
   * propositions toujours à la même place.
   *
   * La graine dépend de l'instant, donc chaque lancement diffère. Aucune séance
   * n'est reprise en cours de route : elle n'est pas enregistrée, une
   * interruption la recommence de toute façon.
   */
  const graine = reglages.graine ?? maintenant;
  const brasses = melanger(dues, graine);

  if (reglages.ordre !== 'aleatoire') {
    // Tri stable APRÈS brassage : à urgence égale — le cas de toutes les
    // cartes neuves — l'ordre reste celui du brassage, pas celui du fichier.
    brasses.sort((a, b) =>
      risque(progressions.get(a.id), maintenant) - risque(progressions.get(b.id), maintenant));
  }

  const revisions = brasses.slice(0, limiteRevisions);
  const nouvelles = melanger(neuves, graine + 1).slice(0, limiteNouvelles);
  if (nouvelles.length === 0) return revisions;
  if (revisions.length === 0) return nouvelles;

  // Points d'insertion centrés sur chaque tranche (0,5·pas, 1,5·pas, …) plutôt
  // qu'à leur fin : sinon la dernière nouvelle carte tombe pile au dernier rang,
  // là où la fatigue est maximale — précisément ce qu'on cherchait à éviter.
  const file = [];
  const pas = revisions.length / nouvelles.length;
  let i = 0;
  for (const [k, r] of revisions.entries()) {
    while (i < nouvelles.length && k >= (i + 0.5) * pas) file.push(nouvelles[i++]);
    file.push(r);
  }
  file.push(...nouvelles.slice(i));
  return file;
}

/**
 * File d'une séance en cours.
 *
 * Sa seule subtilité : une carte ratée ne disparaît pas jusqu'au lendemain,
 * elle est réinjectée quelques cartes plus loin. C'est ce qui permet de
 * repartir en ayant réellement appris, et non sur un échec.
 */
export class Session {
  /**
   * @param {string} mode 'apprentissage' (défaut) ou 'examen'.
   *   En examen, une carte ratée n'est PAS réinjectée : un examen ne repose
   *   pas deux fois la même question, et le corrigé n'arrive qu'à la fin.
   */
  constructor(file, reglages = REGLAGES_PLAN, mode = 'apprentissage', graine = 0) {
    this.reglages = reglages;
    this.mode = mode;
    /** Distingue deux séances : sert à rebrasser les propositions. */
    this.graine = graine;
    this.file = [...file];
    this.position = 0;
    this.reprises = 0;
  }

  get restantes() {
    return this.file.length - this.position;
  }

  courante() {
    return this.position < this.file.length ? this.file[this.position] : null;
  }

  /**
   * Avance d'une carte. `reussie === false` replanifie la carte dans la séance.
   * On ne réinjecte qu'une carte déjà présente : pas de boucle infinie possible
   * puisque chaque reprise consomme une position.
   */
  avancer(reussie) {
    const carte = this.courante();
    if (!carte) return null;
    this.position++;
    if (!reussie && this.mode !== 'examen') {
      const cible = Math.min(this.position + this.reglages.ecartReprise, this.file.length);
      this.file.splice(cible, 0, carte);
      this.reprises++;
    }
    return this.courante();
  }
}
