# Questionnaire d'évaluation v2 : conception

> Statut : **proposition à valider** avant implémentation. Les questions v1 pertinentes sont
> reprises (marquées `← A1` etc.). Les questions sur les biais cognitifs viendront dans une
> version ultérieure : le thème « Équité & biais » est prévu pour les accueillir.
>
> **v2.1 (2026-09-09)** : ajout du thème 6 « Biais cognitifs et algorithmiques » (BI1–BI8),
> d'après le cours 5. Aucun code de question existant n'a changé ; les thèmes suivants sont
> renumérotés.
>
> **v2.3 (2026-09-10)** : thème **Gouvernance FinOps** (GF1–GF7), d'après le brief métier.
> Il ne compte pas dans le score sur 100 : il produit un **ajustement** de −4 à +4 points, et
> alimente l'**estimation d'empreinte** affichée à l'étape « Résultat ». Il remplace le F6 de la
> v2.2, qui traitait le même sujet de façon moins précise.
>
> **v2.5 (2026-09-11)** : deux questions de gouvernance ajoutées pour rendre l'estimation
> d'empreinte calculable plutôt que forfaitaire : **GF10** (longueur typique d'un échange, en
> tokens) et **GF11** (volume de données par cycle d'entraînement). GF8 et GF9 demandent désormais
> les paramètres **actifs** et non le total : dans un modèle à mélange d'experts, seule une fraction
> des poids travaille à chaque token. La justification de GF5 a été corrigée : elle affirmait que
> l'entraînement pesait plus que l'inférence, ce que les mesures récentes contredisent pour un
> modèle réellement déployé. Aucune question n'est notée dans ce thème : il reste hors score.
>
> **v2.4 (2026-09-11)** : trois questions notées ajoutées, aucun code existant renommé.
> **T5** porte sur l'accessibilité numérique (RGAA) de l'interface ; **F6** et **F7** sur
> l'allègement du modèle lui-même (quantification, élagage, distillation). **F4** est recentrée
> sur les optimisations d'exécution : elle mentionnait « modèle distillé ou quantifié », ce qui
> recouvrait désormais F6 et F7 et rendait la réponse ambiguë.

## 1. Principes

| Principe | Décision |
| --- | --- |
| Échelle | Score sur **100**, calculé sur les seules questions applicables au parcours |
| Verdict | **0–60** non conforme (non déployable) · **61–85** partiellement conforme (test / pilote) · **86–100** conforme (production) |
| Dynamique | Une étape de **cadrage** en tête oriente le parcours : chaque réponse active ou masque des blocs de questions |
| Blocages | Deux situations arrêtent l'évaluation sans score : domaine militaire/défense/sécurité nationale, et pratiques interdites par l'AI Act si déploiement dans l'UE |
| Plafonds | Une question **critique** répondue « Non » plafonne le score à **60** (non déployable), au lieu de le mettre à zéro comme en v1 : on conserve l'information sur le reste |
| Recommandations | Chaque point perdu produit une action ; la synthèse les classe par **points récupérables** |
| Par pays | Le bloc réglementaire est découpé par pays de déploiement, avec une barre d'avancement par pays (« 15/20 ») et ses propres recommandations |

### Barème

Chaque question rapporte **Oui = 100 % · Partiellement = 50 % · Non = 0 %** de ses points.
Le poids d'une question dépend de son importance :

| Poids | Points | Usage |
| --- | --- | --- |
| Critique | 4 | Manquement rédhibitoire pour une mise en production (plafond 60 si « Non ») |
| Standard | 2 | La grande majorité des questions |
| Mineur | 1 | Bonnes pratiques |

**Score = 100 × points obtenus / points applicables.** Une question masquée par le cadrage ne compte
ni au numérateur ni au dénominateur : un outil interne simple a moins d'obligations qu'un système
à haut risque, et c'est normal. Les sous-scores par thème et par pays se calculent de la même
façon sur leur périmètre.

> **Le barème ne s'affiche pas.** Les poids ci-dessus servent au calcul, pas à la saisie : le
> formulaire ne met plus de pastille « 4 pt » sur les réponses. Deux raisons : la personne qui
> répond n'a pas à viser la note plutôt qu'à décrire la réalité, et les points bruts se
> contredisaient visuellement avec le score (une réponse à 4 pt fait monter un parcours de 48
> points de 8, pas de 4). L'interface ne parle donc que d'une seule échelle, celle sur 100 :
> score global, pourcentages par thème et par pays, et gains des recommandations.

### Exemple de parcours

| Cas | Cadrage | Questions notées | Points max |
| --- | --- | --- | --- |
| Outil interne, pas de données perso, non génératif, UE seule | `C1=UE · C3=Aucun · C4=Non · C5=Ni l'un ni l'autre · C6=interne` | 29 | 56 |
| Chatbot client GenAI, données perso, UE + US | `C1=UE,US · C3=Aucun · C4=Oui · C5=Les deux · C6=API` | 42 | 84 |
| Tri de CV (emploi = haut risque), données sensibles, UE + US + Chine | `C1=UE,US,CN · C3=Emploi · C4=Oui · C5=Ni l'un ni l'autre · C6=fine-tuning · D1=Non` | 49 | 105 |

Chiffres recalculés en v2.1 (le thème 6 ajoute 8 à 14 points selon le parcours). Le cadrage est
donné pour que ces trois lignes soient reproductibles : `applicableQuestions()` sur ces réponses.

Le formulaire annonce la durée estimée dès le cadrage terminé.

---

## 2. Arbre de décision

```
CADRAGE (non noté)
 ├─ C1 Pays de déploiement ─────────────► active les blocs UE / US / CN / Autre
 ├─ C2 Domaine militaire / défense ? ──► OUI = BLOCAGE (hors politique IA)
 ├─ C3 Domaine à fort enjeu ? ─────────► active « Systèmes critiques » + questions sectorielles US
 ├─ C4 Données personnelles ? ─────────► active RGPD / PIPL / lois d'État US, AIPD
 ├─ C5 Génère du contenu / interagit ? ► active transparence, marquage, deep synthesis
 └─ C6 Origine du modèle ──────────────► active fournisseur tiers, GPAI, sécurité GenAI

THÈMES NOTÉS
 1 Nécessité & proportionnalité      toujours
 2 Données & vie privée              élargi si C4
 3 Transparence & explicabilité      élargi si C5
 4 Supervision humaine & robustesse  élargi si C3
 5 Équité & biais                    toujours
 6 Biais cognitifs & algorithmiques  toujours, élargi si C3 / C5 / C6
 7 Sécurité                          élargi si C5 / C6
 8 Frugalité & FinOps                toujours
 9 Réglementation                    un sous-bloc par pays de C1
    ├─ UE   : AI Act (dont art. 5 = BLOCAGE), RGPD, maîtrise de l'IA
    ├─ US   : sectoriel (emploi, biométrie, santé, crédit), lois d'État, FTC
    ├─ CN   : enregistrement CAC, marquage, PIPL, localisation des données
    └─ Autre: revue juridique locale
```

---

## 3. Étape 0 : Cadrage (non noté)

| Code | Question | Réponses | Effet |
| --- | --- | --- | --- |
| C1 | Dans quels pays / zones l'application sera-t-elle déployée ou utilisée ? | Choix multiple : UE · États-Unis · Chine · Autre | Active les blocs pays. Au moins un choix requis. |
| C2 | L'application est-elle **exclusivement** destinée à un usage militaire, de défense ou de sécurité nationale ? | Oui / Non | **Oui → BLOCAGE** : « Hors périmètre de la politique IA de l'entreprise ». Évaluation refusée, statut non conforme, motif enregistré. |
| C3 | L'application intervient-elle dans un domaine à fort enjeu pour les personnes ? | Choix multiple : Santé · Biométrie / identification · Emploi, RH, recrutement · Éducation, examens · Crédit, assurance, accès à des services essentiels · Justice, forces de l'ordre, migration · Infrastructures critiques · **Aucun** | Active le bloc « systèmes critiques » (S2, S6, D3), les questions de biais BI1 et BI5, et les questions sectorielles US. Correspond aux domaines « haut risque » de l'annexe III de l'AI Act. |
| C4 | L'application traite-t-elle des données personnelles (directement ou via ses données d'entraînement) ? | Oui / Non | Active D2, D3, D6, UE5, UE6, US7, CN3, CN4 |
| C5 | L'application génère-t-elle du contenu (texte, image, audio, vidéo) ou interagit-elle directement avec des personnes ? | Génère du contenu · Interagit (chatbot, assistant) · Les deux · Ni l'un ni l'autre | Active T1, T3, BI4, BI5, SE2, UE4, CN1, CN2, CN6 |
| C6 | D'où vient le modèle ? | Développé en interne · Modèle tiers ajusté (fine-tuning) · API d'un fournisseur (OpenAI, Mistral, Anthropic…) · Modèle ouvert hébergé par nous | Active SE3, UE7, D5, BI2 |

Ces réponses sont **enregistrées** avec l'évaluation (elles remplacent les « informations préliminaires »
de la v1, qui restent : outil & éditeur, finalité, criticité métier).

---

## 4. Thèmes notés

Légende : **●** critique (4 pts, plafond 60 si Non) · ○ standard (2 pts) · · mineur (1 pt) · `[si …]` condition d'affichage

### Thème 1 : Nécessité et proportionnalité

| Code | Q | Question | Recommandation si insuffisant |
| --- | --- | --- | --- |
| N1 | ● | **Un algorithme d'IA est-il vraiment nécessaire ?** Une approche plus simple (règles métier, statistiques classiques, processus humain) a-t-elle été comparée ? *Oui, l'IA est justifiée après comparaison / Partiellement, sans comparaison formelle / Non, une solution plus simple suffirait* | Documenter la comparaison avec une solution non-IA ; si elle est équivalente, la privilégier : moins de risque, de coût et d'empreinte. |
| N2 | ○ | Le modèle est-il proportionné au besoin ? (pas de LLM massif pour une classification simple) `← D2` | Comparer à des alternatives plus légères à qualité équivalente et documenter le choix. |
| N3 | ○ | La finalité est-elle précise, écrite et limitée : l'usage réel ne dérive pas de l'usage déclaré ? | Rédiger une finalité limitative et prévoir une revue à chaque évolution d'usage. |
| N4 | ○ | La tâche présente-t-elle les caractéristiques qui rendent une IA pertinente : volume important, données non structurées, grande variabilité des cas, absence de règles explicites ? *Au moins deux, écrites / une seule ou non documentée / la tâche se décrit en règles* | Décrire la tâche par des chiffres (volume mensuel, nature des données, part de cas atypiques) et vérifier qu'une règle métier ne suffirait pas. |
| N5 | ○ | Le gain attendu est-il chiffré, avec une mesure de référence prise avant l'IA (temps passé, taux d'erreur, volume traité) ? *Référence et cible chiffrées / gain annoncé sans référence / non chiffré* | Mesurer la situation actuelle sur un échantillon représentatif et fixer une cible chiffrée avant le déploiement. |
| N6 | ○ | **ROI** : coûts de mise en œuvre et coûts récurrents (licences, appels d'API, infrastructure, supervision, maintenance) comparés aux gains chiffrés ? *Coûts complets et horizon de rentabilité / estimation partielle / aucune* | Poser un calcul sur 12 à 24 mois : coûts (repris du suivi FinOps) face aux gains mesurés, et à partir de quand l'application devient rentable. |
| N7 | · | Le bénéfice réel sera-t-il mesuré après mise en production, avec une décision explicite (poursuivre, corriger, arrêter) si la cible n'est pas atteinte ? | Programmer une revue à trois ou six mois : comparer les gains mesurés à la cible et acter la suite. |

> **Utilité et ROI (N4–N7).** N1 seul répondait « oui/non » à une question qui n'est pas binaire.
> Les quatre questions suivantes la décomposent : la tâche relève-t-elle vraiment de l'IA (N4),
> le gain est-il mesuré avant (N5), le coût complet est-il rapproché du gain (N6), et le bilan
> sera-t-il fait après (N7). N6 se lit avec le module FinOps, qui porte les coûts réels mensuels.

### Thème 2 : Données et vie privée

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| D1 | ● | `[si C4]` L'application est-elle exempte de traitement de données sensibles (santé, opinions, biométrie…) sans accord explicite du DPO ? `← A2` | Recenser les catégories, supprimer ou anonymiser le non nécessaire, faire valider le résidu par le DPO. |
| D2 | ○ | `[si C4]` Base légale identifiée et minimisation appliquée (on ne collecte que le nécessaire) ? | Documenter la base légale par traitement ; supprimer les champs sans finalité. |
| D3 | ○ | `[si C4 et (C3 ≠ Aucun ou D1 ≠ Oui)]` Une analyse d'impact (AIPD / DPIA) a-t-elle été réalisée ? | Conduire une AIPD avec le DPO avant tout déploiement. |
| D4 | ● | Les données sont-elles hébergées dans une zone validée par l'entreprise ? `← A1` | Documenter la zone auprès de l'éditeur ; migrer ou obtenir une dérogation écrite du DPO. |
| D5 | ○ | `[si C6 ≠ API tierce]` Données d'entraînement : provenance licite, droits d'usage vérifiés, documentation disponible ? | Constituer une fiche de provenance des jeux de données (source, licence, date, biais connus). |
| D6 | · | `[si C4]` Durée de conservation définie et droits des personnes (accès, effacement, opposition) opérationnels ? | Définir les durées et une procédure de réponse aux demandes sous un mois. |

### Thème 3 : Transparence et explicabilité

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| T1 | ● | `[si C5 ≠ Ni l'un ni l'autre]` Les personnes sont-elles informées qu'elles interagissent avec une IA ou reçoivent des résultats générés par une IA ? `← B1` | Ajouter une mention légale visible sur l'interface indiquant que les résultats sont générés par intelligence artificielle. |
| T2 | ○ | Le Process Owner peut-il expliquer globalement comment l'IA produit ses résultats ? `← B2` | Obtenir une note d'explicabilité de l'éditeur (type de modèle, données, limites) et former le Process Owner. |
| T3 | ○ | `[si C5 génère]` Les contenus générés sont-ils marqués (filigrane, métadonnées, mention) ? | Activer le marquage natif du fournisseur ou ajouter une mention systématique. |
| T4 | · | Une documentation technique existe-t-elle (fiche modèle, performances mesurées, limites connues) ? | Rédiger une fiche modèle d'une page, mise à jour à chaque version. |
| T5 | ○ | `[si C5 ≠ Ni l'un ni l'autre]` L'interface par laquelle les personnes utilisent l'IA ou en reçoivent les résultats est-elle conforme au **RGAA** (accessibilité numérique) ? | Faire auditer les écrans selon le RGAA, corriger au minimum les critères de niveau A et AA, puis publier la déclaration d'accessibilité. |

T5 est posée sous la même condition que T1 : s'il n'y a ni interaction ni contenu généré, il n'y a
pas d'écran par lequel l'IA atteint quelqu'un. Elle est placée dans « Transparence » et non dans
« Équité » parce qu'elle porte sur l'accès à l'information produite, pas sur la façon dont le modèle
traite les personnes : une réponse qu'un lecteur d'écran ne restitue pas n'est une réponse pour
personne, quelle que soit la qualité du modèle.

### Thème 4 : Supervision humaine et robustesse

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| S1 | ● | Un humain valide-t-il les décisions à effet significatif avant application ? `← C1` | Instaurer une validation humaine obligatoire, avec traçabilité du validateur. |
| S2 | ○ | `[si C3 ≠ Aucun]` Les personnes concernées disposent-elles d'un recours : contester une décision, obtenir une explication, parler à un humain ? | Publier une procédure de recours et l'afficher au point de décision. |
| S3 | ○ | Des tests de robustesse ont-ils été menés (cas limites, entrées inattendues, dérive dans le temps) ? | Constituer un jeu de tests de non-régression et le rejouer à chaque mise à jour du modèle. |
| S4 | ○ | Les décisions et sorties de l'IA sont-elles journalisées de façon à permettre un audit a posteriori ? | Journaliser entrée, sortie, version du modèle et horodatage, avec une durée de conservation définie. |
| S5 | ○ | `[si C3 ≠ Aucun]` Un plan existe-t-il en cas d'erreur ou d'indisponibilité de l'IA (procédure dégradée, correction, communication) ? | Rédiger un plan d'incident : qui décide d'arrêter, comment on revient en arrière, qui informe les personnes. |

### Thème 5 : Équité et biais

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| E1 | ○ | Des tests ont-ils été réalisés pour vérifier que l'IA ne reproduit pas de biais discriminatoires ? `← C2` | Campagne de tests par population (genre, âge, origine, handicap…), résultats documentés, revue annuelle. |
| E2 | ○ | `[si C3 ≠ Aucun]` Les populations affectées et les critères d'équité retenus sont-ils définis par écrit ? | Nommer les groupes à protéger et la métrique d'équité (parité, égalité des chances…) avant les tests. |
| E3 | · | Les utilisateurs sont-ils formés aux limites de l'IA pour éviter une confiance excessive (automation bias) ? | Intégrer un module « limites et bonnes pratiques » à la formation des utilisateurs. |

> Les biais **cognitifs** (ancrage, effet de halo) et l'origine des biais algorithmiques font
> l'objet du thème 6, ajouté en v2.1.

### Thème 6 : Biais cognitifs et algorithmiques

Ajouté en v2.1, d'après le cours 5 « Impact sociétal et éthique ». Le thème 5 mesure le
**résultat** (l'IA discrimine-t-elle ?) ; celui-ci s'intéresse aux **causes** et aux **moyens de
détection**. Deux familles de biais, traitées ensemble parce qu'elles se nourrissent l'une l'autre :

| | Biais cognitifs (humains) | Biais algorithmiques |
| --- | --- | --- |
| Origine | Heuristiques, émotions, expérience | Données biaisées, conception du modèle, choix des variables |
| Nature | Distorsion du jugement | Distorsion des prédictions ou des recommandations |
| Exemples | Confirmation, ancrage, effet de halo | Discrimination genre/âge, sur-représentation d'un groupe |
| Traitement | Formation, prise de conscience, relecture externe | Audit des données, métriques d'équité, explicabilité |

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| BI1 | ● | `[si C3 ≠ Aucun]` Les données sur lesquelles repose le système ont-elles été analysées pour y chercher des biais (sur-représentation, décisions passées discriminatoires, période ou zone non représentative) ? | Mesurer la représentation de chaque groupe et la comparer à la population réelle ; rééquilibrer. Modèle fourni : exiger sa fiche de données. |
| BI2 | ○ | `[si C6 ≠ API tierce]` Le processus de collecte et d'annotation est-il documenté : qui annote, selon quelles consignes écrites, avec quel contrôle de cohérence ? | Guide d'annotation, double annotation d'un échantillon, mesure du taux d'accord, correction des consignes. |
| BI3 | ○ | Le poids réel de chaque variable dans les résultats a-t-il été examiné, pour repérer une variable qui pèse anormalement lourd ? *Oui, avec SHAP/LIME ou équivalent / lecture manuelle des pondérations / poids inconnu* | Analyser la contribution des variables (SHAP, LIME) sur un échantillon représentatif ; normaliser ou repondérer celles qui dominent. |
| BI4 | ○ | `[si C5 ≠ Ni l'un ni l'autre]` Les consignes système et les exemples fournis au modèle ont-ils été testés en faisant varier leur ordre et leur formulation ? | Rejouer un jeu de cas de référence en permutant l'ordre des exemples et en reformulant la consigne ; figer la formulation retenue. |
| BI5 | ○ | `[si C3 ≠ Aucun ou C5 génère]` L'effet d'un signe de prestige (école, diplôme, marque, service d'origine, ancienneté) sur les résultats a-t-il été testé ? | Rejouer des cas identiques en ne changeant que ce signe ; si le résultat bouge, réduire le poids de la variable, la retirer ou la masquer. |
| BI6 | ○ | Les biais détectés donnent-ils lieu à une correction mise en œuvre, puis à une nouvelle mesure qui vérifie qu'elle a fonctionné ? | Registre des biais : mesure initiale, correction appliquée, mesure après correction, date et responsable. |
| BI7 | · | Les personnes qui conçoivent et valident le système sont-elles sensibilisées à leurs propres biais cognitifs (confirmation, ancrage, halo) ? | Module « biais cognitifs » dans la formation de l'équipe projet ; relecture des variables et critères par une personne extérieure. |
| BI8 | · | Les biais sont-ils remesurés périodiquement après la mise en production, sur les données réellement traitées ? | Remesure au moins annuelle sur les données de production, rattachée à la revue de conformité. |

> **Pourquoi BI1 est critique.** Le cours en fait la première cause de biais algorithmique : un
> modèle appris sur les décisions passées d'une organisation en reproduit les discriminations et
> les applique désormais à grande échelle. La question n'est posée qu'en domaine à fort enjeu
> (C3), là où la conséquence est directe pour les personnes.
>
> **Répartition.** 16 points au maximum, soit environ 15 % du score sur les parcours types :
> comparable au thème « Données & vie privée ». Cinq questions sur huit sont posées sur tous les
> parcours ; les trois autres suivent le cadrage.
>
> **À ne pas confondre avec le thème 5.** E1 demande *si* des tests de biais ont été faits, E2 *sur
> quelles populations*, E3 porte sur l'excès de confiance des utilisateurs (automation bias). Le
> thème 6 demande *d'où vient le biais* et *comment on le voit*.

### Thème 7 : Sécurité

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| SE1 | ○ | L'accès à l'outil est-il restreint par le SSO avec une gestion stricte des permissions ? `← A3` | Raccorder au SSO, définir des profils par rôle, revoir les habilitations périodiquement. |
| SE2 | ○ | `[si C5 ≠ Ni l'un ni l'autre]` L'application est-elle protégée contre les attaques propres à l'IA (injection de prompt, extraction de données, contournement des consignes) ? | Filtrer les entrées, cloisonner les données accessibles au modèle, tester les injections connues. |
| SE3 | ○ | `[si C6 = API tierce]` Le contrat avec le fournisseur interdit-il l'usage de nos données pour entraîner ses modèles et couvre-t-il la confidentialité ? | Vérifier les conditions (opt-out d'entraînement, zone de traitement, sous-traitants) et les faire valider par le juridique. |

### Thème 8 : Frugalité et FinOps

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| F1 | ○ | Les coûts (licences, requêtes API, compute) sont-ils monitorés et plafonnés ? `← D1` | Suivi mensuel et plafond avec alerte, remontés dans le rapport FinOps. |
| F2 | ○ | L'empreinte carbone (entraînement + inférence) a-t-elle été estimée ? | Estimer avec un outil (CodeCarbon, calculateur du fournisseur) et suivre l'évolution. |
| F3 | ○ | Où tourne l'IA ? *On-premise ou cloud en région bas-carbone / Cloud sans critère carbone / Inconnu* | Choisir une région à faible intensité carbone ; documenter le choix. |
| F4 | · | Des optimisations **d'exécution** réduisent-elles la consommation (cache des réponses, traitement par lots) ? | Mettre en place un cache des réponses fréquentes et regrouper les appels en lots. |
| F5 | · | Le volume d'appels est-il maîtrisé (pas d'appels redondants ou inutiles) ? | Auditer les appels sur une semaine et supprimer les redondances. |
| F6 | · | `[si C6 ≠ API d'un fournisseur]` Le modèle est-il déployé en **précision réduite** (quantification en 8 bits ou moins) quand la qualité mesurée le permet ? | Mesurer la qualité du modèle quantifié (int8) sur un jeu de test représentatif et déployer la version réduite si l'écart reste acceptable. |
| F7 | · | `[si C6 ≠ API d'un fournisseur]` A-t-on cherché à **alléger le modèle lui-même** (élagage/pruning, distillation) plutôt que de déployer le modèle d'origine ? | Comparer le modèle d'origine à une version élaguée ou distillée sur le cas d'usage réel, et retenir la plus petite qui tienne la qualité attendue. |

F4 et F5 portent sur la façon d'**appeler** le modèle, F6 et F7 sur le modèle **lui-même**. La
distinction n'est pas cosmétique : un cache ne réduit que les appels répétés, là où un modèle
quantifié ou élagué réduit le coût de *chaque* inférence : c'est l'économie qui tient quand l'usage
augmente. Les deux dernières ne s'affichent que si le modèle tourne chez nous (C6) : derrière l'API
d'un fournisseur, on ne choisit ni les poids ni le format d'exécution, et poser la question
n'apporterait qu'un « Non » qui ne veut rien dire.
### Thème 9 : Gouvernance FinOps *(hors score)*

Ce thème **ne compte pas dans le score sur 100**. Les quatre premières questions produisent un
**ajustement** de −4 à +4 points appliqué au score ; les trois dernières ne sont pas notées du tout,
elles alimentent l'estimation d'empreinte. Toutes sont **exigées à la soumission**.

| Code | Question | Effet |
| --- | --- | --- |
| GF1 | Type de reporting FinOps prévu ? *Tableau de bord automatique / rapport manuel / aucun* | +1 / 0 / −1 |
| GF2 | À quelle fréquence ? *Mensuelle ou plus / trimestrielle ou annuelle / aucune* | +1 / 0 / −1 |
| GF3 | Quelles mesures sont suivies ? *Coût · Énergie · CO₂* (choix multiple) | +1 si les trois · −1 si aucune |
| GF4 | À qui le reporting est-il diffusé ? *Gouvernance / équipe projet / personne* | +1 / 0 / −1 |
| GF5 | Fréquence d'entraînement ? *Jamais / une fois / périodique / continu* | alimente l'estimation |
| GF6 | Volume d'inférence mensuel ? *< 1 000 / < 100 k / < 10 M / > 10 M* | alimente l'estimation |
| GF7 | Région d'hébergement ? *On-premise / cloud bas carbone / standard / forte intensité / inconnu* | alimente l'estimation |
| GF8 | Taille du modèle ? *Petit < 1 Md / moyen 1–20 Md / grand > 20 Md / inconnue* | alimente l'estimation |
| GF9 | Taille exacte, si connue *(champ chiffré, facultatif)* | remplace la tranche de GF8 |

> **« L'approche FinOps ajoute ou supprime des points, mais ne rend pas la solution non conforme. »**
> Deux garde-fous appliquent cette règle dans `scoreEvaluation` :
>
> 1. un malus ne fait **jamais** passer sous le seuil de conformité partielle une application qui
>    était au-dessus (`finops.floored` le signale) ;
> 2. un bonus ne défait **jamais** le plafond d'un critère critique manqué : le plafond est appliqué
>    en dernier.
>
> Le score de base reste visible à côté du score ajusté (`finops.baseScore`) : l'écart doit se lire.

> **Les options nomment ce qu'elles recouvrent.** GF7 ne demande pas « une région bas carbone » sans
> dire laquelle : chaque option cite des régions réelles (Stockholm, Dublin, Varsovie…) et
> **l'intensité carbone que le calcul retiendra**. Idem pour GF8, qui donne des exemples de modèles
> par tranche. Ces précisions sont rattachées au bouton radio par `aria-describedby`, pas seulement
> posées à côté. Un test vérifie que chaque option de GF7 a sa précision et une intensité connue du
> modèle de calcul : une option qui ne calculerait rien serait un piège.

### Thème 9 : Réglementation par pays

Un sous-bloc par pays coché en C1. Chaque sous-bloc a **sa barre d'avancement** (en pourcentage de son
périmètre) et **ses recommandations**. Pour le score global, le thème compte comme les autres (ses
points s'ajoutent), et un pays faible se voit immédiatement.

> ⚠️ Contenu réglementaire à **faire valider par un juriste** et à dater : les obligations évoluent
> (calendrier d'application de l'AI Act, lois d'État américaines, mesures chinoises). Le
> questionnaire pointe les sujets ; il ne remplace pas une analyse juridique.

#### Bloc UE : AI Act et RGPD

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| UE1 | **BLOCAGE** | L'application met-elle en œuvre une **pratique interdite** (art. 5 AI Act) : notation sociale, manipulation ou exploitation de vulnérabilités, catégorisation biométrique par attributs sensibles, reconnaissance des émotions au travail ou en formation, identification biométrique à distance en temps réel dans l'espace public, constitution de bases faciales par moissonnage ? | **Oui → évaluation refusée** : « Pratique interdite dans l'UE (art. 5 AI Act) ». |
| UE2 | ○ | La classification de risque AI Act a-t-elle été faite et documentée (risque inacceptable / haut / limité / minimal) ? | Réaliser et écrire la classification ; en cas de doute, consulter le juridique. |
| UE3 | ● | `[si C3 ≠ Aucun]` Système probablement à **haut risque** (annexe III) : les obligations sont-elles couvertes : gestion des risques, gouvernance des données, documentation technique, enregistrement dans la base UE, évaluation de conformité ? | Lancer le chantier de conformité haut risque avec le juridique ; ne pas déployer avant. |
| UE4 | ○ | `[si C5 ≠ Ni l'un ni l'autre]` Obligations de transparence (art. 50) : information des personnes, marquage des contenus synthétiques et des hypertrucages ? | Ajouter l'information et le marquage prévus par l'art. 50. |
| UE5 | ○ | `[si C4]` RGPD : traitement inscrit au registre, base légale, AIPD si requise, DPO consulté ? | Compléter le registre et consulter le DPO. |
| UE6 | ○ | `[si C4]` Les transferts de données hors UE sont-ils encadrés (décision d'adéquation, clauses contractuelles types) ? | Cartographier les transferts et mettre en place les garanties. |
| UE7 | · | `[si C6 = API tierce ou modèle ouvert]` Le fournisseur du modèle général respecte-t-il ses obligations GPAI (documentation, politique droits d'auteur, résumé des données d'entraînement) ? | Demander la documentation GPAI au fournisseur. |
| UE8 | · | Le personnel qui utilise ou supervise l'IA a-t-il reçu une formation (maîtrise de l'IA, art. 4) ? | Organiser une sensibilisation adaptée aux rôles. |

#### Bloc États-Unis : patchwork fédéral et lois d'État

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| US1 | ● | `[si C3 ∋ Emploi]` Outil de décision d'emploi automatisé : audit de biais indépendant annuel et notification des candidats (NYC Local Law 144 et lois similaires) ? | Commander un audit de biais et publier la notification requise. |
| US2 | ● | `[si C3 ∋ Biométrie]` Consentement écrit préalable et politique de conservation pour les données biométriques (Illinois BIPA, Texas, Washington) ? | Mettre en place le consentement écrit et la politique publiée. |
| US3 | ● | `[si C3 ∋ Santé]` Données de santé protégées : conformité HIPAA (accords de sous-traitance, sécurité, usage minimal) ? | Conclure les BAA avec les fournisseurs et documenter les mesures. |
| US4 | ○ | `[si C3 ∋ Crédit]` Décisions de crédit ou d'assurance : motifs de refus explicables et non-discrimination (FCRA, ECOA) ? | Produire des motifs de refus lisibles et tester la discrimination par proxy. |
| US5 | ○ | `[si C3 ≠ Aucun]` Lois d'État sur l'IA à haut risque (Colorado AI Act…) : analyse d'impact, notification des personnes, prévention de la discrimination algorithmique ? | Réaliser l'analyse d'impact et prévoir la notification. |
| US6 | ○ | La communication sur les capacités de l'IA est-elle exacte et non trompeuse (FTC Act §5) ? | Relire les supports marketing et documentations avec le juridique. |
| US7 | ○ | `[si C4]` Droits des consommateurs (CCPA/CPRA et lois d'État) : opt-out des décisions automatisées, accès, suppression ? | Offrir l'opt-out et une procédure d'accès / suppression. |

#### Bloc Chine : CAC, PIPL, localisation

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| CN1 | ● | `[si C5 ≠ Ni l'un ni l'autre]` Service accessible au public : enregistrement de l'algorithme auprès de la CAC et évaluation de sécurité réalisés (mesures provisoires IA générative) ? | Engager la procédure d'enregistrement avec un conseil local. |
| CN2 | ○ | `[si C5 génère]` Marquage explicite et implicite des contenus synthétiques (mesures d'étiquetage 2025, dispositions deep synthesis) ? | Mettre en place les deux niveaux de marquage. |
| CN3 | ○ | `[si C4]` PIPL : consentement séparé pour les données sensibles, analyse d'impact, désignation d'un responsable ? | Adapter les parcours de consentement et documenter l'analyse. |
| CN4 | ● | `[si C4]` Localisation des données et transfert transfrontalier autorisé (évaluation de sécurité CAC, contrat standard ou certification) ? | Cartographier les flux ; obtenir le mécanisme de transfert adapté avant tout déploiement. |
| CN5 | ○ | `[si recommandation ou classement]` Algorithmes de recommandation : enregistrement et possibilité pour l'utilisateur de désactiver la personnalisation ? | Ajouter l'option de désactivation et vérifier l'enregistrement. |
| CN6 | ○ | `[si C5 génère]` Modération : mécanismes de contrôle des contenus générés conformes aux exigences locales ? | Mettre en place un filtrage et une procédure de signalement. |
| CN7 | ○ | Données d'entraînement : licéité et respect de la propriété intellectuelle documentés ? | Constituer le dossier de provenance exigé. |

#### Bloc Autre pays

| Code | Q | Question | Recommandation |
| --- | --- | --- | --- |
| AU1 | ○ | Une revue juridique locale (protection des données, IA, secteur) a-t-elle été menée pour chaque pays concerné ? | Mandater une revue par pays avant déploiement. |

---

## 5. Résultat et suites

### Verdict

| Score | Verdict | Statut de l'application | Échéance |
| --- | --- | --- | --- |
| **86–100** | Conforme : déployable en production | `compliant` | réévaluation à 12 mois |
| **61–85** | Partiellement conforme : autorisé en test / pilote | `partially_compliant` *(nouveau)* | réévaluation à **6 mois** |
| **0–60**, ou plafonné, ou bloqué | Non conforme : non déployable | `non_compliant` | plan d'action |

Un blocage (C2, UE1) donne le verdict « Refusé » avec le motif ; le score n'est pas calculé.

### Recommandations

- **Par question** : chaque réponse en dessous du maximum porte sa recommandation (colonne de droite
  des tableaux) ; elle devient une action corrective, assignée au Process Owner.
- **Synthèse classée** : « Pour gagner des points » : les actions triées par gain, les critiques
  d'abord ; le gain est annoncé sur l'échelle du score (« +8 pts »). Les cinq premières sont mises
  en avant sur la fiche, toutes sont dans le plan.
- **Par pays** : sous chaque barre de pays, les recommandations de ce bloc uniquement.

### Ce qui change pour le reste de l'application

- Nouveau statut `partially_compliant` : pastille, filtres de l'inventaire, KPI d'accueil (« Conformes »
  devient « Conformes · Partielles · Non conformes »), rapport FinOps par statut, job d'expiration
  (6 mois au lieu de 12 pour ce statut).
- Les évaluations **v1 déjà soumises restent lisibles** telles quelles (le questionnaire est versionné) ;
  toute nouvelle évaluation utilise la v2.

---

## 6. Expérience de saisie

Un **assistant par étapes** (une étape par thème), et non plus une page unique :

- **Cadrage d'abord** ; le nombre de questions retenues et la durée estimée s'affichent dans la
  colonne de droite (« 27 questions vous concernent, environ 15 minutes »), recalculés à chaque réponse.
- Une **liste d'étapes** à gauche : faites (✓), en cours, à venir : les blocs masqués n'y figurent
  pas. Une étape complète garde sa coche même quand on s'y trouve : en reprenant un brouillon on
  retombe sur le cadrage, déjà rempli.
- **Une question à la fois** visuellement (carte), réponses en gros boutons, « Pourquoi cette question ? »
  dépliable, commentaire facultatif.
- **Enregistrement automatique** à chaque changement d'étape : on peut s'interrompre et reprendre.
- **Avancement** sur toutes les étapes notées : une barre pour l'étape affichée (« 3/8 »), une pour
  l'ensemble (« 3/46 »), le nombre de questions restantes avec la durée correspondante, et la liste
  des étapes incomplètes : celle où l'on se trouve y est mise en avant. Le compte porte sur les
  questions *applicables* : il descend quand une réponse de cadrage en masque.
- **Pas de score pendant la saisie.** Le voir monter pousse à répondre pour la note plutôt qu'à
  décrire la réalité : le score, le verdict prévu et les barres par thème et par pays n'apparaissent
  qu'à l'étape « Résultat ». Deux exceptions, signalées sous la question concernée parce qu'elles
  décident de ce qui pourra être déployé et non d'un nombre de points : une réponse **bloquante**
  (l'évaluation sera refusée) et un **critère critique** à « Non » (plafond à 60).
- **Étape finale** : récapitulatif, **impact FinOps** en deux lectures : l'estimation calculée depuis
  le type d'IA, l'usage et l'hébergement (hypothèses affichées), puis le relevé réel s'il existe,
  avec l'écart entre les deux : l'effet de la gouvernance sur le score, le top 5 des actions, puis
  la soumission.
- Clavier : les réponses sont des boutons radio natifs, on avance à la touche Entrée ; le focus se place
  sur la première question de chaque étape.

---

## 7. Décisions à trancher

1. **Nouveau statut « Partiellement conforme »** dans le cycle de vie des applications : recommandé
   (c'est ce que le barème implique), mais c'est un statut de plus que le brief initial.
2. **Plafond à 60 pour les critiques** au lieu du zéro de la v1 : recommandé : on garde l'information.
3. **Échéance de 6 mois** pour le statut partiel (12 mois pour conforme) : proposition.
