/**
 * Interface du jeu.
 *
 * Le moteur (`src/jeu.js`) décide ; ce fichier affiche et chronomètre. La
 * séparation n'est pas cosmétique : elle permet de figer le chrono pendant un
 * joker sans que le moteur ait à connaître l'existence des jokers.
 */

import { ECHELLE, PALIERS, Partie, RESULTAT } from '../../src/jeu.js';
import { LETTRES, melanger } from '../../src/presentation.js';
import { ETAT_VIDE, creerEnregistreur, lire } from './stockage-jeu.js';

const $ = (id) => document.getElementById(id);
const euro = (n) => n.toLocaleString('fr-FR') + ' €';

const etat = (await lire()) ?? ETAT_VIDE;
const vues = new Map(etat.vues ?? []);
const enregistreur = creerEnregistreur(() => ({
  ...etat, vues: [...vues], parties: etat.parties, historique: etat.historique,
}));

let partie = null;
let fige = false;          // révélation en cours : plus rien n'est cliquable
let ordre = [];            // permutation appliquée aux propositions
let minuteur = null;
let restant = 0;
/** Explication de la question qu'on vient de traiter, révélée sur demande. */
let explication = '';

/* ------------------------------------------------------------------ chrono */

/**
 * Le chrono tourne jusqu'au dernier mot — sélection ET confirmation comprises.
 * Le geler au premier appui s'exploiterait trivialement : toucher A à la
 * première seconde pour figer, réfléchir, puis valider D.
 */
function lancerChrono(secondes) {
  arreterChrono();
  // 0 seconde = aucune limite : on masque le cadran plutôt que d'afficher un
  // compte à rebours figé, qui laisserait croire à une panne.
  if (!secondes) { $('chrono').hidden = true; restant = Infinity; return; }
  restant = secondes;
  $('chrono').hidden = false;
  peindreChrono(secondes, secondes);
  minuteur = setInterval(() => {
    restant -= 0.1;
    peindreChrono(restant, secondes);
    if (restant <= 0) { arreterChrono(); repondre(null); }
  }, 100);
}

function arreterChrono() {
  clearInterval(minuteur);
  minuteur = null;
}

function peindreChrono(restant, total) {
  const part = Math.max(0, restant / total);
  const perimetre = 2 * Math.PI * 19;
  $('jauge').style.strokeDasharray = `${perimetre * part} ${perimetre}`;
  $('secondes').textContent = Math.ceil(Math.max(0, restant));
  $('chrono').classList.toggle('urgent', restant <= 5);
  $('chrono').classList.toggle('alerte', restant <= 10 && restant > 5);
}

/*
 * Une application mise en arrière-plan est gelée par le système : à son retour,
 * le chrono aurait « sauté » sans que l'utilisateur ait rien vu. On ne peut ni
 * le sanctionner ni faire comme si de rien n'était — on repose la question.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || fige || !partie || partie.terminee) return;
  arreterChrono();
  partie.repondre(null, RESULTAT.INTERROMPU);
  dessiner();
  message('', 'Reprise après interruption — la question est reposée.');
});

/* ------------------------------------------------------------------ dessin */

function message(titre, corps, ton = '') {
  $('retour').className = `retour ${ton}`;
  $('retour').innerHTML = titre ? `<span class="titre">${titre}</span>${corps}` : corps;
}

/**
 * @param {number} [surligne]  rang à marquer comme courant, si différent de
 *   celui de la partie — sert à montrer la position AVANT le déplacement.
 */
function dessinerEchelle(surligne = partie.rang) {
  $('barreaux').innerHTML = ECHELLE.map((somme, i) => {
    const c = [];
    if (PALIERS.includes(i + 1)) c.push('palier');
    if (i < surligne) c.push('franchi');
    if (i === surligne) c.push('courant');
    return `<li class="${c.join(' ')}"><span class="rang">${i + 1}</span>`
      + `<span class="somme">${euro(somme)}</span></li>`;
  }).join('');
}

/**
 * Fait glisser le marqueur d'un rang à l'autre, échelle ouverte.
 *
 * On la montre AVANT de bouger, puis on déplace : sans ce temps d'arrêt, le
 * joueur voit une échelle déjà à jour et ne perçoit ni la montée ni la chute.
 * C'est tout l'intérêt de l'animation — rendre le déplacement sensible.
 */
function animerEchelle(de, vers) {
  $('echelle').classList.add('ouverte', 'revelation');
  dessinerEchelle(de);
  requestAnimationFrame(() => setTimeout(() => {
    dessinerEchelle(vers);
    const cible = $('barreaux').children[vers];
    cible?.classList.add(vers > de ? 'monte' : vers < de ? 'descend' : 'reste');
    cible?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 550));
}

/**
 * Somme affichée en haut : ce que l'on emporte en s'arrêtant maintenant.
 *
 * C'était auparavant le palier de sécurité — un nombre qui ne bougeait qu'aux
 * rangs 5 et 10 et donnait l'impression que rien ne se passait. Depuis que la
 * partie ne s'arrête plus sur une erreur, le filet ne dit d'ailleurs plus
 * grand-chose : il ne fixe qu'un plancher de chute, que l'échelle montre déjà.
 */
function majAcquis() {
  const emporte = partie.rang === 0 ? 0 : ECHELLE[partie.rang - 1];
  $('acquis').textContent = euro(emporte);
}

function dessiner() {
  const q = partie.question;

  /*
   * Le modèle place la bonne réponse en A ou B dans plus de 80 % des cas.
   * On brasse donc à l'affichage, avec une graine dérivée de l'identifiant :
   * l'ordre est stable pour une question donnée — on ne veut pas qu'il change
   * sous les doigts entre la sélection et la confirmation — mais imprévisible
   * d'une question à l'autre.
   */
  ordre = melanger(q.options.map((_, i) => i), grainePour(q.id));

  majAcquis();
  $('palier').innerHTML = `Question ${partie.rang + 1} · pour <b>${euro(partie.enJeu())}</b>`;
  $('question').textContent = q.question;

  $('propositions').innerHTML = ordre.map((source, place) => {
    const eteinte = partie.eteintes.has(source) ? ' eteinte' : '';
    return `<button class="prop${eteinte}" data-source="${source}">
      <span class="lettre">${LETTRES[place]}</span>
      <span class="texte">${echapper(q.options[source])}</span></button>`;
  }).join('');

  $('arret').hidden = false;
  $('arret').innerHTML = partie.rang === 0
    ? 'Abandonner la partie'
    : `Je m'arrête et j'emporte <b>${euro(ECHELLE[partie.rang - 1])}</b>`;

  for (const [nom, dispo] of Object.entries(partie.jokers)) {
    document.querySelector(`[data-joker="${nom}"]`).classList.toggle('use', !dispo);
  }
  dessinerEchelle();
  lancerChrono(partie.secondes());
}

const echapper = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Même hachage FNV-1a que les identifiants de carte. */
function grainePour(texte) {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/* ------------------------------------------------------------------- jouer */

/*
 * Un seul appui vaut validation.
 *
 * L'émission demande « c'est votre dernier mot ? » parce qu'un candidat en
 * plateau ne peut pas se rétracter et que le suspense est le produit. Ici le
 * second appui n'ajoutait rien : on a déjà choisi en touchant, et le
 * redemander transforme quinze décisions en trente gestes.
 */
function toucher(source) {
  if (fige || partie.eteintes.has(source)) return;
  repondre(source);
}

function repondre(source) {
  arreterChrono();
  fige = true;
  $('chrono').hidden = true;
  $('arret').hidden = true;

  const q = partie.question;
  const bilan = partie.repondre(source);

  [...$('propositions').children].forEach((b) => {
    const i = Number(b.dataset.source);
    b.classList.add('verrou');
    if (i === q.bonne) b.classList.add('juste');
    else if (i === source) b.classList.add('fausse');
  });

  etat.vues = [...vues];
  enregistreur.demander();

  const juste = bilan.resultat === RESULTAT.JUSTE;
  const titre = juste ? (bilan.jackpot ? '🏆 Un million !' : 'Bonne réponse')
    : bilan.resultat === RESULTAT.TEMPS ? 'Temps écoulé' : 'Mauvaise réponse';

  // L'explication n'est plus imposée : elle attend derrière « Pourquoi ? ».
  // Enchaîner reste le geste par défaut, comprendre est un choix.
  const rang = bilan.rangApres + 1;
  const mouvement = bilan.rangApres > bilan.rangAvant
    ? `Tu montes au rang ${rang}.`
    : bilan.rangApres < bilan.rangAvant
      ? `Tu redescends au rang ${rang}.`
      // Immobile : soit un palier a retenu la chute, soit on était déjà en bas.
      // Le dire précisément évite l'absurde « le palier de 0 € te retient ».
      : partie.filet() > 0
        ? `Le palier de ${euro(partie.filet())} te retient : tu restes au rang ${rang}.`
        : `Tu es déjà au premier rang : on ne descend pas plus bas.`;

  message(titre, bilan.jackpot ? 'Tu as gravi les quinze rangs.' : mouvement,
    juste ? 'ok' : 'ko');

  majAcquis();
  document.body.classList.add('revelation');
  animerEchelle(bilan.rangAvant, bilan.rangApres);
  explication = q.explication ?? 'Aucune explication disponible.';

  if (bilan.jackpot) { setTimeout(finir, 2400); return; }
  $('suite').hidden = false;
  $('continuer').textContent = 'Continuer';
}

$('continuer').addEventListener('click', () => {
  $('suite').hidden = true;
  $('pourquoi').hidden = false;
  document.body.classList.remove('revelation');
  $('echelle').classList.remove('ouverte', 'revelation');
  fige = false;
  message('', '');
  dessiner();
});

$('pourquoi').addEventListener('click', () => {
  document.body.classList.remove('revelation');
  $('echelle').classList.remove('ouverte', 'revelation');
  $('retour').className = 'retour';
  $('retour').innerHTML = `<span class="titre">L'explication</span>
    <span class="explication">${echapper(explication)}</span>`;
  $('pourquoi').hidden = true;
});

function finir() {
  arreterChrono();
  if (!partie.terminee) partie.arreter();

  etat.parties = partie.numero;
  etat.vues = [...vues];
  (etat.historique ??= []).push({
    partie: partie.numero, rang: partie.rang, gain: partie.gain,
    justes: partie.parcours.filter((p) => p.resultat === RESULTAT.JUSTE).length,
  });
  enregistreur.forcer();

  const rates = partie.parcours.filter((p) => p.resultat !== RESULTAT.JUSTE);
  $('chrono').hidden = true;
  $('suite').hidden = true;
  document.body.classList.remove('revelation');
  $('echelle').classList.remove('ouverte', 'revelation');
  $('jokers').style.visibility = 'hidden';
  $('palier').innerHTML = `Tu emportes <b>${euro(partie.gain)}</b>`;
  $('question').textContent = partie.gain > 0 ? 'Partie terminée' : 'Dommage';
  $('propositions').innerHTML = rates.map((p) => `
    <div class="bilan-rate">
      <div class="bilan-q">Q${p.rang + 1} — ${echapper(p.question)}</div>
      <div class="bilan-r">Réponse : <b>${echapper(p.options[p.bonne])}</b></div>
      <div class="bilan-e">${echapper(p.explication ?? '')}</div>
    </div>`).join('');

  message('', `${partie.parcours.filter((p) => p.resultat === RESULTAT.JUSTE).length}
    bonne(s) réponse(s) sur ${partie.parcours.length}`);
  $('arret').hidden = false;
  $('arret').textContent = 'Rejouer';
  $('arret').onclick = () => location.reload();
}

/* ----------------------------------------------------------------- jokers */

$('jokers').addEventListener('click', (e) => {
  const b = e.target.closest('.joker');
  if (!b || fige || !partie) return;
  const nom = b.dataset.joker;

  // Le chrono se fige : demander un joker ne doit pas coûter de temps, sinon
  // il devient un piège plutôt qu'une aide.
  const gele = restant;
  arreterChrono();

  const effet = partie.utiliserJoker(nom);
  if (!effet) { lancerChrono(gele); return; }

  if (nom === 'indice') {
    b.classList.add('use');
    message('Indice', echapper(effet.indice ?? 'Aucun indice disponible.'));
    lancerChrono(gele);
    return;
  }
  dessiner();                       // relance un chrono plein
  if (nom === 'changer') message('Question changée', 'Même palier, autre question.');
});

/* ------------------------------------------------------------- évènements */

$('propositions').addEventListener('click', (e) => {
  const b = e.target.closest('.prop');
  if (b) toucher(Number(b.dataset.source));
});

$('arret').addEventListener('click', () => {
  if (fige || !partie) return;
  if (partie.rang === 0) { if (confirm('Abandonner sans rien emporter ?')) finir(); return; }
  arreterChrono();
  fige = true;
  partie.arreter();
  message('Sage décision', `Tu emportes ${euro(partie.gain)}.`, 'ok');
  setTimeout(finir, 1600);
});

$('quitter').addEventListener('click', () => {
  if (partie && !partie.terminee && !confirm('Quitter la partie en cours ?')) return;
  window.location.href = '../';
});
$('voir-echelle').addEventListener('click', () => $('echelle').classList.add('ouverte'));
$('fermer-echelle').addEventListener('click', () => $('echelle').classList.remove('ouverte'));
window.addEventListener('pagehide', () => enregistreur.forcer());

/* ------------------------------------------------------------- démarrage */

if (!etat.banque?.length) {
  $('question').textContent = 'Aucune question préparée';
  $('jokers').style.visibility = 'hidden';
  message('', `Le jeu a besoin de questions enrichies. Va dans
    <b>Réglages → Le Millionnaire</b> pour les préparer à partir de tes séries.`);
  $('arret').hidden = false;
  $('arret').textContent = 'Retour';
  $('arret').onclick = () => { window.location.href = '../'; };
} else {
  partie = new Partie(etat.banque, vues, (etat.parties ?? 0) + 1,
                      grainePour(String(Date.now())), etat.reglages ?? {});
  dessiner();
}
