# Instructions pour Claude Code : Poryg'AI

Registre des applications IA d'une entreprise : inventaire, évaluation éthique, statut de
conformité, FinOps. Projet d'école, repris à plusieurs. **Lis le [README](README.md) pour démarrer**
(installation, comptes de démo, feuille de route) ; ce fichier-ci ne contient que ce qu'il faut
savoir pour *modifier* le code sans casser les règles du projet.

---

## Les cinq règles à ne pas enfreindre

1. **Le serveur décide, le client suit.** Toute autorisation est vérifiée par l'API
   (`app.requirePermission('x:y')` → 401/403). Le client masque les boutons interdits, mais ce n'est
   que du confort : ne jamais s'y fier comme protection.
2. **Jamais de `DELETE` sur une table métier.** Suppression logique (`status = 'deleted'` +
   `deleted_by` + `deleted_at`). Des triggers SQL le refusent de toute façon, y compris à tes tests.
3. **Toute mutation journalise.** `recordAudit(db, …)` **dans la même transaction** que l'écriture.
   `audit_log` est en ajout seul (triggers `BEFORE UPDATE/DELETE`).
4. **Peu de dépendances.** L'utilisatrice a demandé du code simple à reprendre : préférer les API
   natives (Node, navigateur) et 20 lignes maison à une bibliothèque. Pas d'ORM, pas de lib UI, pas
   de state manager, pas de lib de graphiques. 9 dépendances d'exécution aujourd'hui : ne pas en
   ajouter sans le demander.
5. **Tout en français** : interface, messages d'erreur, commentaires, documentation, noms de tests.
   Les identifiants de code restent en anglais (`createApplication`, `monthlyCostEur`).

---

## Commandes

```bash
npm run dev          # API (127.0.0.1:3000) + front (localhost:5173)
npm test             # 165 tests Vitest, base SQLite en mémoire
npm run typecheck    # les 3 workspaces
npm run db:reset     # base neuve + jeu de démo (interdit en production)
```

**Avant de dire qu'une tâche est finie : `npm test` ET `npm run typecheck` doivent passer.**
Les tests sont rapides (~5 s) et couvrent les règles métier : s'ils cassent, c'est en général le
test qui dit vrai.

Le port 5173 est imposé (l'URI de redirection Google y est déclarée). Si un `EADDRINUSE` survient,
un serveur précédent traîne : le tuer plutôt que changer de port.

---

## Organisation

| Workspace | Rôle |
| --- | --- |
| `shared/` | **Vérité partagée** front/back : rôles et permissions, statuts, référentiels, questionnaire, schémas Zod, types DTO. Pas de build : le TypeScript est importé tel quel. |
| `server/` | API Fastify + SQLite (`node:sqlite`, pas de dépendance native). |
| `client/` | React + Vite, CSS pur suivant la charte graphique. |

**Ajouter une fonctionnalité serveur**, dans l'ordre :
1. permission dans `shared/src/roles.ts` ;
2. schéma Zod dans `shared/src/schemas.ts` ;
3. migration SQL si besoin (`server/src/db/migrations/NNN_nom.sql`, **jamais modifier un fichier
   déjà appliqué**) ;
4. `modules/<domaine>.repo.ts` (SQL, transactions, audit : aucune notion HTTP) ;
5. `modules/<domaine>.routes.ts` (HTTP, permission, validation) ;
6. enregistrement dans `server/src/app.ts` ;
7. test dans `server/tests/`.

---

## Pièges déjà rencontrés : ne pas les réintroduire

**Variables d'environnement vides.** Un `.env` copié depuis `.env.example` contient `COOKIE_SECRET=`
(vide). `??` ne filtre pas la chaîne vide. Utiliser le helper `read()` de `server/src/config.ts`,
qui traite le vide comme absent.

**`setNotFoundHandler` unique.** Fastify n'en accepte qu'un par instance. Il y en avait deux
(erreurs + statique en production) : le mode production ne démarrait pas. Il est désormais
enregistré une seule fois dans `app.ts`, en tenant compte des deux cas.

**Migrations qui reconstruisent une table.** SQLite ne sait pas modifier une contrainte `CHECK`.
Il faut recréer la table, et donc désactiver les clés étrangères : or `PRAGMA foreign_keys` est sans
effet dans une transaction. Un fichier commençant par `-- migrate: no-transaction` est exécuté hors
transaction (il pose lui-même `BEGIN … COMMIT`) ; le runner vérifie ensuite
`PRAGMA foreign_key_check`. Exemple complet : `004_questionnaire_v2.sql`.
**Toujours tester une telle migration sur une copie de `data/poryg.db` avant de la laisser tourner.**

**Écran d'attente qui démonte la page.** Écrire `if (loading && !data)`, jamais `if (loading)` :
sinon, après une action, la page se démonte pendant le rechargement et les formulaires perdent leur
contenu.

**Cascades de requêtes.** Une page qui charge une ressource puis monte des composants qui en
chargent d'autres enchaîne les allers-retours. Appeler tous les `useApi` **au niveau de la page** et
passer le résultat en props (`ApiQuery<T>`). Voir `ApplicationDetailPage`.

**Lenteur ressentie : ce n'est jamais SQLite.** L'API répond en 4–5 ms. Les causes réelles ont été
le double montage de StrictMode, les cascades, et l'absence de cache. `api/cache.ts` déduplique les
requêtes en vol et garde les lectures 15 s ; **toute écriture vide le cache entier**.

**Données réservées à un rôle.** Ne pas envoyer puis masquer : ne pas calculer du tout. Exemple :
`monthlyCostEur` vaut `NULL` en SQL si l'utilisateur n'a pas `finops:read`, et `getApplication()`
prend un `user` **optionnel dont l'absence est le cas le plus restrictif**. Même règle sur les
tableaux de bord : tout agrégat passe par `visibilityClause(user)`, sinon un simple compteur
révélerait l'existence du brouillon d'un autre.

**Piste `1fr` et contenu large.** Dans une grille, `grid-template-columns: 1fr` a pour largeur
minimale celle de son contenu : un tableau large pousse la carte, et donc la page, au-delà de
l'écran : malgré son conteneur `overflow-x: auto`. Écrire `minmax(0, 1fr)`.

**`min-width` global sur `.table`.** `.table` impose `min-width: 780px`, ce qui convient à
l'inventaire (5 colonnes) mais pas à un tableau de 3 colonnes dans une carte de demi-largeur :
il défilait horizontalement et la dernière colonne sortait du cadre. `.breakdown` neutralise ce
minimum et fixe ses proportions (`table-layout: fixed`). Un tableau étroit ne doit pas hériter
d'une largeur pensée pour un tableau large.

**`overflow: hidden` ne découpe pas un `<table>`.** Un tableau en `.visually-hidden` débordait la
page entière. Le masquage doit porter sur un `<div>` qui enveloppe le tableau.

---

## Domaine métier

**Rôles** (un seul par utilisateur, dans `users.role`) : `ai_officer`, `app_manager`, `dpo`,
`auditor`, `standard`. Matrice unique : `shared/src/roles.ts`. Deux niveaux d'autorisation : la
permission de rôle, puis la règle de **propriété** (`canEditApplication`, `canSubmitApplication`,
`canEditCosts`) : un Application Manager n'agit que sur ses propres applications.

**Statuts** : `draft` → `in_progress` → `compliant` / `partially_compliant` / `non_compliant`,
plus `deleted`. **Un verdict ferme le questionnaire** : on ne réévalue que depuis `in_progress`.
Trois événements y ramènent : une action corrective terminée, l'expiration annuelle, une
modification d'un champ évalué. Le formulaire rouvert est prérempli avec la dernière évaluation
soumise. Voir docs/architecture.md § « Le cycle de réévaluation ». Un brouillon n'est visible que par son propriétaire et l'AI Officer ; un brouillon
d'autrui renvoie **404, pas 403** (on ne révèle pas son existence).

**Questionnaire v2.3** : définition dans `shared/src/questionnaire.ts`, conception dans
[docs/questionnaire-v2.md](docs/questionnaire-v2.md), schéma visuel dans
`docs/questionnaire-v2.excalidraw` (aperçu : le `.svg` à côté, tous deux regénérés par
`scratchpad/gen_arbre.py` à partir du code pour qu'ils ne puissent pas diverger).
**Ajouter des questions n'exige rien d'autre que `questionnaire.ts`** : sections, étapes du
formulaire, sous-scores et plan d'action en découlent. Incrémenter `QUESTIONNAIRE_VERSION` pour
que les évaluations soumises gardent la trace du jeu de questions utilisé.
Score sur 100 = points obtenus ÷ points applicables. Le **cadrage** (C1–C6) détermine quelles
questions s'affichent (`showIf`) ; une question masquée ne compte nulle part. Neuf thèmes, dont
« Biais cognitifs et algorithmiques » (BI, ajouté en v2.1 d'après le cours 5) : le thème E mesure
si l'IA discrimine, le thème BI d'où vient le biais et comment on le détecte. Poids : critique 4,
standard 2, mineur 1. Une critique à « Non » plafonne à 60. Deux blocages (C2 militaire, UE1
pratique interdite AI Act) refusent l'évaluation sans score. Verdict : ≥ 86 conforme · 61–85
partiellement conforme · ≤ 60 non conforme.

**Le verdict n'est jamais reçu du client** : `scoreEvaluation()` est rejouée côté serveur sur les
réponses stockées. Le client l'utilise aussi : pour savoir quelles questions s'appliquent, mesurer
l'avancement et signaler les critères critiques manqués : mais seul le serveur fait foi.

**Le score n'est pas affiché pendant la saisie** (décision de l'utilisatrice) : le voir monter
pousse à répondre pour la note plutôt qu'à décrire la réalité. Il n'apparaît qu'à l'étape
« Résultat ». Seules les conséquences graves sont signalées en cours de route, sous la question
concernée : réponse bloquante et critère critique à « Non ».

**FinOps responsable.** Une saisie mensuelle porte trois grandeurs : coût, énergie (kWh) et
empreinte (kg CO₂). Le carbone est **proposé** à la saisie depuis `estimateCo2` mais jamais
calculé en cachette : c'est la valeur validée qui est stockée. Le rapport suit les trois
principes du FinOps (visibilité / responsabilité / optimisation continue) et croise la dépense
avec le thème « Frugalité et FinOps » du questionnaire. Vocabulaire partagé dans
`shared/src/finops.ts` ; détail dans docs/architecture.md § « Le rapport FinOps responsable ».

**La boucle questionnaire ↔ FinOps.** Le thème **Gouvernance FinOps** (GF1–GF7) décrit comment le
suivi sera tenu : reporting, fréquence, mesures, diffusion : et de quoi dépend l'impact : type
d'IA, entraînement, inférence, hébergement. Deux règles à ne pas casser :

1. **Ce thème ne compte pas dans le score sur 100.** Il produit un ajustement de −4 à +4 points.
   Un malus ne fait jamais passer une application sous le seuil de conformité partielle, et un
   bonus ne défait jamais le plafond d'un critère critique. Règle métier : « l'approche FinOps
   ajoute ou supprime des points, mais ne rend pas la solution non conforme ».
2. **L'estimation d'empreinte est un ordre de grandeur, et le dit.** Ses coefficients sont dans
   `shared/src/finops.ts` avec leurs hypothèses, qui sont affichées à l'écran. Dès qu'un relevé
   réel existe, c'est lui qui fait foi. Ne jamais faire retomber l'estimation sur une valeur
   plausible quand les réponses manquent : on affiche ce qui manque, pas un chiffre inventé.
3. **Une option qui alimente un calcul dit ce qu'elle recouvre.** GF7 cite des régions réelles et
   l'intensité carbone retenue, GF8 des exemples de modèles par tranche. Si tu ajoutes une option
   à l'une de ces questions, ajoute l'entrée correspondante dans le modèle **et** sa précision
   (`Option.hint`) : un test échoue sinon.

> Le contenu réglementaire (AI Act, RGPD, lois d'État américaines, mesures chinoises) a été rédigé
> sans validation juridique et les textes évoluent. Si tu le modifies, garde l'avertissement dans
> `docs/questionnaire-v2.md`.

---

## Interface

**Accessibilité : WCAG 2.2 AA, vérifié avec axe : objectif 0 violation.** C'est une exigence du
projet, pas un bonus. En pratique : éléments HTML natifs, `<label for>` sur chaque champ, erreurs
liées par `aria-describedby`, focus déplacé sur le résumé d'erreurs, `aria-sort` sur les colonnes
triables, conteneurs à défilement focalisables (`tabIndex={0}` + `role="group"`), et **jamais
d'information portée par la seule couleur** (une pastille est toujours doublée d'un libellé).

**Graphiques, sans bibliothèque.** Trois composants et rien d'autre : `MonthlyBars` (colonnes
mensuelles), `HistoryChart` (colonnes empilées), `BreakdownBars` (barres horizontales dans un vrai
tableau). Les colonnes ont un **axe vertical gradué** : échelle arrondie par `niceScale`
(`lib/charts.ts`), jamais le maximum brut de la série : et donnent le **détail au survol**.
L'infobulle se loge dans la marge haute réservée du tracé : elle ne recouvre rien, ce qui la
dispense d'un mécanisme de fermeture (WCAG 2.2, 1.4.13). Le graphique reste `aria-hidden` et sans
élément focalisable ; la donnée est portée par le tableau qui l'accompagne (masqué pour
`MonthlyBars`, visible pour `HistoryChart`).

**Historique : les décisions d'abord.** Une passe dans le questionnaire écrivait une douzaine de
lignes `evaluation_saved` qui noyaient les décisions. Deux corrections, aucune ne touche au
journal : le formulaire **n'enregistre plus un brouillon identique** au précédent (empreinte
comparée avant chaque écriture), et la frise **replie les suites d'événements automatiques** en
une ligne dépliable (`groupHistory`). La règle « toute mutation journalise » reste entière : rien
n'est supprimé, tout reste lisible en dépliant.

**Charte graphique** : contour noir partout, ombres dures jamais floues, rayons généreux.
Toutes les couleurs sont dans `client/src/styles/tokens.css` : **n'écris jamais une couleur en dur
ailleurs**. Trois écarts assumés par rapport à la charte d'origine (contrastes insuffisants
mesurés) sont documentés dans [docs/accessibilite.md](docs/accessibilite.md) ; notamment les liens
utilisent `--rose-lien` et non `--rose-dark`.

**Le mode développement est lent par nature** (Vite sert ~90 modules, React double les effets).
Pour juger des performances, mesurer sur `npm run build && NODE_ENV=production npm start`.

---

## Documentation à tenir à jour

Quand tu livres quelque chose, mets à jour ce qui est concerné :

| Fichier | Contenu |
| --- | --- |
| [README.md](README.md) | Démarrage, scripts, structure, feuille de route |
| [docs/architecture.md](docs/architecture.md) | Cycle d'une requête, routes, base, client, cache, production |
| [docs/securite.md](docs/securite.md) | Mesures, où elles sont dans le code, reste à faire |
| [docs/accessibilite.md](docs/accessibilite.md) | Règles, contrastes mesurés, checklist de test |
| [docs/roles-et-permissions.md](docs/roles-et-permissions.md) | Matrice, statuts, règles de gestion |
| [docs/questionnaire-v2.md](docs/questionnaire-v2.md) | Questionnaire : arbre, barème, questions, recommandations |

Le nombre de tests est cité dans le README et `docs/securite.md` : le corriger quand il change.

---

## Décisions déjà tranchées

Ne pas les rouvrir sans demander : elles ont été discutées :

- SQL écrit à la main plutôt qu'un ORM ; `node:sqlite` plutôt que `better-sqlite3` (pas de
  compilation native à installer pour l'équipe).
- Sessions serveur + cookie `httpOnly` plutôt qu'un JWT ; `scrypt` (`node:crypto`) plutôt qu'argon2.
- SSO Google écrit à la main (`auth/google-sso.ts`), sans bibliothèque OAuth. La signature de l'ID
  token n'est pas vérifiée : il arrive par notre propre appel HTTPS au serveur de Google, cas couvert
  par la spécification OIDC §3.1.3.7. Les autres claims le sont.
- Pas de création automatique de compte au SSO : l'adresse doit exister dans `users`.
- Un seul rôle par utilisateur.
- Le statut `partially_compliant` n'a **pas** d'échéance de réévaluation (choix de l'utilisatrice).
- Tri des tableaux fait dans le navigateur (listes courtes) ; à passer en SQL au-delà de quelques
  centaines de lignes.
