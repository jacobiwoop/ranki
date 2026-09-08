/**
 * Agent d'enrichissement — tourne dans le navigateur, avec la clé de
 * l'utilisateur.
 *
 * Il ne sert qu'une fois : à partir des questions vérifiées d'une série, il
 * fabrique les variantes du jeu, puis on n'y retouche plus. Aucune requête
 * pendant une partie — le jeu reste jouable hors ligne, sans clé, sans délai.
 *
 * L'API de Google autorise les appels navigateur (elle renvoie les en-têtes
 * CORS attendus), contrairement à d'autres passerelles. Rien à relayer.
 *
 * Trois écueils rencontrés pendant la mise au point, tous traités ici :
 *
 *   - le modèle rend parfois 2 questions sur 20 en signalant qu'il a terminé
 *     normalement. Sans contrôle du compte, on perdrait des centaines de
 *     questions en silence ;
 *   - dire « remplace les mauvaises réponses » ne suffit pas ; les lui passer
 *     dans un champ nommé `leurres` fait toute la différence (0,05 leurre neuf
 *     sur 3 avant, 3,00 après) ;
 *   - la difficulté déclarée est instable d'un lot à l'autre. On la stocke,
 *     mais le jeu s'appuie sur le CLASSEMENT, pas sur l'étiquette.
 */

const MODELE_DEFAUT = 'gemini-3.1-flash-lite';
const point = (modele) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent`;

const BAREME = `BARÈME DE DIFFICULTÉ — absolu, identique pour tous les lots.
Note par rapport à l'ensemble du programme d'un technicien informatique,
JAMAIS par rapport aux autres questions du lot. Un lot entier peut mériter 2.

1 · Définition de base, connue de quiconque a ouvert le cours une fois.
    ex. « Que signifie l'acronyme HTTP ? »
2 · Fait à mémoriser, sans raisonnement.
    ex. « Quel port utilise HTTPS par défaut ? »
3 · Demande un raisonnement ou un calcul court.
    ex. « Combien d'hôtes adressables dans un /26 ? »
4 · Piège, nuance, ou confusion classique entre deux notions voisines.
    ex. « Pour la date du jour sans l'heure : TODAY() ou NOW() ? »
5 · Exige d'appliquer une règle à un cas, ou d'en déduire une conséquence.
    ex. « 192.168.1.130/26 joint-il 192.168.1.190 sans routeur ? »`;

const CONSIGNE = `Tu prépares des questions pour un jeu de quiz à difficulté
croissante, à partir d'un recueil d'examen (technicien informatique,
programme francophone). Les questions fournies sont VÉRIFIÉES : la bonne
réponse indiquée est juste, ne la remets jamais en cause.

${BAREME}

Pour CHAQUE question reçue, produis :

- difficulte : 1 à 5, selon le barème ci-dessus.
- indice : une phrase qui oriente sans livrer la réponse. Elle doit rester
  utile même après un 50/50. Ne cite JAMAIS le texte de la bonne réponse.
- variantes : exactement 4, une par procédé, dans cet ordre.

RÈGLE ABSOLUE, valable pour les QUATRE procédés : la BONNE RÉPONSE d'une
variante doit toujours être le fait d'origine, ou une conséquence directement
déductible de lui. Tu ne montes pas en quantité de savoir, tu montes en NIVEAU
D'EXIGENCE sur le MÊME savoir. Si une variante exige de connaître un fait qui
n'est ni dans la question, ni dans sa réponse, ni déductible de l'une ou
l'autre, elle est invalide : écris alors une variante plus modeste.

Cette règle ne concerne QUE la bonne réponse. Les mauvaises réponses, elles,
tu dois les inventer librement — c'est même tout ton travail.

CHAQUE variante compte TOUJOURS quatre options exactement, quel que soit le
nombre de leurres fournis. Le recueil d'origine en donne parfois deux, parfois
quatre : tu complètes ou tu écartes pour arriver à quatre.

  ① "durcir" — TA TÂCHE EST D'ÉCRIRE TROIS MAUVAISES RÉPONSES ENTIÈREMENT
     NOUVELLES. C'est tout le travail de ce procédé : si tu recopies les
     options fournies, tu n'as rien fait.
     Le champ "leurres" te donne les mauvaises réponses d'origine. AUCUNE
     ne doit réapparaître — elles sont trop faciles à écarter, c'est
     précisément pourquoi on te demande de les jeter. Tes nouveaux leurres :
     valeurs voisines, notions réellement confondues sur le terrain, erreur
     typique du débutant. Aucun leurre absurde ni hors sujet — quelqu'un qui ne
     sait pas doit pouvoir se tromper de bonne foi.
     La question et la bonne réponse sont recopiées telles quelles.
     Niveau : restituer. Difficulté : celle de l'origine, +1.

  ② "retourner" — MÊME fait, question posée dans l'autre sens : on part de la
     réponse pour demander la notion, ou on demande de reconnaître le fait sous
     une autre formulation. On ne doit plus pouvoir réciter mécaniquement.
     Niveau : comprendre. Difficulté : 2 à 3.

  ③ "appliquer" — le MÊME fait, MIS EN SITUATION. La question DOIT décrire un
     cas de terrain : un besoin chiffré, un matériel donné, une décision à
     prendre, une commande à lancer. Elle commence typiquement par « Tu dois… »,
     « Un client demande… », « Sur un poste qui… ». Une question qui demande
     encore « qu'est-ce que… » ou « que signifie… » n'est PAS une application :
     c'est une définition, et elle est invalide ici.
     Niveau : appliquer. Difficulté : 3 à 4.

  ④ "analyser" — on RAISONNE à partir du même fait : diagnostiquer une panne
     dont il est la cause, en déduire une conséquence, ou trancher un cas
     limite. La question décrit un SYMPTÔME ou une SITUATION et demande
     pourquoi, ou ce qui va se produire. La bonne réponse doit être une
     conséquence DÉDUCTIBLE du fait d'origine, jamais un fait rapporté
     d'ailleurs.
     Niveau : analyser. Difficulté : 4 à 5.

Deux tests à t'appliquer avant de rendre :
  - pour ① : « mes trois mauvaises réponses sont-elles toutes nouvelles ? »
  - pour ③ et ④ : « quelqu'un qui maîtrise parfaitement la question d'origine,
    et rien d'autre, peut-il répondre ? »
Si la réponse est non, recommence la variante.

Chaque explication fait 2 à 4 phrases et dit pourquoi les AUTRES options sont
fausses. Traite les questions dans l'ordre reçu et rends le même id.`;

const VARIANTE = {
  type: 'object',
  properties: {
    procede: { type: 'string', enum: ['durcir', 'retourner', 'appliquer', 'analyser'] },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    bonne: { type: 'integer' },
    explication: { type: 'string' },
    difficulte: { type: 'integer' },
  },
  required: ['procede', 'question', 'options', 'bonne', 'explication', 'difficulte'],
};

const SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      difficulte: { type: 'integer' },
      indice: { type: 'string' },
      variantes: { type: 'array', items: VARIANTE, minItems: 4, maxItems: 4 },
    },
    required: ['id', 'difficulte', 'indice', 'variantes'],
  },
};

/** Un bloc de questions vers le modèle. Peut se subdiviser s'il rend trop peu. */
async function traiterBloc(cartes, { cle, modele, signal }, essai = 1) {
  const enonce = cartes.map((c) => ({
    id: c.id,
    question: c.question,
    reponse: c.propositions.find((p) => p.correcte)?.texte,
    leurres: c.propositions.filter((p) => !p.correcte).map((p) => p.texte),
  }));

  const reponse = await fetch(point(modele), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': cle },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${CONSIGNE}\n\n`
        + `Tu dois rendre EXACTEMENT ${enonce.length} objets, un par question `
        + `reçue, dans le même ordre. En rendre moins est une faute.\n\n`
        + `QUESTIONS :\n${JSON.stringify(enonce, null, 1)}` }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 65_536,
      },
    }),
  });

  if (!reponse.ok) {
    const corps = await reponse.text();
    if (essai < 3 && (reponse.status === 429 || reponse.status >= 500)) {
      await new Promise((r) => setTimeout(r, 3000 * essai));
      return traiterBloc(cartes, { cle, modele, signal }, essai + 1);
    }
    throw new Error(messageLisible(reponse.status, corps));
  }

  const donnees = await reponse.json();
  const candidat = donnees.candidates?.[0];
  if (candidat?.finishReason && candidat.finishReason !== 'STOP') {
    throw new Error(`sortie interrompue (${candidat.finishReason})`);
  }
  const resultats = JSON.parse(
    (candidat?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
  );

  if (resultats.length < cartes.length) {
    if (essai < 3) return traiterBloc(cartes, { cle, modele, signal }, essai + 1);
    if (cartes.length > 2) {
      const moitie = Math.ceil(cartes.length / 2);
      const [a, b] = await Promise.all([
        traiterBloc(cartes.slice(0, moitie), { cle, modele, signal }),
        traiterBloc(cartes.slice(moitie), { cle, modele, signal }),
      ]);
      return [...a, ...b];
    }
    throw new Error(`${resultats.length}/${cartes.length} questions rendues`);
  }
  return resultats;
}

function messageLisible(statut, corps) {
  if (statut === 400 || statut === 403) return 'Clé refusée — vérifie qu\'elle est valide.';
  if (statut === 429) return 'Quota atteint. Réessaie plus tard.';
  try { return JSON.parse(corps).error?.message ?? `Erreur ${statut}`; } catch { return `Erreur ${statut}`; }
}

/** Aplatit un résultat d'agent en questions jouables, la source incluse. */
function versQuestions(enrichi, carte) {
  const bonne = carte.propositions.findIndex((p) => p.correcte);
  const commun = { origine: carte.id, section: carte.section, indice: enrichi.indice };
  const sortie = [];

  /*
   * La question d'origine n'entre dans le jeu que si elle a déjà quatre
   * propositions : le plateau affiche A, B, C, D, et le joker 50/50 a besoin
   * de trois mauvaises réponses pour en éteindre deux. Les questions à trois
   * ou cinq propositions ne sont pas perdues pour autant — leurs quatre
   * variantes, elles, sont normalisées à quatre options par l'agent.
   */
  if (carte.propositions.length === 4) {
    sortie.push({
      ...commun,
      id: `${carte.id}-o`,
      procede: 'originale',
      question: carte.question,
      options: carte.propositions.map((p) => p.texte),
      bonne,
      explication: carte.explication,
      difficulte: enrichi.difficulte,
    });
  }

  for (const v of enrichi.variantes ?? []) {
    // Une variante mal formée est écartée plutôt que corrigée : mieux vaut
    // trois bonnes questions que quatre dont une bancale.
    if (!Array.isArray(v.options) || v.options.length !== 4) continue;
    if (!Number.isInteger(v.bonne) || v.bonne < 0 || v.bonne > 3) continue;
    sortie.push({
      ...commun,
      id: `${carte.id}-${v.procede}`,
      procede: v.procede,
      question: v.question,
      options: v.options,
      bonne: v.bonne,
      explication: v.explication,
      difficulte: v.difficulte,
    });
  }
  return sortie;
}

/**
 * Enrichit une liste de cartes, bloc par bloc.
 *
 * Chaque bloc terminé est remonté immédiatement par `surBloc` : l'appelant
 * peut l'écrire aussitôt, si bien qu'une coupure ou une fermeture d'onglet ne
 * fait rien perdre de ce qui a déjà été payé.
 *
 * @param {object[]} cartes
 * @param {{cle:string, modele?:string, taille?:number, parallele?:number,
 *          signal?:AbortSignal, surBloc?:Function, surErreur?:Function}} options
 */
export async function enrichir(cartes, options) {
  const {
    cle, modele = MODELE_DEFAUT, taille = 20, parallele = 4,
    signal, surDebut, surBloc, surErreur,
  } = options;
  if (!cle) throw new Error('Clé absente.');

  const parId = new Map(cartes.map((c) => [c.id, c]));
  const blocs = [];
  for (let i = 0; i < cartes.length; i += taille) blocs.push(cartes.slice(i, i + taille));

  /** Sections couvertes par un bloc, pour dire à l'utilisateur où l'on en est. */
  const sectionsDe = (bloc) => [...new Set(bloc.map((c) => c.section || 'Sans série'))];

  const debut = Date.now();
  let faits = 0;
  surDebut?.({ blocs: blocs.length, total: cartes.length, taille, parallele, modele });

  for (let i = 0; i < blocs.length; i += parallele) {
    if (signal?.aborted) break;
    await Promise.all(blocs.slice(i, i + parallele).map(async (bloc, j) => {
      const numero = i + j + 1;
      const t0 = Date.now();
      surBloc?.({
        etat: 'encours', numero, taille: bloc.length,
        sections: sectionsDe(bloc), faits, total: cartes.length,
      });
      try {
        const enrichis = await traiterBloc(bloc, { cle, modele, signal });
        const questions = enrichis
          .filter((e) => parId.has(e.id))
          .flatMap((e) => versQuestions(e, parId.get(e.id)));
        faits += bloc.length;
        surBloc?.({
          etat: 'fini', numero, taille: bloc.length, sections: sectionsDe(bloc),
          questions, faits, total: cartes.length,
          ms: Date.now() - t0, msTotal: Date.now() - debut,
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        faits += bloc.length;
        surErreur?.({
          etat: 'echec', numero, taille: bloc.length, sections: sectionsDe(bloc),
          erreur: e.message, faits, total: cartes.length,
          ms: Date.now() - t0, msTotal: Date.now() - debut,
        });
      }
    }));
  }
}

export { MODELE_DEFAUT };
