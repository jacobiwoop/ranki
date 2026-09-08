import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Moteur } from '../src/moteur.js';
import { CORRECT, ENCORE, FACILE } from '../src/notation.js';
import { JOUR_MS, REGLAGES_PLAN } from '../src/planificateur.js';
import {
  calibration, cartesProblematiques, chargePrevisionnelle,
  maitriseParTag, repartitionNotes, retention,
} from '../src/stats.js';

const T0 = Date.UTC(2026, 0, 1, 9);

const SOURCE = [
  '# Réseau', '@tags réseau',
  'Q: Port HTTPS ?', '- 80', '- [x] 443', '- 22', '- 8080', '',
  'Q: Port SSH ?', '- 80', '- 443', '- [x] 22', '- 8080',
].join('\n');

function moteurPret() {
  const m = new Moteur();
  const r = m.importer(SOURCE);
  return { moteur: m, ...r };
}

describe('import', () => {
  it('charge les cartes du fichier', () => {
    const { moteur, ajoutees, erreurs } = moteurPret();
    assert.equal(ajoutees, 2);
    assert.deepEqual(erreurs, []);
    assert.equal(moteur.cartes.length, 2);
  });

  it('réimporter le même fichier ne duplique rien', () => {
    const { moteur } = moteurPret();
    const r = moteur.importer(SOURCE);
    assert.equal(r.ajoutees, 0);
    assert.equal(r.majes, 2);
    assert.equal(moteur.cartes.length, 2);
  });

  it('corriger une explication préserve l\'historique de révision', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    moteur.repondre(id, { correcte: true, tempsMs: 4000 }, T0);
    const avant = { ...moteur.progression(id) };

    moteur.importer(SOURCE.replace('- [x] 443', '- [x] 443\n> Explication ajoutée après coup'));

    const apres = moteur.progression(id);
    assert.equal(apres.nbRevisions, avant.nbRevisions);
    assert.equal(apres.prochaine, avant.prochaine);
    assert.equal(moteur.index.get(id).explication, 'Explication ajoutée après coup');
  });
});

describe('réponse et replanification', () => {
  it('met à jour la progression et planifie la suite', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    const { note, joursProchains } = moteur.repondre(id, { correcte: true, tempsMs: 4000 }, T0);

    const p = moteur.progression(id);
    assert.ok(note >= 1 && note <= 4);
    assert.equal(p.nbRevisions, 1);
    assert.equal(p.nbReussites, 1);
    assert.equal(p.nbEchecs, 0);
    assert.ok(p.etat.stabilite > 0);
    assert.equal(p.derniereRevision, T0);
    assert.equal(p.prochaine, T0 + joursProchains * JOUR_MS);
  });

  it('une erreur compte comme échec et raccourcit l\'échéance', () => {
    const { moteur } = moteurPret();
    const [a, b] = moteur.cartes.map((c) => c.id);
    const juste = moteur.repondre(a, { correcte: true, tempsMs: 4000 }, T0);
    const faux = moteur.repondre(b, { correcte: false, tempsMs: 4000 }, T0);

    assert.equal(moteur.progression(b).nbEchecs, 1);
    assert.ok(faux.joursProchains <= juste.joursProchains);
  });

  it('accepte une note imposée, court-circuitant la déduction', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    // Temps très lent : la déduction dirait « Difficile ». On force « Facile ».
    const { note, raisons } = moteur.repondre(
      id, { correcte: true, tempsMs: 30_000, noteImposee: FACILE }, T0,
    );
    assert.equal(note, FACILE);
    assert.deepEqual(raisons, ['note imposée']);
  });

  it('refuse une carte inconnue', () => {
    const { moteur } = moteurPret();
    assert.throws(() => moteur.repondre('fantome', { correcte: true, tempsMs: 1000 }), /inconnue/);
  });

  it('journalise ce qui est nécessaire aux statistiques', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    moteur.repondre(id, { correcte: true, tempsMs: 4000 }, T0);
    const e = moteur.journal[0];
    for (const champ of ['id', 'horodatage', 'correcte', 'tempsMs', 'note',
      'premiereVue', 'recuperabiliteAvant', 'stabiliteApres', 'tags']) {
      assert.ok(champ in e, `champ manquant : ${champ}`);
    }
    assert.equal(e.premiereVue, true);
  });
});

describe('séance', () => {
  it('propose les cartes neuves, puis plus rien avant l\'échéance', () => {
    const { moteur } = moteurPret();
    const s1 = moteur.demarrerSeance(T0);
    assert.equal(s1.restantes, 2);

    while (s1.courante()) {
      moteur.repondre(s1.courante().id, { correcte: true, tempsMs: 3000 }, T0);
      s1.avancer(true);
    }

    // Le lendemain, tout n'est pas forcément dû ; dans 10 ans, si.
    assert.equal(moteur.demarrerSeance(T0 + 10 * 365 * JOUR_MS).restantes, 2);
  });
});

describe('persistance', () => {
  it('survit à un aller-retour JSON complet', () => {
    const { moteur } = moteurPret();
    const s = moteur.demarrerSeance(T0);
    let t = T0;
    while (s.courante()) {
      moteur.repondre(s.courante().id, { correcte: true, tempsMs: 3500 }, t);
      t += 20_000;
      s.avancer(true);
    }

    const rendu = Moteur.depuisJSON(JSON.parse(JSON.stringify(moteur)));
    assert.equal(rendu.cartes.length, moteur.cartes.length);
    assert.equal(rendu.journal.length, moteur.journal.length);
    assert.deepEqual(
      [...rendu.progressions.values()],
      [...moteur.progressions.values()],
    );
    // Et il reste utilisable, pas seulement lisible.
    assert.doesNotThrow(() => rendu.repondre(rendu.cartes[0].id, { correcte: true, tempsMs: 3000 }));
  });
});

describe('séance ciblée et modes', () => {
  const MULTI = [
    '# Réseau', 'Q: Port HTTPS ?', '- [x] 443', '- 80', '',
    'Q: Port SSH ?', '- [x] 22', '- 80', '',
    '# Crypto', 'Q: RSA est-il asymétrique ?', '- [x] oui', '- non',
  ].join('\n');

  function moteurMulti() {
    const m = new Moteur();
    m.importer(MULTI);
    return m;
  }

  it('liste les séries avec leur avancement', () => {
    const m = moteurMulti();
    const series = m.series(T0);
    assert.deepEqual(series.map((s) => s.nom), ['Réseau', 'Crypto']);
    assert.equal(series[0].total, 2);
    assert.equal(series[0].neuves, 2);
    assert.equal(series[0].dues, 0);
  });

  it('une séance ciblée ne propose que la série demandée', () => {
    const m = moteurMulti();
    const s = m.demarrerSeance(T0, { section: 'Crypto', inclureNonDues: true });
    assert.equal(s.file.length, 1);
    assert.equal(s.file[0].section, 'Crypto');
  });

  it('inclureNonDues reprend TOUT le chapitre, même ce qui n\'est pas dû', () => {
    const m = moteurMulti();
    // On répond à tout : plus rien n'est dû aujourd'hui.
    const s1 = m.demarrerSeance(T0);
    while (s1.courante()) {
      m.repondre(s1.courante().id, { correcte: true, tempsMs: 3000 }, T0);
      s1.avancer(true);
    }
    assert.equal(m.demarrerSeance(T0).restantes, 0, 'plus rien de dû');
    assert.equal(
      m.demarrerSeance(T0, { section: 'Réseau', inclureNonDues: true }).restantes, 2,
      'le bachotage d\'un chapitre passe outre les échéances',
    );
  });

  it('une séance ciblée ignore le quota quotidien de nouvelles cartes', () => {
    const m = new Moteur({ reglages: { ...REGLAGES_PLAN, limiteNouvelles: 1 } });
    m.importer(MULTI);
    assert.equal(m.demarrerSeance(T0).restantes, 1, 'quota respecté en mode normal');
    assert.equal(
      m.demarrerSeance(T0, { section: 'Réseau', inclureNonDues: true }).restantes, 2,
      'mais pas quand on demande explicitement un chapitre',
    );
  });

  it('en mode examen, une carte ratée n\'est PAS reproposée', () => {
    const m = moteurMulti();
    const s = m.demarrerSeance(T0, { mode: 'examen' });
    const taille = s.file.length;
    s.avancer(false);
    s.avancer(false);
    assert.equal(s.file.length, taille, 'la file ne s\'allonge pas');
    assert.equal(s.reprises, 0);
  });

  it('en mode apprentissage, elle repasse dans la séance', () => {
    const m = moteurMulti();
    const s = m.demarrerSeance(T0, { mode: 'apprentissage' });
    const taille = s.file.length;
    s.avancer(false);
    assert.equal(s.file.length, taille + 1);
    assert.equal(s.reprises, 1);
  });

  it('une section inconnue donne une séance vide plutôt qu\'une erreur', () => {
    const m = moteurMulti();
    assert.equal(m.demarrerSeance(T0, { section: 'Inexistante' }).restantes, 0);
  });
});

describe('réglages', () => {
  it('sont enregistrés et relus', () => {
    const { moteur } = moteurPret();
    moteur.reglages = { ...moteur.reglages, limiteNouvelles: 3, retentionCible: 0.95 };

    const rendu = Moteur.depuisJSON(JSON.parse(JSON.stringify(moteur)));
    assert.equal(rendu.reglages.limiteNouvelles, 3);
    assert.equal(rendu.reglages.retentionCible, 0.95);
  });

  it('une sauvegarde antérieure à un réglage hérite de sa valeur par défaut', () => {
    const { moteur } = moteurPret();
    const donnees = JSON.parse(JSON.stringify(moteur));
    delete donnees.reglages.ordre;          // réglage ajouté après coup
    delete donnees.reglages.limiteRevisions;

    const rendu = Moteur.depuisJSON(donnees);
    assert.equal(rendu.reglages.ordre, 'risque');
    assert.equal(rendu.reglages.limiteRevisions, 200);
  });

  it('une sauvegarde sans aucun réglage reste lisible', () => {
    const { moteur } = moteurPret();
    const donnees = JSON.parse(JSON.stringify(moteur));
    delete donnees.reglages;
    assert.doesNotThrow(() => Moteur.depuisJSON(donnees).demarrerSeance(T0));
  });

  it('replanifier recalcule les échéances selon la rétention visée', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    moteur.repondre(id, { correcte: true, tempsMs: 3000 }, T0);
    const echeanceInitiale = moteur.progression(id).prochaine;

    // Viser plus haut doit RAPPROCHER la révision.
    moteur.reglages = { ...moteur.reglages, retentionCible: 0.95 };
    const touchees = moteur.replanifier();

    assert.equal(touchees, 1);
    assert.ok(moteur.progression(id).prochaine < echeanceInitiale,
      'une cible plus exigeante rapproche la révision');
  });

  it('replanifier laisse les cartes jamais vues intactes', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    moteur.progression(id); // crée une fiche vierge
    assert.equal(moteur.replanifier(), 0);
    assert.equal(moteur.progression(id).prochaine, null);
  });

  it('replanifier ne touche ni la mémoire ni l\'historique', () => {
    const { moteur } = moteurPret();
    const id = moteur.cartes[0].id;
    moteur.repondre(id, { correcte: true, tempsMs: 3000 }, T0);
    const etat = { ...moteur.progression(id).etat };
    const revisions = moteur.journal.length;

    moteur.reglages = { ...moteur.reglages, retentionCible: 0.85 };
    moteur.replanifier();

    assert.deepEqual(moteur.progression(id).etat, etat);
    assert.equal(moteur.journal.length, revisions);
  });
});

describe('statistiques', () => {
  /** Journal fabriqué à la main pour contrôler exactement ce qu'on mesure. */
  const journal = [
    { id: 'a', premiereVue: true, correcte: true, note: 3, tempsMs: 3000, longueur: 100, recuperabiliteAvant: 1, tags: ['x'] },
    { id: 'a', premiereVue: false, correcte: true, note: 3, tempsMs: 3000, longueur: 100, recuperabiliteAvant: 0.95, tags: ['x'] },
    { id: 'a', premiereVue: false, correcte: false, note: 1, tempsMs: 8000, longueur: 100, recuperabiliteAvant: 0.55, tags: ['x'] },
    { id: 'b', premiereVue: false, correcte: true, note: 4, tempsMs: 2000, longueur: 100, recuperabiliteAvant: 0.92, tags: ['y'] },
    { id: 'b', premiereVue: false, correcte: false, note: 1, tempsMs: 9000, longueur: 100, recuperabiliteAvant: 0.45, tags: ['y'] },
    { id: 'b', premiereVue: false, correcte: false, note: 1, tempsMs: 9000, longueur: 100, recuperabiliteAvant: 0.35, tags: ['y'] },
  ];

  it('la rétention exclut les premières découvertes', () => {
    const r = retention(journal);
    assert.equal(r.total, 5, 'la découverte initiale n\'est pas un test');
    assert.equal(r.taux, 2 / 5);
  });

  it('la calibration confronte prédiction et réalité', () => {
    const c = calibration(journal, 4);
    assert.ok(c.tranches.length > 0);
    assert.ok(c.ecartMoyen >= 0 && c.ecartMoyen <= 1);
    for (const t of c.tranches) {
      assert.ok(t.predit >= 0 && t.predit <= 1);
      assert.ok(t.observe >= 0 && t.observe <= 1);
    }
  });

  it('la calibration est parfaite quand le modèle dit vrai', () => {
    // 100 révisions annoncées à 50 %, dont exactement la moitié réussissent.
    const parfait = Array.from({ length: 100 }, (_, i) => ({
      id: 'c', premiereVue: false, correcte: i % 2 === 0, note: 3,
      tempsMs: 3000, longueur: 100, recuperabiliteAvant: 0.5, tags: [],
    }));
    assert.ok(calibration(parfait, 10).ecartMoyen < 1e-9);
  });

  it('classe les tags du plus faible au plus solide', () => {
    const m = maitriseParTag(journal);
    assert.equal(m[0].tag, 'y');
    assert.equal(m[0].taux, 1 / 3);
    assert.equal(m[1].tag, 'x');
  });

  it('repère les cartes qui résistent', () => {
    const p = cartesProblematiques(journal, { minRevisions: 3, seuil: 0.6 });
    assert.equal(p.length, 1);
    assert.equal(p[0].id, 'b');
  });

  it('compte la charge à venir et le retard', () => {
    const progressions = [
      { prochaine: T0 - 3 * JOUR_MS },      // en retard
      { prochaine: T0 + 0.2 * JOUR_MS },    // aujourd'hui
      { prochaine: T0 + 2 * JOUR_MS },
      { prochaine: T0 + 900 * JOUR_MS },    // hors fenêtre
      { prochaine: null },                  // jamais vue
    ];
    const c = chargePrevisionnelle(progressions, 7, T0);
    assert.equal(c.enRetard, 1);
    assert.equal(c.parJour.length, 7);
    assert.equal(c.parJour.reduce((a, b) => a + b, 0), 2);
  });

  it('résume la répartition des notes', () => {
    const r = repartitionNotes(journal);
    assert.equal(r[1].nombre, 3);
    assert.equal(r[3].nombre, 2);
    assert.equal(r[4].nombre, 1);
    const somme = [1, 2, 3, 4].reduce((s, n) => s + r[n].part, 0);
    assert.ok(Math.abs(somme - 1) < 1e-9);
  });

  it('ne plante pas sur un journal vide', () => {
    assert.equal(retention([]).taux, null);
    assert.equal(calibration([]).ecartMoyen, null);
    assert.deepEqual(maitriseParTag([]), []);
  });
});

describe('recueils', () => {
  it('les recueils regroupent les séries par fichier importé', () => {
    const m = new Moteur();
    m.importer('# Réseau\n\nQ: A ?\n- [x] oui\n- non\n\n# Système\n\nQ: B ?\n- [x] oui\n- non', 'cours-1');
    m.importer('# Réseau\n\nQ: C ?\n- [x] oui\n- non', 'cours-2');

    const r = m.recueils();
    assert.deepEqual(r.map((x) => x.nom).sort(), ['cours-1', 'cours-2']);

    const un = r.find((x) => x.nom === 'cours-1');
    assert.equal(un.total, 2);
    assert.deepEqual(un.series.map((s) => s.nom).sort(), ['Réseau', 'Système']);

    // Deux fichiers peuvent nommer un chapitre pareil sans que leurs cartes
    // se retrouvent mélangées dans la même série.
    const deux = r.find((x) => x.nom === 'cours-2');
    assert.equal(deux.series.length, 1);
    assert.equal(deux.series[0].total, 1);
    });

  it('une carte importée sans nom de fichier reste visible', () => {
    const m = new Moteur();
    m.importer('Q: A ?\n- [x] oui\n- non');
    const r = m.recueils();
    assert.equal(r.length, 1);
    assert.equal(r[0].total, 1, 'la carte ne doit pas disparaître de l\'accueil');
    });

  it('réimporter sans nom de fichier conserve le recueil connu', () => {
    const m = new Moteur();
    m.importer('Q: A ?\n- [x] oui\n- non', 'cours-1');
    m.importer('Q: A ?\n- [x] oui\n- non\n> explication corrigée');
    assert.equal(m.recueils()[0].nom, 'cours-1');
    });

  it('une séance peut viser un recueil entier', () => {
    const m = new Moteur();
    m.importer('# X\n\nQ: A ?\n- [x] oui\n- non\n\nQ: B ?\n- [x] oui\n- non', 'cours-1');
    m.importer('# Y\n\nQ: C ?\n- [x] oui\n- non', 'cours-2');

    const s = m.demarrerSeance(Date.now(), { recueil: 'cours-1', inclureNonDues: true   });
    assert.equal(s.file.length, 2);
    assert.ok(s.file.every((c) => c.recueil === 'cours-1'));
    });
});
