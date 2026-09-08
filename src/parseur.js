/**
 * Parseur du format .qcm — texte lisible à l'œil nu, éditable partout,
 * versionnable dans git, et facile à générer depuis des cours existants.
 *
 *   # Réseau / Protocoles          ← section (la barre crée une hiérarchie)
 *   @tags réseau, ports            ← tags, valables jusqu'à la section suivante
 *
 *   Q: Quel port utilise HTTPS par défaut ?
 *   - 80
 *   - [x] 443                      ← [x] marque une bonne réponse
 *   - 8080
 *   - 22
 *   > 443/TCP est le port réservé à HTTP over TLS.
 *   > Le 80 est le HTTP en clair.  ← plusieurs lignes > sont recollées
 *   @source Cours Réseau, chap. 3
 *
 *   // ligne ignorée
 *
 * Deux types de questions, distingués par la puce :
 *
 *   -  →  QCM. Une ou plusieurs bonnes réponses, marquées [x].
 *   1. →  ORDRE. C'est la séquence qui est demandée ; le numéro donne la
 *         bonne position, et l'affichage brasse les propositions.
 *
 *   Q: Classe les couches OSI, de la plus basse à la plus haute.
 *   1. Physique
 *   2. Liaison de données
 *   3. Réseau
 *
 * Chaque question peut fixer son barème avec @bareme (voir BAREMES).
 * Placé avant toute question, il s'applique à toute la section.
 *
 * Le parseur ne s'arrête jamais à la première erreur : il collecte tout, avec
 * les numéros de ligne. Sur un import de 800 questions, on veut la liste
 * complète des problèmes, pas les découvrir un par un.
 */

/**
 * Identifiant stable dérivé du texte de la question (FNV-1a 32 bits).
 * Corriger une faute de frappe dans une proposition conserve l'historique de
 * révision ; reformuler la question crée une nouvelle carte — ce qui est le
 * comportement voulu, la question EST l'identité de la carte.
 */
export function identifiant(question) {
  let h = 0x811c9dc5;
  for (let i = 0; i < question.length; i++) {
    h ^= question.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

const RE_SECTION = /^#\s*(.+)$/;
const RE_META = /^@(\w+)\s+(.*)$/;
const RE_QUESTION = /^Q\s*:\s*(.+)$/i;
const RE_PROPOSITION = /^[-*]\s+(.*)$/;
const RE_ORDONNEE = /^(\d+)\s*[.)]\s+(.*)$/;
const RE_EXPLICATION = /^>\s?(.*)$/;
const RE_CORRECTE = /^\[\s*([xX✓])\s*\]\s*(.*)$/;

/** Barèmes acceptés, par type de question. Le premier est celui par défaut. */
export const BAREMES = {
  qcm: ['partiel', 'strict'],
  ordre: ['paires', 'positions', 'strict'],
};

/**
 * @param {string} texte
 * @returns {{cartes: object[], erreurs: {ligne:number, message:string}[]}}
 */
export function analyser(texte) {
  const lignes = texte.split(/\r?\n/);
  const cartes = [];
  const erreurs = [];
  const vues = new Map(); // id -> ligne, pour repérer les doublons

  let section = '';
  let tagsSection = [];
  let baremeSection = null;
  let courante = null;
  let ligneQuestion = 0;

  const erreur = (ligne, message) => erreurs.push({ ligne, message });
  const extrait = (c) => `« ${c.question.slice(0, 50)} »`;

  /** Valide la question courante et l'ajoute si elle tient debout. */
  function cloturer() {
    if (!courante) return;
    const c = courante;
    courante = null;

    const n = c.propositions.length;
    const type = c.type ?? 'qcm';

    if (n < 2) {
      return erreur(ligneQuestion,
        `${extrait(c)} : ${n} proposition(s), il en faut au moins 2`);
    }

    if (type === 'ordre') {
      // Les numéros doivent former 1..n sans trou ni répétition : sinon la
      // séquence attendue est ambiguë, et l'erreur passerait inaperçue.
      const numeros = c.propositions.map((p) => p.numero);
      const attendus = numeros.map((_, i) => i + 1).join(',');
      if ([...numeros].sort((a, b) => a - b).join(',') !== attendus) {
        return erreur(ligneQuestion,
          `${extrait(c)} : la numérotation doit aller de 1 à ${n} sans trou `
          + `(lu : ${numeros.join(', ')})`);
      }
    } else {
      const bonnes = c.propositions.filter((p) => p.correcte).length;
      if (bonnes === 0) {
        return erreur(ligneQuestion, `${extrait(c)} : aucune bonne réponse marquée [x]`);
      }
      if (bonnes === n) {
        return erreur(ligneQuestion, `${extrait(c)} : toutes les propositions sont marquées correctes`);
      }
    }

    const bareme = c.bareme ?? BAREMES[type][0];
    if (!BAREMES[type].includes(bareme)) {
      return erreur(ligneQuestion,
        `${extrait(c)} : barème « ${bareme} » inconnu pour une question de type `
        + `${type} (attendu : ${BAREMES[type].join(', ')})`);
    }

    const id = identifiant(c.question);
    if (vues.has(id)) {
      return erreur(ligneQuestion, `question en double (déjà vue ligne ${vues.get(id)})`);
    }
    vues.set(id, ligneQuestion);
    cartes.push(finaliser(c, id, type, bareme));
  }

  function finaliser(c, id, type, bareme) {
    const longueur =
      c.question.length + c.propositions.reduce((s, p) => s + p.texte.length, 0);
    // Sur une question d'ordre, la position dans le tableau EST la réponse :
    // on range donc les propositions selon leur numéro.
    const propositions = type === 'ordre'
      ? [...c.propositions].sort((a, b) => a.numero - b.numero)
        .map(({ texte }) => ({ texte }))
      : c.propositions;

    return {
      id,
      question: c.question,
      type,
      bareme,
      propositions,
      explication: c.explication.join(' ').trim(),
      source: c.source,
      section: c.section,
      tags: [...new Set(c.tags)],
      reponsesMultiples: type === 'qcm'
        && propositions.filter((p) => p.correcte).length > 1,
      longueur,
    };
  }

  lignes.forEach((brute, i) => {
    const ligne = i + 1;
    const t = brute.trim();

    if (t === '' || t.startsWith('//')) return;

    let m;
    if ((m = t.match(RE_SECTION))) {
      cloturer();
      section = m[1].trim();
      tagsSection = [];
      baremeSection = null;
      return;
    }

    if ((m = t.match(RE_QUESTION))) {
      cloturer();
      ligneQuestion = ligne;
      courante = {
        question: m[1].trim(),
        propositions: [],
        explication: [],
        source: '',
        section,
        tags: [...tagsSection],
        type: null,      // déduit de la puce employée
        bareme: baremeSection,
      };
      return;
    }

    if ((m = t.match(RE_META))) {
      const [, cle, valeur] = m;
      if (cle === 'tags') {
        const tags = valeur.split(',').map((s) => s.trim()).filter(Boolean);
        if (courante) courante.tags.push(...tags);
        else tagsSection = tags;
      } else if (cle === 'source') {
        if (courante) courante.source = valeur.trim();
        else erreur(ligne, '@source hors de toute question');
      } else if (cle === 'bareme') {
        if (courante) courante.bareme = valeur.trim();
        else baremeSection = valeur.trim();
      } else {
        erreur(ligne, `métadonnée inconnue : @${cle}`);
      }
      return;
    }

    if ((m = t.match(RE_PROPOSITION))) {
      if (!courante) return erreur(ligne, 'proposition sans question (« Q: » manquant ?)');
      if (courante.type === 'ordre') {
        return erreur(ligne, 'puce « - » mêlée à une question numérotée : '
          + 'une question est soit un QCM, soit un classement');
      }
      const corps = m[1].trim();
      const c = corps.match(RE_CORRECTE);
      const texte = (c ? c[2] : corps).trim();
      if (!texte) return erreur(ligne, 'proposition vide');
      courante.type = 'qcm';
      courante.propositions.push({ texte, correcte: Boolean(c) });
      return;
    }

    if ((m = t.match(RE_ORDONNEE))) {
      if (!courante) return erreur(ligne, 'proposition sans question (« Q: » manquant ?)');
      if (courante.type === 'qcm') {
        return erreur(ligne, 'ligne numérotée mêlée à un QCM : '
          + 'une question est soit un QCM, soit un classement');
      }
      const texte = m[2].trim();
      if (!texte) return erreur(ligne, 'proposition vide');
      courante.type = 'ordre';
      courante.propositions.push({ texte, numero: Number(m[1]) });
      return;
    }

    if ((m = t.match(RE_EXPLICATION))) {
      if (!courante) return erreur(ligne, 'explication sans question');
      courante.explication.push(m[1].trim());
      return;
    }

    erreur(ligne, `ligne incomprise : ${t.slice(0, 60)}`);
  });

  cloturer();
  return { cartes, erreurs };
}
