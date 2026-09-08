import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LETTRES, melanger, preparerAffichage, verifier } from '../src/presentation.js';
import { Moteur } from '../src/moteur.js';
import { JOUR_MS, REGLAGES_PLAN } from '../src/planificateur.js';

const carte = {
  id: 'abc123',
  question: 'Quel port ?',
  propositions: [
    { texte: '443', correcte: true },
    { texte: '80', correcte: false },
    { texte: '22', correcte: false },
    { texte: '8080', correcte: false },
  ],
};

describe('mélange des propositions', () => {
  it('conserve toutes les propositions, sans perte ni doublon', () => {
    for (let tour = 0; tour < 30; tour++) {
      const { propositions } = preparerAffichage(carte, tour);
      assert.equal(propositions.length, 4);
      assert.deepEqual(
        propositions.map((p) => p.texte).sort(),
        ['22', '443', '80', '8080'],
      );
    }
  });

  it('est stable pour un même passage : rafraîchir ne rebat pas les cartes', () => {
    const a = preparerAffichage(carte, 3);
    const b = preparerAffichage(carte, 3);
    assert.deepEqual(a.propositions.map((p) => p.texte), b.propositions.map((p) => p.texte));
    assert.equal(a.lettres, b.lettres);
  });

  it('change d\'un passage à l\'autre', () => {
    const ordres = new Set();
    for (let tour = 0; tour < 20; tour++) {
      ordres.add(preparerAffichage(carte, tour).propositions.map((p) => p.texte).join('|'));
    }
    assert.ok(ordres.size >= 8, `seulement ${ordres.size} ordres distincts sur 20 passages`);
  });

  it('promène la bonne réponse sur TOUTES les positions', () => {
    // Le point crucial : si la bonne réponse restait en tête, on mémoriserait
    // la position au lieu du contenu.
    const positions = new Set();
    for (let tour = 0; tour < 100; tour++) {
      positions.add(preparerAffichage(carte, tour).bonnes[0]);
    }
    assert.deepEqual([...positions].sort(), [0, 1, 2, 3]);
  });

  it('suit correctement la bonne réponse après mélange', () => {
    for (let tour = 0; tour < 50; tour++) {
      const { propositions, bonnes, lettres } = preparerAffichage(carte, tour);
      assert.equal(bonnes.length, 1);
      assert.equal(propositions[bonnes[0]].texte, '443');
      assert.equal(lettres, LETTRES[bonnes[0]]);
    }
  });

  it('gère les réponses multiples', () => {
    const multi = {
      ...carte,
      propositions: [
        { texte: 'RSA', correcte: true },
        { texte: 'AES', correcte: false },
        { texte: 'ECDSA', correcte: true },
        { texte: 'SHA-256', correcte: false },
      ],
    };
    for (let tour = 0; tour < 30; tour++) {
      const { propositions, bonnes } = preparerAffichage(multi, tour);
      assert.equal(bonnes.length, 2);
      assert.deepEqual(bonnes.map((i) => propositions[i].texte).sort(), ['ECDSA', 'RSA']);
    }
  });

  it('conserve le rang d\'origine dans le fichier', () => {
    const { propositions } = preparerAffichage(carte, 7);
    for (const p of propositions) {
      assert.equal(p.texte, carte.propositions[p.rangOrigine].texte);
    }
  });

  it('peut être désactivé pour garder l\'ordre du fichier', () => {
    const { propositions } = preparerAffichage(carte, 5, false);
    assert.deepEqual(propositions.map((p) => p.texte), ['443', '80', '22', '8080']);
  });

  it('deux cartes différentes ne subissent pas le même mélange', () => {
    const autre = { ...carte, id: 'zzz999' };
    const a = preparerAffichage(carte, 0).propositions.map((p) => p.texte).join('|');
    const b = preparerAffichage(autre, 0).propositions.map((p) => p.texte).join('|');
    assert.notEqual(a, b);
  });

  it('mélanger un tableau vide ou d\'un élément ne plante pas', () => {
    assert.deepEqual(melanger([], 1), []);
    assert.deepEqual(melanger(['x'], 1), ['x']);
  });
});

describe('vérification de la réponse', () => {
  const { bonnes } = preparerAffichage(carte, 0);

  it('accepte la bonne case', () => {
    assert.equal(verifier(bonnes, bonnes).correcte, true);
  });

  it('refuse une case erronée', () => {
    const mauvaise = [0, 1, 2, 3].find((i) => !bonnes.includes(i));
    const r = verifier([mauvaise], bonnes);
    assert.equal(r.correcte, false);
    assert.deepEqual(r.enTrop, [mauvaise]);
    assert.deepEqual(r.oublies, bonnes);
  });

  it('refuse une réponse à moitié juste sur un QCM multiple', () => {
    const r = verifier([0], [0, 2]);
    assert.equal(r.correcte, false);
    assert.deepEqual(r.oublies, [2]);
    assert.deepEqual(r.enTrop, []);
  });

  it('refuse de tout cocher pour être sûr', () => {
    assert.equal(verifier([0, 1, 2, 3], [0, 2]).correcte, false);
  });

  it('refuse une absence de réponse', () => {
    assert.equal(verifier([], bonnes).correcte, false);
  });
});

describe('plusieurs séances dans la même journée', () => {
  function moteurAvecNeuves(nb, reglages = {}) {
    const source = Array.from({ length: nb }, (_, i) =>
      `Q: Question numéro ${i} ?\n- [x] bonne\n- mauvaise`).join('\n\n');
    const m = new Moteur({ reglages: { ...REGLAGES_PLAN, limiteNouvelles: 5, ...reglages } });
    m.importer(source);
    return m;
  }

  const repondreTout = (m, instant) => {
    const s = m.demarrerSeance(instant);
    let n = 0;
    while (s.courante()) {
      m.repondre(s.courante().id, { correcte: true, tempsMs: 3000 }, instant + n * 1000);
      s.avancer(true);
      n++;
    }
    return n;
  };

  it('le plafond de nouvelles cartes tient sur la JOURNÉE, pas sur la séance', () => {
    const m = moteurAvecNeuves(50);
    const matin = Date.UTC(2026, 0, 5, 9);

    assert.equal(repondreTout(m, matin), 5, 'première séance : le quota complet');
    assert.equal(repondreTout(m, matin + 3 * 3_600_000), 0, 'deuxième séance : quota épuisé');
    assert.equal(repondreTout(m, matin + 6 * 3_600_000), 0, 'troisième séance : toujours rien');
    assert.equal(m.journal.length, 5, 'cinq cartes découvertes dans la journée, pas quinze');
  });

  it('le quota se recharge le lendemain', () => {
    const m = moteurAvecNeuves(50);
    const jour1 = Date.UTC(2026, 0, 5, 9);
    repondreTout(m, jour1);
    assert.equal(repondreTout(m, jour1 + 2 * JOUR_MS), 5,
      'nouvelles cartes du surlendemain (les 5 premières sont revenues aussi)');
  });

  it('une séance déjà bouclée ne repropose pas les mêmes cartes', () => {
    const m = moteurAvecNeuves(50);
    const matin = Date.UTC(2026, 0, 5, 9);
    repondreTout(m, matin);
    assert.equal(m.demarrerSeance(matin + 3_600_000).restantes, 0);
  });
});

describe('ordre des questions', () => {
  function contexte() {
    const source = Array.from({ length: 12 }, (_, i) =>
      `Q: Question numéro ${i} ?\n- [x] bonne\n- mauvaise`).join('\n\n');
    return source;
  }

  function fileApres(ordre, jour) {
    const m = new Moteur({ reglages: { ...REGLAGES_PLAN, limiteNouvelles: 12, ordre } });
    m.importer(contexte());
    const t0 = Date.UTC(2026, 0, 1, 9);
    // On fait passer toutes les cartes une fois, à des stabilités variées.
    const s = m.demarrerSeance(t0);
    let n = 0;
    while (s.courante()) {
      m.repondre(s.courante().id,
        { correcte: true, tempsMs: 2000 + (n % 4) * 2000 }, t0 + n * 1000);
      s.avancer(true);
      n++;
    }
    return m.demarrerSeance(t0 + jour * JOUR_MS).file.map((c) => c.id);
  }

  it('par défaut, classe les plus proches de l\'oubli en premier', () => {
    const a = fileApres('risque', 400);
    const b = fileApres('risque', 400);
    assert.deepEqual(a, b, 'le classement par risque est déterministe');
    assert.ok(a.length > 0);
  });

  it('en mode aléatoire, l\'ordre diffère du classement par risque', () => {
    const parRisque = fileApres('risque', 400);
    const brasse = fileApres('aleatoire', 400);
    assert.deepEqual([...brasse].sort(), [...parRisque].sort(), 'mêmes cartes');
    assert.notDeepEqual(brasse, parRisque, 'ordre différent');
  });

  it('en mode aléatoire, l\'ordre reste stable au sein d\'une journée', () => {
    assert.deepEqual(fileApres('aleatoire', 400), fileApres('aleatoire', 400));
  });

  it('en mode aléatoire, l\'ordre change d\'un jour à l\'autre', () => {
    assert.notDeepEqual(fileApres('aleatoire', 400), fileApres('aleatoire', 401));
  });
});
