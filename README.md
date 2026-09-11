# Poryg'AI : registre des applications IA

Plateforme interne permettant de **lister les applications qui utilisent de l'IA**, de collecter
leurs informations (domaine métier, sensibilité des données, Process Owner…), de les **évaluer**
avec un questionnaire d'IA éthique et responsable, de leur donner un **statut de conformité**,
et de suivre leur **usage et leurs coûts** (FinOps, dashboards).

Le registre est **multi-organisation** : chaque organisation a son propre inventaire, ses propres
membres et sa propre formule d'abonnement, et une même personne peut appartenir à plusieurs
organisations (avec un rôle différent dans chacune).

Rôles : AI Officer · Application Manager · DPO · Auditeur · Utilisateur standard.
Statuts : Draft → In progress → Conforme / Partiellement conforme / Non conforme (+ Deleted, suppression logique).

> **État actuel : lots 0 à 7 livrés.** Connexion (SSO Google + mot de passe) et rôles, accueil,
> inventaire complet, questionnaire d'évaluation v2.5 avec verdict automatique et plan d'action,
> rapport FinOps responsable, tableaux de bord BI, organisations et abonnements. Reste le
> durcissement pour la production : voir la [feuille de route](#feuille-de-route).
>
> 🤖 **Vous reprenez le projet avec Claude Code ?** Lisez d'abord **[CLAUDE.md](CLAUDE.md)** :
> conventions, pièges déjà rencontrés et décisions déjà tranchées.

---

## Démarrage rapide

Prérequis : **Node.js ≥ 22.13** (développé avec la 24) et npm ≥ 10. Rien d'autre : pas de Docker,
pas de base à installer, pas de compilation native (SQLite est intégré à Node).

```bash
npm install
npm run dev          # API sur http://127.0.0.1:3000 + front sur http://localhost:5173
```

Puis ouvrir <http://localhost:5173>.

Au démarrage, l'API crée `data/poryg.db` si besoin, applique les migrations et : **en développement
seulement, et si la base ne contient aucune application** : insère le jeu de démo : 5 comptes et
8 applications. Sans lui, les comptes proposés sur la page de connexion n'existeraient pas et la
connexion par mot de passe échouerait. `npm run db:seed` fait la même chose à la main.

### Deux façons de se connecter

**1. Comptes de l'équipe, via le SSO Google** (bouton « Continuer avec Google »).
Nécessite d'activer le SSO, voir la section suivante.

| Compte Google                  | Rôle                |
| ------------------------------ | ------------------- |
| cleomarinmarie@gmail.com       | AI Officer          |
| aurelien.chiquet44@gmail.com   | Application Manager |
| chatet.maelle@gmail.com        | DPO                 |

Ces comptes n'ont **pas** de mot de passe : ils passent obligatoirement par Google. Ils sont
membres de l'organisation d'accueil créée par la migration 006.

Le rôle n'est plus porté par le compte mais par son **appartenance** à une organisation. En
pratique, il se change dans l'interface (« Organisation » → Personnes) ; en SQL :

```sql
UPDATE memberships SET role = 'auditor'
 WHERE organization_id = 1
   AND user_id = (SELECT id FROM users WHERE email = 'chatet.maelle@gmail.com');
```

**2. Comptes de démonstration, par mot de passe** : proposés en un clic sur la page de connexion
(en développement uniquement). Mot de passe commun : `Poryg2026!`

| Compte                      | Rôle                 | Ce qu'il voit / peut faire                                   |
| --------------------------- | -------------------- | ------------------------------------------------------------ |
| alice.martin@poryg.local    | AI Officer           | Tout, y compris les brouillons des autres                    |
| camille.roux@poryg.local    | Application Manager  | Déclare des applications, remplit les questionnaires         |
| david.nguyen@poryg.local    | DPO                  | Avis sur les applications à données personnelles / sensibles |
| emma.bernard@poryg.local    | Auditeur             | Décide Conforme / Non conforme                               |
| lucas.petit@poryg.local     | Utilisateur standard | Consultation seule                                           |

Le jeu de démonstration contient **deux organisations** : « Poryg Industries » (8 applications,
8 personnes, formule Entreprise) et « Atelier Nova » (vide, formule Découverte). Alice et Camille
appartiennent aux deux : connectez-vous avec l'une d'elles pour voir le sélecteur d'organisation
dans l'en-tête, et constater que l'inventaire change entièrement d'une organisation à l'autre.

### Activer la connexion Google

Sans configuration, seule la connexion par mot de passe est proposée : l'application fonctionne
normalement. Pour activer le SSO :

1. Aller sur <https://console.cloud.google.com/apis/credentials> et créer (ou choisir) un projet.
2. *Écran de consentement OAuth* → type **Externe**, renseigner un nom d'application et un e-mail
   de contact. Tant que l'application est en mode « Test », ajouter les trois adresses de l'équipe
   dans **Utilisateurs test**.
3. *Identifiants* → **Créer des identifiants** → **ID client OAuth** → type **Application Web**.
4. Dans **URI de redirection autorisés**, ajouter exactement :
   `http://localhost:5173/api/auth/google/callback`
5. Copier l'ID client et le code secret dans le fichier `.env` à la racine :

```
GOOGLE_CLIENT_ID=votre-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=votre-secret
```

6. Relancer `npm run dev`. Le bouton « Continuer avec Google » apparaît.

> **L'inscription est libre** : une personne inconnue qui se connecte avec Google voit son compte
> créé à la première connexion. Elle arrive **sans organisation** et n'accède donc à rien du
> registre tant qu'elle n'a pas ajouté la sienne ou été invitée dans une autre. Le rôle, lui, vient
> toujours de notre base : jamais de Google.

### Scripts

| Commande              | Effet                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| `npm run dev`         | Lance API + front avec rechargement à chaud                                 |
| `npm run dev:server`  | API seule (`node --watch`)                                                  |
| `npm run dev:client`  | Front seul (Vite)                                                           |
| `npm test`            | Tests serveur (Vitest, base SQLite en mémoire)                              |
| `npm run typecheck`   | Vérification TypeScript des 3 workspaces                                    |
| `npm run db:migrate`  | Applique les migrations SQL manquantes                                      |
| `npm run db:seed`     | Migre puis insère le jeu de démo (ne fait rien si la base contient déjà des comptes) |
| `npm run db:reset`    | Supprime `data/poryg.db`, migre, seed (interdit en production)              |
| `npm run build`       | Compile le front dans `client/dist`                                         |
| `npm start`           | Lance l'API ; avec `NODE_ENV=production` elle sert aussi `client/dist`      |

Configuration : copier `.env.example` en `.env` si besoin (ports, chemin de la base, durée de session).

---

## Structure du dépôt

```
poryg-ai/
├─ CLAUDE.md       Instructions pour Claude Code (conventions, pièges, décisions)
├─ shared/         Code partagé front/back (TypeScript pur, importé tel quel)
│  └─ src/         roles · statuses · plans (abonnements) · referentiels · finops ·
│                  questionnaire · schemas (Zod) · types (DTO)
├─ server/         API Fastify
│  ├─ src/
│  │  ├─ app.ts            assemblage de l'application (utilisé par server.ts et les tests)
│  │  ├─ server.ts         point d'entrée : écoute + jobs périodiques
│  │  ├─ config.ts         variables d'environnement (helper `read` : le vide vaut « absent »)
│  │  ├─ audit.ts          journal d'audit
│  │  ├─ auth/             mots de passe (scrypt), sessions, SSO Google (google-sso.ts)
│  │  ├─ plugins/          security.ts (helmet, rate-limit, CSRF) · auth.ts (session, RBAC)
│  │  ├─ modules/          applications · evaluations · finops · organizations · auth ·
│  │  │                    users · dashboard
│  │  │                    (une paire `.routes.ts` + `.repo.ts` par domaine)
│  │  ├─ jobs/             expiration annuelle des conformités
│  │  ├─ db/               connexion node:sqlite, migrations SQL, seed, CLI
│  │  └─ lib/              erreurs HTTP, validation, dates
│  └─ tests/               Vitest : 212 tests
├─ client/         Front React + Vite
│  └─ src/
│     ├─ App.tsx           routes
│     ├─ api/              client fetch · cache mémoire · hook useApi
│     ├─ auth/             AuthContext, gardes de routes
│     ├─ components/       ApplicationForm · ApplicationsTable · QuestionCard · CostEntry ·
│     │  └─ ui/            EvaluationSummary · BreakdownBars · MonthlyBars · Plans + briques UI
│     ├─ layout/           AppShell (en-tête, navigation, main)
│     ├─ pages/            Login · Home · Applications (liste/fiche/déclaration/édition) ·
│     │                    Evaluation · Finops · ApplicationFinops · Dashboards ·
│     │                    Organizations (mes organisations / création / fiche / import) · 403 · 404
│     ├─ styles/           tokens.css (charte) · base.css · components.css
│     └─ lib/              formatage, aides formulaires
├─ docs/           Documentation (voir ci-dessous) + charte graphique d'origine
├─ data/           Base SQLite locale (ignorée par git)
└─ scripts/        dev.mjs : lance API + front
```

---

## Stack technique et choix

Objectif : **peu de dépendances, du code lisible, facile à reprendre.** 9 dépendances d'exécution.

| Couche       | Choix                                   | Pourquoi                                                                                  |
| ------------ | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Front        | React 19 + TypeScript + Vite            | Standard, rapide, typé                                                                    |
| Routage      | React Router 7                          | Routes imbriquées, gardes par rôle                                                        |
| UI           | CSS pur + composants maison             | La charte est spécifique ; pas de lib à surcharger. Formulaires natifs (accessibles d'office) |
| Validation   | Zod (schémas partagés)                  | Même règle côté client (confort) et serveur (sécurité)                                    |
| API          | Fastify 5                               | Léger, rapide, plugins sécurité officiels, excellent support des tests (`inject`)         |
| Base         | SQLite via `node:sqlite`                | Intégré à Node ≥ 22.13 : zéro dépendance native. SQL écrit à la main, pas d'ORM           |
| Auth         | Sessions cookie httpOnly + scrypt       | Plus sûr qu'un JWT en localStorage ; scrypt est dans `node:crypto`                        |
| SSO          | Google OpenID Connect, écrit à la main  | `fetch` + `node:crypto` suffisent : aucune bibliothèque OAuth à installer ni à suivre     |
| Tests        | Vitest                                  | Rapide, config nulle                                                                      |

Les alternatives écartées (ORM, NestJS, Next.js, lib de composants, JWT…) sont discutées dans
[docs/architecture.md](docs/architecture.md#décisions-et-alternatives-écartées).

---

## Documentation

| Document                                                 | Contenu                                                         |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| [docs/architecture.md](docs/architecture.md)             | Fonctionnement front, API, base ; cycle d'une requête ; brancher un SSO ; mise en production |
| [docs/securite.md](docs/securite.md)                     | Mesures de sécurité, où elles sont dans le code, ce qui reste à faire |
| [docs/accessibilite.md](docs/accessibilite.md)           | Règles appliquées (WCAG 2.2 AA), contrastes vérifiés, checklist de test |
| [docs/roles-et-permissions.md](docs/roles-et-permissions.md) | Matrice des rôles, cycle de vie des statuts, règles de gestion |
| [docs/questionnaire-v2.md](docs/questionnaire-v2.md)       | Conception du questionnaire : arbre de décision, barème, toutes les questions et recommandations |
| `docs/questionnaire-v2.excalidraw`                        | Schéma logique du questionnaire, éditable sur [excalidraw.com](https://excalidraw.com) (aperçu : le `.svg` à côté) |
| [docs/charte/](docs/charte/)                             | Charte graphique d'origine (HTML) : source des tokens CSS       |

---

## Conventions

- **Français** dans l'interface, les messages d'erreur, les commentaires et la documentation.
- **TypeScript strict** partout ; `npm run typecheck` doit passer.
- **Une permission = une entrée** dans `shared/src/roles.ts`. Le serveur l'applique, le client masque.
- **Toute mutation métier** appelle `recordAudit()` dans la même transaction.
- **Jamais de `DELETE`** sur les tables métier (des triggers SQL le bloquent) : statut `deleted` + `deleted_by/at`.
- **Migrations additives** : un nouveau fichier `server/src/db/migrations/NNN_nom.sql`, jamais modifier un fichier déjà appliqué.
- **CSS** : variables de `tokens.css` uniquement, classes BEM légères, aucune couleur codée en dur.
- Un module API = `modules/<domaine>.routes.ts` (HTTP) + `modules/<domaine>.repo.ts` (SQL).
- **Accessibilité WCAG 2.2 AA**, vérifiée avec axe : objectif 0 violation sur chaque page.

Les conventions détaillées, les pièges déjà rencontrés et les décisions techniques déjà tranchées
sont dans **[CLAUDE.md](CLAUDE.md)** : à lire avant de modifier le code, que ce soit à la main ou
avec un assistant.

---

## Feuille de route

| Lot | Contenu                                                                                     | État     |
| --- | ------------------------------------------------------------------------------------------- | -------- |
| 0   | Socle : monorepo, tooling, tests                                                            | ✅ livré |
| 1   | Design system, connexion + rôles, accueil, formulaire de déclaration                        | ✅ livré |
| 1b  | SSO Google + comptes de l'équipe                                                            | ✅ livré |
| 2   | Inventaire filtrable, fiche application, édition, envoi à l'audit, suppression logique, historique | ✅ livré |
| 3   | Questionnaire d'évaluation v2 : cadrage dynamique, score /100, blocs par pays, verdict à 3 niveaux | ✅ livré |
| 3b  | Questionnaire v2.1 : thème « Biais cognitifs et algorithmiques » (BI1–BI8)                    | ✅ livré |
| 4   | Plan d'action généré automatiquement, suivi des actions correctives                          | ✅ livré |
| 5   | FinOps : saisie des coûts, rapport global et rapport par application                         | ✅ livré |
| 6   | Tableaux de bord BI : historique du parc, thèmes faibles, échéances, activité                | ✅ livré |
| 6b  | Rapport PDF imprimable, réévaluation déclenchée par une action corrective, formulaire prérempli | ✅ livré |
| 6c  | FinOps responsable : énergie et carbone à côté du coût, frugalité du parc, leviers d'optimisation | ✅ livré |
| 6d  | Questionnaire v2.3 : thème « Gouvernance FinOps » (ajustement ±4 pts), taille du modèle et régions détaillées, estimation d'empreinte en fin de formulaire | ✅ livré |
| 7   | Organisations, formules d'abonnement, import de comptes, choix de l'organisation active     | ✅ livré |
| 7b  | Natures de données multiples par application ; questionnaire v2.4 : accessibilité (RGAA), quantification et élagage du modèle | ✅ livré |
| 7c  | Empreinte carbone recalculée sur la physique (2N en inférence, 6ND en entraînement), calibrée sur des mesures publiées et affichée en fourchette | ✅ livré |
| 8   | Durcissement : polices auto-hébergées, revue sécurité, mise en production                   | à faire  |

**Prochaines étapes identifiées**

- **Validation juridique** du contenu réglementaire du questionnaire (AI Act, RGPD, lois d'État
  américaines, mesures chinoises) : rédigé sans conseil et à dater.
- **Import de coûts** FinOps (CSV, facture cloud) : la colonne `finops_costs.source` est déjà là
  pour ça, la saisie est aujourd'hui unitaire.
- **Facturation réelle** : les formules d'abonnement n'encaissent rien (voir `shared/src/plans.ts`).
  Brancher un prestataire de paiement supposerait aussi de décider ce qui se passe quand une
  organisation cesse de payer alors qu'elle dépasse les plafonds gratuits.
- **Invitations par e-mail** : l'import rattache des adresses, mais personne n'est prévenu : il faut
  aujourd'hui le dire de vive voix. Aucun envoi d'e-mail n'existe dans le projet.

Déjà en place pour les lots suivants : le schéma `finops_costs`, le job d'expiration annuelle des
conformités, le journal d'audit, la matrice de permissions complète (évaluation, plans d'action,
FinOps, administration).
