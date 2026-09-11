# Rôles, permissions et cycle de vie

Source de vérité : `shared/src/roles.ts` (matrice) et `shared/src/statuses.ts` (statuts).
Ce document explique ; le code fait foi.

## Organisations : le rôle appartient à l'appartenance

Le registre est cloisonné par organisation. Une personne peut être membre de plusieurs, **avec un
rôle différent dans chacune** : le rôle est donc porté par la table `memberships`, pas par `users`,
qui ne garde que l'identité (adresse, nom, mot de passe ou identifiant Google).

| Table | Contenu |
| --- | --- |
| `organizations` | nom, identifiant lisible (`slug`), formule d'abonnement, statut |
| `memberships` | qui appartient à quelle organisation, avec quel rôle, actif ou retiré |
| `sessions.organization_id` | l'organisation **active** : c'est elle qui décide du rôle appliqué |

Trois règles de gestion :

1. **Qui crée une organisation en devient l'AI Officer.** C'est le seul rôle qui peut y inviter les
   autres ; il faut bien quelqu'un pour commencer.
2. **Une organisation ne peut pas perdre son dernier AI Officer** : ni en le rétrogradant, ni en le
   retirant. Et personne ne peut retirer ni rétrograder son propre accès (le meilleur moyen de
   s'enfermer dehors) : il faut passer par un autre AI Officer.
3. **Retirer quelqu'un ne supprime rien** : son appartenance passe à `disabled`, ce qu'il a déclaré
   ou évalué reste attribué à son nom. Le réintégrer reconsomme une place dans la formule.

Les **formules d'abonnement** (`shared/src/plans.ts`) ne limitent que le nombre d'applications et de
personnes : Découverte (gratuite, 4 et 5), Équipe (49 €/mois, 25 et 25), Entreprise (199 €/mois,
sans plafond). Aucun paiement n'est encaissé par le projet.

## Les cinq rôles

| Rôle (code)                      | Mission                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| AI Officer (`ai_officer`)        | Pilote le registre : voit tout, administre référentiels et comptes, peut tout faire (y compris supprimer logiquement). |
| Application Manager (`app_manager`) | Process Owner opérationnel : déclare ses applications, remplit les questionnaires, exécute les plans d'action. |
| DPO (`dpo`)                      | Protection des données : avis (bloquant) sur les applications traitant des données personnelles ou sensibles, peut créer des plans d'action. |
| Auditeur (`auditor`)             | Évalue et **décide** Conforme / Non conforme, crée les plans d'action.                        |
| Utilisateur standard (`standard`) | Consultation de l'inventaire (hors brouillons) et du tableau de bord.                        |

Un utilisateur a **un seul rôle par organisation** (`memberships.role`). Choix de simplicité : si un
besoin de cumul apparaît (ex. DPO + AI Officer dans la même organisation), remplacer la colonne par
une table de liaison et adapter `can()`.

### Comptes de l'équipe

Créés par la migration `002_comptes_equipe.sql` et versés par la migration `006` dans
l'organisation d'accueil, ils se connectent **uniquement** par le SSO Google (`password_hash` à
NULL) :

| Adresse Google                 | Nom              | Rôle                |
| ------------------------------ | ---------------- | ------------------- |
| cleomarinmarie@gmail.com       | Cléo Marin       | AI Officer          |
| aurelien.chiquet44@gmail.com   | Aurélien Chiquet | Application Manager |
| chatet.maelle@gmail.com        | Maëlle Chatet    | DPO                 |

Changer un rôle, ou inscrire une nouvelle personne :

En pratique, cela se fait dans l'interface : **Organisation → Personnes** pour un rôle, et
**Importer des comptes** pour inscrire quelqu'un. En SQL, le rôle se change sur l'appartenance et
non sur le compte :

```sql
UPDATE memberships SET role = 'auditor'
 WHERE organization_id = 1
   AND user_id = (SELECT id FROM users WHERE email = 'chatet.maelle@gmail.com');
```

Une adresse absente de la table `users` peut tout de même se connecter avec un compte Google : son
compte est créé à la première connexion, **sans organisation**. Elle ne voit donc rien du registre
et n'a qu'un chemin, « Ajouter mon organisation » : c'est le cloisonnement qui protège, pas la porte
d'entrée (voir [securite.md](securite.md#sso-google)).

## Matrice

| Permission                    | Standard | App Manager | Auditeur | DPO | AI Officer | Utilisée dès le lot |
| ----------------------------- | :------: | :---------: | :------: | :-: | :--------: | :-----------------: |
| `organization:read`           | ✅       | ✅          | ✅       | ✅  | ✅         | 7 |
| `organization:manage`         |          |             |          |     | ✅         | 7 |
| `organization:members`        |          |             |          |     | ✅         | 7 |
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
| `finops:write`                |          | ✅ (les siennes) |     |     | ✅         | 5 |
| `dashboard:read`              | ✅       | ✅          | ✅       | ✅  | ✅         | 1 |
| `admin:referentiels`          |          |             |          |     | ✅         | 7 |
| `admin:users`                 |          |             |          |     | ✅         | 7 |

Règles complémentaires, au-delà de la simple permission de rôle :

- **Brouillons** (`draft`) : visibles uniquement par leur Process Owner, leur créateur, et les rôles
  ayant `application:read_all_drafts`. Un brouillon d'autrui renvoie 404 (pas 403 : on ne révèle
  pas son existence). Appliqué **dans le SQL** (`applications.repo.ts › visibilityClause`).
- **Propriété** : un Application Manager ne modifie et n'envoie à l'audit que les applications dont
  il est Process Owner ou déclarant. `application:update_any` (AI Officer) lève cette restriction.
  Fonctions `canEditApplication` / `canSubmitApplication` dans `shared/src/roles.ts` : utilisées par
  le serveur (403) **et** par le client (masquage des boutons).
- **Application supprimée** : plus aucune modification possible, quel que soit le rôle.

### Ajouter une permission

1. Ajouter la ligne dans `PERMISSIONS` (`shared/src/roles.ts`) : le type `Permission` se met à jour tout seul.
2. Protéger la route : `{ preHandler: app.requirePermission('nouvelle:permission') }`.
3. Côté client, masquer l'action : `can(user.role, 'nouvelle:permission')`.
4. Compléter `server/tests/permissions.test.ts` et ce document.

## Cycle de vie d'une application

```
             déclaration                soumission                 verdict (score /100)
  (rien) ───────────────► draft ───────────────────► in_progress ─────┬────► compliant            (≥ 86, prod)
                                                          ▲           ├────► partially_compliant  (61–85, test)
                                                          │           └────► non_compliant        (≤ 60, plafonné ou refusé)
                                                          │                     │ plan d'action
                                                          │  1 an après la      │ puis nouvelle
                                                          └──── conformité ─────┘ évaluation

  partially_compliant : sans échéance automatique : reste en test jusqu'à réévaluation.
  deleted : depuis n'importe quel statut, par l'AI Officer. Jamais de DELETE SQL.
```

| Statut          | Libellé       | Signification                                                                      |
| --------------- | ------------- | ---------------------------------------------------------------------------------- |
| `draft`         | Draft         | En cours de saisie. Modifiable par le Process Owner, invisible des tableaux de conformité. |
| `in_progress`   | In progress   | En cours d'audit. Aussi le statut automatique un an après une mise en conformité.  |
| `compliant`     | Conforme      | Score ≥ 86/100 : déployable en production. `compliance_valid_until` = décision + 12 mois. |
| `partially_compliant` | Partiellement conforme | Score 61–85 : autorisée en test / pilote. Sans échéance. Plan d'action généré. |
| `non_compliant` | Non conforme  | Score ≤ 60, critère critique manqué (plafond) ou pratique refusée (blocage). Plan d'action. |
| `deleted`       | Deleted       | Suppression logique : `deleted_by`, `deleted_at`. Reste affichée, grisée et barrée. |

### Règles de gestion (brief)

1. **Conformité annuelle** : une application `compliant` repasse `in_progress` quand
   `compliance_valid_until` est dépassé. Job `server/src/jobs/compliance-expiry.ts`, exécuté au
   démarrage puis toutes les 24 h ; chaque bascule est tracée (`audit_log`, acteur = système).
2. **Pas de suppression physique** : statut `deleted` + traçabilité « par qui / quand ». Des triggers
   SQL refusent tout `DELETE` sur les tables métier. La **restauration** relit le statut d'avant dans
   le journal d'audit (une application conforme supprimée puis restaurée redevient conforme).
3. **Traçabilité** : toute action porte son auteur et son horodatage (`audit_log`, table immuable).
   La fiche d'une application affiche cet historique, avec le détail des champs modifiés.

### Le questionnaire d'évaluation (v2)

Conception complète, arbre de décision et liste des questions : **[questionnaire-v2.md](questionnaire-v2.md)**.
Définition en code : `shared/src/questionnaire.ts` (versionnée : `QUESTIONNAIRE_VERSION`).

En résumé :

- **Cadrage** (6 questions, non notées) : pays de déploiement, domaine militaire (→ blocage), domaine à
  fort enjeu, données personnelles, contenu généré / interaction, origine du modèle. Chaque réponse
  active ou masque des questions via `showIf`.
- **8 thèmes notés**, dont un bloc réglementaire **par pays** (UE, États-Unis, Chine, autre) avec sa
  propre barre d'avancement.
- **Score = 100 × points obtenus / points applicables.** Poids : critique 4, standard 2, mineur 1.
  Une question masquée ne compte nulle part.
- **Verdict** : ≥ 86 conforme · 61–85 partiellement conforme · ≤ 60 non conforme. Une question
  **critique** à « Non » plafonne à 60. Deux **blocages** (militaire, pratique interdite AI Act)
  refusent l'évaluation sans score.
- **Recommandations** : une par point perdu, classées par points récupérables ; elles deviennent le
  plan d'action (sauf si conforme).

**Qui fait quoi :** `evaluation:fill` (AI Officer, Application Manager, Auditeur) saisit et enregistre
un brouillon (sauvegarde automatique à chaque étape) ; `evaluation:decide` (AI Officer, Auditeur)
**soumet**, ce qui déclenche le verdict. Une évaluation soumise est figée (trigger SQL). Les
évaluations v1 restent lisibles avec leur barème d'origine (16/18).

### Règle ajoutée au lot 2 : réévaluation après modification

Modifier le **domaine métier**, la **sensibilité des données** ou le **type d'IA** d'une application
déjà décidée (Conforme, Partiellement conforme ou Non conforme) la replace en `in_progress` et efface son échéance : ce qui
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
