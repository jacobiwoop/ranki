import test from 'node:test';
import assert from 'node:assert/strict';

import { PROMPT_QCM } from '../app/prompt-qcm.js';
import { BAREMES, analyser } from '../src/parseur.js';

/**
 * Le prompt décrit le format à une IA qui ne verra jamais le parseur. S'ils
 * divergent, l'utilisateur reçoit un fichier refusé sans savoir pourquoi —
 * et rien, à part ces tests, ne signalerait la dérive.
 */

/** Dernier bloc de code du prompt : l'exemple complet donné en modèle. */
function exemple() {
  const blocs = [...PROMPT_QCM.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocs.at(-1);
}

test('l\'exemple du prompt est accepté par le parseur', () => {
  const { cartes, erreurs } = analyser(exemple());
  assert.deepEqual(erreurs, [], 'l\'exemple donné en modèle doit être valide');
  assert.ok(cartes.length >= 4, `seulement ${cartes.length} cartes dans l'exemple`);
});

test('l\'exemple montre les deux types de question', () => {
  const { cartes } = analyser(exemple());
  const types = new Set(cartes.map((c) => c.type));
  assert.ok(types.has('qcm'), 'aucun QCM dans l\'exemple');
  assert.ok(types.has('ordre'), 'aucun classement dans l\'exemple');
});

test('l\'exemple montre le cas des réponses multiples', () => {
  const { cartes } = analyser(exemple());
  assert.ok(cartes.some((c) => c.reponsesMultiples),
    'le prompt autorise plusieurs [x] : l\'exemple doit le démontrer');
});

test('chaque question de l\'exemple porte une explication', () => {
  const { cartes } = analyser(exemple());
  for (const c of cartes) {
    assert.ok(c.explication.length > 40, `explication trop courte : ${c.question}`);
  }
});

test('le prompt cite exactement les barèmes acceptés', () => {
  for (const valeurs of Object.values(BAREMES)) {
    for (const b of valeurs) {
      assert.ok(PROMPT_QCM.includes(`\`${b}\``),
        `le barème « ${b} » existe mais n'est pas cité dans le prompt`);
    }
  }
  // L'inverse : un barème cité mais disparu du parseur ferait écrire des
  // fichiers refusés.
  const connus = new Set(Object.values(BAREMES).flat());
  for (const cite of PROMPT_QCM.matchAll(/@bareme\s+(\w+)/g)) {
    assert.ok(connus.has(cite[1]), `le prompt cite un barème inconnu : ${cite[1]}`);
  }
});

test('le prompt énonce les règles qui font échouer un import', () => {
  // Chacune correspond à une erreur que `cloturer()` peut lever.
  const attendues = [
    'deux propositions',      // n < 2
    'pas toutes',             // toutes marquées correctes
    'mélange',                // - et 1. mêlés
    'sans trou',              // numérotation d'un classement
    'même énoncé',            // doublon d'identifiant
  ];
  for (const regle of attendues) {
    assert.ok(PROMPT_QCM.includes(regle), `règle absente du prompt : « ${regle} »`);
  }
});

test('le prompt demande une sortie brute, sans prose autour', () => {
  assert.match(PROMPT_QCM, /uniquement le contenu du fichier/i);
});
