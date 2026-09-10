# Architecture

## Vue d'ensemble

```
 Navigateur                       Développement                          Production
 ──────────                       ─────────────                          ──────────
 React (SPA)  ──── /api/* ───►    Vite :5173  ── proxy ──►  Fastify :3000     Fastify :3000
                                  (sert le front)           (API)             (API + client/dist)
                                                               │
                                                               ▼
                                                        SQLite  data/poryg.db
```

- En **développement**, Vite sert le front et relaie `/api/*` vers Fastify : le navigateur ne voit
  qu'une seule origine (`localhost:5173`), ce qui simplifie cookies et CSRF.
- En **production** (`NODE_ENV=production`), Fastify sert lui-même `client/dist` : un seul processus,
  une seule origine, une CSP stricte.

Trois workspaces npm :

| Workspace | Rôle                                                                                          |
| --------- | --------------------------------------------------------------------------------------------- |
| `shared`  | Vérité partagée : rôles/permissions, statuts, référentiels, schémas Zod, types DTO. Pas de build : le TypeScript est importé tel quel par Vite et par `tsx`. |
| `server`  | API Fastify + accès SQLite.                                                                   |
| `client`  | Front React.                                                                                  |

---

## Le serveur

### Cycle d'une requête

```
requête HTTP
 │
 ├─ @fastify/cookie            lit les cookies
 ├─ plugins/security.ts        helmet (en-têtes), rate-limit, hook CSRF (Origin / Sec-Fetch-Site)
 ├─ plugins/auth.ts            hook : cookie de session → request.user (ou null)
 ├─ route                      preHandler : app.requireAuth / app.requirePermission('x:y')
 │    ├─ validate(schema, body)     Zod → 400 VALIDATION_ERROR { fields }
 │    ├─ modules/*.repo.ts          SQL paramétré, transaction, recordAudit()
 │    └─ réponse JSON
 └─ setErrorHandler             toute erreur → { error: { code, message, fields? } }
```

`app.ts` assemble tout cela dans `buildApp()`. `server.ts` l'appelle, lance les jobs périodiques et
écoute. Les tests appellent `buildApp({ dbPath: ':memory:' })` et utilisent `app.inject()` : pas de
port, pas de réseau, une base neuve par test.

### Les routes

| Méthode | Route | Permission | Règle supplémentaire |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | : | 5 tentatives/min/IP |
| POST | `/api/auth/logout` | connecté | |
| GET | `/api/auth/me` | : | renvoie `user: null` si pas de session |
| GET | `/api/auth/providers` | : | dit si le SSO Google est actif |
| GET | `/api/auth/google/start` · `/callback` | : | voir « Le SSO Google » |
| GET | `/api/users` | connecté | annuaire (choix du Process Owner) |
| GET | `/api/applications` | `application:read` | filtres `?q=&status=&domain=&sensitivity=` |
| POST | `/api/applications` | `application:create` | |
| GET | `/api/applications/:id` | `application:read` | brouillon d'autrui → 404 |
| PUT | `/api/applications/:id` | `application:update` | + `canEditApplication` (propriétaire) |
| GET | `/api/applications/:id/history` | `application:history` | |
| POST | `/api/applications/:id/submit` | `application:submit` | + brouillon + propriétaire |
| POST | `/api/applications/:id/delete` | `application:delete` | suppression **logique** |
| POST | `/api/applications/:id/restore` | `application:restore` | rend le statut d'avant |
| GET | `/api/applications/:id/evaluation` | `evaluation:read` | brouillon + historique + plans d'action |
| PUT | `/api/applications/:id/evaluation` | `evaluation:fill` | enregistre un brouillon, sans verdict |
| POST | `/api/applications/:id/evaluation/submit` | `evaluation:decide` | score, verdict, plan d'action |
| POST | `/api/action-plans/:id/done` | `action_plan:execute` | coche / décoche ; **cocher remet l'application en audit** |
| GET | `/api/finops/report` | `finops:read` | rapport global agrégé, `?months=6` (1 à 36) |
| GET | `/api/applications/:id/finops` | `finops:read` | rapport d'une seule application |
| GET | `/api/applications/:id/costs` | `finops:read` | coûts mensuels d'une application |
| PUT | `/api/applications/:id/costs` | `finops:write` | + `canEditCosts` (propriétaire) |
| GET | `/api/dashboard/summary` | `dashboard:read` | indicateurs adaptés au rôle |
| GET | `/api/dashboard/bi` | `dashboard:read` | tableaux de bord BI, `?months=12` (1 à 36) |

`GET /api/applications/:id` renvoie aussi un objet `permissions` (`edit`, `submit`, `delete`,
`restore`, `history`) : le client s'en sert pour n'afficher que les actions réellement possibles,
sans réimplémenter les règles.

### Modules

Un domaine métier = deux fichiers dans `server/src/modules/` :

- `<domaine>.routes.ts` : déclare les routes HTTP, choisit la permission, valide l'entrée, appelle le repo.
- `<domaine>.repo.ts` : SQL, mapping ligne → DTO, transactions, audit. Aucune notion HTTP.

Pour ajouter une fonctionnalité : (1) permission dans `shared/src/roles.ts`, (2) schéma Zod dans
`shared/src/schemas.ts`, (3) migration SQL si besoin, (4) repo, (5) routes, (6) enregistrement dans
`app.ts`, (7) test dans `server/tests/`.

### Erreurs

`lib/http-errors.ts` définit `HttpError(statusCode, code, message, fields?)` et des raccourcis
(`unauthenticated()`, `forbidden()`, `notFound()`, `badRequest()`). Le client reçoit toujours :

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Certains champs sont invalides", "fields": { "name": "…" } } }
```

Les erreurs 5xx sont journalisées côté serveur et renvoyées sans détail (`INTERNAL_ERROR`).

### Audit

`recordAudit(db, { actorId, entity, entityId, action, before, after, ip })` insère dans `audit_log`.
Appelé **dans la transaction** de chaque mutation (création d'application, connexion, déconnexion,
expiration automatique…). `actorId = null` signifie « le système ». La table est en ajout seul :
des triggers SQL interdisent `UPDATE` et `DELETE`.

### Jobs

`jobs/compliance-expiry.ts` : au démarrage puis toutes les 24 h, passe en `in_progress` toute
application `compliant` dont `compliance_valid_until` est dépassé, avec une ligne d'audit.
`server.ts` purge aussi les sessions expirées toutes les heures.

---

## La base de données

- Fichier `data/poryg.db` (chemin configurable via `DB_PATH`), mode WAL, clés étrangères activées.
- Accès via le module intégré **`node:sqlite`** (`DatabaseSync`), API synchrone : `prepare().get()/all()/run()`.
  Les helpers `one`, `all`, `run`, `transaction` de `db/connection.ts` gardent les repos lisibles.
- **Dates** : texte ISO 8601 UTC (`2026-09-08T14:03:12.345Z`), triables et comparables en SQL.
- **Migrations** : `server/src/db/migrations/NNN_nom.sql`, appliquées dans l'ordre par `runMigrations()`
  (table `_migrations`). Toujours **ajouter** un fichier, jamais modifier un fichier joué.
- **Suppression logique** : `status = 'deleted'` + `deleted_by` + `deleted_at`. Des triggers
  `BEFORE DELETE` refusent la suppression physique sur `users`, `applications`, `finops_costs`, `audit_log`.
- **Seed** (`db/seed.ts`) : idempotent (il ne fait rien dès que la base contient une application),
  utilisé par `npm run db:seed`, par les tests, et par `server.ts` au démarrage hors production :
  sinon une base fraîche n'aurait que le schéma et les comptes de démo n'existeraient pas.

Schéma actuel :
- migration 001 : `users`, `sessions`, `applications`, `finops_costs`, `audit_log` ;
- migration 002 : comptes de l'équipe (données, pas de structure) ;
- migration 003 : `evaluations`, `evaluation_answers`, `action_plans` ;
- migration 004 : questionnaire v2 : statut `partially_compliant`, verdict à quatre valeurs,
  réponses en JSON. **Reconstruit trois tables** (SQLite ne sait pas modifier une contrainte CHECK).

Une migration qui commence par `-- migrate: no-transaction` est exécutée hors transaction : c'est le
seul moyen de désactiver les clés étrangères (`PRAGMA foreign_keys` est sans effet dans une
transaction), nécessaire pour reconstruire une table référencée. Le fichier pose lui-même
`BEGIN … COMMIT` autour de la reconstruction, et le runner vérifie `PRAGMA foreign_key_check`
après coup. Procédure et raisons : en-tête de `004_questionnaire_v2.sql`.

### Le rapport FinOps responsable

`modules/finops.repo.ts` fait toutes les agrégations **en SQL** (série mensuelle, répartitions par
application, domaine et statut, couverture) ; le code ne sert qu'à combler les mois sans dépense et
à calculer les parts. Deux partis pris : les applications **supprimées** sont exclues (elles ne
tournent plus), et la règle de visibilité des brouillons s'applique comme partout ailleurs.

Les coûts s'additionnent par **source** (`finops_costs.source`) : une saisie manuelle vient s'ajouter
à un éventuel import automatique, et une nouvelle saisie manuelle remplace la précédente pour le
même mois (`ON CONFLICT … DO UPDATE` sur la contrainte unique `(application, mois, source)`). Le
formulaire de saisie affiche donc toujours ce qui est déjà enregistré pour le mois choisi, sans quoi
le total obtenu serait incompréhensible.

**Le coût du mois voyage avec l'application.** `ApplicationDto.monthlyCostEur` est calculé par une
sous-requête SQL (`strftime('%Y-%m','now')`), ce qui évite un aller-retour supplémentaire pour
l'afficher dans les tableaux. Sans la permission `finops:read`, la colonne SQL vaut littéralement
`NULL` : la donnée n'est pas calculée, pas seulement masquée à l'affichage. `getApplication()` prend
un `user` **optionnel** dont l'absence est le cas le plus restrictif : un appel interne qui l'oublie
ne peut pas provoquer de fuite. Côté client, le tableau retire la colonne quand la valeur est `null`.

**Trois grandeurs, pas une.** Depuis la migration `005`, chaque saisie mensuelle porte le coût
(`amount_eur`), l'énergie (`energy_kwh`) et l'empreinte (`co2_kg`) : le triptyque du FinOps
appliqué à l'IA responsable. Un arbitrage entre un modèle massif et un modèle frugal ne se
tranche pas sur le seul montant de la facture. Les deux nouvelles colonnes ont une valeur par
défaut à 0 : une saisie sans empreinte vaut « zéro connu », et la distinction utile : qui
déclare, qui ne déclare pas : est portée par `coverage.withFootprint`, calculé sur les lignes
dont l'énergie est strictement positive.

**Le carbone n'est jamais calculé en cachette.** Le formulaire *propose* une empreinte à partir
de la consommation (`estimateCo2`, facteur `CO2_KG_PER_KWH` du mix français), dans un champ qui
reste modifiable ; ce qui est enregistré est toujours la valeur validée par la personne. Une
application hébergée ailleurs qu'en France doit corriger la proposition.

**Les trois principes du FinOps structurent la page.** *Visibilité* : la couverture de la donnée,
coûts et empreintes comptés séparément. *Responsabilité* : la dépense par statut de conformité,
par domaine, par application. *Optimisation continue* : les **leviers** (`buildLevers`), déduits
des données et jamais affichés dans le vide : une saisie manquante, une empreinte non déclarée,
ou une réponse en dessous du maximum aux questions de frugalité du questionnaire (N2 modèle
proportionné, F3 hébergement, F4/F5 optimisations et volume). Chaque levier nomme les
applications concernées et la raison : un conseil générique ne se met pas en œuvre.

**Le croisement qui décide.** `frugality` reprend le sous-score du thème « Frugalité et FinOps »
de la dernière évaluation soumise et le rapproche de la dépense du mois : une application chère
**et** mal notée est un arbitrage à poser, pas seulement une ligne de budget. Comme pour les
tableaux de bord BI, la note est **relue** depuis `sections_json` : jamais rejouée avec le
questionnaire d'aujourd'hui.

**Deux rapports, deux échelles.** `buildFinopsReport` couvre toute l'entreprise ;
`buildApplicationFinops` ramène la même lecture à une application, en y ajoutant sa part dans la
dépense du mois et son rang : c'est ce qui transforme un montant brut en information exploitable.
Les totaux de comparaison respectent la visibilité de l'utilisateur, mais l'application demandée est
toujours détaillée (la route a déjà vérifié qu'elle lui est visible).

Deux points de saisie, une seule route (`PUT /api/applications/:id/costs`) :
- la page **FinOps**, avec un sélecteur d'application, pour saisir plusieurs coûts à la suite ;
- la carte **Coûts** de la fiche application (`components/CostEntry.tsx`), où l'application est déjà
  connue : un bouton dévoile un formulaire à deux champs.

Le message d'avertissement est le même des deux côtés : le composant `ExistingCostNotice` est
partagé, pour qu'une évolution de la règle ne soit à faire qu'une fois. Les graphiques mensuels
passent tous par `components/MonthlyBars.tsx`, pour la même raison.

### L'impact FinOps annoncé au questionnaire

Deux lectures, dans cet ordre, sur la carte de l'étape « Résultat » :

**1. L'estimation** (`estimateCarbonFootprint`, shared/finops.ts) : un ordre de grandeur calculé
avant toute mesure, sur la structure demandée par le métier :

```
kWh/an = (inférences × Wh par inférence + entraînements × kWh par entraînement)
         × facteur de taille du modèle × PUE
kg CO₂ = kWh × intensité carbone de la région d'hébergement
```

Les entrées sont le **type d'IA** (pris sur la fiche de l'application), la **fréquence
d'entraînement** (GF5), le **volume d'inférence** (GF6), la **région d'hébergement** (GF7) et la
**taille du modèle** (GF8, ou GF9 si la valeur exacte est connue).

La taille joue en facteur, pas en valeur absolue : l'énergie suit à peu près le nombre de
paramètres à architecture comparable. La référence est 7 milliards ; un modèle déclaré à
70 000 M pèse donc ×10, et le facteur est borné à [0,05 ; 30] : au-delà, la proportionnalité ne
tient plus et le chiffre donnerait une fausse précision. **Une valeur exacte prime toujours sur la
tranche.**
Les coefficients sont des ordres de grandeur assumés, pas des relevés : ils sont renvoyés avec le
résultat (`assumptions`) et **affichés** : une estimation dont on ne voit pas les hypothèses ne se
discute pas. Sans les trois réponses, `complete` vaut `false` et rien n'est affiché.

**2. Le relevé**, décrit ci-dessous. Dès qu'il existe, c'est lui qui fait foi, et l'écart avec
l'estimation est dit en toutes lettres : c'est ce qui permet de corriger le modèle avec le temps.

`estimateFinopsImpact` (finops.repo) accompagne l'étape « Résultat » du questionnaire : coût,
énergie et carbone **projetés sur douze mois** à partir de la moyenne des mois réellement déclarés.

C'est une projection, jamais une prévision inventée. Trois garde-fous :

- **Sans donnée déclarée**, `monthsObserved` vaut 0 : la carte ne montre aucun chiffre, elle dit ce
  qui manque et renvoie à la saisie. C'est exactement ce que la question **F6** demande de mettre en
  place : la boucle se referme entre le questionnaire et le module FinOps.
- **Le carbone déclaré prime.** S'il ne l'est pas, il est calculé depuis la consommation avec
  `CO2_KG_PER_KWH`, et `co2Derived` le signale à l'affichage : un calcul ne doit pas passer pour
  une mesure.
- **`finops:read` garde la donnée à la source** : sans la permission, le champ vaut `null` et rien
  n'est calculé.

L'équivalence en kilomètres (`carKmEquivalent`) sert à se représenter une masse de carbone ; elle
est annoncée comme un ordre de grandeur, pas comme une mesure.

### L'historique d'une application

`audit_log` garde **tout** — c'est la règle du projet, et une évaluation enregistrée en brouillon
est une mutation comme une autre. Mais l'affichage, lui, doit laisser voir les décisions : une
passe dans le questionnaire produisait une douzaine de lignes `evaluation_saved` d'affilée.

Deux corrections, côté client uniquement :

- **Moins d'écritures inutiles.** `EvaluationPage` compare une empreinte de ce qu'elle s'apprête à
  enregistrer avec la dernière sauvegarde : changer d'étape sans rien saisir n'écrit plus rien.
- **Repliage à l'affichage.** `groupHistory` (ApplicationDetailPage) replie les suites d'actions
  automatiques (`evaluation_saved`, `seed`) en une ligne dépliable, qui annonce le nombre, la
  période et l'auteur. Un événement automatique isolé reste une ligne normale.

### Le cycle de réévaluation

Un verdict décrit l'application **au moment où il est rendu**. Trois choses le
périment, et toutes ramènent le statut à `in_progress` :

1. **Une action corrective terminée** (`setActionPlanDone`) : le motif qui avait fait baisser le
   score n'existe plus. L'échéance de conformité est effacée : elle ne décrit plus rien.
2. **L'expiration annuelle** (`jobs/compliance-expiry.ts`), règle de gestion du brief.
3. **Une modification d'un champ évalué** (`REEVALUATION_FIELDS` dans `applications.repo.ts`).

Tant qu'un verdict est en place, le questionnaire est **fermé** : `assertEvaluable` refuse la
saisie et la soumission (400), et `GET /api/applications/:id/evaluation` renvoie
`permissions: { fill: false, submit: false }` pour que le client grise le bouton « Évaluer » au lieu
de laisser l'utilisateur remplir quarante questions pour rien. La **lecture** reste ouverte :
historique, plan d'action et rapport doivent rester consultables.

Décocher une action ne restaure pas le verdict : on ne peut pas deviner lequel, et un verdict ne se
rend que par une évaluation.

Quand le formulaire se rouvre, il est **prérempli avec la dernière évaluation soumise** (côté
client, `EvaluationPage`) : une réévaluation ne repart pas de zéro, l'application n'a changé que sur
les points corrigés. Un brouillon en cours l'emporte toujours sur ce pré-remplissage : c'est le
travail non terminé de l'utilisateur.

### Le rapport PDF

`/applications/:id/rapport` (`EvaluationReportPage`) récapitule l'évaluation soumise et son plan
d'action : identité de l'application, verdict, sous-scores par thème, **toutes les réponses avec
leur libellé et leur commentaire**, et l'état de chaque action corrective.

Le PDF est produit par le **navigateur** (« Imprimer → Enregistrer au format PDF »), pas par le
serveur : une bibliothèque de génération de PDF serait la plus grosse dépendance du projet pour un
besoin que `@media print` couvre entièrement. La feuille d'impression (`components.css`, section
« Impression ») retire navigation, boutons et ombres, répète les en-têtes de tableau à chaque page
et empêche de couper une ligne en deux.

### Les tableaux de bord BI

`modules/dashboard.repo.ts` (`buildBiReport`) répond à la question que le FinOps ne traite pas :
**où en est le parc, comment il évolue, et où ça coince**. Une seule route, `GET /api/dashboard/bi`,
et sept blocs :

| Bloc | Source | Lecture |
| --- | --- | --- |
| `portfolio` | `applications` | forme du parc : statut, domaine, sensibilité, type d'IA, taux de conformité |
| `history` | `applications.created_at` + `evaluations.submitted_at` | déclarations et décisions, mois par mois |
| `quality` | `evaluations.sections_json` + `evaluation_answers` | thèmes les plus faibles, questions le plus souvent manquées |
| `actions` | `action_plans` | actions ouvertes, terminées, en retard |
| `compliance` | `applications.compliance_valid_until` | conformités qui expirent dans 90 jours |
| `activity` | `audit_log` | activité de la plateforme, par mois et par type d'événement |
| `monthlyCostEur` | `finops_costs` | le lien vers le FinOps, `null` sans `finops:read` |

Trois points qui méritent d'être connus avant de modifier ce module :

- **Les sous-scores par thème sont relus, pas recalculés.** `sections_json` est écrit à la
  soumission : c'est le résultat qui a fait foi ce jour-là. Rejouer `scoreEvaluation` avec le
  questionnaire d'aujourd'hui donnerait un historique qui change tout seul quand on ajoute une
  question : inacceptable pour un registre de conformité.
- **Les questions manquées passent par la définition du questionnaire**, pas par la valeur brute
  stockée : on cherche l'option dont le `score` vaut 0, parce que « 0 » n'est pas toujours la
  valeur basse d'une question à choix.
- **Les répartitions sont ordonnées par le référentiel**, pas par les données : une catégorie vide
  reste affichée (« aucune application à données sensibles » est une information) et l'ordre des
  lignes ne change pas d'un mois à l'autre.

Comme partout, chaque requête est filtrée par `visibilityClause(user)`. C'est ici que la règle est
la plus facile à oublier : un simple compteur suffirait à révéler l'existence du brouillon d'un
autre. Le coût, lui, n'est calculé que si l'utilisateur a `finops:read` : il vaut `null` sinon.

**Ce que ces tableaux de bord ne mesurent pas.** L'« utilisation » qu'ils montrent est celle de
*Poryg'AI* (journal d'audit), pas celle des outils d'IA inventoriés : la plateforme ne collecte
aucune télémétrie sur les applications qu'elle recense. La page le dit explicitement, pour qu'un
lecteur ne prenne pas un compteur d'événements pour un compteur d'usages.

---

## Le client

- **Routage** (`App.tsx`) : `/login` public ; `/` et ses enfants sous `<RequireAuth>` + `<AppShell>`.
  `<RequirePermission permission="…">` protège une page par la matrice partagée (affiche la page 403).
  Attention à l'ordre : `applications/nouvelle` est déclarée **avant** `applications/:id`, sinon
  « nouvelle » serait pris pour un identifiant.
- **Filtres dans l'URL** : la page inventaire lit et écrit `?q=&status=&domain=&sensitivity=` via
  `useSearchParams`. Une recherche est donc partageable, et le bouton « Précédent » fonctionne.
- **Formulaire partagé** : `components/ApplicationForm.tsx` sert à la déclaration ET à la
  modification (mêmes champs, même validation, même gestion accessible des erreurs).
- **Authentification** (`auth/AuthContext.tsx`) : au chargement, `GET /api/auth/me` restaure la session
  (le cookie est httpOnly, le JS ne le lit jamais). `login()` / `logout()` mettent à jour `user`.
  Si l'API répond 401 en cours de navigation, un événement global remet `user` à `null` → retour au login.
- **Appels API** (`api/client.ts`) : `api.get` / `api.post` / `api.put`, erreurs typées
  `ApiError { status, code, fields }`. `useApi(url)` charge une ressource au montage
  (`{ data, error, loading, reload }`).

### Cache et parallélisme des requêtes

`api/cache.ts` (une trentaine de lignes, sans dépendance) tient un cache mémoire des lectures GET.
Il règle trois choses mesurées sur la fiche application :

| | Avant | Après |
| --- | --- | --- |
| Requêtes API au chargement | 8 (chacune envoyée deux fois) | 4 |
| Fenêtre du premier au dernier appel | 235 ms | 23 ms |
| Retour arrière sur une page déjà vue | tout est refetché | 0 requête |

1. **Déduplication des requêtes en vol** (`dedupe`) : deux appelants qui demandent la même URL en
   même temps ne déclenchent qu'une requête. C'est ce qui neutralise le double montage des effets
   par React StrictMode en développement.
2. **Fraîcheur courte** (15 s) : revenir sur une page déjà vue l'affiche sans requête ni écran d'attente.
3. **Invalidation simple** : toute écriture réussie (POST/PUT) vide *l'intégralité* du cache. Grossier,
   mais impossible d'afficher une donnée périmée : à cette échelle, une invalidation plus fine
   n'apporterait rien et introduirait des bugs.

**Éviter les cascades.** Une page qui charge une ressource, puis monte des composants qui en chargent
d'autres, enchaîne les allers-retours. `ApplicationDetailPage` appelle donc ses trois `useApi` au
niveau de la page et passe le résultat aux sous-composants (`ApiQuery<T>` en props) : les trois
requêtes partent ensemble. À reproduire pour toute page qui affiche plusieurs blocs de données.

**Le mode développement est intrinsèquement plus lent** : Vite sert 88 modules séparés et React
double les effets. En production, le front est un seul fichier JS (392 ko, 122 ko gzip) plus un CSS
de 21 ko. Pour juger des performances réelles, mesurer sur `npm run build && NODE_ENV=production npm start`.
- **Formulaires** : état React + `schema.safeParse()` du même schéma Zod que le serveur. Les erreurs sont
  affichées dans un résumé en tête de formulaire (focus déplacé dessus) et sous chaque champ.
- **Composants UI** (`components/ui/`) : `Button`, `TextField`/`SelectField`/`TextareaField`/`RadioGroupField`,
  `Card`, `Alert`/`FormErrorSummary`, `Kpi`, `RoleBadge`/`StatusPill`. Tous en éléments natifs.
- **Styles** : `tokens.css` (variables de la charte) → `base.css` (reset, typo, focus, grille) →
  `components.css` (composants). Classes BEM légères. Aucune valeur de couleur hors de `tokens.css`.

---

## Le SSO Google

Implémenté dans `server/src/auth/google-sso.ts` (logique pure, testable) et branché par
`server/src/modules/auth.routes.ts` (routes et cookies). Flux **Authorization Code + PKCE**, écrit
à la main : `fetch` et `node:crypto` suffisent, aucune bibliothèque OAuth.

```
 Navigateur                    Poryg'AI (Fastify)                      Google
     │  clic « Continuer avec Google »
     ├──── GET /api/auth/google/start ──►│
     │                                    │ tire state + nonce + code_verifier
     │                                    │ les met dans un cookie signé (10 min)
     │◄──── 302 vers Google ──────────────┤
     ├──────────────────────────────────────────────────────────────►│
     │                                    │        l'utilisateur s'authentifie
     │◄─────────────────────────────────────── 302 avec ?code&state ─┤
     ├──── GET /api/auth/google/callback ►│
     │                                    │ vérifie le state (temps constant)
     │                                    ├── POST /token (code + verifier) ─►│
     │                                    │◄────────────────── id_token ──────┤
     │                                    │ valide iss / aud / exp / nonce / email_verified
     │                                    │ cherche l'utilisateur en base
     │◄──── 302 vers / + cookie session ──┤
```

**Trois décisions importantes :**

1. **Pas de création automatique de compte.** L'adresse doit déjà exister dans `users`, sinon retour
   à `/login?erreur=sso_inconnu`. Sans cette règle, n'importe quel compte Google entrerait dans le
   registre. C'est l'AI Officer qui inscrit les personnes (migration `002_comptes_equipe.sql` pour
   l'équipe actuelle).
2. **Le rôle ne vient jamais de Google.** Google répond seulement « qui est cette personne ? ».
   Le rôle est lu dans `users.role`.
3. **La signature de l'ID token n'est pas vérifiée** : et c'est correct ici : le token n'arrive pas
   par le navigateur mais par notre propre appel HTTPS à `oauth2.googleapis.com`. La spécification
   OIDC (§3.1.3.7, point 6) autorise explicitement à s'appuyer sur la validation TLS dans ce cas.
   Cela évite une dépendance JWT/JWKS. Les autres contrôles (émetteur, destinataire, expiration,
   nonce, `email_verified`) sont bien effectués.

Le cookie d'état (`poryg_sso`) est en `SameSite=Lax` : et non `Strict` : car le retour de Google est
une navigation inter-site : en `Strict`, le navigateur ne le renverrait pas. Il est signé, `httpOnly`,
limité au chemin `/api/auth/google` et expire en 10 minutes.

### Ajouter un autre fournisseur (Microsoft, Keycloak…)

Le fichier `google-sso.ts` est paramétré par les seules constantes d'endpoints et une `GoogleConfig`.
Pour Microsoft Entra ou Keycloak, le plus simple est de copier ce fichier, changer les trois URL et
les émetteurs acceptés, puis dupliquer les deux routes. L'interface `Identity`
(`server/src/auth/provider.ts`) reste le point de contact commun avec le reste de l'application.

---

## Mise en production

```bash
npm run build                      # client/dist
NODE_ENV=production npm start      # Fastify sert l'API et le front (ou via .env)
```

Un seul gestionnaire de 404 est enregistré (Fastify n'en accepte qu'un par instance) : il renvoie
`index.html` pour les routes du front et une erreur JSON pour `/api/*`.

- Mettre l'API derrière un reverse proxy HTTPS (Caddy, nginx) et passer `trustProxy: true` dans `app.ts`
  pour que `request.ip` soit la vraie adresse (rate-limit, audit).
- `NODE_ENV=production` active le cookie `Secure`, la CSP stricte et interdit `db:reset`.
- Sauvegarder `data/poryg.db` (un simple fichier ; en WAL, copier aussi `-wal`/`-shm` ou utiliser `VACUUM INTO`).
- Auto-héberger les polices (voir `docs/accessibilite.md`) pour supprimer la dépendance à Google Fonts.

---

## Décisions et alternatives écartées

| Décision                      | Alternative écartée            | Raison                                                                                               |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| SQL à la main + helpers       | ORM (Drizzle, Prisma)          | Le schéma est petit ; le SQL est lisible par tous et visible dans les migrations. Un ORM ajoute une couche à apprendre. |
| `node:sqlite`                 | `better-sqlite3`               | Aucune compilation native (les coéquipiers n'ont pas besoin de Visual Studio Build Tools). API quasi identique : bascule possible en changeant `db/connection.ts`. |
| Fastify                       | Express / NestJS / Next.js     | Express : pas de validation ni de sérialisation natives. NestJS : lourd pour cette taille. Next.js : mélange front/back, sécurité moins démontrable. |
| Sessions serveur + cookie     | JWT dans localStorage          | Le JWT est lisible par tout script injecté (XSS) et non révocable. Une session en base se révoque d'une ligne. |
| scrypt (`node:crypto`)        | argon2 / bcrypt                | Recommandé par l'OWASP, aucune dépendance native.                                                   |
| Un rôle par utilisateur       | Plusieurs rôles                | Simplicité de l'UI et des règles. Une table `user_roles` peut remplacer `users.role` plus tard.      |
| CSS pur + composants natifs   | Lib UI (Radix, MUI…)           | La charte est très spécifique ; les éléments natifs sont accessibles d'office. Une lib ne s'imposera que si des widgets complexes (combobox, date picker) deviennent nécessaires. |
| npm workspaces                | pnpm / turborepo               | Déjà installé avec Node, aucun outil supplémentaire.                                                |
| Référentiels en dur (shared)  | Tables en base                 | Versionnés avec le code ; passeront en base si l'AI Officer doit les éditer.                        |
