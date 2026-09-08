# Poryg'AI — registre des applications IA

Plateforme interne permettant de **lister les applications qui utilisent de l'IA**, de collecter
leurs informations (domaine métier, sensibilité des données, Process Owner…), de les **évaluer**
avec un questionnaire d'IA éthique et responsable, de leur donner un **statut de conformité**,
et de suivre leur **usage et leurs coûts** (FinOps, dashboards).

Rôles : AI Officer · Application Manager · DPO · Auditeur · Utilisateur standard.
Statuts : Draft → In progress → Conforme / Non conforme (+ Deleted, suppression logique).

> État actuel : **lots 1 à 4** livrés — connexion (SSO Google + mot de passe) et rôles, accueil,
> inventaire complet (déclaration, recherche, fiche, édition, suppression logique tracée,
> historique), et évaluation de conformité avec scoring automatique et plan d'action.
> Voir la [feuille de route](#feuille-de-route).

---

## Démarrage rapide

Prérequis : **Node.js ≥ 22.13** (développé avec la 24) et npm ≥ 10. Rien d'autre : pas de Docker,
pas de base à installer, pas de compilation native (SQLite est intégré à Node).

```bash
npm install
npm run db:seed      # crée data/poryg.db avec 5 comptes et 8 applications de démo
npm run dev          # API sur http://127.0.0.1:3000 + front sur http://localhost:5173
```

Puis ouvrir <http://localhost:5173>.

### Deux façons de se connecter

**1. Comptes de l'équipe, via le SSO Google** (bouton « Continuer avec Google »).
Nécessite d'activer le SSO, voir la section suivante.

| Compte Google                  | Rôle                |
| ------------------------------ | ------------------- |
| cleomarinmarie@gmail.com       | AI Officer          |
| aurelien.chiquet44@gmail.com   | Application Manager |
| chatet.maelle@gmail.com        | DPO                 |

Ces comptes n'ont **pas** de mot de passe : ils passent obligatoirement par Google.
Pour changer un rôle : `UPDATE users SET role = 'auditor' WHERE email = '…';`

**2. Comptes de démonstration, par mot de passe** — proposés en un clic sur la page de connexion
(en développement uniquement). Mot de passe commun : `Poryg2026!`

| Compte                      | Rôle                 | Ce qu'il voit / peut faire                                   |
| --------------------------- | -------------------- | ------------------------------------------------------------ |
| alice.martin@poryg.local    | AI Officer           | Tout, y compris les brouillons des autres                    |
| camille.roux@poryg.local    | Application Manager  | Déclare des applications, remplit les questionnaires         |
| david.nguyen@poryg.local    | DPO                  | Avis sur les applications à données personnelles / sensibles |
| emma.bernard@poryg.local    | Auditeur             | Décide Conforme / Non conforme                               |
| lucas.petit@poryg.local     | Utilisateur standard | Consultation seule                                           |

### Activer la connexion Google

Sans configuration, seule la connexion par mot de passe est proposée — l'application fonctionne
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

> Une adresse Google **doit déjà exister** dans la table `users` pour pouvoir se connecter : il n'y a
> pas de création automatique de compte. Le rôle vient de notre base, jamais de Google.

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
├─ shared/         Code partagé front/back (TypeScript pur, importé tel quel)
│  └─ src/         rôles & permissions, statuts, référentiels, schémas Zod, types DTO
├─ server/         API Fastify
│  ├─ src/
│  │  ├─ app.ts            assemblage de l'application (utilisé par server.ts et les tests)
│  │  ├─ server.ts         point d'entrée : écoute + jobs périodiques
│  │  ├─ config.ts         variables d'environnement
│  │  ├─ audit.ts          journal d'audit
│  │  ├─ auth/             mots de passe (scrypt), sessions, SSO Google (google-sso.ts)
│  │  ├─ plugins/          security.ts (helmet, rate-limit, CSRF) · auth.ts (session, RBAC)
│  │  ├─ modules/          une paire routes + repo par domaine métier
│  │  ├─ jobs/             expiration annuelle des conformités
│  │  ├─ db/               connexion node:sqlite, migrations SQL, seed, CLI
│  │  └─ lib/              erreurs HTTP, validation, dates
│  └─ tests/               Vitest
├─ client/         Front React + Vite
│  └─ src/
│     ├─ App.tsx           routes
│     ├─ api/              client fetch + hook useApi
│     ├─ auth/             AuthContext, gardes de routes
│     ├─ components/       composants UI accessibles (boutons, champs, badges, cartes…)
│     ├─ layout/           AppShell (en-tête, navigation, main)
│     ├─ pages/            Login, Home, Applications (liste/fiche/déclaration/édition), 403, 404
│     ├─ styles/           tokens.css (charte) · base.css · components.css
│     └─ lib/              formatage, aides formulaires
├─ docs/           Documentation (voir ci-dessous) + charte graphique d'origine
├─ data/           Base SQLite locale (ignorée par git)
└─ scripts/        dev.mjs : lance API + front
```

---

## Stack technique et choix

Objectif : **peu de dépendances, du code lisible, facile à reprendre.** 8 dépendances d'exécution.

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
| [docs/charte/](docs/charte/)                             | Charte graphique d'origine (HTML) — source des tokens CSS       |

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

---

## Feuille de route

| Lot | Contenu                                                                                     | État     |
| --- | ------------------------------------------------------------------------------------------- | -------- |
| 0   | Socle : monorepo, tooling, tests                                                            | ✅ livré |
| 1   | Design system, connexion + rôles, accueil, formulaire de déclaration                        | ✅ livré |
| 1b  | SSO Google + comptes de l'équipe                                                            | ✅ livré |
| 2   | Inventaire filtrable, fiche application, édition, envoi à l'audit, suppression logique, historique | ✅ livré |
| 3   | Questionnaire d'évaluation (18 pts, critères éliminatoires), scoring, verdict automatique    | ✅ livré |
| 4   | Plan d'action généré automatiquement, suivi des actions correctives                          | ✅ livré |
| 5   | FinOps : saisie/import des coûts, rapport                                                   | à faire  |
| 6   | Dashboards BI et historique                                                                 | à faire  |
| 7   | Durcissement : polices auto-hébergées, revue sécurité, mise en production                   | à faire  |

Déjà en place pour les lots suivants : le schéma `finops_costs`, le job d'expiration annuelle des
conformités, le journal d'audit, la matrice de permissions complète (évaluation, plans d'action,
FinOps, administration).
