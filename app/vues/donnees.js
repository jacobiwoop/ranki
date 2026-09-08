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
      <button class="bouton secondaire" id="fichier">Importer un fichier .qcm…</button>
      <input type="file" id="choisir" accept=".qcm,.txt,text/plain" hidden>

      <div id="retour-donnees">${message}</div>

      <h3>Sauvegarde</h3>
      <p class="consigne">Tes données ne quittent jamais cet appareil. Pour passer
      du téléphone au PC, exporte ici et réimporte là-bas.</p>
      <div class="paire-boutons">
        <button class="bouton secondaire" id="exporter">Exporter</button>
        <button class="bouton secondaire" id="restaurer">Restaurer…</button>
      </div>
      <input type="file" id="choisir-sauvegarde" accept=".json,application/json" hidden>`;

    const sur = (sel, ev, fn) => racine.querySelector(sel).addEventListener(ev, fn);
    sur('#fichier', 'click', () => racine.querySelector('#choisir').click());
    sur('#choisir', 'change', importerFichier);
    sur('#exporter', 'click', exporter);
    sur('#restaurer', 'click', () => racine.querySelector('#choisir-sauvegarde').click());
    sur('#choisir-sauvegarde', 'change', restaurer);
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
    if (erreurs.length) html += blocErreurs(erreurs, `${erreurs.length} question(s) ignorée(s) :`);
    dessiner(html);
  }

  function blocErreurs(erreurs, titre) {
    const lignes = erreurs.slice(0, 40)
      .map((e) => `<li>Ligne ${e.ligne} — ${echapper(e.message)}</li>`).join('');
    const reste = erreurs.length > 40 ? `<li>… et ${erreurs.length - 40} autres</li>` : '';
    return `<div class="erreurs">${echapper(titre)}<ul>${lignes}${reste}</ul></div>`;
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
