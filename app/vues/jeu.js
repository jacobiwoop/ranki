/**
 * Onglet « Jeu » — préparer les questions, puis jouer.
 *
 * Le jeu vit dans une base séparée de la révision : rien de ce qui se passe
 * ici ne touche une date d'échéance. La préparation, elle, LIT les cartes de
 * révision — c'est leur contenu vérifié qui sert de matière première.
 */

import { ETAT_VIDE, ecrire, effacer, lire } from '../jeu/stockage-jeu.js';
import { MODELE_DEFAUT, enrichir } from '../jeu/agent.js';
import { SECONDES_DEFAUT } from '../../src/jeu.js';

const CLE_API = 'millionnaire.cle';

export function creerVueJeu({ moteur }) {
  let racine = null;
  let etat = ETAT_VIDE;
  let enCours = null;   // AbortController pendant une génération
  let reglagesOuverts = false;

  /** Durées du chronomètre, par tranche de rangs. */
  const secondes = () => {
    const s = etat.reglages?.secondes;
    return Array.isArray(s) && s.length === 3 ? s : [...SECONDES_DEFAUT];
  };

  const TRANCHES = [
    { titre: 'Rangs 1 à 5', detail: 'Définitions et faits directs.' },
    { titre: 'Rangs 6 à 10', detail: 'Raisonnement court, pièges classiques.' },
    { titre: 'Rangs 11 à 15', detail: 'Calculs, diagnostics. Ces énoncés sont longs à lire.' },
  ];

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

    const sec = secondes();
    racine.innerHTML = `
      <div class="titre-action">
        <h2>Le Millionnaire</h2>
        <button class="icone-reglage ${reglagesOuverts ? 'actif' : ''}" id="ouvrir-reglages"
                aria-label="Réglages du jeu" title="Réglages du jeu">⚙</button>
      </div>

      ${reglagesOuverts ? `
        <div class="reglages-jeu">
          <h3>Temps de réflexion</h3>
          <p class="consigne">Le chronomètre couvre la lecture, la réflexion et
          la validation. Il se fige pendant un joker. <b>0 = aucune limite.</b></p>
          ${TRANCHES.map((tr, i) => `
            <div class="reglage-duree">
              <label for="sec-${i}">
                <b>${tr.titre}</b>
                <span>${tr.detail}</span>
              </label>
              <div class="champ-duree">
                <input type="number" id="sec-${i}" data-tranche="${i}"
                       min="0" max="300" step="5" value="${sec[i]}">
                <span class="unite">s</span>
              </div>
            </div>`).join('')}
          <button class="bouton secondaire" id="secondes-defaut">Revenir aux valeurs par défaut
            (${SECONDES_DEFAUT.join(' · ')} s)</button>
        </div>` : ''}

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
      <div id="journal" class="journal" ${enCours ? '' : 'hidden'}></div>

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
    sur('#ouvrir-reglages', 'click', () => { reglagesOuverts = !reglagesOuverts; dessiner(); });
    racine.querySelectorAll('[data-tranche]').forEach((champ) => {
      champ.addEventListener('change', async () => {
        // On borne à la saisie plutôt qu'à l'usage : l'utilisateur voit tout de
        // suite la valeur retenue au lieu de croire qu'un 9999 a été accepté.
        const valeur = Math.min(300, Math.max(0, Math.round(Number(champ.value) || 0)));
        champ.value = String(valeur);
        const s = secondes();
        s[Number(champ.dataset.tranche)] = valeur;
        etat.reglages = { ...etat.reglages, secondes: s };
        await ecrire(etat);
      });
    });
    sur('#secondes-defaut', 'click', async () => {
      etat.reglages = { ...etat.reglages, secondes: [...SECONDES_DEFAUT] };
      await ecrire(etat);
      dessiner();
    });
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
    const debut = Date.now();
    let nbBlocs = 0;
    dessiner(barre(0, cartes.length, etat.banque.length, [], debut));

    const tracer = (evenement) => journaliser(evenement);

    await enrichir(cartes, {
      cle,
      modele: MODELE_DEFAUT,
      signal: enCours.signal,
      surDebut: ({ blocs, taille, parallele, modele }) => {
        nbBlocs = blocs;
        journaliser({ etat: 'info', texte:
          `${cartes.length} question${cartes.length > 1 ? 's' : ''} · `
          + `${blocs} bloc${blocs > 1 ? 's' : ''} de ${taille} · `
          + `${parallele} en parallèle · ${modele}` });
      },
      surBloc: async (e) => {
        if (e.etat === 'encours') { tracer(e); return; }
        // On écrit à chaque bloc : une coupure ne doit pas gâcher ce qui est payé.
        for (const q of e.questions) if (!deja.has(q.id)) { deja.add(q.id); etat.banque.push(q); }
        await ecrire(etat);
        tracer({ ...e, produites: e.questions.length });
        majProgression(barre(e.faits, e.total, etat.banque.length, erreurs, debut, nbBlocs));
      },
      surErreur: (e) => {
        erreurs.push(e.erreur);
        tracer(e);
        majProgression(barre(e.faits, e.total, etat.banque.length, erreurs, debut, nbBlocs));
      },
    });

    const interrompu = enCours?.signal.aborted;
    enCours = null;
    const secondes = Math.round((Date.now() - debut) / 1000);
    journaliser({ etat: interrompu ? 'stop' : 'ok',
      texte: `${interrompu ? 'Arrêté' : 'Terminé'} en ${duree(secondes)} · `
        + `${etat.banque.length.toLocaleString('fr-FR')} questions prêtes` });

    const trace = racine.querySelector('#journal')?.innerHTML ?? '';
    dessiner(`<div class="message ${erreurs.length ? 'attention' : 'ok'}">
      ${interrompu ? 'Arrêté' : 'Terminé'} —
      ${etat.banque.length.toLocaleString('fr-FR')} questions prêtes en ${duree(secondes)}.</div>`);
    const zone = racine.querySelector('#journal');
    if (zone) { zone.innerHTML = trace; zone.hidden = false; }
  }

  const duree = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`);

  /**
   * Journal des blocs — la transparence demandée.
   *
   * Une barre de progression seule ne dit pas ce qui se passe : on ignore si
   * l'attente vient d'un bloc lent, d'un nouvel essai après un refus, ou d'un
   * blocage. Chaque bloc écrit donc son entrée, mise à jour sur place quand il
   * aboutit, avec sa durée et ce qu'il a produit.
   */
  function journaliser(e) {
    const zone = racine.querySelector('#journal');
    if (!zone) return;
    zone.hidden = false;

    if (e.etat === 'info' || e.etat === 'ok' || e.etat === 'stop') {
      zone.insertAdjacentHTML('afterbegin',
        `<div class="jrn ${e.etat}"><span class="marque">${
          e.etat === 'info' ? '·' : e.etat === 'ok' ? '✓' : '■'}</span>
         <span class="txt">${echapper(e.texte)}</span></div>`);
      return;
    }

    const cle = `bloc-${e.numero}`;
    const sections = e.sections.join(', ');
    const corps = e.etat === 'encours'
      ? `<span class="marque tourne">◌</span>
         <span class="txt">Bloc ${e.numero} · ${e.taille} question${e.taille > 1 ? 's' : ''} · ${echapper(sections)}</span>
         <span class="chiffre">en cours…</span>`
      : e.etat === 'fini'
        ? `<span class="marque">✓</span>
           <span class="txt">Bloc ${e.numero} · ${echapper(sections)}</span>
           <span class="chiffre">+${e.produites} · ${(e.ms / 1000).toFixed(1)} s</span>`
        : `<span class="marque">✗</span>
           <span class="txt">Bloc ${e.numero} · ${echapper(e.erreur)}</span>
           <span class="chiffre">${(e.ms / 1000).toFixed(1)} s</span>`;

    const existant = zone.querySelector(`[data-bloc="${cle}"]`);
    const classe = `jrn ${e.etat}`;
    if (existant) { existant.className = classe; existant.innerHTML = corps; }
    else {
      zone.insertAdjacentHTML('afterbegin',
        `<div class="${classe}" data-bloc="${cle}">${corps}</div>`);
    }
  }

  /** Mise à jour ciblée : redessiner effacerait la clé en cours de saisie. */
  function majProgression(html) {
    const zone = racine.querySelector('#progression');
    if (zone) zone.innerHTML = html;
  }

  function barre(faits, total, produites, erreurs = [], debut = null, nbBlocs = 0) {
    const part = total ? Math.round((faits / total) * 100) : 0;
    // Estimation du reste, à partir du rythme observé. Sans repère de temps,
    // une barre à 12 % ne dit pas s'il faut attendre trente secondes ou dix
    // minutes — et c'est précisément ce qu'on veut savoir avant de partir.
    let temps = '';
    if (debut && faits > 0) {
      const ecoule = (Date.now() - debut) / 1000;
      const reste = Math.round((ecoule / faits) * (total - faits));
      temps = ` · ${duree(Math.round(ecoule))} écoulées`
        + (faits < total ? `, ~${duree(reste)} restantes` : '');
    }
    return `<div class="avancement">
      <div class="jauge"><span style="width:${part}%"></span></div>
      <div class="legende">${part} % — ${faits} / ${total} question${total > 1 ? 's' : ''} ·
        ${produites.toLocaleString('fr-FR')} produites${
        nbBlocs > 1 ? ` · ${Math.ceil(faits / 20)}/${nbBlocs} blocs` : ''}${temps}${
        erreurs.length ? ` · <b>${erreurs.length} bloc${erreurs.length > 1 ? 's' : ''} en échec</b>` : ''}</div>
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

  /*
   * Au retour sur l'onglet, on se remet à jour — SAUF pendant une génération :
   * redessiner effacerait la barre et le journal, et perdrait le fil d'une
   * opération qui dure plusieurs minutes.
   */
  return {
    monter,
    reprendre: async () => {
      if (enCours || !racine) return;
      etat = (await lire()) ?? ETAT_VIDE;
      dessiner();
    },
    demonter,
  };
}
