# Sécurité

## Contexte et modèle de menace

Application interne d'entreprise. Elle manipule des informations sensibles (inventaire des usages
IA, sensibilité des données, non-conformités, coûts). Menaces considérées :

- vol ou usurpation de session (XSS, CSRF, cookie dérobé) ;
- force brute et énumération de comptes sur la connexion ;
- élévation de privilège (un utilisateur standard qui crée/modifie, un manager qui « audite ») ;
- injection (SQL, contenu) et données invalides ;
- perte de traçabilité (suppression ou altération d'enregistrements).

## Mesures en place

### Authentification

| Mesure | Détail | Code |
| --- | --- | --- |
| Hachage scrypt | N=2^15, r=8, p=1, sel 16 octets, comparaison en temps constant | `server/src/auth/password.ts` |
| Pas d'énumération | E-mail inconnu ⇒ on vérifie quand même un hash leurre (même temps de réponse) et on renvoie le même message que pour un mauvais mot de passe | `auth/local-provider.ts`, `modules/auth.routes.ts` |
| Anti force brute | 5 tentatives / minute / IP sur `POST /api/auth/login` → 429 ; 300 req/min ailleurs | `config.ts`, `plugins/security.ts` |
| Journal | `login`, `login_failed`, `logout` dans `audit_log` avec IP | `modules/auth.routes.ts` |

### Sessions

| Mesure | Détail | Code |
| --- | --- | --- |
| Identifiant aléatoire | 32 octets (`crypto.randomBytes`), stocké en base, rien d'autre dans le cookie | `auth/session.ts` |
| Cookie durci | `HttpOnly` (invisible au JS), `SameSite=Strict`, `Secure` en production, `Path=/` | `modules/auth.routes.ts` |
| Expiration | 8 h glissantes (`SESSION_TTL_HOURS`) ; purge horaire des sessions expirées | `auth/session.ts`, `server.ts` |
| Révocation | `logout` supprime la ligne ; un compte désactivé (`is_active = 0`) perd immédiatement l'accès | `auth/session.ts` |

### CSRF

Deux barrières indépendantes (`plugins/security.ts`) :

1. le cookie est `SameSite=Strict` : jamais envoyé depuis un autre site ;
2. sur toute requête non-GET, l'API refuse (403) si `Sec-Fetch-Site` vaut `cross-site`/`same-site`, ou si
   l'hôte de l'en-tête `Origin` diffère de `Host`.

En développement, Vite relaie `/api` sans `changeOrigin` pour que `Host` reste `localhost:5173`
(voir `client/vite.config.ts`).

### Contrôle d'accès (RBAC)

- Matrice unique dans `shared/src/roles.ts`. Le serveur l'applique via `app.requirePermission('x:y')`
  (401 sans session, 403 sans permission). Le client n'en fait qu'un usage d'affichage.
- Règle de visibilité des brouillons appliquée **dans le SQL** (`applications.repo.ts › visibilityClause`),
  pas seulement dans l'UI. Un brouillon d'autrui renvoie **404** (rien n'est révélé).
- Tests : `tests/permissions.test.ts`, `tests/applications.test.ts`.

### Validation et injection

- Toute entrée passe par un schéma Zod **côté serveur** (`lib/validate.ts`), même si le client a déjà validé.
- 100 % des requêtes SQL sont paramétrées (`?`). Aucune concaténation de valeur.
- React échappe le contenu par défaut ; aucun `dangerouslySetInnerHTML`.

### En-têtes HTTP (`@fastify/helmet`)

CSP `default-src 'self'` (scripts/styles/images/connexions limités à l'origine, polices Google
autorisées explicitement), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, HSTS en HTTPS. Effectif en production quand Fastify sert le front.

### Erreurs et journaux

- Format d'erreur unique ; les 5xx ne renvoient jamais de stack trace (`app.ts › setErrorHandler`).
- Les logs Fastify (pino) ne contiennent ni mot de passe ni cookie.

### Intégrité des données

- **Pas de suppression physique** : triggers `BEFORE DELETE` sur `users`, `applications`, `finops_costs`,
  `audit_log` (`db/migrations/001_init.sql`). Le statut `deleted` porte `deleted_by` et `deleted_at`.
- **Audit immuable** : triggers `BEFORE UPDATE/DELETE` sur `audit_log`.
- Contraintes `CHECK` sur les statuts, rôles, formats de mois ; clés étrangères activées.
- Tests : `tests/compliance.test.ts`.

### Exposition réseau

- L'API n'écoute que sur `127.0.0.1` par défaut (`API_HOST`).
- Aucune donnée personnelle dans les URL (identifiants numériques uniquement).

## Vérifier

```bash
npm test          # 26 tests dont auth, CSRF, RBAC, rate-limit, triggers
npm audit         # vulnérabilités connues des dépendances
```

Contrôle manuel rapide : se connecter en `lucas.petit@poryg.local` (standard), taper l'URL
`/applications/nouvelle` → page 403 ; puis `curl -X POST http://127.0.0.1:3000/api/applications`
avec son cookie → `403 FORBIDDEN`.

## Reste à faire (lot 7)

- HTTPS via reverse proxy + `trustProxy: true` ; HSTS.
- SSO OIDC (voir `architecture.md`) ; conserver le rôle en base.
- Polices auto-hébergées (supprime `fonts.googleapis.com` de la CSP et la fuite d'IP vers Google).
- Politique de mot de passe et rotation pour les comptes locaux résiduels (ou les supprimer après SSO).
- Journal des **lectures** sensibles (qui a consulté quelle fiche) si le DPO le demande.
- Sauvegardes chiffrées de `data/poryg.db`.
- Revue de sécurité externe / test d'intrusion avant ouverture à toute l'entreprise.
