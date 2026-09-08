/**
 * Moteur — la façade unique que l'interface appellera.
 *
 * L'interface ne doit connaître que quatre gestes : charger des cartes,
 * démarrer une séance, transmettre une réponse, sauvegarder. Tout le reste
 * (notation déduite, mise à jour mémoire, replanification, journalisation)
 * se passe ici.
 */

import { reviser } from './memoire.js';
import { ProfilUtilisateur, noter } from './notation.js';
import { analyser } from './parseur.js';
import {
  JOUR_MS, REGLAGES_PLAN, Session, construireFile,
  prochaineRevision, progressionVierge,
} from './planificateur.js';

export class Moteur {
  constructor({ cartes = [], progressions = new Map(), profil = new ProfilUtilisateur(),
                journal = [], reglages = REGLAGES_PLAN } = {}) {
    this.cartes = cartes;
    this.index = new Map(cartes.map((c) => [c.id, c]));
    this.progressions = progressions;
    this.profil = profil;
    this.journal = journal;
    this.reglages = reglages;
    this.session = null;
  }

  /**
   * Fusionne un fichier .qcm dans la collection.
   * Les cartes déjà connues (même identifiant, donc même question) voient leur
   * contenu mis à jour SANS perdre leur historique de révision : corriger une
   * explication ne doit pas réinitialiser des semaines de travail.
   *
   * @param {string} texte
   * @param {string} [recueil] nom du fichier d'origine. Il regroupe les cartes
   *   sur l'accueil : un fichier rassemble des sections, et on peut en importer
   *   plusieurs sans que tout se mélange dans une liste à plat.
   */
  importer(texte, recueil = null) {
    const { cartes, erreurs } = analyser(texte);
    let ajoutees = 0;
    let majes = 0;
    for (const carte of cartes) {
      if (recueil) carte.recueil = recueil;
      if (this.index.has(carte.id)) {
        const i = this.cartes.indexOf(this.index.get(carte.id));
        // Réimporter sans nom de fichier ne doit pas effacer celui déjà connu.
        if (!recueil) carte.recueil = this.cartes[i].recueil;
        this.cartes[i] = carte;
        majes++;
      } else {
        this.cartes.push(carte);
        ajoutees++;
      }
      this.index.set(carte.id, carte);
    }
    return { ajoutees, majes, erreurs };
  }

  /**
   * Les recueils importés, chacun avec ses séries.
   *
   * Les cartes d'avant l'introduction de ce champ n'ont pas de recueil : on les
   * regroupe sous un libellé neutre plutôt que de les perdre, et une
   * réimportation du fichier leur rendra son nom.
   */
  recueils(maintenant = Date.now()) {
    const parNom = new Map();

    for (const carte of this.cartes) {
      const nomRecueil = carte.recueil || 'Questions importées';
      const nomSerie = carte.section || 'Sans série';

      if (!parNom.has(nomRecueil)) {
        parNom.set(nomRecueil, {
          nom: nomRecueil, total: 0, dues: 0, neuves: 0, acquises: 0,
          series: [], _index: new Map(),
        });
      }
      const r = parNom.get(nomRecueil);
      // On regroupe par couple (recueil, série) et non par nom de série seul :
      // deux fichiers peuvent très bien nommer un chapitre « Partie 1 ».
      if (!r._index.has(nomSerie)) {
        const s = { nom: nomSerie, recueil: nomRecueil, total: 0, dues: 0, neuves: 0, acquises: 0 };
        r._index.set(nomSerie, s);
        r.series.push(s);
      }
      const s = r._index.get(nomSerie);

      const p = this.progressions.get(carte.id);
      const neuve = !p || p.prochaine === null;
      const due = !neuve && p.prochaine <= maintenant;
      // « Acquise » : la mémoire tient au moins trois semaines.
      const acquise = !neuve && p.etat && p.etat.stabilite >= 21;

      for (const cible of [r, s]) {
        cible.total++;
        if (neuve) cible.neuves++;
        if (due) cible.dues++;
        if (acquise) cible.acquises++;
      }
    }

    for (const r of parNom.values()) delete r._index;
    return [...parNom.values()];
  }

  progression(id) {
    if (!this.progressions.has(id)) this.progressions.set(id, progressionVierge(id));
    return this.progressions.get(id);
  }

  /** Nombre de cartes découvertes depuis minuit — pour un plafond réellement quotidien. */
  nouvellesDuJour(maintenant = Date.now()) {
    const minuit = new Date(maintenant).setHours(0, 0, 0, 0);
    return this.journal.filter((e) => e.premiereVue && e.horodatage >= minuit).length;
  }

  /**
   * Ouvre une séance. On peut en enchaîner autant qu'on veut dans la journée :
   * les révisions dues déjà traitées ont été replanifiées à demain au plus tôt,
   * et le quota de nouvelles cartes est décompté sur la journée entière — sans
   * quoi cinq séances d'affilée en introduiraient cinq fois trop.
   */
  demarrerSeance(maintenant = Date.now(), options = {}) {
    const {
      section = null, recueil = null,
      inclureNonDues = false, mode = 'apprentissage',
    } = options;
    const reglages = {
      ...this.reglages,
      limiteNouvelles: Math.max(
        0, this.reglages.limiteNouvelles - this.nouvellesDuJour(maintenant),
      ),
    };
    const file = construireFile({
      cartes: this.cartes,
      progressions: this.progressions,
      maintenant,
      reglages,
      section,
      recueil,
      inclureNonDues,
    });
    this.session = new Session(file, this.reglages, mode, maintenant);
    return this.session;
  }

  /** Les séries importées, telles qu'elles apparaîtront sur l'accueil. */
  series(maintenant = Date.now()) {
    const parSection = new Map();
    for (const carte of this.cartes) {
      const nom = carte.section || 'Sans série';
      if (!parSection.has(nom)) {
        parSection.set(nom, { nom, total: 0, dues: 0, neuves: 0, acquises: 0 });
      }
      const s = parSection.get(nom);
      s.total++;
      const p = this.progressions.get(carte.id);
      if (!p || p.prochaine === null) s.neuves++;
      else {
        if (p.prochaine <= maintenant) s.dues++;
        // « Acquise » : la mémoire tient au moins trois semaines.
        if (p.etat && p.etat.stabilite >= 21) s.acquises++;
      }
    }
    return [...parSection.values()];
  }

  /**
   * Enregistre une réponse et replanifie la carte.
   *
   * @param {string} idCarte
   * @param {object} reponse  { correcte, tempsMs, nbChangements, noteImposee? }
   *   noteImposee court-circuite la notation déduite. Sert au mode manuel
   *   (l'utilisateur note lui-même, à la façon d'Anki) et au groupe témoin
   *   des simulations — sans quoi on ne pourrait pas mesurer ce que la
   *   déduction apporte réellement.
   * @returns {{note:number, raisons:string[], joursProchains:number}}
   */
  repondre(idCarte, reponse, maintenant = Date.now()) {
    const carte = this.index.get(idCarte);
    if (!carte) throw new Error(`Carte inconnue : ${idCarte}`);
    const p = this.progression(idCarte);

    const score = reponse.score ?? (reponse.correcte ? 1 : 0);
    const { note, raisons } = reponse.noteImposee
      ? { note: reponse.noteImposee, raisons: ['note imposée'] }
      : noter({
        correcte: reponse.correcte,
        score,
        tempsMs: reponse.tempsMs,
        longueur: carte.longueur,
        nbChangements: reponse.nbChangements ?? 0,
        nbPropositions: carte.propositions.length,
        reponsesMultiples: carte.reponsesMultiples,
        historique: p,
        profil: this.profil,
      });

    const joursEcoules = p.derniereRevision === null
      ? 0
      : (maintenant - p.derniereRevision) / JOUR_MS;

    const stabiliteAvant = p.etat?.stabilite ?? null;
    const etat = reviser(p.etat, note, joursEcoules);
    const { jours, date } = prochaineRevision(etat, maintenant, this.reglages);

    this.journal.push({
      id: idCarte,
      horodatage: maintenant,
      correcte: score === 1,
      score,
      // Ce que le modèle de mémoire a considéré comme un rappel réussi. Une
      // réponse partielle compte ici, alors qu'elle n'est pas « correcte » :
      // les statistiques doivent mesurer la même chose que le planificateur.
      reussie: note > 1,
      tempsMs: reponse.tempsMs,
      longueur: carte.longueur,
      note,
      raisons,
      premiereVue: p.nbRevisions === 0,
      recuperabiliteAvant: etat.recuperabiliteAvant,
      stabiliteAvant,
      stabiliteApres: etat.stabilite,
      section: carte.section,
      tags: carte.tags,
    });

    p.etat = { stabilite: etat.stabilite, difficulte: etat.difficulte };
    p.derniereRevision = maintenant;
    p.prochaine = date;
    p.nbRevisions++;
    if (note > 1) p.nbReussites++; else p.nbEchecs++;

    // Le profil de vitesse n'apprend que sur les réponses PLEINEMENT justes :
    // une réponse partielle ne mesure pas une vitesse de rappel fiable.
    this.profil.enregistrer({
      longueur: carte.longueur,
      tempsMs: reponse.tempsMs,
      correcte: score === 1,
    });

    return { note, raisons, joursProchains: jours };
  }

  /**
   * Recalcule la date de révision de toutes les cartes déjà vues, à partir de
   * leur état de mémoire actuel.
   *
   * Indispensable quand la rétention visée change : sans cela, l'ancienne
   * cible resterait gravée dans les échéances déjà posées, et le nouveau
   * réglage ne prendrait effet qu'au compte-gouttes, carte par carte.
   *
   * @returns {number} nombre de cartes replanifiées
   */
  replanifier() {
    let touchees = 0;
    for (const p of this.progressions.values()) {
      if (!p.etat || p.derniereRevision === null) continue;
      p.prochaine = prochaineRevision(p.etat, p.derniereRevision, this.reglages).date;
      touchees++;
    }
    return touchees;
  }

  /** Instantané complet — c'est ce qu'on écrira dans IndexedDB. */
  toJSON() {
    return {
      version: 1,
      cartes: this.cartes,
      progressions: [...this.progressions.values()],
      profil: this.profil.toJSON(),
      journal: this.journal,
      reglages: this.reglages,
    };
  }

  /**
   * Les réglages enregistrés sont fusionnés PAR-DESSUS les valeurs par défaut :
   * une sauvegarde ancienne, faite avant l'ajout d'un réglage, reste lisible et
   * hérite simplement de la nouvelle valeur par défaut.
   */
  static depuisJSON(donnees, reglages = REGLAGES_PLAN) {
    return new Moteur({
      cartes: donnees.cartes ?? [],
      progressions: new Map((donnees.progressions ?? []).map((p) => [p.id, p])),
      profil: ProfilUtilisateur.depuisJSON(donnees.profil),
      journal: donnees.journal ?? [],
      reglages: { ...reglages, ...(donnees.reglages ?? {}) },
    });
  }
}
