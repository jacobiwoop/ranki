import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIFFICULTE_DU_RANG, ECHELLE, PALIERS, Partie, RESULTAT,
  SECONDES_DU_RANG, classer, tirer,
} from '../src/jeu.js';

/** Banque factice : `parNiveau` questions pour chaque difficulté de 1 à 5. */
function banque(parNiveau = 10) {
  const q = [];
  for (let d = 1; d <= 5; d++) {
    for (let i = 0; i < parNiveau; i++) {
      q.push({
        id: `d${d}-${i}`, difficulte: d,
        question: `Question ${d}.${i} ?`,
        options: ['a', 'b', 'c', 'd'], bonne: i % 4,
        explication: 'parce que.', indice: 'un indice',
      });
    }
  }
  return q;
}

test('les paliers encadrent la montée en difficulté', () => {
  // On garde les paliers de l'émission (Q5 et Q10) plutôt que de les déplacer
  // pour les faire coïncider avec les cinq niveaux. Seul le second tombe
  // pile à un changement — le premier est au milieu de la difficulté 2, et
  // c'est très bien : il sécurise tôt, avant que ça devienne sérieux.
  assert.notEqual(
    DIFFICULTE_DU_RANG(8), DIFFICULTE_DU_RANG(9),
    'Q10 doit ouvrir la difficulté 4',
  );
  assert.deepEqual(PALIERS.map((p) => DIFFICULTE_DU_RANG(p - 1)), [2, 4]);
  // Un filet doit toujours valoir moins que ce qui est en jeu ensuite.
  for (const p of PALIERS) assert.ok(ECHELLE[p - 1] < ECHELLE[p]);
});

test('quinze rangs répartis sur cinq niveaux, trois par niveau', () => {
  const compte = {};
  for (let r = 0; r < ECHELLE.length; r++) {
    const d = DIFFICULTE_DU_RANG(r);
    compte[d] = (compte[d] ?? 0) + 1;
  }
  assert.deepEqual(compte, { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3 });
});

test('le chronomètre s\'allonge avec la difficulté', () => {
  assert.equal(SECONDES_DU_RANG(0), 20);
  assert.equal(SECONDES_DU_RANG(9), 30);
  assert.equal(SECONDES_DU_RANG(14), 45);
});

test('une question ne tombe jamais deux fois dans la même partie', () => {
  const p = new Partie(banque(4), new Map(), 1);
  const vues = new Set();
  while (!p.terminee) {
    assert.ok(!vues.has(p.question.id), `${p.question.id} reposée`);
    vues.add(p.question.id);
    p.repondre(p.question.bonne);
  }
  assert.equal(vues.size, 15);
});

test('les quinze tranches se partagent la banque à parts égales', () => {
  // Le point de tout le découpage : peu importe que le modèle ait étiqueté
  // 1 200 questions en difficulté 3 et 96 en difficulté 5, chaque rang reçoit
  // le même nombre de questions.
  const tranches = classer(banque(20));  // 100 questions, très inégalement réparties
  const tailles = tranches.map((t) => t.length);
  assert.equal(tailles.reduce((a, b) => a + b, 0), 100);
  assert.ok(Math.max(...tailles) - Math.min(...tailles) <= 1,
    `tranches déséquilibrées : ${tailles.join(', ')}`);
});

test('les tranches vont du plus facile au plus difficile', () => {
  const tranches = classer(banque(20));
  const moyenne = (t) => t.reduce((s, q) => s + q.difficulte, 0) / t.length;
  for (let i = 1; i < tranches.length; i++) {
    assert.ok(moyenne(tranches[i]) >= moyenne(tranches[i - 1]),
      `la tranche ${i} est plus facile que la précédente`);
  }
});

test('une banche déséquilibrée ne prive aucun rang', () => {
  // 300 questions faciles, 3 difficiles : le découpage par quantiles doit
  // quand même servir les quinze rangs.
  const b = [];
  for (let i = 0; i < 300; i++) {
    b.push({ id: `f${i}`, difficulte: 1, question: '?', options: ['a', 'b', 'c', 'd'], bonne: 0 });
  }
  for (let i = 0; i < 3; i++) {
    b.push({ id: `d${i}`, difficulte: 5, question: '?', options: ['a', 'b', 'c', 'd'], bonne: 0 });
  }
  const tranches = classer(b);
  for (let r = 0; r < 15; r++) {
    assert.ok(tirer(tranches, new Map(), new Set(), r, 1), `rang ${r} non servi`);
  }
});

test('les jamais vues passent avant les déjà vues', () => {
  // 100 questions : assez pour que chaque tranche en contienne plusieurs.
  const tranches = classer(banque(20));
  const vues = new Map();
  // Tout le premier rang a été vu, sauf une seule question.
  const inedite = tranches[0].at(-1);
  tranches[0].filter((q) => q.id !== inedite.id).forEach((q) => vues.set(q.id, 1));

  assert.equal(tirer(tranches, vues, new Set(), 0, 42).id, inedite.id);
});

test('à égalité de fraîcheur, la moins récemment vue passe devant', () => {
  const trois = [
    { id: 'a', difficulte: 1, options: ['a', 'b', 'c', 'd'], bonne: 0 },
    { id: 'b', difficulte: 1, options: ['a', 'b', 'c', 'd'], bonne: 0 },
    { id: 'c', difficulte: 1, options: ['a', 'b', 'c', 'd'], bonne: 0 },
  ];
  const vues = new Map([['a', 9], ['b', 2], ['c', 5]]);
  assert.equal(tirer([trois], vues, new Set(), 0, 1).id, 'b');
});

test('une tranche épuisée déborde sur les voisines au lieu d\'échouer', () => {
  const tranches = classer(banque(6));
  // On exclut tout le rang 0 : il doit quand même être servi.
  const exclues = new Set(tranches[0].map((q) => q.id));
  assert.ok(tirer(tranches, new Map(), exclues, 0, 7), 'aucune question tirée');
});

test('une mauvaise réponse fait redescendre sans terminer la partie', () => {
  const p = new Partie(banque(), new Map(), 1);
  p.repondre(p.question.bonne);           // rang 0 -> 1
  p.repondre(p.question.bonne);           // rang 1 -> 2
  const r = p.repondre((p.question.bonne + 1) % 4);

  assert.equal(r.resultat, RESULTAT.FAUX);
  assert.ok(!p.terminee, 'une erreur ne doit plus éliminer');
  assert.equal(r.rangAvant, 2);
  assert.equal(r.rangApres, 1, 'on redescend d\'un rang');
  assert.ok(p.question, 'une nouvelle question doit être posée');
});

test('un palier franchi devient un plancher', () => {
  const p = new Partie(banque(), new Map(), 1);
  for (let i = 0; i < 5; i++) p.repondre(p.question.bonne);  // Q5 passée, rang 5
  assert.equal(p.rang, 5);

  const r = p.repondre((p.question.bonne + 1) % 4);
  assert.equal(r.rangApres, 5, 'le palier de Q5 retient la chute');
  assert.equal(p.gain, 1_500);
});

test('on ne descend jamais sous le rang zéro', () => {
  const p = new Partie(banque(), new Map(), 1);
  for (let i = 0; i < 3; i++) p.repondre((p.question.bonne + 1) % 4);
  assert.equal(p.rang, 0);
  assert.ok(!p.terminee);
  assert.equal(p.gain, 0);
});

test('la partie ne s\'arrête qu\'au sommet ou sur abandon', () => {
  const p = new Partie(banque(30), new Map(), 1);
  // Dix erreurs d'affilée : la partie doit tenir.
  for (let i = 0; i < 10; i++) p.repondre((p.question.bonne + 1) % 4);
  assert.ok(!p.terminee, `terminée après ${p.erreurs} erreurs`);
  assert.equal(p.erreurs, 10);

  p.arreter();
  assert.ok(p.terminee);
});

test('s\'arrêter emporte le rang précédent, pas celui en jeu', () => {
  const p = new Partie(banque(), new Map(), 1);
  p.repondre(p.question.bonne);      // rang 0 gagné, on est au rang 1
  p.repondre(p.question.bonne);      // rang 1 gagné, on est au rang 2
  assert.equal(p.arreter(), ECHELLE[1]);
});

test('quinze bonnes réponses donnent le million', () => {
  const p = new Partie(banque(), new Map(), 1);
  let dernier;
  while (!p.terminee) dernier = p.repondre(p.question.bonne);
  assert.equal(dernier.jackpot, true);
  assert.equal(p.gain, 1_000_000);
});

test('le temps écoulé compte comme une erreur, sans éliminer', () => {
  const p = new Partie(banque(), new Map(), 1);
  p.repondre(p.question.bonne);
  const r = p.repondre(null);

  assert.equal(r.resultat, RESULTAT.TEMPS);
  assert.ok(!p.terminee);
  assert.equal(r.rangApres, 0, 'le temps écoulé fait redescendre comme une erreur');
});

test('une interruption ne sanctionne pas et garde la question', () => {
  const p = new Partie(banque(), new Map(), 1);
  const avant = p.question.id;
  const r = p.repondre(null, RESULTAT.INTERROMPU);

  assert.equal(r.resultat, RESULTAT.INTERROMPU);
  assert.ok(!p.terminee, 'la partie ne doit pas se terminer');
  assert.equal(p.question.id, avant, 'la même question doit être reposée');
  assert.equal(p.parcours.length, 0, 'rien ne doit être journalisé');
});

test('le 50/50 éteint deux mauvaises et jamais la bonne', () => {
  const p = new Partie(banque(), new Map(), 1);
  const bonne = p.question.bonne;
  const { eteintes } = p.utiliserJoker('moitie');

  assert.equal(eteintes.length, 2);
  assert.ok(!eteintes.includes(bonne), 'la bonne réponse a été éteinte');
  assert.equal(p.utiliserJoker('moitie'), null, 'un joker ne sert qu\'une fois');
});

test('changer de question reste au même rang et n\'y revient pas', () => {
  const p = new Partie(banque(), new Map(), 1);
  const avant = p.question.id;
  const rangAvant = p.rang;
  p.utiliserJoker('changer');

  assert.equal(p.rang, rangAvant, 'le rang ne doit pas bouger');
  assert.notEqual(p.question.id, avant);
  assert.ok(p.exclues.has(avant), 'la question écartée doit rester exclue');
});

test('le parcours retient si un joker a servi', () => {
  const p = new Partie(banque(), new Map(), 1);
  p.utiliserJoker('moitie');
  p.repondre(p.question.bonne);
  assert.equal(p.parcours[0].avecJoker, true);

  p.repondre(p.question.bonne);
  assert.equal(p.parcours[1].avecJoker, false);
});

test('la partie note les questions vues, pour espacer les suivantes', () => {
  const vues = new Map();
  const p = new Partie(banque(), vues, 7);
  const id = p.question.id;
  p.repondre(p.question.bonne);
  assert.equal(vues.get(id), 7, 'le numéro de partie doit être mémorisé');
});

test('deux parties d\'affilée ne rejouent pas les mêmes questions', () => {
  const b = banque(20);
  const vues = new Map();

  const un = new Partie(b, vues, 1);
  const idsUn = [];
  while (!un.terminee) { idsUn.push(un.question.id); un.repondre(un.question.bonne); }

  const deux = new Partie(b, vues, 2);
  const idsDeux = [];
  while (!deux.terminee) { idsDeux.push(deux.question.id); deux.repondre(deux.question.bonne); }

  const communes = idsUn.filter((id) => idsDeux.includes(id));
  assert.equal(communes.length, 0, `${communes.length} question(s) rejouée(s)`);
});
