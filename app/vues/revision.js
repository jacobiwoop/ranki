/**
 * Écran de révision — l'écran qui compte.
 *
 * Principe : on touche sa réponse, ça enchaîne. Aucune auto-évaluation.
 * Trois interactions selon le type de question :
 *
 *   QCM à réponse unique   → un appui valide immédiatement (le plus rapide)
 *   QCM à réponses multiples → on coche, puis on valide
 *   Classement             → on touche les éléments dans le bon ordre
 *
 * Ce module mesure aussi ce qui nourrit la notation déduite : le temps écoulé
 * depuis l'affichage, et les changements d'avis.
 */

import { preparerAffichage, verifier, verifierOrdre } from '../../src/presentation.js';

const LIBELLE_NOTE = { 1: 'Encore', 2: 'Difficile', 3: 'Correct', 4: 'Facile' };

export function creerVueRevision({ moteur, preferences, enregistreur, rafraichirOnglets }) {
  let session = null;
  let racine = null;
  let options = {};        // { section, inclureNonDues, mode }
  /** Trace de la séance, pour le corrigé de fin en mode examen. */
  let parcours = [];

  // État de la carte affichée
  let carte = null;
  let vue = null;          // résultat de preparerAffichage
  let choix = [];          // indices affichés, dans l'ordre de sélection
  let changements = 0;
  let debut = 0;
  let repondu = false;
  let minuteur = null;

  const jours = (n) => (n === 1 ? '1 jour' : `${n} jours`);

  /** Appelé par l'accueil avant de basculer sur cette vue. */
  function configurer(nouvellesOptions) {
    options = nouvellesOptions ?? {};
  }

  function monter(element) {
    racine = element;
    parcours = [];
    session = moteur.demarrerSeance(Date.now(), options);
    afficher();
  }

  function demonter() {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  }

  function afficher() {
    if (minuteur) { clearTimeout(minuteur); minuteur = null; }
    carte = session.courante();
    if (!carte) return afficherBilan();

    vue = preparerAffichage(
      carte,
      moteur.progression(carte.id).nbRevisions,
      preferences.melangerPropositions,
      session.graine,
    );
    choix = [];
    changements = 0;
    repondu = false;

    dessiner();
    // Le chronomètre ne démarre qu'une fois la carte réellement peinte,
    // sinon on compterait le temps de rendu comme du temps de réflexion.
    requestAnimationFrame(() => { debut = performance.now(); });
  }

  function dessiner() {
    const estOrdre = carte.type === 'ordre';
    const total = session.file.length;
    const faites = session.position;

    racine.innerHTML = `
      <div class="compteur">
        <span>${faites + 1} / ${total}</span>
        <span>${carte.section ?? ''}</span>
      </div>
      <div class="progression"><i style="width:${(faites / total) * 100}%"></i></div>
      <p class="question"></p>
      <p class="consigne">${consigne(estOrdre)}</p>
      <ul class="options"></ul>
      <div class="zone-action"></div>
      <div class="retour"></div>
    `;
    // textContent : le contenu des cartes vient d'un fichier utilisateur et ne
    // doit jamais être interprété comme du HTML.
    racine.querySelector('.question').textContent = carte.question;

    const liste = racine.querySelector('.options');
    vue.propositions.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'option';
      li.dataset.i = String(i);
      li.innerHTML = '<span class="marque"></span><span class="texte"></span>';
      li.querySelector('.marque').textContent = estOrdre ? '·' : p.lettre;
      li.querySelector('.texte').textContent = p.texte;
      li.addEventListener('click', () => toucher(i));
      liste.appendChild(li);
    });

    majBoutonValider();
  }

  function consigne(estOrdre) {
    if (estOrdre) return 'Touche les éléments dans le bon ordre.';
    if (carte.reponsesMultiples) return 'Plusieurs réponses. Coche puis valide.';
    return 'Une seule réponse.';
  }

  /** Un appui sur une proposition. */
  function toucher(i) {
    if (repondu) return;
    const estOrdre = carte.type === 'ordre';

    if (estOrdre) {
      const rang = choix.indexOf(i);
      if (rang >= 0) {
        // Retirer un élément déjà placé annule aussi tous les suivants :
        // l'ordre n'aurait plus de sens avec un trou au milieu.
        choix = choix.slice(0, rang);
        changements++;
      } else {
        choix.push(i);
      }
      rendreSelection();
      if (choix.length === vue.propositions.length) valider();
      return;
    }

    if (!carte.reponsesMultiples) {
      // Réponse unique : l'appui vaut validation. C'est tout l'intérêt.
      choix = [i];
      rendreSelection();
      valider();
      return;
    }

    const rang = choix.indexOf(i);
    if (rang >= 0) { choix.splice(rang, 1); changements++; } else { choix.push(i); }
    rendreSelection();
    majBoutonValider();
  }

  function rendreSelection() {
    const estOrdre = carte.type === 'ordre';
    racine.querySelectorAll('.option').forEach((li) => {
      const i = Number(li.dataset.i);
      const rang = choix.indexOf(i);
      li.classList.toggle('choisie', rang >= 0);
      if (estOrdre) {
        li.querySelector('.marque').textContent = rang >= 0 ? String(rang + 1) : '·';
      }
    });
  }

  function majBoutonValider() {
    const zone = racine.querySelector('.zone-action');
    if (repondu || carte.type === 'ordre' || !carte.reponsesMultiples) {
      zone.innerHTML = '';
      return;
    }
    zone.innerHTML = '<button class="bouton" id="valider">Valider</button>';
    const b = zone.querySelector('#valider');
    b.disabled = choix.length === 0;
    b.addEventListener('click', valider);
  }

  function valider() {
    if (repondu) return;
    repondu = true;
    const tempsMs = Math.round(performance.now() - debut);

    const resultat = carte.type === 'ordre'
      ? verifierOrdre(choix.map((i) => vue.propositions[i].rangOrigine), carte.bareme)
      : verifier(choix, vue.bonnes, carte.bareme);

    const bilan = moteur.repondre(carte.id, {
      correcte: resultat.correcte,
      score: resultat.score,
      tempsMs,
      nbChangements: changements,
    });

    enregistreur.demander();
    parcours.push({ carte, vue, choix: [...choix], resultat, bilan });

    // Une carte non acquise repasse plus loin dans la même séance —
    // sauf en examen, où l'on enchaîne sans rien dévoiler.
    session.avancer(bilan.note > 1);

    if (session.mode === 'examen') afficher();
    else revelerReponse(resultat, bilan);
  }

  function revelerReponse(resultat, bilan) {
    racine.querySelector('.options').classList.add('figee');
    racine.querySelector('.zone-action').innerHTML = '';

    const estOrdre = carte.type === 'ordre';
    racine.querySelectorAll('.option').forEach((li) => {
      const i = Number(li.dataset.i);
      const p = vue.propositions[i];

      if (estOrdre) {
        // On réaffiche la séquence attendue : le rang d'origine + 1.
        li.querySelector('.marque').textContent = String(p.rangOrigine + 1);
        const bienPlace = choix.indexOf(i) === p.rangOrigine;
        li.classList.add(bienPlace ? 'bonne' : 'ratee');
        ajouterVerdict(li, bienPlace ? '✓' : '✗');
        return;
      }

      const attendu = vue.bonnes.includes(i);
      const coche = choix.includes(i);
      if (attendu) { li.classList.add('bonne'); ajouterVerdict(li, '✓'); }
      else if (coche) { li.classList.add('ratee'); ajouterVerdict(li, '✗'); }
      else li.classList.add('eteinte');
    });

    if (estOrdre) reordonnerSelonAttendu();

    const retour = racine.querySelector('.retour');
    const parfait = resultat.correcte;
    const partiel = !parfait && bilan.note > 1;
    const classe = parfait ? 'ok' : (partiel ? 'mitige' : 'ko');
    const titre = parfait ? 'Correct'
      : (partiel ? `Partiel — ${Math.round(resultat.score * 100)} %` : 'Raté');

    retour.innerHTML = `
      <div class="bandeau ${classe}">
        <span>${titre}</span>
        <span class="note">${LIBELLE_NOTE[bilan.note]} · revu dans ${jours(bilan.joursProchains)}</span>
      </div>`;

    if (carte.explication) {
      const bloc = document.createElement('div');
      bloc.className = 'explication';
      bloc.textContent = carte.explication;
      retour.appendChild(bloc);
    }
    if (carte.source) {
      const src = document.createElement('div');
      src.className = 'source';
      src.textContent = carte.source;
      retour.appendChild(src);
    }

    /*
     * On attend TOUJOURS un appui, y compris sur une bonne réponse.
     *
     * Un enchaînement automatique existait, réglable à 0,8 ou 1,6 seconde. Il
     * a été retiré pour deux raisons. La première est un bug : le clic qui
     * validait la réponse remontait jusqu'au conteneur et déclenchait
     * lui-même le passage à la suite — l'explication n'apparaissait pas une
     * seule image, alors qu'un délai était censé la laisser lire.
     *
     * La seconde tient à la conception, et elle suffirait seule : une
     * explication fait sept cents signes, on ne la lit pas en huit dixièmes de
     * seconde. Un réglage qui escamote le retour vide le mode apprentissage de
     * son objet — c'est précisément là que l'apprentissage a lieu, pas dans le
     * fait d'avoir coché juste.
     */
    const suivant = document.createElement('button');
    suivant.className = 'bouton';
    suivant.id = 'suivant';
    suivant.textContent = session.restantes > 0 ? 'Suivant' : 'Voir le bilan';
    suivant.addEventListener('click', afficher);
    retour.appendChild(suivant);
  }

  function ajouterVerdict(li, signe) {
    const s = document.createElement('span');
    s.className = 'verdict';
    s.textContent = signe;
    li.appendChild(s);
  }

  /** Range visuellement les éléments dans l'ordre attendu, pour la correction. */
  function reordonnerSelonAttendu() {
    const liste = racine.querySelector('.options');
    [...liste.children]
      .sort((a, b) =>
        vue.propositions[Number(a.dataset.i)].rangOrigine
        - vue.propositions[Number(b.dataset.i)].rangOrigine)
      .forEach((li) => liste.appendChild(li));
  }

  function afficherBilan() {
    if (session.file.length === 0) {
      racine.innerHTML = `
        <div class="vide">
          <strong>Rien à réviser</strong>
          ${moteur.cartes.length === 0
            ? 'Commence par importer des questions dans l\'onglet « Cartes ».'
            : 'Tout est à jour dans cette sélection. Reviens plus tard.'}
        </div>
        <button class="bouton secondaire" id="retour-accueil">Retour à l'accueil</button>`;
      racine.querySelector('#retour-accueil')
        .addEventListener('click', () => rafraichirOnglets('accueil'));
      return;
    }

    const justes = parcours.filter((p) => p.resultat.correcte).length;
    const taux = parcours.length ? Math.round((justes / parcours.length) * 100) : 0;

    racine.innerHTML = `
      <div class="bilan">
        <div class="grand">${taux} %</div>
        <div class="sous">${justes} sur ${parcours.length} question${parcours.length > 1 ? 's' : ''}
          ${session.mode === 'examen' ? 'à l\'examen' : 'réussies'}</div>
        <button class="bouton" id="encore">Nouvelle séance</button>
        <button class="bouton secondaire" id="retour-accueil">Retour à l'accueil</button>
      </div>
      ${session.mode === 'examen' ? '<h3>Corrigé</h3><div id="corrige"></div>' : ''}`;

    racine.querySelector('#encore').addEventListener('click', () => {
      parcours = [];
      session = moteur.demarrerSeance(Date.now(), options);
      afficher();
    });
    racine.querySelector('#retour-accueil')
      .addEventListener('click', () => rafraichirOnglets('accueil'));

    if (session.mode === 'examen') dessinerCorrige(racine.querySelector('#corrige'));
  }

  /**
   * Corrigé complet de l'examen : chaque question, ce que tu as coché, ce
   * qu'il fallait, et l'explication quand elle existe.
   */
  function dessinerCorrige(hote) {
    parcours.forEach((p, i) => {
      const bloc = document.createElement('article');
      bloc.className = `corrige-item ${p.resultat.correcte ? 'ok' : 'ko'}`;

      const titre = document.createElement('p');
      titre.className = 'corrige-question';
      titre.textContent = `${i + 1}. ${p.carte.question}`;
      bloc.appendChild(titre);

      const liste = document.createElement('ul');
      liste.className = 'options figee';
      p.vue.propositions.forEach((prop, j) => {
        const li = document.createElement('li');
        const attendu = p.carte.type === 'ordre'
          ? p.choix.indexOf(j) === prop.rangOrigine
          : p.vue.bonnes.includes(j);
        const coche = p.choix.includes(j);
        li.className = 'option '
          + (attendu ? 'bonne' : (coche ? 'ratee' : 'eteinte'));
        li.innerHTML = '<span class="marque"></span><span class="texte"></span>';
        li.querySelector('.marque').textContent = prop.lettre;
        li.querySelector('.texte').textContent = prop.texte;
        if (attendu || coche) ajouterVerdict(li, attendu ? '✓' : '✗');
        liste.appendChild(li);
      });
      bloc.appendChild(liste);

      if (p.carte.explication) {
        const e = document.createElement('div');
        e.className = 'explication';
        e.textContent = p.carte.explication;
        bloc.appendChild(e);
      }
      hote.appendChild(bloc);
    });
  }

  return { monter, demonter, configurer };
}
