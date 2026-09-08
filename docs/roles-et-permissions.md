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
| `application:update_any`      |          |             |          |     | ✅         | 2 |
| `application:submit`          |          | ✅ (les siennes) |     |     | ✅         | 2 |
| `application:delete` (logique) |         |             |          |     | ✅         | 2 |
| `application:restore`         |          |             |          |     | ✅         | 2 |
| `application:history`         |          | ✅          | ✅       | ✅  | ✅         | 2 |
| `evaluation:fill`             |          | ✅          |          |     | ✅         | 3 |
| `evaluation:decide`           |          |             | ✅       |     | ✅         | 4 |
| `evaluation:dpo_opinion`      |          |             |          | ✅  | ✅         | 4 |
| `action_plan:create`          |          |             | ✅       | ✅  | ✅         | 4 |
| `action_plan:execute`         |          | ✅          |          |     | ✅         | 4 |
| `finops:read`                 |          | ✅          | ✅       | ✅  | ✅         | 5 |
| `dashboard:read`              | ✅       | ✅          | ✅       | ✅  | ✅         | 1 |
| `admin:referentiels`          |          |             |          |     | ✅         | 7 |
| `admin:users`                 |          |             |          |     | ✅         | 7 |

Règles complémentaires, au-delà de la simple permission de rôle :

- **Brouillons** (`draft`) : visibles uniquement par leur Process Owner, leur créateur, et les rôles
  ayant `application:read_all_drafts`. Un brouillon d'autrui renvoie 404 (pas 403 : on ne révèle
  pas son existence). Appliqué **dans le SQL** (`applications.repo.ts › visibilityClause`).
- **Propriété** : un Application Manager ne modifie et n'envoie à l'audit que les applications dont
  il est Process Owner ou déclarant. `application:update_any` (AI Officer) lève cette restriction.
  Fonctions `canEditApplication` / `canSubmitApplication` dans `shared/src/roles.ts` — utilisées par
  le serveur (403) **et** par le client (masquage des boutons).
- **Application supprimée** : plus aucune modification possible, quel que soit le rôle.

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
   SQL refusent tout `DELETE` sur les tables métier. La **restauration** relit le statut d'avant dans
   le journal d'audit (une application conforme supprimée puis restaurée redevient conforme).
3. **Traçabilité** — toute action porte son auteur et son horodatage (`audit_log`, table immuable).
   La fiche d'une application affiche cet historique, avec le détail des champs modifiés.

### Le questionnaire d'évaluation

Défini dans `shared/src/questionnaire.ts` (versionné avec le code, comme les référentiels).
9 questions réparties en 4 piliers, **18 points** au total : Oui = 2, Partiellement = 1, Non = 0.

| Pilier | Questions | Dont éliminatoires |
| --- | --- | --- |
| A. Sécurité & Données | A1, A2, A3 | A1 (hébergement), A2 (données sensibles) |
| B. Transparence | B1, B2 | B1 (information des utilisateurs) |
| C. Équité & Supervision | C1, C2 | C1 (humain dans la boucle) |
| D. FinOps & Éco-conception | D1, D2 | — |

**Scoring hybride.** L'application est *Conforme* si le score ≥ **14/18** **ET** qu'aucun critère
éliminatoire n'a obtenu 0. Un seul « Non » sur un éliminatoire suffit à basculer en *Non conforme*,
même avec 16/18. Le calcul est celui de `scoreEvaluation()` — la même fonction sert au client
(affichage en direct pendant la saisie) et au serveur (calcul qui fait foi à la soumission).

**Effets de la soumission :**

- *Conforme* → statut `compliant` et échéance à +12 mois ; le job d'expiration annuelle prendra le relais.
- *Non conforme* → statut `non_compliant`, échéance effacée, et **une action corrective par question
  à 0 ou 1 point**, avec le texte de remédiation prévu pour cette question. Échéance par défaut :
  90 jours pour un critère éliminatoire, 180 jours sinon ; responsable = le Process Owner.

> La fiche d'évaluation d'origine mentionne, en cas de non-conformité, une action système
> « l'application est bloquée ». Point tranché avec le métier : **cela désigne le statut
> `non_compliant` lui-même**, pas un mécanisme supplémentaire. Poryg'AI est un registre et n'a
> aucune prise technique sur les applications inventoriées — il n'y a donc rien à implémenter de plus.

> L'échéance de conformité est posée à **+12 mois** (date anniversaire) plutôt qu'à 365 jours fixes :
> cela colle à la règle de gestion « conforme pendant un an » et ne dérive pas les années bissextiles.

**Qui fait quoi :** `evaluation:fill` (AI Officer, Application Manager, Auditeur) permet de saisir et
d'enregistrer un brouillon ; `evaluation:decide` (AI Officer, Auditeur) permet de **soumettre**, ce
qui déclenche le verdict. Le DPO consulte. Une évaluation soumise est figée en base (trigger SQL) :
c'est la preuve de l'audit. Une nouvelle soumission crée une nouvelle évaluation, l'historique reste.

### Règle ajoutée au lot 2 : réévaluation après modification

Modifier le **domaine métier**, la **sensibilité des données** ou le **type d'IA** d'une application
déjà décidée (Conforme ou Non conforme) la replace en `in_progress` et efface son échéance : ce qui
a été audité ne correspondrait plus à ce qui est déclaré.

Les autres champs (nom, description, Process Owner) ne déclenchent pas de réévaluation. La liste est
dans `REEVALUATION_FIELDS` (`shared/src/schemas.ts`), et l'utilisateur est prévenu avant d'enregistrer.

Cette règle ne figure pas explicitement dans le brief : elle en découle (« conforme pendant un an
puis ré-évaluer toutes les évolutions »). À confirmer avec le métier.

## Ce que chaque rôle voit sur l'accueil (lot 1)

| Rôle           | Bloc « Mes évaluations »                                             |
| -------------- | -------------------------------------------------------------------- |
| App Manager    | Ses brouillons à compléter, ses questionnaires à renseigner, ses plans d'action |
| Auditeur       | Applications `in_progress` à auditer                                 |
| DPO            | Applications `in_progress` à données personnelles ou sensibles       |
| AI Officer     | Applications en cours d'audit et non conformes                       |
| Standard       | (bloc vide)                                                          |
