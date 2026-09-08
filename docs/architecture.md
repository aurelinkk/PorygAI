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

### Modules

Un domaine métier = deux fichiers dans `server/src/modules/` :

- `<domaine>.routes.ts` — déclare les routes HTTP, choisit la permission, valide l'entrée, appelle le repo.
- `<domaine>.repo.ts` — SQL, mapping ligne → DTO, transactions, audit. Aucune notion HTTP.

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
- **Seed** (`db/seed.ts`) : idempotent, utilisé par `npm run db:seed` et par les tests.

Schéma actuel (migration 001) : `users`, `sessions`, `applications`, `finops_costs`, `audit_log`.
Les tables des questionnaires, évaluations et plans d'action arriveront avec les lots 3 et 4.

---

## Le client

- **Routage** (`App.tsx`) : `/login` public ; `/` et ses enfants sous `<RequireAuth>` + `<AppShell>`.
  `<RequirePermission permission="…">` protège une page par la matrice partagée (affiche la page 403).
- **Authentification** (`auth/AuthContext.tsx`) : au chargement, `GET /api/auth/me` restaure la session
  (le cookie est httpOnly, le JS ne le lit jamais). `login()` / `logout()` mettent à jour `user`.
  Si l'API répond 401 en cours de navigation, un événement global remet `user` à `null` → retour au login.
- **Appels API** (`api/client.ts`) : `api.get` / `api.post`, erreurs typées `ApiError { status, code, fields }`.
  `useApi(url)` charge une ressource au montage (`{ data, error, loading, reload }`). Pas de cache :
  inutile pour l'instant, à reconsidérer si les pages se multiplient.
- **Formulaires** : état React + `schema.safeParse()` du même schéma Zod que le serveur. Les erreurs sont
  affichées dans un résumé en tête de formulaire (focus déplacé dessus) et sous chaque champ.
- **Composants UI** (`components/ui/`) : `Button`, `TextField`/`SelectField`/`TextareaField`/`RadioGroupField`,
  `Card`, `Alert`/`FormErrorSummary`, `Kpi`, `RoleBadge`/`StatusPill`. Tous en éléments natifs.
- **Styles** : `tokens.css` (variables de la charte) → `base.css` (reset, typo, focus, grille) →
  `components.css` (composants). Classes BEM légères. Aucune valeur de couleur hors de `tokens.css`.

---

## Brancher un SSO (OIDC)

L'authentification est isolée derrière l'interface `AuthProvider` (`server/src/auth/provider.ts`) :

```ts
interface AuthProvider {
  kind: 'local' | 'oidc';
  authenticate(input: AuthInput): Promise<Identity | null>; // { email, displayName, externalId? }
}
```

Le provider répond « qui est cette personne ? ». **Sessions, rôle et permissions restent à Poryg'AI** :
le rôle est stocké dans `users.role`, attribué par l'AI Officer, jamais déduit de l'IdP.

Étapes pour passer en SSO (lot 7) :

1. Créer `auth/oidc-provider.ts` avec la bibliothèque `openid-client` : `GET /api/auth/oidc/start`
   redirige vers l'IdP ; `GET /api/auth/oidc/callback` échange le `code` et renvoie une `Identity`
   (`externalId` = claim `sub`).
2. Dans `auth.routes.ts`, à la réception d'une identité : chercher l'utilisateur par `external_id`
   puis par e-mail ; le créer au besoin avec le rôle `standard` (« auto-provisioning »).
3. Choisir le provider par configuration dans `app.ts` (`AUTH_PROVIDER=oidc`).
4. Sur la page de connexion, remplacer le formulaire par un bouton « Se connecter avec le SSO ».

Pour un test local réaliste : Keycloak en Docker (`quay.io/keycloak/keycloak start-dev`).

---

## Mise en production

```bash
npm run build                      # client/dist
NODE_ENV=production npm start      # Fastify sert l'API et le front (ou via .env)
```

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
