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

### SSO Google

| Mesure | Détail | Code |
| --- | --- | --- |
| PKCE (S256) | Le `code_verifier` ne quitte jamais le serveur ; un code intercepté est inexploitable | `auth/google-sso.ts` |
| `state` anti-CSRF | 32 octets aléatoires, comparés en temps constant au retour | `google-sso.ts › safeEquals` |
| `nonce` anti-rejeu | Lie l'ID token à cette demande précise ; un token réutilisé est refusé | `validateIdTokenClaims` |
| Cookie d'état signé | `httpOnly`, `SameSite=Lax` (obligatoire pour un retour inter-site), chemin `/api/auth/google`, 10 min | `modules/auth.routes.ts` |
| Claims validés | émetteur, destinataire (`aud`), expiration, `nonce`, `email_verified` | `validateIdTokenClaims` |
| Pas d'auto-provisioning | Une adresse Google inconnue est refusée et journalisée : le registre ne s'ouvre pas à tout compte Google | `modules/auth.routes.ts` |
| Rôle non délégué | Le rôle vient de `users.role`, jamais d'un claim Google | `modules/auth.routes.ts` |
| Secret côté serveur | `client_secret` uniquement dans `.env` (ignoré par git), jamais exposé au navigateur | `config.ts`, `.gitignore` |

Sur la non-vérification de la signature du JWT : voir l'explication dans
[architecture.md](architecture.md#le-sso-google) — l'ID token est obtenu par un appel HTTPS direct au
point de terminaison de Google, cas explicitement couvert par la spécification OIDC §3.1.3.7.

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
- **Deux niveaux** : la permission de rôle, puis la règle de propriété (`canEditApplication`,
  `canSubmitApplication`) — un Application Manager ne modifie que ses propres applications, même
  s'il a la permission `application:update`.
- Règle de visibilité des brouillons appliquée **dans le SQL** (`applications.repo.ts › visibilityClause`),
  pas seulement dans l'UI. Un brouillon d'autrui renvoie **404** (rien n'est révélé), y compris sur
  son historique.
- Le champ `permissions` renvoyé par la fiche est calculé côté serveur : le client ne décide rien.
- Le **coût du mois** porté par chaque application n'est calculé en SQL que si l'utilisateur a
  `finops:read` ; sinon la colonne vaut `NULL` et la donnée ne quitte jamais le serveur.
- Tests : `tests/permissions.test.ts`, `tests/applications.test.ts`, `tests/inventory.test.ts`.

### Validation et injection

- Toute entrée passe par un schéma Zod **côté serveur** (`lib/validate.ts`), même si le client a déjà
  validé — y compris les paramètres de filtrage de l'inventaire (une valeur inconnue → 400).
- 100 % des requêtes SQL sont paramétrées (`?`). Aucune concaténation de valeur.
- La recherche libre échappe `%`, `_` et `\` avant le `LIKE ... ESCAPE '\'` : un utilisateur ne peut
  pas transformer sa recherche en joker et contourner le filtrage.
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
npm test          # 142 tests : auth, SSO, CSRF, RBAC, propriété, filtres, scoring, triggers
npm audit         # vulnérabilités connues des dépendances
```

Le **verdict de conformité n'est jamais reçu du client** : le serveur recalcule le score à partir
des réponses effectivement enregistrées en base (`submitEvaluation`). Une évaluation soumise est
ensuite figée par un trigger SQL, et ni les évaluations ni les plans d'action ne peuvent être
supprimés physiquement.

Le parcours SSO est testé de bout en bout sans réseau (`tests/google-sso.test.ts`) : l'échange du
code est intercepté et l'ID token fabriqué, ce qui permet de vérifier les refus (state falsifié,
cookie altéré, token expiré, mauvais `nonce`, adresse inconnue, compte désactivé).

Contrôle manuel rapide : se connecter en `lucas.petit@poryg.local` (standard), taper l'URL
`/applications/nouvelle` → page 403 ; puis `curl -X POST http://127.0.0.1:3000/api/applications`
avec son cookie → `403 FORBIDDEN`.

## Reste à faire (lot 7)

- HTTPS via reverse proxy + `trustProxy: true` ; HSTS.
- Fixer `COOKIE_SECRET` en production (sinon il est régénéré à chaque redémarrage).
- Mettre à jour `GOOGLE_REDIRECT_URI` et l'URI autorisée dans la console Google avec le domaine réel.
- Polices auto-hébergées (supprime `fonts.googleapis.com` de la CSP et la fuite d'IP vers Google).
- Supprimer les comptes de démonstration par mot de passe une fois le SSO en place.
- Journal des **lectures** sensibles (qui a consulté quelle fiche) si le DPO le demande.
- Sauvegardes chiffrées de `data/poryg.db`.
- Revue de sécurité externe / test d'intrusion avant ouverture à toute l'entreprise.
