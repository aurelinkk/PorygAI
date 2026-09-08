# Rôles, permissions et cycle de vie

Source de vérité : `shared/src/roles.ts` (matrice) et `shared/src/statuses.ts` (statuts).
Ce document explique ; le code fait foi.

## Les cinq rôles

| Rôle (code)                      | Mission                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| AI Officer (`ai_officer`)        | Pilote le registre : voit tout, administre référentiels et comptes, peut tout faire (y compris supprimer logiquement). |
| Application Manager (`app_manager`) | Process Owner opérationnel : déclare ses applications, remplit les questionnaires, exécute les plans d'action. |
| DPO (`dpo`)                      | Protection des données : avis (bloquant) sur les applications traitant des données personnelles ou sensibles, peut créer des plans d'action. |
| Auditeur (`auditor`)             | Évalue et **décide** Conforme / Non conforme, crée les plans d'action.                        |
| Utilisateur standard (`standard`) | Consultation de l'inventaire (hors brouillons) et du tableau de bord.                        |

Un utilisateur a **un seul rôle** (`users.role`). Choix de simplicité : si un besoin de cumul apparaît
(ex. DPO + AI Officer), remplacer la colonne par une table `user_roles` et adapter `can()`.

### Comptes de l'équipe

Créés par la migration `002_comptes_equipe.sql`, ils se connectent **uniquement** par le SSO Google
(`password_hash` à NULL) :

| Adresse Google                 | Nom              | Rôle                |
| ------------------------------ | ---------------- | ------------------- |
| cleomarinmarie@gmail.com       | Cléo Marin       | AI Officer          |
| aurelien.chiquet44@gmail.com   | Aurélien Chiquet | Application Manager |
| chatet.maelle@gmail.com        | Maëlle Chatet    | DPO                 |

Changer un rôle, ou inscrire une nouvelle personne :

```sql
UPDATE users SET role = 'auditor' WHERE email = 'chatet.maelle@gmail.com';
INSERT INTO users (email, display_name, role) VALUES ('nouveau@gmail.com', 'Prénom Nom', 'standard');
```

Une adresse absente de cette table ne peut pas se connecter, même avec un compte Google valide
(pas de création automatique — voir [securite.md](securite.md#sso-google)).

## Matrice

| Permission                    | Standard | App Manager | Auditeur | DPO | AI Officer | Utilisée dès le lot |
| ----------------------------- | :------: | :---------: | :------: | :-: | :--------: | :-----------------: |
| `application:read`            | ✅       | ✅          | ✅       | ✅  | ✅         | 1 |
| `application:read_all_drafts` |          |             |          |     | ✅         | 1 |
| `application:create`          |          | ✅          |          |     | ✅         | 1 |
| `application:update`         |          | ✅ (les siennes) |     |     | ✅         | 2 |
| `application:delete` (logique) |         |             |          |     | ✅         | 2 |
| `evaluation:fill`             |          | ✅          |          |     | ✅         | 3 |
| `evaluation:decide`           |          |             | ✅       |     | ✅         | 4 |
| `evaluation:dpo_opinion`      |          |             |          | ✅  | ✅         | 4 |
| `action_plan:create`          |          |             | ✅       | ✅  | ✅         | 4 |
| `action_plan:execute`         |          | ✅          |          |     | ✅         | 4 |
| `finops:read`                 |          | ✅          | ✅       | ✅  | ✅         | 5 |
| `dashboard:read`              | ✅       | ✅          | ✅       | ✅  | ✅         | 1 |
| `admin:referentiels`          |          |             |          |     | ✅         | 7 |
| `admin:users`                 |          |             |          |     | ✅         | 7 |

Règles complémentaires appliquées dans le SQL (pas seulement par permission) :

- **Brouillons** (`draft`) : visibles uniquement par leur Process Owner, leur créateur, et les rôles
  ayant `application:read_all_drafts`. Un brouillon d'autrui renvoie 404.
- **Modification** : un Application Manager ne modifie que les applications dont il est Process Owner
  (à implémenter au lot 2 avec `application:update`).

### Ajouter une permission

1. Ajouter la ligne dans `PERMISSIONS` (`shared/src/roles.ts`) — le type `Permission` se met à jour tout seul.
2. Protéger la route : `{ preHandler: app.requirePermission('nouvelle:permission') }`.
3. Côté client, masquer l'action : `can(user.role, 'nouvelle:permission')`.
4. Compléter `server/tests/permissions.test.ts` et ce document.

## Cycle de vie d'une application

```
             déclaration                soumission               décision auditeur
  (rien) ───────────────► draft ───────────────────► in_progress ─────┬────► compliant
                                                          ▲           │
                                                          │           └────► non_compliant
                                                          │                     │ plan d'action
                                                          │  1 an après la      │ puis nouvelle
                                                          └──── conformité ─────┘ évaluation

  deleted : depuis n'importe quel statut, par l'AI Officer. Jamais de DELETE SQL.
```

| Statut          | Libellé       | Signification                                                                      |
| --------------- | ------------- | ---------------------------------------------------------------------------------- |
| `draft`         | Draft         | En cours de saisie. Modifiable par le Process Owner, invisible des tableaux de conformité. |
| `in_progress`   | In progress   | En cours d'audit. Aussi le statut automatique un an après une mise en conformité.  |
| `compliant`     | Conforme      | Toutes les exigences satisfaites. `compliance_valid_until` = décision + 12 mois.   |
| `non_compliant` | Non conforme  | Motif obligatoire ; plan d'action avec échéance et responsable.                    |
| `deleted`       | Deleted       | Suppression logique : `deleted_by`, `deleted_at`. Reste affichée, grisée et barrée. |

### Règles de gestion (brief)

1. **Conformité annuelle** — une application `compliant` repasse `in_progress` quand
   `compliance_valid_until` est dépassé. Job `server/src/jobs/compliance-expiry.ts`, exécuté au
   démarrage puis toutes les 24 h ; chaque bascule est tracée (`audit_log`, acteur = système).
2. **Pas de suppression physique** — statut `deleted` + traçabilité « par qui / quand ». Des triggers
   SQL refusent tout `DELETE` sur les tables métier.
3. **Traçabilité** — toute action porte son auteur et son horodatage (`audit_log`, table immuable).

## Ce que chaque rôle voit sur l'accueil (lot 1)

| Rôle           | Bloc « Mes évaluations »                                             |
| -------------- | -------------------------------------------------------------------- |
| App Manager    | Ses brouillons à compléter, ses questionnaires à renseigner, ses plans d'action |
| Auditeur       | Applications `in_progress` à auditer                                 |
| DPO            | Applications `in_progress` à données personnelles ou sensibles       |
| AI Officer     | Applications en cours d'audit et non conformes                       |
| Standard       | (bloc vide)                                                          |
