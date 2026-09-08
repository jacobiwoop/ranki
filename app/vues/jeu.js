/**
 * Onglet « Jeu » — préparer les questions, puis jouer.
 *
 * Le jeu vit dans une base séparée de la révision : rien de ce qui se passe
 * ici ne touche une date d'échéance. La préparation, elle, LIT les cartes de
 * révision — c'est leur contenu vérifié qui sert de matière première.
 */

import { ETAT_VIDE, ecrire, effacer, lire } from '../jeu/stockage-jeu.js';
import { MODELE_DEFAUT, enrichir } from '../jeu/agent.js';

const CLE_API = 'millionnaire.cle';

export function creerVueJeu({ moteur }) {
  let racine = null;
  let etat = ETAT_VIDE;
  let enCours = null;   // AbortController pendant une génération

  async function monter(element) {
    racine = element;
    etat = (await lire()) ?? ETAT_VIDE;
    dessiner();
  }

  function demonter() {
    // Une génération lancée puis abandonnée continuerait à consommer le quota.
    enCours?.abort();
    enCours = null;
  }

  const cleEnregistree = () => {
    try { return localStorage.getItem(CLE_API) ?? ''; } catch { return ''; }
  };

  /**
   * Une carte utilisable par le jeu.
   *
   * On n'exige PAS quatre propositions : l'agent en fabrique autant qu'il faut
   * pour arriver à quatre — c'est même le travail du procédé « durcir ». Seuls
   * comptent une réponse unique (un plateau A/B/C/D n'a qu'une bonne case) et
   * au moins deux propositions pour qu'il y ait matière à partir.
   */
  const eligible = (c) => c.type !== 'ordre'
    && c.propositions.length >= 2
    && c.propositions.filter((p) => p.correcte).length === 1;

  function dessiner(progression = '') {
    const pretes = etat.banque?.length ?? 0;
    const sources = moteur.cartes.filter(eligible).length;
    const parties = etat.parties ?? 0;
    const meilleur = (etat.historique ?? []).reduce((m, h) => Math.max(m, h.gain), 0);

    racine.innerHTML = `
      <h2>Le Millionnaire</h2>

      ${pretes === 0 ? `
        <div class="vide">
          <strong>Aucune question préparée</strong>
          Le jeu se construit à partir de tes questions de révision : pour chacune,
          quatre variantes de difficulté croissante.
        </div>` : `
        <div class="carte-action">
          <div class="grand-compte">${pretes.toLocaleString('fr-FR')}</div>
          <div class="libelle">questions prêtes · ${parties} partie${parties > 1 ? 's' : ''} jouée${parties > 1 ? 's' : ''}${
            meilleur > 0 ? ` · record ${meilleur.toLocaleString('fr-FR')} €` : ''}</div>
          <button class="bouton" id="jouer">Jouer</button>
        </div>`}

      <h3>Préparer les questions</h3>
      <p class="consigne">Une IA fabrique quatre variantes par question :
      leurres durcis, angle retourné, mise en situation, puis diagnostic.
      L'opération se fait <b>une seule fois</b> — ensuite le jeu fonctionne hors
      ligne, sans clé.</p>

      <div class="reglage">
        <label for="cle">Clé API Google AI Studio</label>
        <input type="password" id="cle" placeholder="AQ.…" value="${echapper(cleEnregistree())}"
               autocomplete="off" spellcheck="false">
        <p class="aide">Gratuite sur <b>aistudio.google.com</b>. Elle reste sur cet
        appareil et n'est <b>jamais incluse</b> dans une sauvegarde exportée.
        Le navigateur n'est pas un coffre-fort : n'y mets pas une clé qui donne
        accès à autre chose.</p>
      </div>

      <div class="reglage">
        <label for="serie">Sur quelles questions ?</label>
        <select id="serie">
          <option value="">Toutes les séries (${sources})</option>
          ${moteur.series().map((s, i) => {
            // On annonce le nombre RÉELLEMENT traitable, pas le total de la
            // série : voir une série « (51) » produire dix questions n'a aucun
            // sens tant qu'on ignore que quarante-neuf sont écartées.
            const n = moteur.cartes.filter((c) => c.section === s.nom && eligible(c)).length;
            return `<option value="${i}"${n === 0 ? ' disabled' : ''}>${echapper(s.nom)} (${n})</option>`;
          }).join('')}
        </select>
        <p class="aide">Chaque question en produit cinq : l'originale et quatre
        variantes. Compte ~35 secondes et quelques centimes par tranche de 20.
        Tu peux arrêter en route, ce qui est fait est gardé.</p>
      </div>

      <div id="progression">${progression}</div>

      <div class="paire-boutons">
        <button class="bouton" id="generer" ${sources === 0 || enCours ? 'disabled' : ''}>
          ${enCours ? 'Génération en cours…' : 'Générer'}</button>
        <button class="bouton secondaire" id="stopper" ${enCours ? '' : 'hidden'}>Arrêter</button>
      </div>

      <h3>Sauvegarde du jeu</h3>
      <p class="consigne">Séparée de celle des révisions. Génère sur ton PC,
      importe le fichier sur ton téléphone : tu ne paies qu'une fois.</p>
      <div class="paire-boutons">
        <button class="bouton secondaire" id="exporter" ${pretes ? '' : 'disabled'}>Exporter</button>
        <button class="bouton secondaire" id="importer">Importer…</button>
      </div>
      <input type="file" id="choisir" accept=".json,application/json" hidden>

      ${pretes ? `<button class="bouton danger" id="vider">Effacer les questions du jeu</button>` : ''}`;

    const sur = (sel, ev, fn) => racine.querySelector(sel)?.addEventListener(ev, fn);
    sur('#jouer', 'click', () => { window.location.href = 'jeu/'; });
    sur('#cle', 'change', (e) => {
      try { localStorage.setItem(CLE_API, e.target.value.trim()); } catch { /* mode privé */ }
    });
    sur('#generer', 'click', generer);
    sur('#stopper', 'click', () => { enCours?.abort(); enCours = null; dessiner(); });
    sur('#exporter', 'click', exporter);
    sur('#importer', 'click', () => racine.querySelector('#choisir').click());
    sur('#choisir', 'change', importer);
    sur('#vider', 'click', vider);
  }

  async function generer() {
    const cle = racine.querySelector('#cle').value.trim();
    if (!cle) { dessiner('<div class="erreurs">Colle d\'abord ta clé.</div>'); return; }
    try { localStorage.setItem(CLE_API, cle); } catch { /* mode privé */ }

    const choix = racine.querySelector('#serie').value;
    const section = choix === '' ? null : moteur.series()[Number(choix)]?.nom;
    const cartes = moteur.cartes.filter((c) =>
      (section === null || c.section === section) && eligible(c));

    if (cartes.length === 0) {
      dessiner('<div class="erreurs">Aucune question à réponse unique dans cette série. '
        + 'Le jeu ne sait pas traiter les classements ni les réponses multiples.</div>');
      return;
    }

    enCours = new AbortController();
    const deja = new Set((etat.banque ?? []).map((q) => q.id));
    const erreurs = [];
    dessiner(barre(0, cartes.length, 0));

    await enrichir(cartes, {
      cle,
      modele: MODELE_DEFAUT,
      signal: enCours.signal,
      surBloc: async ({ questions, faits, total }) => {
        // On écrit à chaque bloc : une coupure ne doit pas gâcher ce qui est payé.
        for (const q of questions) if (!deja.has(q.id)) { deja.add(q.id); etat.banque.push(q); }
        await ecrire(etat);
        majProgression(barre(faits, total, etat.banque.length, erreurs));
      },
      surErreur: ({ erreur, faits, total }) => {
        erreurs.push(erreur);
        majProgression(barre(faits, total, etat.banque.length, erreurs));
      },
    });

    const interrompu = enCours?.signal.aborted;
    enCours = null;
    dessiner(`<div class="message ok">${interrompu ? 'Arrêté' : 'Terminé'} —
      ${etat.banque.length.toLocaleString('fr-FR')} questions prêtes.</div>`
      + (erreurs.length ? blocErreurs(erreurs) : ''));
  }

  /** Mise à jour ciblée : redessiner effacerait la clé en cours de saisie. */
  function majProgression(html) {
    const zone = racine.querySelector('#progression');
    if (zone) zone.innerHTML = html;
  }

  function barre(faits, total, produites, erreurs = []) {
    const part = total ? Math.round((faits / total) * 100) : 0;
    return `<div class="progression">
      <div class="jauge"><span style="width:${part}%"></span></div>
      <div class="legende">${faits} / ${total} questions traitées ·
        ${produites.toLocaleString('fr-FR')} produites${
        erreurs.length ? ` · <b>${erreurs.length} bloc(s) en échec</b>` : ''}</div>
    </div>`;
  }

  const blocErreurs = (erreurs) => `<div class="erreurs">Blocs en échec :<ul>${
    [...new Set(erreurs)].slice(0, 5).map((e) => `<li>${echapper(e)}</li>`).join('')}</ul></div>`;

  const echapper = (t) => String(t ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function exporter() {
    const contenu = JSON.stringify({ version: 1, banque: etat.banque });
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
    lien.download = `millionnaire-${new Date().toISOString().slice(0, 10)}.json`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  }

  async function importer(evenement) {
    const fichier = evenement.target.files?.[0];
    evenement.target.value = '';
    if (!fichier) return;
    try {
      const donnees = JSON.parse(await fichier.text());
      if (!Array.isArray(donnees.banque)) throw new Error('format inattendu');
      // On fusionne au lieu de remplacer : deux séries générées séparément
      // doivent pouvoir cohabiter.
      const vus = new Set(etat.banque.map((q) => q.id));
      let ajoutees = 0;
      for (const q of donnees.banque) if (!vus.has(q.id)) { vus.add(q.id); etat.banque.push(q); ajoutees++; }
      await ecrire(etat);
      dessiner(`<div class="message ok">${ajoutees} question(s) ajoutée(s).</div>`);
    } catch (e) {
      dessiner(`<div class="erreurs">Fichier illisible : ${echapper(e.message)}</div>`);
    }
  }

  async function vider() {
    if (!confirm('Effacer les questions du jeu ? Tes révisions ne sont pas touchées.')) return;
    await effacer();
    etat = { ...ETAT_VIDE, banque: [], vues: [], historique: [] };
    dessiner();
  }

  return { monter, demonter };
}
