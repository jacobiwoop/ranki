/**
 * Le prompt que l'utilisateur copie pour faire fabriquer un `.qcm` par l'IA
 * de son choix.
 *
 * Il est long à dessein. Un format « à peu près » respecté produit un fichier
 * que le parseur rejette ligne par ligne, et l'utilisateur n'a aucun moyen de
 * savoir laquelle des trente règles implicites a été enfreinte. Chaque
 * contrainte qui fait échouer l'import est donc énoncée, avec sa raison — un
 * modèle respecte bien mieux une règle dont il comprend l'objet.
 *
 * Tenir ce texte à jour avec `src/parseur.js` : toute règle ajoutée là-bas doit
 * apparaître ici, sinon on produira des fichiers invalides sans le savoir.
 */

export const PROMPT_QCM = `# Rôle

Tu convertis un document de cours en un fichier de questions au format \`.qcm\`,
destiné à une application de révision par répétition espacée.

Ta sortie doit être **uniquement le contenu du fichier**. Aucune phrase avant,
aucune phrase après, aucun bloc de code, aucun commentaire sur ton travail.
Le premier caractère de ta réponse est \`#\` ou \`Q\`.

# Le format, dans le détail

Le fichier est du texte brut. Chaque ligne a un rôle donné par son premier
caractère. Une ligne vide sépare, elle n'a aucune autre valeur.

## Les sections

\`\`\`
# Réseau / Protocoles
\`\`\`

Une ligne commençant par \`#\` ouvre une section, qui vaut jusqu'à la suivante.
La barre oblique crée une hiérarchie lisible : \`# Réseau / Adressage IP\`.

## Une question à choix

\`\`\`
Q: Quel port utilise HTTPS par défaut ?
- 80
- [x] 443
- 8080
- 22
> 443/TCP est le port réservé à HTTP over TLS. Le port 80 sert au HTTP en
> clair, le 8080 est une convention pour les serveurs alternatifs, et le 22
> est celui de SSH.
@source Chapitre 3, page 45
\`\`\`

- \`Q:\` ouvre la question. Une seule ligne, même longue.
- \`-\` introduit une proposition. \`- [x]\` marque une bonne réponse.
- \`>\` donne l'explication. Plusieurs lignes \`>\` sont recollées en un seul
  paragraphe : va à la ligne quand c'est plus lisible.
- \`@source\` situe l'origine dans le document. Facultatif mais précieux.

Plusieurs bonnes réponses sont permises : marque simplement plusieurs \`[x]\`.

## Une question de classement

\`\`\`
Q: Classe les couches du modèle OSI, de la plus basse à la plus haute.
1. Physique
2. Liaison de données
3. Réseau
4. Transport
\`\`\`

La puce numérotée change le type de question : c'est la **séquence** qui est
demandée. Le numéro donne la bonne position ; l'application brassera les
propositions à l'affichage.

N'emploie ce type que si l'ordre est réellement porteur de sens — une
chronologie, une hiérarchie, des étapes d'un protocole. Pas pour une simple
énumération.

## Les métadonnées

\`\`\`
@tags réseau, ports        placé avant toute question : vaut pour la section
                           placé dans une question : vaut pour elle seule
@source Chapitre 3, p. 45  dans une question uniquement
@bareme strict             voir ci-dessous
\`\`\`

Les seules métadonnées reconnues sont \`@tags\`, \`@source\` et \`@bareme\`.
Toute autre (\`@auteur\`, \`@date\`, \`@niveau\`…) fait échouer la ligne.

Barèmes acceptés — n'écris \`@bareme\` que pour t'écarter du défaut :

| Type de question | Valeurs | Défaut |
|---|---|---|
| choix (\`-\`) | \`partiel\`, \`strict\` | \`partiel\` |
| classement (\`1.\`) | \`paires\`, \`positions\`, \`strict\` | \`paires\` |

## Les commentaires

Une ligne commençant par \`//\` est ignorée. Sers-t'en en tête de fichier pour
dire d'où viennent les questions.

# Ce qui fait ÉCHOUER l'import

Ces règles ne souffrent aucune exception. Une seule question fautive et
l'application la rejette en la nommant.

1. **Au moins deux propositions** par question.
2. **Au moins une** \`[x]\` sur une question à choix, et **pas toutes**.
   Une question dont toutes les réponses sont bonnes n'apprend rien.
3. **Jamais de mélange** entre \`-\` et \`1.\` dans la même question.
4. Sur un classement, la numérotation va de **1 à n, sans trou ni doublon**.
5. **Deux questions ne peuvent pas avoir le même énoncé.** L'identité d'une
   carte vient de son texte : deux énoncés identiques n'en font qu'une, et la
   seconde est refusée. Si le document pose deux fois la même question, garde
   la meilleure formulation ou distingue-les explicitement.
6. \`@source\` et \`@tags\` d'une question se placent **après** ses propositions,
   jamais avant.
7. N'invente aucune autre syntaxe : pas de \`**gras\`**, pas de titres \`##\`,
   pas de tableaux, pas de listes à puces imbriquées.

# Comment regrouper

C'est la partie qui demande du jugement.

**Regroupe par thème, pas par ordre d'apparition.** Si le document traite du
DHCP au chapitre 2 puis y revient au chapitre 7, les deux vont dans la même
section. Le but est de pouvoir réviser un sujet entier d'un bloc.

**Vise 8 à 25 questions par section.** En dessous, la section est trop maigre
pour une séance ; au-dessus, elle est trop vaste pour qu'on sache ce qu'on va
réviser. Découpe alors en sous-sections avec la barre oblique :

\`\`\`
# Réseau / Adressage IP
# Réseau / Routage
# Réseau / Services (DNS, DHCP, NTP)
\`\`\`

**Nomme les sections d'après leur contenu, pas d'après le document.**
« Sécurité / Chiffrement » vaut mieux que « Chapitre 4 » : dans six mois, le
numéro de chapitre ne dira plus rien.

**Ordonne du fondamental vers le pointu**, à l'intérieur de chaque section
comme entre les sections.

Ajoute des \`@tags\` transversaux : ils recoupent les sections et permettent de
retrouver un sujet qui les traverse (\`@tags tcp, port, sécurité\`).

# La qualité des questions

**Une question, une idée.** Si tu dois écrire « et » dans l'énoncé, il y a
probablement deux questions.

**Quatre propositions, sauf raison précise.** C'est le format le plus courant
et le mieux servi par l'application.

**Les mauvaises réponses doivent être crédibles.** C'est le point qui fait
toute la différence entre une bonne et une mauvaise question. Une proposition
absurde ne fait qu'augmenter les chances de trouver par élimination. Puise
dans :
- les valeurs voisines (\`/25\` et \`/27\` face à \`/26\`) ;
- les notions réellement confondues sur le terrain (\`TODAY()\` et \`NOW()\`) ;
- l'erreur typique du débutant.

**Interdits :** « toutes les réponses ci-dessus », « aucune de ces réponses »,
« A et C », et toute proposition manifestement plus longue que les autres —
elle trahit la bonne réponse.

**Varie la position de la bonne réponse.** Ne la mets pas systématiquement en
première ou deuxième position ; répartis-la sur les quatre.

**Écris une explication pour chaque question**, en deux à quatre phrases. Elle
doit dire pourquoi la bonne réponse est bonne **et** pourquoi les autres sont
fausses. C'est ce texte qui sera lu après chaque réponse : c'est là que
l'apprentissage se fait, pas dans le fait d'avoir coché juste.

**N'invente rien.** Ne pose que des questions dont la réponse figure dans le
document fourni. Si un passage est ambigu ou incomplet, ne devine pas : passe
au suivant. Un fichier plus court est bien meilleur qu'un fichier qui enseigne
des faussetés — l'application est conçue pour ancrer durablement ce qu'elle
présente, y compris une erreur.

# Combien de questions

Couvre le document sérieusement : compte à peu près **une question par notion
distincte**. Ne cherche ni à atteindre un quota ni à tout couvrir à tout prix.
Une définition importante mérite une question ; une remarque de passage, non.

Si le document est très long, traite-le **entièrement** et rends un seul
fichier. Si tu approches ta limite de longueur, arrête-toi proprement à la fin
d'une question complète et signale-le en dernière ligne par un commentaire
\`// interrompu à la section X, demander la suite\`.

# Exemple complet et valide

\`\`\`
// Questions tirées de « Cours Réseau — L2 », chapitres 1 à 3.

# Réseau / Protocoles
@tags réseau

Q: Quel port utilise HTTPS par défaut ?
- 80
- [x] 443
- 8080
- 22
> 443/TCP est le port réservé à HTTP over TLS. Le 80 correspond au HTTP en
> clair, le 8080 est une convention pour les serveurs alternatifs, et le 22
> est celui de SSH.
@source Chapitre 2, page 31

Q: Que garantit TLS lors d'un échange HTTPS ?
- [x] La confidentialité des données transmises
- [x] L'authenticité du serveur contacté
- La disponibilité du service
- La vitesse de la connexion
> TLS chiffre le trafic et vérifie le certificat du serveur : il assure donc
> confidentialité et authenticité. Il n'a en revanche aucun effet sur la
> disponibilité ni sur le débit.
@source Chapitre 2, page 34

# Réseau / Modèle OSI
@tags osi, couches

Q: Classe les couches du modèle OSI, de la plus basse à la plus haute.
1. Physique
2. Liaison de données
3. Réseau
4. Transport
> L'ordre se retient par la progression du signal électrique vers
> l'application : le support physique, puis la trame locale, puis
> l'acheminement entre réseaux, puis le transport de bout en bout.
@source Chapitre 1, page 12

Q: À quelle couche du modèle OSI le protocole IP appartient-il ?
- Couche 2, liaison de données
- [x] Couche 3, réseau
- Couche 4, transport
- Couche 7, application
> IP assure l'acheminement des paquets entre réseaux distincts, ce qui est la
> définition de la couche 3. La couche 2 ne gère que le lien local, la couche 4
> le transport de bout en bout, et la couche 7 les échanges applicatifs.
@source Chapitre 1, page 14
\`\`\`

# Pour finir

Relis ta sortie avant de répondre et vérifie, question par question :

- au moins deux propositions ;
- au moins une \`[x]\`, mais pas toutes ;
- aucun mélange de \`-\` et de \`1.\` ;
- aucun énoncé en double ;
- une explication sur chaque question ;
- aucune métadonnée en dehors de \`@tags\`, \`@source\` et \`@bareme\`.

Puis rends le fichier, et rien d'autre.

---

**Le document à convertir suit.**
`;
