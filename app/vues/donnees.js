/**
 * Section « Données » — en tête des réglages.
 *
 * Anciennement un onglet à part entière. L'import n'est pas une activité
 * quotidienne : on charge ses questions une fois, puis on révise pendant des
 * mois. Lui réserver un onglet permanent revenait à garder un tiers de la
 * barre de navigation pour un geste qu'on fait deux fois par an.
 *
 * Plus de zone de saisie : personne ne tape ses questions à la main, on ouvre
 * un fichier. Le supprimer retire aussi l'étape « coller puis cliquer sur
 * Importer » — désormais choisir le fichier suffit.
 *
 * La section se redessine toute seule dans son conteneur, sans passer par la
 * vue qui l'héberge : sinon l'écran des réglages se remonterait et effacerait
 * le compte rendu d'import qu'on vient d'afficher.
 */

import { analyser } from '../../src/parseur.js';
import { PROMPT_QCM } from '../prompt-qcm.js';

export function creerSectionDonnees({ moteur, enregistreur }) {
  let racine = null;

  function monter(element) {
    racine = element;
    dessiner();
  }

  function dessiner(message = '') {
    const nb = moteur.cartes.length;
    racine.innerHTML = `
      <h3>Questions</h3>
      <p class="consigne">${nb} question${nb > 1 ? 's' : ''} en mémoire.</p>
      <div class="paire-boutons">
        <button class="bouton secondaire" id="fichier">Importer un fichier .qcm…</button>
        <button class="bouton secondaire" id="verifier">Vérifier sans importer…</button>
      </div>
      <input type="file" id="choisir" accept=".qcm,.txt,text/plain" hidden>
      <input type="file" id="choisir-verif" accept=".qcm,.txt,text/plain" hidden>

      <div id="retour-donnees">${message}</div>

      <details class="fabrique">
        <summary>Je n'ai pas de fichier .qcm</summary>
        <p class="aide">Fais-en un à partir de tes cours, avec l'IA de ton
        choix. Copie le prompt ci-dessous, colle-le dans ta conversation, puis
        joins ton document. Tu récupères le texte produit dans un fichier
        <b>.qcm</b> et tu l'importes ici.</p>
        <button class="bouton secondaire" id="copier-prompt">Copier le prompt</button>
        <p class="aide" id="apercu-prompt"></p>
      </details>

      <h3>Sauvegarde</h3>
      <p class="consigne">Tes données ne quittent jamais cet appareil. Pour passer
      du téléphone au PC, exporte ici et réimporte là-bas.</p>
      <div class="paire-boutons">
        <button class="bouton secondaire" id="exporter">Exporter</button>
        <button class="bouton secondaire" id="restaurer">Restaurer…</button>
      </div>
      <input type="file" id="choisir-sauvegarde" accept=".json,application/json" hidden>`;

    // `?.` : plusieurs de ces éléments n'existent que dans certains états —
    // le bouton de rapport n'apparaît qu'en cas d'erreur.
    const sur = (sel, ev, fn) => racine.querySelector(sel)?.addEventListener(ev, fn);
    sur('#fichier', 'click', () => racine.querySelector('#choisir').click());
    sur('#choisir', 'change', importerFichier);
    sur('#exporter', 'click', exporter);
    sur('#restaurer', 'click', () => racine.querySelector('#choisir-sauvegarde').click());
    sur('#choisir-sauvegarde', 'change', restaurer);
    sur('#copier-prompt', 'click', copierPrompt);
    sur('#verifier', 'click', () => racine.querySelector('#choisir-verif').click());
    sur('#choisir-verif', 'change', verifierFichier);
    sur('#copier-erreurs', 'click', copierErreurs);
    racine.querySelector('#apercu-prompt').textContent =
      `${Math.round(PROMPT_QCM.length / 100) / 10} k caractères — le format y est décrit en entier, `
      + 'les règles qui font échouer un import comprises.';
  }

  /**
   * Copie le prompt dans le presse-papiers.
   *
   * `navigator.clipboard` exige une origine sécurisée : sur une page servie en
   * HTTP simple depuis une adresse IP, il est absent. On retombe alors sur une
   * zone de texte sélectionnée, que l'utilisateur copie lui-même — mieux vaut
   * un geste de plus qu'un bouton qui ne fait rien.
   */
  async function copierPrompt(evenement) {
    const bouton = evenement.currentTarget;
    try {
      await navigator.clipboard.writeText(PROMPT_QCM);
      bouton.textContent = '✓ Copié — colle-le dans ton IA, puis joins ton document';
      setTimeout(() => { bouton.textContent = 'Copier le prompt'; }, 4000);
    } catch {
      const zone = document.createElement('textarea');
      zone.className = 'prompt-repli';
      zone.readOnly = true;
      zone.value = PROMPT_QCM;
      bouton.replaceWith(zone);
      zone.focus();
      zone.select();
    }
  }

  async function importerFichier(evenement) {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier) return;

    const texte = (await fichier.text()).trim();
    // On analyse d'abord pour montrer les problèmes, sans rien modifier.
    const { cartes, erreurs } = analyser(texte);
    if (cartes.length === 0) {
      dessiner(blocErreurs(erreurs, `${fichier.name} : aucune question exploitable.`));
      return;
    }

    // Le nom du fichier devient le recueil : c'est lui qui regroupe les
    // séries sur l'accueil, et il doit rester lisible.
    const { ajoutees, majes } = moteur.importer(texte, fichier.name.replace(/\.[^.]+$/, ''));
    enregistreur.demander();

    const parts = [];
    if (ajoutees) parts.push(`${ajoutees} nouvelle${ajoutees > 1 ? 's' : ''}`);
    if (majes) parts.push(`${majes} mise${majes > 1 ? 's' : ''} à jour`);

    let html = `<div class="message ok">${echapper(fichier.name)} — ${parts.join(', ')}.</div>`;
    if (erreurs.length) {
      html += blocErreurs(erreurs,
        `${erreurs.length} question${erreurs.length > 1 ? 's' : ''} refusée${erreurs.length > 1 ? 's' : ''}, `
        + 'les autres sont importées :');
    }
    dessiner(html);
  }

  /*
   * Rapport d'erreurs, avec de quoi le renvoyer à l'IA qui a produit le
   * fichier. C'est la pièce qui manquait : lire « ligne 412, aucune bonne
   * réponse marquée » n'avance à rien quand on n'a pas écrit le fichier
   * soi-même. Le bouton prépare une demande de correction complète, prête à
   * coller dans la conversation d'origine.
   */
  let dernieresErreurs = [];

  function blocErreurs(erreurs, titre) {
    dernieresErreurs = erreurs;
    // On les montre toutes : la liste défile, et une erreur cachée est une
    // erreur qu'on ne corrigera pas.
    const lignes = erreurs
      .map((e) => `<li><b>Ligne ${e.ligne}</b> — ${echapper(e.message)}</li>`).join('');
    return `<div class="erreurs">
      <p class="erreurs-titre">${echapper(titre)}</p>
      <ul class="erreurs-liste">${lignes}</ul>
      <button class="bouton secondaire" id="copier-erreurs">
        Copier le rapport pour ton IA</button>
    </div>`;
  }

  /** Demande de correction, à coller dans la conversation qui a produit le fichier. */
  function rapportPourIA() {
    const liste = dernieresErreurs
      .map((e) => `- ligne ${e.ligne} : ${e.message}`).join('\n');
    return `Le fichier .qcm que tu as produit contient ${dernieresErreurs.length} `
      + `erreur${dernieresErreurs.length > 1 ? 's' : ''} de format. `
      + `Les voici, avec le numéro de ligne du fichier que tu m'as donné :\n\n${liste}\n\n`
      + `Rappels du format :\n`
      + `- au moins deux propositions par question ;\n`
      + `- au moins une proposition marquée [x], mais pas toutes ;\n`
      + `- jamais de mélange entre les puces « - » et « 1. » dans une même question ;\n`
      + `- sur un classement, la numérotation va de 1 à n sans trou ni doublon ;\n`
      + `- deux questions ne peuvent pas avoir le même énoncé ;\n`
      + `- seules @tags, @source et @bareme sont reconnues.\n\n`
      + `Corrige ces erreurs et rends-moi le fichier COMPLET corrigé, `
      + `sans aucun texte autour.`;
  }

  async function copierErreurs(evenement) {
    const bouton = evenement.currentTarget;
    try {
      await navigator.clipboard.writeText(rapportPourIA());
      bouton.textContent = '✓ Copié — colle-le dans ta conversation';
      setTimeout(() => { bouton.textContent = 'Copier le rapport pour ton IA'; }, 4000);
    } catch {
      const zone = document.createElement('textarea');
      zone.className = 'prompt-repli';
      zone.readOnly = true;
      zone.value = rapportPourIA();
      bouton.replaceWith(zone);
      zone.focus(); zone.select();
    }
  }

  /**
   * Analyse un fichier SANS rien écrire.
   *
   * Un import qui garde les questions valides et signale les autres est le bon
   * comportement au quotidien, mais il empêche d'itérer : on ne peut pas
   * corriger puis réimporter proprement, puisque la moitié est déjà entrée.
   * D'où ce mode d'essai, à employer sur un fichier fraîchement sorti d'une IA.
   */
  async function verifierFichier(evenement) {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier) return;

    const { cartes, erreurs } = analyser((await fichier.text()).trim());
    const sections = new Set(cartes.map((c) => c.section || 'Sans série')).size;
    const sansExplication = cartes.filter((c) => !c.explication).length;

    let html = `<div class="message ${erreurs.length ? 'attention' : 'ok'}">
      ${echapper(fichier.name)} — ${cartes.length} question${cartes.length > 1 ? 's' : ''} valide${cartes.length > 1 ? 's' : ''}
      dans ${sections} section${sections > 1 ? 's' : ''}${
      erreurs.length ? `, <b>${erreurs.length} refusée${erreurs.length > 1 ? 's' : ''}</b>` : ''}.
      ${sansExplication ? `<br>${sansExplication} sans explication.` : ''}
      <br><em>Rien n'a été importé.</em></div>`;
    if (erreurs.length) html += blocErreurs(erreurs, 'À corriger :');
    dessiner(html);
  }

  const echapper = (t) => String(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function exporter() {
    await enregistreur.forcer();
    const contenu = JSON.stringify(moteur.toJSON());
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
    lien.download = `revisions-${new Date().toISOString().slice(0, 10)}.json`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  }

  async function restaurer(evenement) {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier) return;

    const perdues = moteur.journal.length;
    const avertissement = perdues > 0
      ? `Cela remplacera l'état actuel (${perdues} révisions enregistrées). Continuer ?`
      : 'Restaurer cette sauvegarde ?';
    if (!confirm(avertissement)) return;

    try {
      const donnees = JSON.parse(await fichier.text());
      if (!donnees || !Array.isArray(donnees.cartes)) throw new Error('format inattendu');
      // Rechargement complet, volontaire : il évite tout état résiduel dans
      // les vues déjà construites.
      await import('../stockage.js').then((m) => m.ecrire(donnees));
      location.reload();
    } catch (e) {
      dessiner(`<div class="erreurs">Sauvegarde illisible : ${echapper(e.message)}</div>`);
    }
  }

  return { monter };
}
