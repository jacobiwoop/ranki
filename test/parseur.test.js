import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { analyser, identifiant } from '../src/parseur.js';

const EXEMPLE = new URL('../exemples/reseau.qcm', import.meta.url);

describe('parseur — fichier d\'exemple', () => {
  const { cartes, erreurs } = analyser(readFileSync(EXEMPLE, 'utf8'));

  it('ne relève aucune erreur', () => {
    assert.deepEqual(erreurs, []);
  });

  it('lit les 7 questions', () => {
    assert.equal(cartes.length, 7);
  });

  it('rattache chaque question à sa section', () => {
    assert.equal(cartes[0].section, 'Réseau / Protocoles');
    assert.equal(cartes[2].section, 'Cryptographie');
    assert.equal(cartes[4].section, 'Modèle OSI');
    assert.equal(cartes[6].section, 'Web / HTTP');
  });

  it('reconnaît les deux types de questions du fichier', () => {
    assert.deepEqual(cartes.map((c) => c.type),
      ['qcm', 'qcm', 'qcm', 'qcm', 'ordre', 'ordre', 'qcm']);
    assert.equal(cartes[4].bareme, 'paires', 'barème par défaut d\'un classement');
    assert.equal(cartes[5].bareme, 'strict', '@bareme lu dans le fichier');
    assert.deepEqual(cartes[5].propositions.map((p) => p.texte),
      ['SYN du client', 'SYN-ACK du serveur', 'ACK du client']);
  });

  it('propage les tags de section et y ajoute ceux de la question', () => {
    assert.deepEqual(cartes[0].tags, ['réseau', 'ports']);
    assert.deepEqual(cartes[2].tags, ['crypto', 'examen']);
  });

  it('repère les questions à réponses multiples', () => {
    assert.equal(cartes[2].reponsesMultiples, true);
    assert.equal(cartes[0].reponsesMultiples, false);
    const bonnes = cartes[2].propositions.filter((p) => p.correcte).map((p) => p.texte);
    assert.deepEqual(bonnes, ['RSA', 'ECDSA']);
  });

  it('recolle les explications multilignes', () => {
    assert.match(cartes[0].explication, /HTTP over TLS.+HTTP en clair/s);
    assert.ok(!cartes[0].explication.includes('\n'));
  });

  it('retire le marqueur [x] du texte de la proposition', () => {
    assert.equal(cartes[0].propositions[1].texte, '443');
  });

  it('lit @source', () => {
    assert.equal(cartes[0].source, 'Cours Réseau, chap. 3');
  });

  it('calcule la longueur affichée, qui sert au calibrage des temps', () => {
    const c = cartes[0];
    const attendu = c.question.length
      + c.propositions.reduce((s, p) => s + p.texte.length, 0);
    assert.equal(c.longueur, attendu);
  });
});

describe('parseur — identité des cartes', () => {
  it('donne le même identifiant à la même question', () => {
    assert.equal(identifiant('Quel port ?'), identifiant('Quel port ?'));
  });

  it('en donne un différent à deux questions distinctes', () => {
    assert.notEqual(identifiant('Quel port ?'), identifiant('Quel protocole ?'));
  });

  it('conserve l\'identifiant quand on corrige une proposition', () => {
    const avant = analyser('Q: Port HTTPS ?\n- [x] 443\n- 80');
    const apres = analyser('Q: Port HTTPS ?\n- [x] 443/TCP\n- 80\n> Ajout d\'explication');
    assert.equal(avant.cartes[0].id, apres.cartes[0].id);
  });
});

describe('parseur — signalement des erreurs', () => {
  it('collecte TOUTES les erreurs, avec leur ligne', () => {
    const { cartes, erreurs } = analyser([
      'Q: Sans aucune bonne réponse ?',   // 1
      '- a',                              // 2
      '- b',                              // 3
      '',                                 // 4
      'Q: Correcte ?',                    // 5
      '- [x] oui',                        // 6
      '- non',                            // 7
      '',                                 // 8
      'Q: Une seule proposition ?',       // 9
      '- [x] seule',                      // 10
    ].join('\n'));

    assert.equal(cartes.length, 1, 'seule la question valide est retenue');
    assert.equal(erreurs.length, 2);
    assert.equal(erreurs[0].ligne, 1);
    assert.match(erreurs[0].message, /aucune bonne réponse/);
    assert.equal(erreurs[1].ligne, 9);
    assert.match(erreurs[1].message, /au moins 2/);
  });

  it('refuse une question dont tout est correct', () => {
    const { erreurs } = analyser('Q: Tout juste ?\n- [x] a\n- [x] b');
    assert.match(erreurs[0].message, /toutes les propositions/);
  });

  it('signale les doublons en pointant la première occurrence', () => {
    const { cartes, erreurs } = analyser([
      'Q: Doublon ?', '- [x] a', '- b', '',
      'Q: Doublon ?', '- [x] a', '- b',
    ].join('\n'));
    assert.equal(cartes.length, 1);
    assert.equal(erreurs.length, 1);
    assert.match(erreurs[0].message, /double.*ligne 1/);
  });

  it('signale une proposition orpheline', () => {
    const { erreurs } = analyser('- perdue dans le vide');
    assert.match(erreurs[0].message, /sans question/);
  });

  it('signale une métadonnée inconnue sans perdre la carte', () => {
    const { cartes, erreurs } = analyser('Q: Ok ?\n- [x] a\n- b\n@inventee valeur');
    assert.equal(cartes.length, 1);
    assert.match(erreurs[0].message, /métadonnée inconnue/);
  });

  it('signale une ligne incompréhensible', () => {
    const { erreurs } = analyser('Q: Ok ?\n- [x] a\n- b\ntexte à la dérive');
    assert.match(erreurs[0].message, /incomprise/);
  });

  it('ignore commentaires et lignes vides', () => {
    const { cartes, erreurs } = analyser([
      '// un commentaire', '', '   ', 'Q: Ok ?', '- [x] a', '- b', '// fin',
    ].join('\n'));
    assert.deepEqual(erreurs, []);
    assert.equal(cartes.length, 1);
  });

  it('accepte un fichier vide sans planter', () => {
    assert.deepEqual(analyser(''), { cartes: [], erreurs: [] });
  });

  it('accepte [X] et [✓] comme marqueurs', () => {
    const { cartes } = analyser('Q: Variantes ?\n- [X] a\n- [✓] b\n- c');
    assert.equal(cartes[0].propositions.filter((p) => p.correcte).length, 2);
  });

  it('accepte * comme puce, et les fins de ligne Windows', () => {
    const { cartes, erreurs } = analyser('Q: Puces ?\r\n* [x] a\r\n* b\r\n');
    assert.deepEqual(erreurs, []);
    assert.equal(cartes[0].propositions.length, 2);
  });
});
