# Moteur de répétition espacée à notation déduite

Un système de révision par QCM qui **ne demande jamais à l'utilisateur de
s'auto-évaluer**. On clique sa réponse, ça enchaîne. La note qui pilote la
planification est reconstruite à partir de signaux objectifs.

Écrit en JavaScript sans aucune dépendance : le code testé ici en ligne de
commande est celui qui tournera tel quel dans le navigateur (PWA).

```
npm start             # lance l'application  →  http://localhost:8123
npm test              # 211 tests
npm run expliquer     # trace une carte pas à pas, pour comprendre
npm run simuler       # 6 mois de révisions simulées, avec groupe témoin
npm run balayage      # règle un paramètre par l'expérience
```

## L'application

Une PWA sans étape de compilation : `app/` importe directement `src/`, donc le
code qui tourne dans le navigateur est **exactement** celui que couvrent les
tests. Un serveur local est nécessaire (les modules ES et les service workers
refusent `file://`) ; `localhost` compte comme origine sécurisée, donc
l'installation sur l'écran d'accueil et le mode hors ligne fonctionnent sans
certificat.

| Écran | Contenu |
|---|---|
| **Accueil** | Ce qui est dû aujourd'hui, puis les recueils importés — dépliables sur leurs séries. |
| *(séance)* | La révision. Trois interactions selon le type de question. |
| **Progrès** | Rétention, charge à venir, maîtrise par thème, fiabilité des prévisions. |
| **Jeu** | « Le Millionnaire » : préparation des questions, puis la partie. |
| **Réglages** | Import `.qcm`, sauvegarde, rythme, rétention, affichage. |

### Deux façons de travailler

- **Ce qui est dû** — la répétition espacée proprement dite : le moteur pioche
  partout ce qui risque d'être oublié aujourd'hui. C'est ce mode qui fait
  mémoriser.
- **Un recueil, ou une de ses séries** — du bachotage assumé : tout le fichier
  ou tout le chapitre, y compris ce qui n'est pas encore dû, et sans le quota
  quotidien de nouvelles cartes. Légitime avant un examen, mais ce n'est pas la
  même chose.

Chaque fichier importé devient un **recueil**, dépliable sur ses séries. Sans ce
niveau, quinze chapitres d'un même document noieraient ceux d'un autre et rien
ne dirait d'où ils viennent.

L'ordre des questions comme celui des propositions est **rebrassé à chaque
séance**. Sans cela, relancer une série reposait exactement les mêmes questions
dans le même ordre, et l'on finissait par retenir la suite plutôt que le
contenu.

Quand il n'y a rien à faire, l'écran dit **pourquoi** — quota de découvertes
épuisé, ou tout est replanifié — avec le compte du jour et la prochaine
échéance. « Rien à réviser » sans explication ressemble à une panne, et l'on
tourne le réglage sans effet visible.

### Deux modes

- **Apprentissage** — après chaque réponse : la correction, l'explication, puis
  « Suivant ». Y compris sur une bonne réponse : rien n'escamote le retour.
- **Examen** — aucun retour pendant la série. Le score et le corrigé complet
  (ta réponse, la bonne, l'explication) arrivent à la fin. Une carte ratée n'est
  pas reproposée en cours de route : un examen ne repose pas deux fois la même
  question.

Dans les deux cas le chronomètre tourne et la notation déduite fonctionne à
l'identique : seul l'affichage du retour change.

### Les trois interactions

- **QCM à réponse unique** — un appui suffit, il vaut validation. C'est tout
  l'intérêt : pas de second geste.
- **QCM à réponses multiples** — on coche, puis on valide.
- **Classement** — on touche les éléments dans l'ordre voulu ; ils se numérotent
  au fur et à mesure et la validation se déclenche au dernier. Retirer un
  élément déjà placé annule aussi les suivants, sinon la séquence aurait un trou.

Le bandeau de retour affiche la note déduite et la prochaine échéance
(« Difficile · revu dans 5 jours »). Aucune obligation d'y toucher : c'est de
la transparence, pas une saisie.

### Données

Tout vit dans IndexedDB, sur l'appareil. Aucun serveur, aucun compte. La
synchronisation téléphone ↔ PC passe par l'export/import d'un fichier JSON,
en tête des réglages. L'écriture est différée puis forcée dès que
l'application passe en arrière-plan — moment où le système peut la tuer.

**Deux bases distinctes**, et non deux tables : `revisions` et `millionnaire`.
Effacer les questions du jeu ne peut donc pas, structurellement, toucher à des
mois d'historique de révision. Les sauvegardes sont séparées elles aussi.

Les onglets sont de vrais onglets : chaque vue garde son conteneur, monté une
seule fois. On retrouve la vue telle qu'on l'a laissée — recueils dépliés,
position de défilement — et une génération de questions lancée dans l'onglet
Jeu se poursuit pendant qu'on consulte ses progrès ailleurs.

## Pourquoi

Anki demande une note de 1 à 4 après chaque carte. C'est un clic de plus, et
surtout une auto-évaluation biaisée. Sur un QCM, l'information est déjà là :
la réponse est objectivement juste ou fausse, et le temps de réponse trahit la
fluidité du rappel. Autant s'en servir.

## Architecture

| Fichier | Rôle |
|---|---|
| `src/memoire.js` | Courbe d'oubli, évolution de stabilité et difficulté |
| `src/notation.js` | **Déduction de la note** — la pièce originale |
| `src/planificateur.js` | Quoi réviser, quand, dans quel ordre |
| `src/presentation.js` | Mélange des propositions, vérification de la réponse |
| `src/parseur.js` | Lecture du format `.qcm` |
| `src/stats.js` | Rétention, calibration, points faibles |
| `src/moteur.js` | Façade unique appelée par l'interface |
| `src/jeu.js` | Le jeu — échelle, paliers, tirage. Étanche au moteur de révision |
| `app/prompt-qcm.js` | Le prompt qui fait fabriquer un `.qcm` par une IA |
| `app/jeu/agent.js` | Génération des variantes, une fois pour toutes |

### Le modèle de mémoire

Repris de FSRS, dont la structure est un résultat expérimental et non un choix
de conception. Chaque carte porte deux nombres :

- **S** (stabilité) — jours au bout desquels le rappel retombe à 90 %
- **D** (difficulté) — de 1 à 10

d'où se déduit **R**, la probabilité de rappel à l'instant t :

```
R(t) = (1 + 0.2345 × t / S) ^ -0.5
```

Le planificateur inverse cette équation pour trouver la date où R atteindra la
rétention visée.

> ⚠️ Les poids de `POIDS_DEFAUT` sont les valeurs publiées de FSRS-5,
> retranscrites de mémoire comme point de départ. **À vérifier contre
> l'implémentation de référence** avant de s'y fier en production. La structure
> des formules, elle, est couverte par les tests.

### La notation déduite

Le temps brut ne veut rien dire : une question longue prend du temps à lire, et
« 4 secondes » est lent pour l'un, rapide pour l'autre. `ProfilUtilisateur`
ajuste donc en continu, par moindres carrés sur les bonnes réponses récentes :

```
temps ≈ latence + pente × longueur_du_texte
```

et juge chaque réponse sur son **résidu** — l'écart à ce qu'on attendait d'elle.
Ce seul changement neutralise à la fois l'effet de la longueur et les écarts
entre utilisateurs.

Puis, par-dessus :

- **hésitation** — cocher puis décocher plafonne la note (on peut être rapide
  et incertain) ;
- **devinage** — juste + quasi instantané + jamais réussie auparavant sur un QCM
  à choix unique : c'est le profil du coup de chance à 25 %, noté « Difficile » ;
- **valeurs aberrantes** — au-delà de 60 s l'utilisateur a été interrompu, la
  mesure est ignorée plutôt qu'interprétée.

## Le format `.qcm`

```
# Réseau / Protocoles
@tags réseau, ports

Q: Quel port utilise HTTPS par défaut ?
- 80
- [x] 443
- 8080
- 22
> 443/TCP est le port réservé à HTTP over TLS.
> Le 80 est le HTTP en clair.
@source Cours Réseau, chap. 3

// les lignes commençant par // sont ignorées
```

`[x]` marque une bonne réponse (plusieurs possibles), `>` l'explication
(multiligne, recollée), `@` les métadonnées.

### Questions de classement

La puce numérotée change le type de question : c'est la **séquence** qui est
demandée. À l'affichage les propositions sont brassées — et jamais présentées
déjà dans l'ordre, ce qui donnerait la réponse.

```
Q: Classe les couches du modèle OSI, de la plus basse à la plus haute.
1. Physique
2. Liaison de données
3. Réseau
```

Une question est soit un QCM (`-`), soit un classement (`1.`) — les mélanger
dans la même question est une erreur signalée.

### Barèmes

`@bareme` se pose sur une question, ou avant toute question pour valoir sur
toute la section. La question l'emporte sur sa section.

| Type | Barème | Effet |
|---|---|---|
| QCM | `partiel` *(défaut)* | Crédite ce qui est trouvé, **déduit** ce qui est coché à tort. Tout cocher rapporte 0. |
| QCM | `strict` | Tout ou rien. |
| Ordre | `paires` *(défaut)* | Proportion de paires bien ordonnées. Intervertir deux voisines coûte peu, tout inverser donne 0. |
| Ordre | `positions` | Proportion d'éléments à leur place exacte. Sévère : décaler la liste d'un cran donne 0. |
| Ordre | `strict` | Tout ou rien. |

Le score obtenu (0 à 1) devient une note :

- **1** → notation habituelle par le temps de réponse (Correct ou Facile)
- **≥ 0,5** → « Difficile ». Une réponse partielle ne peut jamais valoir mieux :
  répondre vite ne rachète pas une réponse incomplète.
- **< 0,5** → « Encore », c'est un oubli.

Le seuil est fixé à la moitié délibérément : sur une question à deux bonnes
réponses — le cas le plus courant — les seuls scores possibles sont 1, 0,5 et 0.
Plus haut, le crédit partiel ne servirait jamais.

Le parseur ne s'arrête pas à la première erreur : il rend la liste complète
avec les numéros de ligne. L'identifiant d'une carte dérive du texte de la
question — corriger une proposition ou une explication **conserve l'historique
de révision**, reformuler la question crée une nouvelle carte.

### Fabriquer un `.qcm` à partir de ses cours

Le format n'a d'intérêt que si l'on peut en produire. Les réglages proposent un
**prompt de 9 000 signes, copiable d'un bouton** : on le colle dans l'IA de son
choix, on joint son document, on récupère le fichier.

Il décrit la grammaire entière, y compris les six règles qui font rejeter un
import — chacune avec sa raison, car un modèle respecte bien mieux une
contrainte dont il comprend l'objet. Il demande aussi de regrouper par thème
plutôt que par ordre d'apparition, et de n'écrire que ce qui figure dans le
document : l'application ancre durablement ce qu'elle présente, y compris une
erreur.

La boucle se referme côté application :

| | |
|---|---|
| **Vérifier sans importer** | analyse et rend son verdict sans rien écrire — indispensable pour itérer, un import partiel empêchant de recommencer proprement |
| **Copier le rapport pour ton IA** | prépare une demande de correction : les erreurs avec leurs lignes, les règles rappelées, la consigne de rendre le fichier entier |

Des tests analysent l'exemple du prompt avec le vrai parseur et vérifient que
les barèmes cités existent encore. Sans eux, prompt et parseur dériveraient en
silence et l'on recevrait des fichiers refusés sans savoir pourquoi.

## Le jeu — « Le Millionnaire »

Un second système, **volontairement étanche** au premier : aucune date de
révision n'est touchée, aucun profil de vitesse alimenté. On peut y passer la
soirée sans rien dérégler.

### Ce qu'il fabrique

Une IA (Gemini, avec la clé de l'utilisateur) lit les questions vérifiées et en
tire quatre variantes de difficulté croissante — sans jamais introduire une
connaissance extérieure :

| | Procédé | Ce qu'on demande |
|---|---|---|
| ① | **durcir** | Mêmes mots, mais trois leurres entièrement neufs |
| ② | **retourner** | Même fait, question posée dans l'autre sens |
| ③ | **appliquer** | Le fait mis en situation : un besoin chiffré, une décision |
| ④ | **analyser** | Raisonner à partir du fait : diagnostic, conséquence, cas limite |

L'opération se fait **une fois** : ensuite le jeu tourne hors ligne, sans clé.
Le résultat s'exporte, pour générer sur un PC et jouer sur un téléphone.

### Les règles

Quinze rangs, de 100 € à 1 000 000 €, et **trois rangs par niveau de
difficulté**. Une bonne réponse fait monter, une mauvaise fait **redescendre** —
sans jamais repasser sous le dernier palier franchi, qui devient un plancher.
La partie ne s'arrête qu'au sommet, ou quand on quitte : c'est un jeu
d'escalade, pas d'élimination.

Chronomètre de 20 s, 30 s puis 45 s selon le rang — un calcul de sous-réseau
demande dix secondes rien que pour être lu. Ces trois durées se règlent depuis
l'engrenage de l'onglet Jeu ; **zéro vaut « aucune limite »**. Le chronomètre
se fige pendant un joker.
Trois jokers : **50:50**, **changer de question**, **indice**. Pas d'« appel à
un ami » ni d'« avis du public » : aucun équivalent honnête hors ligne, et
simuler un sondage en le faisant passer pour de l'information serait un
mensonge.

### Deux mesures qui ont changé la conception

**Les étiquettes de difficulté du modèle sont instables.** D'une formulation de
prompt à l'autre, la difficulté 5 rassemblait 96, 160 ou 191 questions pendant
que la difficulté 3 en comptait plus de 1 200. Les rangs sont donc composés par
**quantiles sur le classement**, pas sur l'étiquette : on demande « les 7 % les
plus durs », ce qui reste valable quelle que soit l'échelle.

**Le modèle place la bonne réponse en A ou B dans plus de 80 % des cas** — et
jamais en D sur 60 variantes mesurées. Aucune consigne n'y change rien, alors
les propositions sont brassées à l'affichage, avec une graine dérivée de
l'identifiant.

## Ce que la simulation démontre

`npm run simuler` fait réviser 300 cartes pendant 180 jours à un apprenant
synthétique dont la vraie mémoire est connue de la simulation seule, et suit un
modèle différent de celui du moteur — sinon on ne prouverait que sa cohérence
interne.

Groupe témoin : la même campagne où la note ignore le temps de réponse
(juste = Correct, faux = Encore), comme le ferait une application naïve.

| Mesure | Notation déduite | Témoin aveugle |
|---|---|---|
| Erreur de calibration | **4,8 %** | 7,1 % |
| Rétention obtenue | **87,1 %** | 85,2 % |
| Cartes acquises (S ≥ 30 j) | **158 / 300** | 133 / 300 |
| Révisions dépensées | 3 652 | 3 368 |
| **Acquises pour 100 révisions** | **4,33** | 3,95 |

La notation déduite fait apprendre 19 % de cartes en plus pour 8 % de
révisions en plus — donc un meilleur rendement, pas seulement plus de travail.

Le contrôle décisif reste celui-ci : la récupérabilité **réelle** moyenne,
rangée par note déduite.

```
Encore      49,7 %
Difficile   75,2 %
Correct     83,7 %
Facile      92,3 %
```

L'ordre est strictement croissant : une note fabriquée à partir du seul temps
de réponse porte bien une information sur l'état réel de la mémoire. C'est
l'hypothèse de départ, et elle tient.

## Régler un paramètre par l'expérience, pas à l'intuition

`npm run balayage` fait varier un réglage et relance une campagne complète à
chaque valeur, sur trois apprenants différents. Exemple sur la zone morte de la
notation — l'écart minimal exigé avant de s'écarter de « Correct » :

| marge | rendement | calibration | % de « Difficile » |
|---:|---:|---:|---:|
| 0 ms | **4,91** | **4,6 %** | 35,7 % |
| 100 ms | 4,84 | 5,0 % | 35,0 % |
| 300 ms | 4,49 | 5,9 % | 22,2 % |
| 700 ms | 4,40 | 5,8 % | 12,6 % |
| 3000 ms | 4,61 | 5,9 % | 7,8 % |

Conclusion retenue, contre l'intuition de départ : une zone morte large **coûte**
du rendement sans rien apporter. La dispersion réelle des temps de réponse est
large — elle vient de la mémoire, pas du bruit moteur. On ne garde qu'un
plancher de 100 ms contre les distributions dégénérées.

## Déploiement

Rien à construire : `vercel.json` sert le dossier tel quel et redirige `/` vers
`/app/`. Il impose aussi un `Cache-Control: no-cache` sur le service worker —
sans quoi une version périmée resterait collée chez les visiteurs.

## Reste à faire

- [ ] Vérifier les poids FSRS contre l'implémentation de référence
- [ ] `calibration.js` — réajuster les poids sur l'historique de l'utilisateur
- [ ] Une seconde passe de vérification sur les variantes « analyser », les
      seules où le modèle raisonne au lieu de reformuler
- [ ] Supprimer un recueil depuis l'interface — aujourd'hui c'est tout ou rien
- [ ] Icônes PNG (le manifeste n'a que du SVG ; suffisant sur Chrome, à
      compléter pour une installation iOS soignée)
