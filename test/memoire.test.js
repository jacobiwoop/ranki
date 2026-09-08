import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  etatInitial, intervalle, recuperabilite, reviser,
} from '../src/memoire.js';

describe('courbe d\'oubli', () => {
  it('vaut 1 au moment de la révision', () => {
    assert.equal(recuperabilite(10, 0), 1);
  });

  it('vaut 0,9 après exactement S jours — c\'est la définition de la stabilité', () => {
    for (const S of [1, 5, 30, 365]) {
      assert.ok(Math.abs(recuperabilite(S, S) - 0.9) < 1e-6,
        `S=${S} donne R=${recuperabilite(S, S)}`);
    }
  });

  it('décroît strictement avec le temps', () => {
    let precedent = 1;
    for (const j of [1, 2, 5, 10, 50, 200]) {
      const r = recuperabilite(10, j);
      assert.ok(r < precedent, `R devrait décroître (${j} jours)`);
      precedent = r;
    }
  });

  it('une carte plus stable s\'oublie moins vite', () => {
    assert.ok(recuperabilite(60, 30) > recuperabilite(10, 30));
  });
});

describe('intervalle', () => {
  it('inverse la courbe d\'oubli', () => {
    for (const S of [1, 7, 40]) {
      for (const r of [0.8, 0.9, 0.95]) {
        const t = intervalle(S, r);
        assert.ok(Math.abs(recuperabilite(S, t) - r) < 1e-9);
      }
    }
  });

  it('exiger plus de rétention raccourcit l\'intervalle', () => {
    assert.ok(intervalle(30, 0.95) < intervalle(30, 0.9));
    assert.ok(intervalle(30, 0.9) < intervalle(30, 0.8));
  });
});

describe('état initial', () => {
  it('mieux on répond du premier coup, plus la carte démarre stable', () => {
    const s = [1, 2, 3, 4].map((n) => etatInitial(n).stabilite);
    for (let i = 1; i < s.length; i++) assert.ok(s[i] > s[i - 1]);
  });

  it('mieux on répond, moins la carte est jugée difficile', () => {
    const d = [1, 2, 3, 4].map((n) => etatInitial(n).difficulte);
    for (let i = 1; i < d.length; i++) assert.ok(d[i] < d[i - 1]);
  });

  it('borne la difficulté entre 1 et 10', () => {
    for (const n of [1, 2, 3, 4]) {
      const { difficulte } = etatInitial(n);
      assert.ok(difficulte >= 1 && difficulte <= 10, `D=${difficulte}`);
    }
  });
});

describe('révision', () => {
  it('rejette une note hors barème', () => {
    assert.throws(() => reviser(null, 0, 0), RangeError);
    assert.throws(() => reviser(null, 5, 0), RangeError);
  });

  it('une réussite augmente la stabilité', () => {
    const etat = { stabilite: 10, difficulte: 5 };
    for (const note of [2, 3, 4]) {
      const apres = reviser(etat, note, 10);
      assert.ok(apres.stabilite > etat.stabilite, `note ${note}`);
    }
  });

  it('« facile » fait progresser plus que « correct », lui-même plus que « difficile »', () => {
    const etat = { stabilite: 10, difficulte: 5 };
    const [d, c, f] = [2, 3, 4].map((n) => reviser(etat, n, 10).stabilite);
    assert.ok(d < c && c < f);
  });

  it('un échec ne peut JAMAIS augmenter la stabilité', () => {
    for (const S of [0.5, 5, 50, 300]) {
      for (const D of [1, 5, 10]) {
        const apres = reviser({ stabilite: S, difficulte: D }, 1, S);
        assert.ok(apres.stabilite <= S, `S=${S} D=${D} -> ${apres.stabilite}`);
        assert.ok(apres.stabilite > 0);
      }
    }
  });

  it('rater rend la carte plus difficile, réussir la rend plus facile', () => {
    const etat = { stabilite: 10, difficulte: 5 };
    assert.ok(reviser(etat, 1, 10).difficulte > 5);
    assert.ok(reviser(etat, 4, 10).difficulte < 5);
  });

  it('maintient la difficulté dans [1, 10] même sous matraquage', () => {
    let etat = etatInitial(3);
    for (let i = 0; i < 200; i++) {
      etat = reviser(etat, 1, 1);
      assert.ok(etat.difficulte <= 10 && etat.difficulte >= 1);
    }
    for (let i = 0; i < 200; i++) {
      etat = reviser(etat, 4, 10);
      assert.ok(etat.difficulte <= 10 && etat.difficulte >= 1);
    }
  });

  it('échapper au « trou noir » de SM-2 : une carte massacrée peut se rétablir', () => {
    // On dégrade sévèrement la carte...
    let etat = etatInitial(1);
    for (let i = 0; i < 30; i++) etat = reviser(etat, 1, 1);
    const pire = etat.difficulte;

    // ...puis on enchaîne les réussites : elle doit redevenir plus facile.
    for (let i = 0; i < 30; i++) etat = reviser(etat, 4, Math.max(1, etat.stabilite));
    assert.ok(etat.difficulte < pire,
      `la difficulté doit pouvoir redescendre (${pire} -> ${etat.difficulte})`);
  });

  it('réussir le jour même ne fait quasiment pas progresser la stabilité', () => {
    const etat = { stabilite: 10, difficulte: 5 };
    const memeJour = reviser(etat, 3, 0.01).stabilite;
    const dixJours = reviser(etat, 3, 10).stabilite;
    assert.ok(memeJour < dixJours,
      'répondre juste 5 minutes après ne prouve rien sur le long terme');
  });

  it('expose la récupérabilité prédite avant la réponse', () => {
    const { recuperabiliteAvant } = reviser({ stabilite: 10, difficulte: 5 }, 3, 10);
    assert.ok(Math.abs(recuperabiliteAvant - 0.9) < 1e-6);
  });
});
