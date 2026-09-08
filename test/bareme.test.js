import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyser } from '../src/parseur.js';
import { preparerAffichage, verifier, verifierOrdre } from '../src/presentation.js';
import { CORRECT, DIFFICILE, ENCORE, FACILE, ProfilUtilisateur, noter } from '../src/notation.js';
import { Moteur } from '../src/moteur.js';

describe('barème d\'un QCM à réponses multiples', () => {
  const bonnes = [0, 2]; // 2 bonnes réponses parmi 4

  it('crédite proportionnellement par défaut', () => {
    assert.equal(verifier([0, 2], bonnes).score, 1);
    assert.equal(verifier([0], bonnes).score, 0.5);
    assert.equal(verifier([], bonnes).score, 0);
  });

  it('déduit les cases cochées à tort', () => {
    // 1 bonne trouvée, 1 fausse cochée -> (1-1)/2 = 0
    assert.equal(verifier([0, 1], bonnes).score, 0);
    // 2 bonnes trouvées, 1 fausse -> (2-1)/2 = 0,5
    assert.equal(verifier([0, 2, 1], bonnes).score, 0.5);
  });

  it('ne récompense pas celui qui coche tout', () => {
    assert.equal(verifier([0, 1, 2, 3], bonnes).score, 0,
      'tout cocher « pour être sûr » ne doit rien rapporter');
  });

  it('ne descend jamais sous zéro', () => {
    assert.equal(verifier([1, 3], bonnes).score, 0);
  });

  it('en barème strict, c\'est tout ou rien', () => {
    assert.equal(verifier([0, 2], bonnes, 'strict').score, 1);
    assert.equal(verifier([0], bonnes, 'strict').score, 0);
  });

  it('`correcte` reste réservé au score plein, quel que soit le barème', () => {
    assert.equal(verifier([0], bonnes).correcte, false);
    assert.equal(verifier([0, 2], bonnes).correcte, true);
  });
});

describe('barème d\'une question d\'ordre', () => {
  const juste = [0, 1, 2, 3];

  it('reconnaît la séquence exacte', () => {
    for (const bareme of ['paires', 'positions', 'strict']) {
      const r = verifierOrdre(juste, bareme);
      assert.equal(r.score, 1, bareme);
      assert.equal(r.correcte, true);
    }
  });

  it('« paires » pardonne une inversion de voisines', () => {
    // 1 paire discordante sur 6
    const r = verifierOrdre([1, 0, 2, 3], 'paires');
    assert.ok(Math.abs(r.score - 5 / 6) < 1e-9, `score ${r.score}`);
    assert.equal(r.correcte, false);
  });

  it('« paires » donne zéro à une liste entièrement inversée', () => {
    assert.equal(verifierOrdre([3, 2, 1, 0], 'paires').score, 0);
  });

  it('« positions » est plus sévère : un décalage global coûte tout', () => {
    // Ordre relatif parfait, mais aucun élément à sa place.
    const decale = [3, 0, 1, 2];
    assert.equal(verifierOrdre(decale, 'positions').score, 0);
    assert.ok(verifierOrdre(decale, 'paires').score > 0.4,
      '« paires » reconnaît que l\'ordre relatif est presque bon');
  });

  it('« strict » refuse la moindre approximation', () => {
    assert.equal(verifierOrdre([1, 0, 2, 3], 'strict').score, 0);
  });

  it('signale les éléments mal placés', () => {
    assert.deepEqual(verifierOrdre([1, 0, 2, 3], 'paires').malPlaces, [0, 1]);
  });
});

describe('notation d\'une réponse partielle', () => {
  const profil = new ProfilUtilisateur();
  const base = { tempsMs: 3000, longueur: 150, profil };

  it('un score plein suit la notation habituelle par le temps', () => {
    const { note } = noter({ ...base, correcte: true, score: 1 });
    assert.ok(note >= CORRECT, `note ${note}`);
  });

  it('une réponse largement juste vaut « Difficile », jamais mieux', () => {
    // Même répondue instantanément : la vitesse ne rachète pas l'incomplétude.
    const { note, raisons } = noter({ ...base, tempsMs: 400, correcte: false, score: 0.8 });
    assert.equal(note, DIFFICILE);
    assert.match(raisons.join(' '), /partiellement juste \(80 %/);
  });

  it('la moitié suffit à compter comme rappel partiel', () => {
    // Cas le plus fréquent : 1 bonne sur 2. Un seuil plus haut rendrait le
    // crédit partiel inutile précisément là où on l'attend.
    assert.equal(noter({ ...base, correcte: false, score: 0.5 }).note, DIFFICILE);
  });

  it('une réponse trop incomplète vaut « Encore »', () => {
    const { note, raisons } = noter({ ...base, correcte: false, score: 0.34 });
    assert.equal(note, ENCORE);
    assert.match(raisons.join(' '), /trop incomplet/);
  });

  it('un score nul vaut « Encore »', () => {
    assert.equal(noter({ ...base, correcte: false, score: 0 }).note, ENCORE);
  });

  it('sans score fourni, retombe sur l\'ancien comportement booléen', () => {
    assert.equal(noter({ ...base, correcte: false }).note, ENCORE);
    assert.ok(noter({ ...base, correcte: true, tempsMs: 800 }).note >= CORRECT);
  });
});

describe('lecture du barème dans le fichier', () => {
  it('applique « partiel » par défaut à un QCM', () => {
    const { cartes } = analyser('Q: Test ?\n- [x] a\n- b');
    assert.equal(cartes[0].type, 'qcm');
    assert.equal(cartes[0].bareme, 'partiel');
  });

  it('applique « paires » par défaut à une question d\'ordre', () => {
    const { cartes } = analyser('Q: Classe ?\n1. un\n2. deux\n3. trois');
    assert.equal(cartes[0].type, 'ordre');
    assert.equal(cartes[0].bareme, 'paires');
  });

  it('accepte @bareme sur une question', () => {
    const { cartes, erreurs } = analyser('Q: Test ?\n@bareme strict\n- [x] a\n- b');
    assert.deepEqual(erreurs, []);
    assert.equal(cartes[0].bareme, 'strict');
  });

  it('accepte @bareme au niveau d\'une section', () => {
    const { cartes } = analyser([
      '# Section sévère', '@bareme strict', '',
      'Q: Une ?', '- [x] a', '- b', '',
      'Q: Deux ?', '- [x] a', '- b',
    ].join('\n'));
    assert.equal(cartes.length, 2);
    assert.ok(cartes.every((c) => c.bareme === 'strict'));
  });

  it('la question peut contredire sa section', () => {
    const { cartes } = analyser([
      '# Section', '@bareme strict', '',
      'Q: Exception ?', '@bareme partiel', '- [x] a', '- b',
    ].join('\n'));
    assert.equal(cartes[0].bareme, 'partiel');
  });

  it('refuse un barème inconnu pour le type', () => {
    const { cartes, erreurs } = analyser('Q: Test ?\n@bareme paires\n- [x] a\n- b');
    assert.equal(cartes.length, 0);
    assert.match(erreurs[0].message, /barème « paires » inconnu.*type qcm/);
  });

  it('range les propositions d\'ordre selon leur numéro, quel que soit l\'ordre d\'écriture', () => {
    const { cartes } = analyser('Q: Classe ?\n3. trois\n1. un\n2. deux');
    assert.deepEqual(cartes[0].propositions.map((p) => p.texte), ['un', 'deux', 'trois']);
  });

  it('refuse une numérotation trouée', () => {
    const { cartes, erreurs } = analyser('Q: Classe ?\n1. un\n2. deux\n4. quatre');
    assert.equal(cartes.length, 0);
    assert.match(erreurs[0].message, /numérotation doit aller de 1 à 3/);
  });

  it('refuse une numérotation répétée', () => {
    const { erreurs } = analyser('Q: Classe ?\n1. un\n1. bis\n2. deux');
    assert.match(erreurs[0].message, /numérotation/);
  });

  it('refuse de mélanger puces et numéros dans une même question', () => {
    const a = analyser('Q: Test ?\n- [x] a\n2. deux');
    assert.match(a.erreurs[0].message, /soit un QCM, soit un classement/);
    const b = analyser('Q: Test ?\n1. un\n- deux');
    assert.match(b.erreurs[0].message, /soit un QCM, soit un classement/);
  });

  it('une question d\'ordre n\'est jamais « à réponses multiples »', () => {
    const { cartes } = analyser('Q: Classe ?\n1. un\n2. deux');
    assert.equal(cartes[0].reponsesMultiples, false);
  });
});

describe('affichage d\'une question d\'ordre', () => {
  const { cartes } = analyser(
    'Q: Classe les couches OSI ?\n1. Physique\n2. Liaison\n3. Réseau\n4. Transport',
  );
  const carte = cartes[0];

  it('brasse les propositions et expose leur rang d\'origine', () => {
    const { type, propositions } = preparerAffichage(carte, 0);
    assert.equal(type, 'ordre');
    assert.deepEqual(
      propositions.map((p) => p.rangOrigine).sort((a, b) => a - b),
      [0, 1, 2, 3],
    );
  });

  it('ne présente JAMAIS la séquence déjà dans le bon ordre', () => {
    // Ce serait donner la réponse. Le mélange retire tant qu'il tombe dessus.
    for (let tour = 0; tour < 200; tour++) {
      const { propositions } = preparerAffichage(carte, tour);
      const rangs = propositions.map((p) => p.rangOrigine);
      assert.ok(!rangs.every((r, i) => r === i), `tour ${tour} affiche l'ordre correct`);
    }
  });

  it('reste stable pour un même passage', () => {
    const a = preparerAffichage(carte, 5).propositions.map((p) => p.rangOrigine);
    const b = preparerAffichage(carte, 5).propositions.map((p) => p.rangOrigine);
    assert.deepEqual(a, b);
  });

  it('boucle complète : afficher, répondre juste, vérifier', () => {
    const { propositions } = preparerAffichage(carte, 0);
    // L'utilisateur remet dans l'ordre : il produit la suite des rangs d'origine.
    const reponse = [...propositions].sort((a, b) => a.rangOrigine - b.rangOrigine)
      .map((p) => p.rangOrigine);
    assert.equal(verifierOrdre(reponse, carte.bareme).correcte, true);
  });
});

describe('bout en bout — le barème remonte jusqu\'au planificateur', () => {
  it('une réponse partielle raccourcit moins l\'échéance qu\'un échec total', () => {
    const source = 'Q: Multiple ?\n- [x] a\n- [x] b\n- c\n- d';
    const faire = (score) => {
      const m = new Moteur();
      m.importer(source);
      const id = m.cartes[0].id;
      const t = Date.UTC(2026, 0, 1);
      m.repondre(id, { correcte: true, tempsMs: 3000 }, t);       // découverte
      return m.repondre(id, { score, correcte: score === 1, tempsMs: 4000 },
        t + 5 * 86_400_000);
    };

    const echec = faire(0);
    const partiel = faire(0.5);
    const plein = faire(1);

    assert.equal(echec.note, 1);
    assert.equal(partiel.note, 2);
    assert.ok(plein.note >= 3);
    assert.ok(partiel.joursProchains > echec.joursProchains,
      'une moitié de réponse vaut mieux que rien');
    assert.ok(plein.joursProchains > partiel.joursProchains);
  });

  it('une réponse partielle compte comme réussite dans les statistiques', () => {
    const m = new Moteur();
    m.importer('Q: Multiple ?\n- [x] a\n- [x] b\n- c\n- d');
    const id = m.cartes[0].id;
    const t = Date.UTC(2026, 0, 1);
    m.repondre(id, { correcte: true, tempsMs: 3000 }, t);
    m.repondre(id, { score: 0.8, correcte: false, tempsMs: 3000 }, t + 5 * 86_400_000);

    const e = m.journal.at(-1);
    assert.equal(e.correcte, false, 'pas pleinement juste');
    assert.equal(e.reussie, true, 'mais le rappel a bien eu lieu');
    assert.equal(e.score, 0.8);
    assert.equal(m.progression(id).nbReussites, 2);
  });
});
