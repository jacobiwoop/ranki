import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CORRECT, DIFFICILE, ENCORE, FACILE, ProfilUtilisateur, noter,
} from '../src/notation.js';

/** Profil calibré sur un utilisateur régulier : ~40 ms/caractère, 600 ms de latence. */
function profilEntraine({ latence = 600, msParCar = 40, bruit = 300 } = {}) {
  const profil = new ProfilUtilisateur();
  // Bruit pseudo-aléatoire déterministe, pour un test reproductible.
  let graine = 42;
  const alea = () => {
    graine = (graine * 1103515245 + 12345) % 2147483648;
    return graine / 2147483648;
  };
  for (let i = 0; i < 120; i++) {
    const longueur = 60 + Math.floor(alea() * 200);
    const tempsMs = latence + msParCar * longueur + (alea() - 0.5) * 2 * bruit;
    profil.enregistrer({ longueur, tempsMs, correcte: true });
  }
  return profil;
}

const base = {
  correcte: true, longueur: 150, nbPropositions: 4,
  historique: { nbRevisions: 5, nbReussites: 4 },
};

describe('notation — cas de base', () => {
  it('une réponse fausse vaut toujours « Encore », quel que soit le temps', () => {
    for (const tempsMs of [200, 3000, 90_000]) {
      const { note } = noter({ ...base, correcte: false, tempsMs, profil: profilEntraine() });
      assert.equal(note, ENCORE);
    }
  });

  it('un temps aberrant (téléphone reposé) donne une note neutre, pas une sanction', () => {
    const { note, raisons } = noter({ ...base, tempsMs: 120_000, profil: profilEntraine() });
    assert.equal(note, CORRECT);
    assert.match(raisons.join(' '), /aberrant/);
  });
});

describe('notation — calibration sur l\'utilisateur', () => {
  it('se déclare non calibré tant que l\'échantillon est trop maigre', () => {
    const profil = new ProfilUtilisateur();
    assert.equal(profil.calibre, false);
    const { raisons } = noter({ ...base, tempsMs: 3000, profil });
    assert.match(raisons.join(' '), /non calibré/);
  });

  it('retrouve la vitesse de lecture réelle de l\'utilisateur', () => {
    const profil = profilEntraine({ latence: 600, msParCar: 40, bruit: 100 });
    assert.ok(Math.abs(profil.pente - 40) < 6, `pente estimée : ${profil.pente}`);
  });

  it('nettement plus rapide que son habitude -> Facile', () => {
    const profil = profilEntraine();
    const rapide = profil.tempsAttendu(150) - 2000;
    assert.equal(noter({ ...base, tempsMs: rapide, profil }).note, FACILE);
  });

  it('nettement plus lent que son habitude -> Difficile', () => {
    const profil = profilEntraine();
    const lent = profil.tempsAttendu(150) + 3000;
    assert.equal(noter({ ...base, tempsMs: lent, profil }).note, DIFFICILE);
  });

  it('à son rythme habituel -> Correct', () => {
    const profil = profilEntraine();
    assert.equal(noter({ ...base, tempsMs: profil.tempsAttendu(150), profil }).note, CORRECT);
  });

  it('une distribution dégénérée ne fait pas basculer la note sur du bruit', () => {
    // Profil quasi sans dispersion : les quantiles se resserrent à quelques
    // millisecondes. Sans plancher absolu, un écart de 50 ms — soit la latence
    // d'un écran tactile — suffirait à changer la note.
    const profil = profilEntraine({ bruit: 30 });
    const attendu = profil.tempsAttendu(150);
    for (const ecart of [-50, 0, 50]) {
      const { note } = noter({ ...base, tempsMs: attendu + ecart, profil });
      assert.equal(note, CORRECT, `écart de ${ecart} ms ne doit pas changer la note`);
    }
  });

  it('mais un écart franc reste détecté, même sur un profil resserré', () => {
    const profil = profilEntraine({ bruit: 30 });
    const attendu = profil.tempsAttendu(150);
    assert.equal(noter({ ...base, tempsMs: attendu - 3000, profil }).note, FACILE);
    assert.equal(noter({ ...base, tempsMs: attendu + 3000, profil }).note, DIFFICILE);
  });

  it('une question longue n\'est PAS pénalisée pour sa longueur', () => {
    const profil = profilEntraine();
    // Question courte et question longue, chacune répondue au rythme attendu.
    const courte = noter({ ...base, longueur: 60, tempsMs: profil.tempsAttendu(60), profil });
    const longue = noter({ ...base, longueur: 400, tempsMs: profil.tempsAttendu(400), profil });
    assert.equal(courte.note, longue.note,
      'le temps de lecture doit être neutralisé, seule la réflexion compte');
  });

  it('un lecteur lent n\'est pas puni : chacun est jugé sur sa propre échelle', () => {
    const rapide = profilEntraine({ msParCar: 20 });
    const lent = profilEntraine({ msParCar: 80 });
    const a = noter({ ...base, tempsMs: rapide.tempsAttendu(150), profil: rapide });
    const b = noter({ ...base, tempsMs: lent.tempsAttendu(150), profil: lent });
    assert.equal(a.note, b.note);
    assert.equal(a.note, CORRECT);
  });
});

describe('notation — signaux d\'hésitation', () => {
  it('deux changements d\'avis plafonnent la note à Difficile', () => {
    const profil = profilEntraine();
    const rapide = profil.tempsAttendu(150) - 2000;
    assert.equal(noter({ ...base, tempsMs: rapide, profil }).note, FACILE);
    const { note, raisons } = noter({ ...base, tempsMs: rapide, nbChangements: 2, profil });
    assert.equal(note, DIFFICILE);
    assert.match(raisons.join(' '), /changements d'avis/);
  });

  it('un seul changement d\'avis fait juste retomber Facile en Correct', () => {
    const profil = profilEntraine();
    const rapide = profil.tempsAttendu(150) - 2000;
    assert.equal(noter({ ...base, tempsMs: rapide, nbChangements: 1, profil }).note, CORRECT);
  });
});

describe('notation — détection du devinage', () => {
  const neuve = { nbRevisions: 2, nbReussites: 0 };

  it('juste + instantané + jamais réussie = coup de chance, pas maîtrise', () => {
    const profil = profilEntraine();
    const { note, raisons } = noter({
      ...base, historique: neuve, tempsMs: profil.tempsAttendu(150) - 4000, profil,
    });
    assert.equal(note, DIFFICILE);
    assert.match(raisons.join(' '), /devinage/);
  });

  it('ne crie pas au devinage sur une carte déjà réussie', () => {
    const profil = profilEntraine();
    const { note } = noter({
      ...base,
      historique: { nbRevisions: 5, nbReussites: 4 },
      tempsMs: profil.tempsAttendu(150) - 4000,
      profil,
    });
    assert.equal(note, FACILE);
  });

  it('ne crie pas au devinage sur un QCM à réponses multiples (hasard négligeable)', () => {
    const profil = profilEntraine();
    const { note } = noter({
      ...base, historique: neuve, reponsesMultiples: true,
      tempsMs: profil.tempsAttendu(150) - 4000, profil,
    });
    assert.equal(note, FACILE);
  });
});

describe('profil — robustesse', () => {
  it('ignore les réponses fausses : une erreur ne mesure pas une vitesse', () => {
    const profil = new ProfilUtilisateur();
    for (let i = 0; i < 50; i++) {
      profil.enregistrer({ longueur: 100, tempsMs: 40_000, correcte: false });
    }
    assert.equal(profil.echantillons.length, 0);
  });

  it('écarte les temps aberrants', () => {
    const profil = new ProfilUtilisateur();
    profil.enregistrer({ longueur: 100, tempsMs: 500_000, correcte: true });
    profil.enregistrer({ longueur: 100, tempsMs: 10, correcte: true });
    assert.equal(profil.echantillons.length, 0);
  });

  it('garde une fenêtre glissante bornée', () => {
    const profil = new ProfilUtilisateur();
    for (let i = 0; i < 500; i++) {
      profil.enregistrer({ longueur: 100 + i % 50, tempsMs: 4000, correcte: true });
    }
    assert.equal(profil.echantillons.length, profil.reglages.fenetre);
  });

  it('résiste à des questions toutes de même longueur (pente non identifiable)', () => {
    const profil = new ProfilUtilisateur();
    for (let i = 0; i < 60; i++) {
      profil.enregistrer({ longueur: 100, tempsMs: 4000 + (i % 7) * 100, correcte: true });
    }
    assert.ok(Number.isFinite(profil.pente) && profil.pente > 0);
    assert.ok(Number.isFinite(profil.tempsAttendu(100)));
  });

  it('survit à un aller-retour JSON', () => {
    const profil = profilEntraine();
    const rendu = ProfilUtilisateur.depuisJSON(JSON.parse(JSON.stringify(profil)));
    assert.equal(rendu.calibre, true);
    assert.ok(Math.abs(rendu.tempsAttendu(150) - profil.tempsAttendu(150)) < 1e-6);
  });
});
