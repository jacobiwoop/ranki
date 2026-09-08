/**
 * Écran « Réglages ».
 *
 * Chaque réglage est accompagné de sa conséquence réelle, pas d'une simple
 * étiquette : sur un système de répétition espacée, la plupart des curseurs
 * n'ont d'effet visible que des semaines plus tard. Sans explication, on les
 * tourne au hasard et on s'enterre.
 */

import { JOUR_MS } from '../../src/planificateur.js';
import { intervalle } from '../../src/memoire.js';
import { chargePrevisionnelle } from '../../src/stats.js';
import { PREFERENCES_DEFAUT } from '../preferences.js';
import { creerSectionDonnees } from './donnees.js';

const RETENTIONS = [
  { valeur: 0.85, nom: '85 % — léger', detail: 'Moins de révisions, on oublie un peu plus.' },
  { valeur: 0.9, nom: '90 % — équilibré', detail: 'Le meilleur rapport effort / mémoire.' },
  { valeur: 0.95, nom: '95 % — intensif', detail: 'Charge quasi doublée. Pour une veille d\'examen.' },
];

export function creerVueReglages({ moteur, preferences, enregistreur, surChangement }) {
  let racine = null;
  // L'import et la sauvegarde occupaient un onglet entier alors qu'on ne s'en
  // sert que deux fois par an. Ils ouvrent désormais les réglages.
  const donnees = creerSectionDonnees({ moteur, enregistreur });
  let message = '';

  function monter(element) {
    racine = element;
    dessiner();
  }

  function dessiner() {
    const r = moteur.reglages;
    const charge = chargePrevisionnelle([...moteur.progressions.values()], 14);
    const moyenne = charge.parJour.reduce((a, b) => a + b, 0) / 14;
    // Virgule décimale, et accord au singulier sous 2 : « 0,5 révision ».
    const moyenneTexte = `${moyenne.toFixed(1).replace('.', ',')} `
      + `révision${moyenne >= 2 ? 's' : ''}`;

    racine.innerHTML = `
      <h2>Réglages</h2>

      <div id="section-donnees"></div>

      <h3>Rythme</h3>
      <div class="reglage">
        <label for="nouvelles">Nouvelles cartes par jour</label>
        <input type="number" id="nouvelles" min="0" max="200" step="1" value="${r.limiteNouvelles}">
        <p class="aide">Le seul vrai frein à la charge future : chaque carte
        découverte aujourd'hui engendre une dizaine de révisions dans les mois
        qui viennent. Actuellement ${moyenneTexte} par jour en moyenne sur les
        deux prochaines semaines.</p>
      </div>

      <div class="reglage">
        <label for="revisions">Révisions maximum par séance</label>
        <input type="number" id="revisions" min="10" max="500" step="10" value="${r.limiteRevisions}">
        <p class="aide">Plafond de confort après une longue absence : le retard
        n'est pas perdu, il est simplement étalé.</p>
      </div>

      <h3>Mémorisation</h3>
      <div class="reglage">
        <label for="retention">Rétention visée</label>
        <select id="retention">
          ${RETENTIONS.map((o) => `<option value="${o.valeur}"
            ${Math.abs(o.valeur - r.retentionCible) < 1e-9 ? 'selected' : ''}>${o.nom}</option>`).join('')}
        </select>
        <p class="aide" id="aide-retention"></p>
      </div>

      <div class="reglage">
        <label for="ordre">Ordre des questions</label>
        <select id="ordre">
          <option value="risque" ${r.ordre === 'risque' ? 'selected' : ''}>Les plus fragiles d'abord</option>
          <option value="aleatoire" ${r.ordre === 'aleatoire' ? 'selected' : ''}>Aléatoire</option>
        </select>
        <p class="aide">« Les plus fragiles d'abord » traite en priorité ce qui
        risque vraiment d'être oublié — utile si tu t'interromps en cours de séance.</p>
      </div>

      <h3>Affichage</h3>
      <div class="reglage">
        <label class="interrupteur">
          <input type="checkbox" id="melanger" ${preferences.melangerPropositions ? 'checked' : ''}>
          <span>Mélanger les propositions</span>
        </label>
        <p class="aide">À laisser activé. Sinon on finit par retenir « c'est la
        deuxième » au lieu du contenu, et l'illusion s'effondre le jour de l'examen.</p>
      </div>

      <div class="reglage">
        <label for="delai">Après une bonne réponse</label>
        <select id="delai">
          <option value="0" ${preferences.delaiEnchainementMs === 0 ? 'selected' : ''}>Attendre un appui</option>
          <option value="850" ${preferences.delaiEnchainementMs === 850 ? 'selected' : ''}>Enchaîner vite (0,8 s)</option>
          <option value="1600" ${preferences.delaiEnchainementMs === 1600 ? 'selected' : ''}>Enchaîner après une pause (1,6 s)</option>
        </select>
        <p class="aide">Une réponse fausse attend toujours ton appui : c'est le
        moment où l'explication compte.</p>
      </div>

      <div id="retour-reglages">${message}</div>

      <h3>Zone sensible</h3>
      <p class="aide">Efface l'historique de révision et toutes les cartes.
      Pense à exporter une sauvegarde ci-dessus d'abord.</p>
      <button class="bouton danger" id="effacer">Tout effacer</button>
    `;
    message = '';

    donnees.monter(racine.querySelector('#section-donnees'));
    majAideRetention();

    lier('#nouvelles', 'change', (e) => nombre('limiteNouvelles', e.target, 0, 200));
    lier('#revisions', 'change', (e) => nombre('limiteRevisions', e.target, 10, 500));
    lier('#retention', 'change', changerRetention);
    lier('#ordre', 'change', (e) => appliquer({ ordre: e.target.value }));
    lier('#melanger', 'change', (e) => {
      preferences.melangerPropositions = e.target.checked;
      sauver();
    });
    lier('#delai', 'change', (e) => {
      preferences.delaiEnchainementMs = Number(e.target.value);
      sauver();
    });
    lier('#effacer', 'click', effacerTout);
  }

  const lier = (selecteur, evenement, action) =>
    racine.querySelector(selecteur).addEventListener(evenement, action);

  function majAideRetention() {
    const r = moteur.reglages.retentionCible;
    const option = RETENTIONS.find((o) => Math.abs(o.valeur - r) < 1e-9);
    // Exemple concret : une carte de stabilité 30 jours revient dans...
    const jours = Math.round(intervalle(30, r));
    racine.querySelector('#aide-retention').textContent =
      `${option?.detail ?? ''} À ce réglage, une carte bien sue revient tous les ${jours} jours environ.`;
  }

  function nombre(cle, champ, min, max) {
    const valeur = Math.min(max, Math.max(min, Math.round(Number(champ.value) || 0)));
    champ.value = String(valeur); // renvoie la valeur bornée à l'écran
    appliquer({ [cle]: valeur });
  }

  function changerRetention(evenement) {
    appliquer({ retentionCible: Number(evenement.target.value) });
    // Les échéances déjà posées l'ont été avec l'ancienne cible : on les
    // recalcule, sinon le nouveau réglage mettrait des mois à se voir.
    const touchees = moteur.replanifier();
    donnees.monter(racine.querySelector('#section-donnees'));
    majAideRetention();
    if (touchees > 0) {
      message = `<div class="message ok">${touchees} carte${touchees > 1 ? 's' : ''}
        replanifiée${touchees > 1 ? 's' : ''} selon la nouvelle cible.</div>`;
      dessiner();
    }
  }

  function appliquer(modifications) {
    moteur.reglages = { ...moteur.reglages, ...modifications };
    sauver();
  }

  function sauver() {
    enregistreur.demander();
    surChangement?.();
  }

  async function effacerTout() {
    if (!confirm('Effacer définitivement toutes les cartes et tout l\'historique ?')) return;
    if (!confirm('Dernière confirmation : cette action est irréversible.')) return;
    const { effacer } = await import('../stockage.js');
    await effacer();
    location.reload();
  }

  return { monter, demonter() {} };
}

export { PREFERENCES_DEFAUT };
