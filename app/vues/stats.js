/**
 * Écran « Progrès ».
 *
 * On y montre ce qui aide à décider quoi travailler, pas des chiffres décoratifs.
 * La calibration y figure parce qu'elle dit si l'on peut FAIRE CONFIANCE aux
 * dates proposées : c'est le contrôle qualité du moteur, exposé à l'utilisateur.
 */

import {
  calibration, cartesProblematiques, chargePrevisionnelle,
  maitriseParTag, repartitionNotes, retention,
} from '../../src/stats.js';

const pc = (x) => (x === null || Number.isNaN(x) ? '—' : `${Math.round(x * 100)} %`);
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

export function creerVueStats({ moteur }) {
  function monter(racine) {
    if (moteur.journal.length === 0) {
      racine.innerHTML = `
        <div class="vide">
          <strong>Aucune donnée pour l'instant</strong>
          Les statistiques apparaîtront après tes premières révisions.
        </div>`;
      return;
    }

    const ret = retention(moteur.journal);
    const cal = calibration(moteur.journal);
    const charge = chargePrevisionnelle([...moteur.progressions.values()], 14);
    const tags = maitriseParTag(moteur.journal);
    const notes = repartitionNotes(moteur.journal);
    const dures = cartesProblematiques(moteur.journal).slice(0, 5);

    const acquises = [...moteur.progressions.values()]
      .filter((p) => p.etat && p.etat.stabilite >= 21).length;

    racine.innerHTML = `
      <h2>Progrès</h2>
      <div class="tuiles">
        <div class="tuile">
          <div class="valeur">${pc(ret.taux)}</div>
          <div class="libelle">Rétention (${pluriel(ret.total, 'révision')})</div>
        </div>
        <div class="tuile">
          <div class="valeur">${acquises}</div>
          <div class="libelle">Cartes acquises sur ${moteur.cartes.length}</div>
        </div>
      </div>

      <h3>Charge des 14 prochains jours</h3>
      <div class="histo">${histogramme(charge.parJour)}</div>
      <div class="histo-legende">
        <span>aujourd'hui</span>
        <span>${charge.enRetard > 0 ? `${charge.enRetard} en retard` : 'à jour'}</span>
        <span>dans 14 j</span>
      </div>

      <h3>Maîtrise par thème</h3>
      ${tags.length ? `<ul class="barres">${tags.map(ligneTag).join('')}</ul>`
        : '<p class="vide">Pas encore de thème mesurable.</p>'}

      <h3>Notes attribuées automatiquement</h3>
      <ul class="barres">
        ${[[1, 'Encore'], [2, 'Difficile'], [3, 'Correct'], [4, 'Facile']]
          .map(([n, nom]) => ligneSimple(nom, notes[n].part)).join('')}
      </ul>

      <h3>Fiabilité des prévisions</h3>
      <p class="consigne">
        Écart entre la probabilité de rappel annoncée et le résultat observé :
        <strong>${pc(cal.ecartMoyen)}</strong>.
        ${cal.ecartMoyen !== null && cal.ecartMoyen < 0.1
          ? 'Les dates proposées sont fiables.'
          : 'Encore trop peu de données pour juger.'}
      </p>

      ${dures.length ? `
        <h3>Cartes qui résistent</h3>
        <ul class="barres">${dures.map(ligneCarte).join('')}</ul>
        <p class="consigne">Un échec répété trahit souvent une question ambiguë
        ou qui mélange deux notions, plus qu'une notion difficile.</p>` : ''}
    `;
  }

  function histogramme(valeurs) {
    const max = Math.max(1, ...valeurs);
    return valeurs
      .map((v) => `<div style="height:${(v / max) * 100}%" title="${v} cartes"></div>`)
      .join('');
  }

  function ligneTag(t) {
    return ligneSimple(t.tag, t.taux, `${t.total} rév.`);
  }

  function ligneCarte(c) {
    const carte = moteur.index.get(c.id);
    const titre = carte ? carte.question : c.id;
    return ligneSimple(titre.slice(0, 60), c.taux, `${c.total} rév.`);
  }

  function ligneSimple(libelle, part, extra = '') {
    const p = Math.round((part ?? 0) * 100);
    const classe = p < 60 ? 'faible' : (p < 80 ? 'moyen' : '');
    const echappe = String(libelle)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `
      <li>
        <div class="ligne"><span>${echappe}</span><span>${p} %${extra ? ` · ${extra}` : ''}</span></div>
        <div class="piste"><i class="${classe}" style="width:${p}%"></i></div>
      </li>`;
  }

  return { monter, reprendre: () => racine && dessiner() };
}
