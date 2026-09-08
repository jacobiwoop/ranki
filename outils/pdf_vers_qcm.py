#!/usr/bin/env python3
"""
Convertit un recueil de QCM au format PDF en fichiers .qcm.

    python3 outils/pdf_vers_qcm.py recueil.pdf --sortie exemples/ [--motdepasse XXXX]

Le PDF n'est pas une source structurée : chaque recueil a ses conventions.
Celui-ci en mélange quatre, toutes gérées ici :

  1. « Réponse correcte : c) RAM »        réponse en ligne après les propositions
  2. « Réponses : » puis « 1. A »          corrigé groupé en fin de série
  3. « Réponses possibles : » puis
     « - Question 1 : b »                  même chose, autre écriture
  4. propositions sans délimiteur
     (« A Anneau », « B Maillé »)          ambigu, accepté sous conditions

Deux fichiers sont produits : les questions dont le corrigé figure dans le PDF,
et celles qui n'en ont pas — ces dernières avec un [x] PLACEHOLDER à corriger
à la main, jamais présenté comme une vraie réponse.

Contrôle de fiabilité intégré (--verifier) : pour les réponses en ligne, le
texte annoncé est comparé à la proposition portant cette lettre. Toute
divergence signale une erreur de lecture.

Dépendance : pypdf.
"""
import argparse
import os
import re
import sys
import unicodedata
from collections import Counter

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf manquant : pip install pypdf")

# Une question : « 12. Texte », « 12) Texte », ou « 12.Texte » sans espace.
# On exige une lettre derrière le séparateur, sinon « 8411.7 » passerait pour
# une question numéro 8411.
# Le recueil contient des coquilles de double numérotation (« 6.18. Texte ») :
# on absorbe le second numéro plutôt que de perdre la question.
RE_QUESTION = re.compile(
    r'^\s{0,6}(\d{1,3})\s*[.)]\s*(?:\d{1,3}\s*[.)]\s*)?([A-Za-zÀ-ÿ«"\'(].*)$')
# Une proposition : « a) Texte », « - A. Texte », « • b) Texte », « a)Texte »
RE_OPTION = re.compile(r'^\s*(?:[-•*]\s*)?([a-eA-E])\s*[.)]\s*([A-Za-zÀ-ÿ0-9«"\'(/].*)$')
# Certaines séries omettent tout délimiteur : « A Anneau ». Ambigu par nature
# (« A quoi sert… » commence pareil), donc accepté sous conditions seulement.
RE_OPTION_NUE = re.compile(r'^\s*([A-E])\s+(\S.*)$')
# Réponse en ligne
RE_INLINE = re.compile(r'^\s*R[ée]ponses?\s+correctes?\s*:\s*([a-eA-E])\b', re.I)
# Début d'un corrigé groupé. « Réponses », « Réponses : », « Réponses possibles : »
RE_DEBUT_CLE = re.compile(r'^\s*R[ée]ponses?(\s+possibles?)?\s*:?\s*$', re.I)
# Lignes d'un corrigé groupé : « 3. B » ou « - Question 3 : b »
RE_CLE = re.compile(
    r'^\s*(?:[-•*]\s*)?(?:Question\s*)?(\d{1,3})\s*[.):]\s*([a-eA-E])\b', re.I)
# Titres de section
RE_TITRE = re.compile(
    r'^\s*((?:DOSSIER|PARTIE|THEME|CHAPITRE)\s+[^\n]{0,80})$', re.I)

BRUIT = re.compile(
    r'^\s*(TD DE REVISION|EXAMEN NATIONAL|EPREUVE DE|Enseignant\s*:|Page \d+|\d+\s*)$',
    re.I)

# Numéro de question recollé en fin de ligne : « d) MAX() 6.Quelle clause… »
RE_QUESTION_COLLEE = re.compile(r'^(.*?\S)\s+(\d{1,3})\s*[.)]\s*([A-ZÀ-ÿ].*)$')


def couper_question_collee(ligne, numero_attendu):
    """Sépare une ligne où la question suivante a été recollée à la précédente.

    Le découpage n'a lieu que si le numéro trouvé est exactement celui attendu :
    sans cette condition, « Windows 10. Le système… » serait coupé à tort.
    """
    m = RE_QUESTION_COLLEE.match(ligne)
    if m and int(m.group(2)) == numero_attendu:
        return m.group(1), int(m.group(2)), m.group(3)
    return None


def nettoyer(t: str) -> str:
    """Répare les artefacts d'extraction PDF."""
    t = unicodedata.normalize('NFC', t)
    t = t.replace(' ', ' ').replace('’', "'").replace('“', '"').replace('”', '"')
    t = re.sub(r'\s+', ' ', t).strip()
    # « sous -réseau » -> « sous-réseau » ; « sous- réseau » -> « sous-réseau »
    t = re.sub(r'(\w)\s+-\s*(\w)', r'\1-\2', t)
    t = re.sub(r'(\w)-\s+(\w)', r'\1-\2', t)
    # Espace avant ponctuation double : on garde l'espace fine française
    t = re.sub(r'\s+([,.;])', r'\1', t)
    t = re.sub(r'\s*([?!:])', r' \1', t)
    return t.strip()


def lire_pages(chemin_pdf, motdepasse=None):
    """Renvoie [(numero_page, texte)]. Déchiffre si nécessaire."""
    lecteur = PdfReader(chemin_pdf)
    if lecteur.is_encrypted:
        if lecteur.decrypt(motdepasse or '') == 0:
            sys.exit("PDF protégé : fournis le mot de passe avec --motdepasse")
    return [(i, p.extract_text() or '') for i, p in enumerate(lecteur.pages, 1)]


class Question:
    def __init__(self, numero, texte, section, page):
        self.numero = numero
        self.lignes = [texte]
        self.options = []          # [(lettre, [lignes])]
        self.bonne = None          # lettre
        self.section = section
        self.page = page

    @property
    def texte(self):
        return nettoyer(' '.join(self.lignes))

    def propositions(self):
        return [(l, nettoyer(' '.join(ls))) for l, ls in self.options]


def analyser(pages):
    questions = []
    section = 'Général'
    courante = None
    cible = None        # 'question' | 'option' | None : où ajouter une continuation
    cles = {}           # (section, numero) -> lettre, issus des corrigés groupés
    dans_cle = False
    bloc_actuel = []    # questions du bloc en cours, pour rattacher son corrigé

    def clore_bloc():
        nonlocal bloc_actuel
        bloc_actuel = []

    for page, texte in pages:
        for brute in texte.split('\n'):
            ligne = brute.rstrip()
            if not ligne.strip() or BRUIT.match(ligne):
                continue

            m = RE_TITRE.match(ligne)
            if m:
                section = nettoyer(m.group(1))
                courante, cible, dans_cle = None, None, False
                clore_bloc()
                continue

            if RE_DEBUT_CLE.match(ligne):
                dans_cle = True
                courante, cible = None, None
                continue

            if dans_cle:
                m = RE_CLE.match(ligne)
                if m:
                    cles[(section, int(m.group(1)))] = m.group(2).lower()
                    continue
                # Une ligne qui n'est pas une clé termine le corrigé.
                dans_cle = False

            m = RE_INLINE.match(ligne)
            if m and courante:
                courante.bonne = m.group(1).lower()
                cible = None
                continue

            m = RE_OPTION.match(ligne)
            if m and courante:
                texte = m.group(2)
                coupe = couper_question_collee(texte, courante.numero + 1)
                if coupe:
                    fin_option, numero, debut_question = coupe
                    courante.options.append((m.group(1).lower(), [fin_option]))
                    courante = Question(numero, debut_question, section, page)
                    questions.append(courante)
                    bloc_actuel.append(courante)
                    cible = 'question'
                    continue
                courante.options.append((m.group(1).lower(), [texte]))
                cible = 'option'
                continue

            # Format sans délimiteur. Deux garde-fous contre les faux positifs
            # (« A quoi sert… ») : la lettre doit être exactement la suivante
            # attendue, et l'énoncé doit déjà être terminé.
            m = RE_OPTION_NUE.match(ligne)
            if m and courante:
                attendue = chr(ord('a') + len(courante.options))
                enonce_fini = courante.options or courante.texte.rstrip().endswith(
                    ('?', ':', '.'))
                if m.group(1).lower() == attendue and enonce_fini:
                    courante.options.append((attendue, [m.group(2)]))
                    cible = 'option'
                    continue

            m = RE_QUESTION.match(ligne)
            if m:
                # Un numéro isolé suivi d'une lettre seule est plus probablement
                # une ligne de corrigé mal détectée qu'une nouvelle question.
                courante = Question(int(m.group(1)), m.group(2), section, page)
                questions.append(courante)
                bloc_actuel.append(courante)
                cible = 'question'
                continue

            # Continuation du texte précédent
            if cible == 'question' and courante:
                courante.lignes.append(ligne.strip())
            elif cible == 'option' and courante and courante.options:
                courante.options[-1][1].append(ligne.strip())

    # Application des corrigés groupés
    for q in questions:
        if q.bonne is None:
            q.bonne = cles.get((q.section, q.numero))

    return questions, cles


THEMES = [
    ('bases-de-données',
     r'\bSQL\b|base de donn|bases de donn|\btable\b|requête|MERISE|\bMCD\b|clé primaire'),
    ('uml', r'\bUML\b|diagramme de (classe|séquence|cas)|cas d.utilisation'),
    ('sécurité',
     r'sécurit|pare-?feu|firewall|antivirus|malware|chiffr|authentifi|'
     r'vulnérab|attaque|\bvirus\b|phishing|piratage|mot de passe'),
    ('réseaux',
     r'réseau|\bIP\b|\bTCP\b|\bUDP\b|\bDNS\b|\bDHCP\b|routeur|commutateur|'
     r'\bswitch\b|\bLAN\b|\bWAN\b|masque|sous-réseau|\bVLAN\b|\bOSI\b|'
     r'protocole|ethernet|proxy|passerelle|topologie|adresse'),
    ('bureautique', r'\bExcel\b|\bWord\b|tableur|traitement de texte|\bPowerPoint\b'),
    ('système-exploitation',
     r"système d.exploitation|\bWindows\b|\bLinux\b|noyau|partition|"
     r"processus|système de fichiers|\bOS\b"),
    ('architecture',
     r'\bCPU\b|\bRAM\b|\bROM\b|\bBIOS\b|carte mère|processeur|mémoire|'
     r'disque dur|\bSSD\b|périphérique|alimentation|\bGPU\b|carte graphique|'
     r'\bUSB\b|composant|microprocesseur'),
    ('maintenance', r'maintenance|dépannage|\bpanne\b|diagnostic'),
]


def themes(question):
    """Jusqu'à deux thèmes par question, du plus spécifique au plus général."""
    corpus = question.texte + ' ' + ' '.join(t for _, t in question.propositions())
    trouves = [tag for tag, motif in THEMES if re.search(motif, corpus, re.I)]
    return trouves[:2] or ['général']


def slug(texte):
    t = unicodedata.normalize('NFD', texte.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


def normaliser(texte):
    """Clé de comparaison pour repérer les doublons."""
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFD', texte.lower()))


def ecrire(chemin, questions, titre, avec_reponses):
    lignes = [
        f'// {titre}',
        '// Extrait de « RECUEIL DE TC POUR SIL ET ASSRI.pdf »',
        f'// {len(questions)} questions',
    ]
    if not avec_reponses:
        lignes += [
            '//',
            "// ATTENTION : le PDF ne donne AUCUNE réponse pour ces questions.",
            "// Les [x] ci-dessous sont des PLACEHOLDERS placés sur la première",
            "// proposition — ils sont FAUX tant que tu ne les as pas corrigés.",
            "// Déplace le [x] sur la bonne proposition avant d'importer.",
        ]
    lignes.append('')

    section_courante = None
    for q in questions:
        if q.section != section_courante:
            section_courante = q.section
            lignes += ['', f'# {section_courante.title()}', '']

        lignes.append(f'Q: {q.texte}')
        # Les tags sont posés par question : le thème varie à l'intérieur
        # d'une même section du recueil.
        lignes.append(f'@tags {", ".join(themes(q))}')
        bonne = q.bonne or 'a'   # placeholder quand le corrigé est absent
        for lettre, texte in q.propositions():
            marque = '[x] ' if lettre == bonne else ''
            lignes.append(f'- {marque}{texte}')
        lignes.append(f'@source Page {q.page} du recueil, question {q.numero}')
        lignes.append('')

    open(chemin, 'w', encoding='utf-8').write('\n'.join(lignes) + '\n')
    return len(questions)


def verifier_inline(pages, questions):
    """Confronte le texte de chaque réponse annoncée à la proposition portante.

    C'est le seul contrôle possible sans corrigé externe : si le PDF dit
    « Réponse correcte : c) RAM », alors la proposition c) doit bien être RAM.
    Une divergence trahit un décalage dans la lecture des propositions.
    """
    motif = re.compile(
        r'R[ée]ponses?\s+correctes?\s*:\s*([a-eA-E])\s*[.)]?\s*(.+)$', re.I)
    annonces = [(m.group(1).lower(), nettoyer(m.group(2)))
                for _, t in pages for l in t.split('\n')
                if (m := motif.search(l)) and m.group(2).strip()]

    def simplifier(s):
        s = unicodedata.normalize('NFD', s.lower())
        s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
        return re.sub(r'[^a-z0-9]', '', s)

    ok = ko = 0
    ecarts = []
    i = 0
    for q in questions:
        if q.bonne is None or i >= len(annonces):
            continue
        lettre, texte = annonces[i]
        if lettre != q.bonne:
            continue
        attendu, recu = simplifier(dict(q.propositions()).get(q.bonne, '')), simplifier(texte)
        if attendu and recu and (attendu.startswith(recu[:40]) or recu.startswith(attendu[:40])):
            ok += 1
        else:
            ko += 1
            ecarts.append((q, texte))
        i += 1
    return ok, ko, ecarts


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf', help='recueil de QCM au format PDF')
    ap.add_argument('--sortie', default='.', help='dossier de destination')
    ap.add_argument('--motdepasse', help='mot de passe si le PDF est protégé')
    ap.add_argument('--nom', default='recueil', help='préfixe des fichiers produits')
    ap.add_argument('--verifier', action='store_true',
                    help='contrôle la cohérence des réponses lues')
    args = ap.parse_args()

    pages = lire_pages(args.pdf, args.motdepasse)
    questions, cles = analyser(pages)

    # Ne garde que ce qui est structurellement exploitable.
    retenues, rejetees, vues, doublons = [], [], {}, 0
    for q in questions:
        props = q.propositions()
        cle = normaliser(q.texte)
        if len(props) < 2 or len(q.texte) < 12:
            rejetees.append(q)
        elif cle in vues:
            doublons += 1
        elif q.bonne and q.bonne not in [l for l, _ in props]:
            rejetees.append(q)
        else:
            vues[cle] = q
            retenues.append(q)

    avec = [q for q in retenues if q.bonne]
    sans = [q for q in retenues if not q.bonne]

    os.makedirs(args.sortie, exist_ok=True)
    f1 = os.path.join(args.sortie, f'{args.nom}.qcm')
    f2 = os.path.join(args.sortie, f'{args.nom}-sans-reponses.qcm')
    ecrire(f1, avec, 'Questions avec corrigé', True)
    ecrire(f2, sans, 'Questions SANS corrigé dans le PDF', False)

    print(f'{len(pages)} pages lues, {len(questions)} questions détectées')
    print(f'  doublons écartés     : {doublons}')
    print(f'  rejetées (malformées): {len(rejetees)}')
    print(f'  -> {f1} : {len(avec)}')
    print(f'  -> {f2} : {len(sans)}')

    if args.verifier:
        ok, ko, ecarts = verifier_inline(pages, questions)
        print(f'\nContrôle des réponses en ligne : {ok} concordantes, {ko} discordantes')
        for q, texte in ecarts[:5]:
            print(f'  p{q.page} n°{q.numero} : annoncé {texte[:50]!r}')
            print(f'                  option {q.bonne}) '
                  f'{dict(q.propositions()).get(q.bonne, "")[:50]!r}')

    print('\nThèmes (questions avec corrigé) :')
    for t, n in Counter(t for q in avec for t in themes(q)).most_common():
        print(f'  {n:>4}  {t}')


if __name__ == '__main__':
    main()
