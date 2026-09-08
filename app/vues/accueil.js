/**
 * Écran d'accueil — le point de départ.
 *
 * Deux façons de travailler, volontairement distinctes :
 *
 *   « Ce qui est dû »  — la répétition espacée proprement dite. Le moteur
 *                        pioche dans tout ce qui risque d'être oublié
 *                        aujourd'hui. C'est le mode qui fait mémoriser.
 *
 *   Un recueil, ou une — du bachotage assumé : on reprend tout un fichier ou
 *   de ses séries        tout un chapitre, y compris ce qui n'est pas encore
 *                        dû. Légitime avant un examen, mais ce n'est pas la
 *                        même chose.
 *
 * La liste est à deux niveaux — recueil, puis série — parce qu'on importe
 * plusieurs fichiers. À plat, quinze chapitres du même document noieraient
 * ceux d'un autre, et rien ne dirait d'où ils viennent.
 *
 * Et deux modes, choisis au lancement : apprentissage (correction après chaque
 * question) ou examen (aucun retour avant la fin).
 */

const pc = (n, total) => (total ? Math.round((n / total) * 100) : 0);

const echapper = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function creerVueAccueil({ moteur, lancerSeance, rafraichirOnglets }) {
  let racine = null;
  /** Recueils dépliés, retenus par nom pour survivre à un redessin. */
  const ouverts = new Set();

  function monter(element) {
    racine = element;
    dessiner();
  }

  function dessiner() {
    if (moteur.cartes.length === 0) {
      racine.innerHTML = `
        <div class="vide">
          <strong>Aucune question</strong>
          Commence par en importer dans l'onglet « Réglages ».
        </div>
        <button class="bouton" id="vers-import">Importer des questions</button>`;
      racine.querySelector('#vers-import')
        .addEventListener('click', () => rafraichirOnglets('reglages'));
      return;
    }

    const recueils = moteur.recueils();
    const dues = recueils.reduce((s, r) => s + r.dues, 0);
    const neuves = recueils.reduce((s, r) => s + r.neuves, 0);
    const aFaire = dues + Math.min(
      neuves,
      Math.max(0, moteur.reglages.limiteNouvelles - moteur.nouvellesDuJour()),
    );

    // Un seul recueil : on le déplie d'office, sinon l'écran n'affiche qu'une
    // ligne close et l'utilisateur ne voit plus ses chapitres.
    if (recueils.length === 1) ouverts.add(recueils[0].nom);

    racine.innerHTML = `
      <h2>Aujourd'hui</h2>
      <div class="carte-action ${aFaire === 0 ? 'terne' : ''}">
        <div class="grand-compte">${aFaire}</div>
        <div class="libelle">${aFaire === 0
          ? 'Rien à réviser pour le moment'
          : `carte${aFaire > 1 ? 's' : ''} à réviser · ${dues} en attente, `
            + `${Math.max(0, aFaire - dues)} nouvelle${aFaire - dues > 1 ? 's' : ''}`}</div>
        ${aFaire > 0 ? `
          <div class="paire-boutons">
            <button class="bouton" data-lancer="du" data-mode="apprentissage">Apprentissage</button>
            <button class="bouton secondaire" data-lancer="du" data-mode="examen">Examen</button>
          </div>` : ''}
      </div>

      <h3>Tes recueils</h3>
      <ul class="recueils">${recueils.map(ligneRecueil).join('')}</ul>
      <p class="aide">Lancer un recueil ou une série reprend TOUT son contenu,
      même ce qui n'est pas encore dû. Utile pour bachoter avant un examen ;
      « Aujourd'hui » reste le mode qui fait réellement mémoriser.</p>
    `;

    /*
     * Recueils et séries sont désignés par leurs INDEX, jamais par leur nom :
     * un nom passé par l'échappement HTML ne correspondrait plus à la valeur
     * stockée sur les cartes, et le filtre ne trouverait rien.
     */
    racine.querySelectorAll('[data-lancer]').forEach((b) => {
      b.addEventListener('click', () => {
        const { lancer, serie, mode } = b.dataset;
        if (lancer === 'du') { lancerSeance({ mode }); return; }

        const r = recueils[Number(lancer)];
        const section = serie === undefined ? null : r.series[Number(serie)].nom;
        lancerSeance({ recueil: r.nom, section, inclureNonDues: true, mode });
      });
    });

    racine.querySelectorAll('.recueil-titre').forEach((t) => {
      t.addEventListener('click', () => {
        const bloc = t.closest('.recueil');
        const nom = recueils[Number(bloc.dataset.index)].nom;
        if (ouverts.has(nom)) ouverts.delete(nom); else ouverts.add(nom);
        bloc.classList.toggle('ouverte', ouverts.has(nom));
      });
    });

    /*
     * Accordéon : une seule série ouverte à la fois. Sur un recueil de quatorze
     * chapitres, laisser tous les boutons visibles produit une page de trente
     * boutons identiques où l'on ne trouve plus rien.
     */
    racine.querySelectorAll('.serie-titre').forEach((t) => {
      t.addEventListener('click', () => {
        const bloc = t.closest('.serie');
        const etaitOuverte = bloc.classList.contains('ouverte');
        racine.querySelectorAll('.serie.ouverte').forEach((s) => s.classList.remove('ouverte'));
        if (!etaitOuverte) bloc.classList.add('ouverte');
      });
    });
  }

  function ligneRecueil(r, index) {
    const progres = pc(r.acquises, r.total);
    return `
      <li class="recueil ${ouverts.has(r.nom) ? 'ouverte' : ''}" data-index="${index}">
        <button class="recueil-titre">
          <span class="chevron" aria-hidden="true">›</span>
          <span class="nom">${echapper(r.nom)}</span>
          <span class="chiffres">
            ${r.dues > 0 ? `<b class="pastille">${r.dues}</b>` : ''}
            ${r.total}
          </span>
        </button>
        <div class="piste"><i style="width:${progres}%"></i></div>
        <div class="detail">
          <span class="resume">${r.series.length} série${r.series.length > 1 ? 's' : ''}
            · ${progres} % acquis · ${r.neuves} jamais vue${r.neuves > 1 ? 's' : ''}</span>
          <div class="paire-boutons">
            <button class="bouton secondaire" data-lancer="${index}" data-mode="apprentissage">Tout, apprentissage</button>
            <button class="bouton secondaire" data-lancer="${index}" data-mode="examen">Tout, examen</button>
          </div>
          <ul class="series">${r.series.map((s, i) => ligneSerie(s, index, i)).join('')}</ul>
        </div>
      </li>`;
  }

  function ligneSerie(s, iRecueil, iSerie) {
    const progres = pc(s.acquises, s.total);
    return `
      <li class="serie">
        <button class="serie-titre">
          <span class="nom">${echapper(s.nom)}</span>
          <span class="chiffres">
            ${s.dues > 0 ? `<b class="pastille">${s.dues}</b>` : ''}
            ${s.total}
          </span>
        </button>
        <div class="piste"><i style="width:${progres}%"></i></div>
        <div class="detail">
          <span>${progres} % acquis · ${s.neuves} jamais vue${s.neuves > 1 ? 's' : ''}</span>
          <div class="paire-boutons">
            <button class="bouton secondaire" data-lancer="${iRecueil}" data-serie="${iSerie}"
                    data-mode="apprentissage">Apprentissage</button>
            <button class="bouton secondaire" data-lancer="${iRecueil}" data-serie="${iSerie}"
                    data-mode="examen">Examen</button>
          </div>
        </div>
      </li>`;
  }

  /*
   * Au retour sur l'onglet, les compteurs ont pu changer — une séance vient
   * peut-être de se terminer. On redessine, mais `ouverts` survit : on
   * retrouve ses recueils dépliés comme on les avait laissés.
   */
  return { monter, reprendre: () => racine && dessiner() };
}
