import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  JOUR_MS, REGLAGES_PLAN, Session, construireFile,
  estDue, prochaineRevision, progressionVierge, risque,
} from '../src/planificateur.js';

const T0 = 1_700_000_000_000; // horodatage fixe : tests déterministes

const carte = (id) => ({ id, question: id, propositions: [], longueur: 100 });

function progression(id, { stabilite = 10, difficulte = 5, jours = 0 } = {}) {
  return {
    ...progressionVierge(id),
    etat: { stabilite, difficulte },
    derniereRevision: T0 - jours * JOUR_MS,
    prochaine: T0 - jours * JOUR_MS + stabilite * JOUR_MS,
    nbRevisions: 1,
    nbReussites: 1,
  };
}

describe('prochaine révision', () => {
  it('place la révision à peu près à la stabilité, pour une cible de 0,9', () => {
    const { jours } = prochaineRevision({ stabilite: 30, difficulte: 5 }, T0);
    assert.equal(jours, 30);
  });

  it('n\'ordonne jamais moins d\'un jour', () => {
    const { jours } = prochaineRevision({ stabilite: 0.05, difficulte: 9 }, T0);
    assert.ok(jours >= 1);
  });

  it('plafonne les intervalles délirants', () => {
    const { jours } = prochaineRevision({ stabilite: 1e9, difficulte: 1 }, T0);
    assert.equal(jours, REGLAGES_PLAN.intervalleMaxJours);
  });

  it('viser une rétention plus haute rapproche la révision', () => {
    const etat = { stabilite: 30, difficulte: 5 };
    const large = prochaineRevision(etat, T0, { ...REGLAGES_PLAN, retentionCible: 0.85 });
    const serre = prochaineRevision(etat, T0, { ...REGLAGES_PLAN, retentionCible: 0.95 });
    assert.ok(serre.jours < large.jours);
  });
});

describe('sélection des cartes dues', () => {
  it('ne considère due qu\'une carte dont la date est passée', () => {
    assert.equal(estDue(progression('a', { jours: 20 }), T0), true);   // 10j de stabilité
    assert.equal(estDue(progression('b', { jours: 2 }), T0), false);
    assert.equal(estDue(progressionVierge('c'), T0), false);
  });

  it('classe les plus proches de l\'oubli en premier', () => {
    const cartes = [carte('fraiche'), carte('critique'), carte('limite')];
    const progressions = new Map([
      ['fraiche', progression('fraiche', { stabilite: 10, jours: 11 })],
      ['critique', progression('critique', { stabilite: 10, jours: 90 })],
      ['limite', progression('limite', { stabilite: 10, jours: 30 })],
    ]);
    const file = construireFile({ cartes, progressions, maintenant: T0 });
    assert.deepEqual(file.map((c) => c.id), ['critique', 'limite', 'fraiche']);
  });

  it('la récupérabilité décroît bien avec le retard accumulé', () => {
    const r1 = risque(progression('a', { jours: 5 }), T0);
    const r2 = risque(progression('a', { jours: 50 }), T0);
    assert.ok(r2 < r1);
  });

  it('respecte le plafond de nouvelles cartes par jour', () => {
    const cartes = Array.from({ length: 100 }, (_, i) => carte(`n${i}`));
    const file = construireFile({
      cartes, progressions: new Map(), maintenant: T0,
      reglages: { ...REGLAGES_PLAN, limiteNouvelles: 7 },
    });
    assert.equal(file.length, 7);
  });

  it('respecte le plafond de révisions par séance', () => {
    const cartes = Array.from({ length: 100 }, (_, i) => carte(`r${i}`));
    const progressions = new Map(cartes.map((c) => [c.id, progression(c.id, { jours: 50 })]));
    const file = construireFile({
      cartes, progressions, maintenant: T0,
      reglages: { ...REGLAGES_PLAN, limiteRevisions: 12, limiteNouvelles: 0 },
    });
    assert.equal(file.length, 12);
  });

  it('répartit les nouvelles cartes au fil de la séance au lieu de les entasser à la fin', () => {
    const revisions = Array.from({ length: 20 }, (_, i) => carte(`r${i}`));
    const neuves = Array.from({ length: 4 }, (_, i) => carte(`n${i}`));
    const progressions = new Map(revisions.map((c) => [c.id, progression(c.id, { jours: 50 })]));

    const file = construireFile({
      cartes: [...revisions, ...neuves], progressions, maintenant: T0,
      reglages: { ...REGLAGES_PLAN, limiteNouvelles: 4 },
    });

    assert.equal(file.length, 24);
    const positions = file
      .map((c, i) => (c.id.startsWith('n') ? i : -1))
      .filter((i) => i >= 0);
    assert.equal(positions.length, 4);
    // Aucune nouvelle carte ne doit se retrouver reléguée dans le dernier quart.
    assert.ok(positions[0] < 8, `première nouvelle en position ${positions[0]}`);
    assert.ok(positions.at(-1) < 23, 'les nouvelles ne doivent pas finir toutes à la fin');
  });

  it('gère les cas dégénérés : que des neuves, ou que des révisions', () => {
    const neuves = [carte('a'), carte('b')];
    assert.equal(construireFile({
      cartes: neuves, progressions: new Map(), maintenant: T0,
    }).length, 2);

    const progressions = new Map(neuves.map((c) => [c.id, progression(c.id, { jours: 50 })]));
    assert.equal(construireFile({ cartes: neuves, progressions, maintenant: T0 }).length, 2);
  });
});

describe('session', () => {
  const file = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(carte);

  it('déroule les cartes dans l\'ordre quand tout est réussi', () => {
    const s = new Session(file);
    const vues = [];
    while (s.courante()) { vues.push(s.courante().id); s.avancer(true); }
    assert.deepEqual(vues, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    assert.equal(s.reprises, 0);
  });

  it('réinjecte une carte ratée plus loin dans la même séance', () => {
    const s = new Session(file, { ...REGLAGES_PLAN, ecartReprise: 3 });
    assert.equal(s.courante().id, 'a');
    s.avancer(false);
    const vues = [];
    while (s.courante()) { vues.push(s.courante().id); s.avancer(true); }
    assert.ok(vues.includes('a'), 'la carte ratée doit repasser');
    assert.equal(s.reprises, 1);
    assert.equal(vues.indexOf('a'), 3, 'elle revient après ecartReprise cartes');
  });

  it('replace la carte à la fin si la séance est trop courte', () => {
    const s = new Session([carte('x'), carte('y')], { ...REGLAGES_PLAN, ecartReprise: 50 });
    s.avancer(false);
    const vues = [];
    while (s.courante()) { vues.push(s.courante().id); s.avancer(true); }
    assert.deepEqual(vues, ['y', 'x']);
  });

  it('termine même si l\'on rate tout : chaque reprise consomme une position', () => {
    const s = new Session(file, { ...REGLAGES_PLAN, ecartReprise: 2 });
    let gardeFou = 0;
    while (s.courante() && gardeFou++ < 10_000) s.avancer(gardeFou > 20);
    assert.equal(s.courante(), null, 'la séance doit se terminer');
    assert.ok(gardeFou < 10_000, 'pas de boucle infinie');
  });

  it('compte correctement les cartes restantes', () => {
    const s = new Session(file);
    assert.equal(s.restantes, 8);
    s.avancer(true);
    assert.equal(s.restantes, 7);
    s.avancer(false);
    assert.equal(s.restantes, 7, 'une reprise rallonge la file d\'autant');
  });

  it('sur une file vide, ne renvoie rien et ne plante pas', () => {
    const s = new Session([]);
    assert.equal(s.courante(), null);
    assert.equal(s.avancer(true), null);
  });
});
