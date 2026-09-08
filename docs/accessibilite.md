# Accessibilité

Référentiel visé : **WCAG 2.2 niveau AA** (équivalent RGAA 4.1). L'accessibilité est traitée dans
le code, pas en surcouche : éléments natifs, relations explicites, focus géré.

## Règles appliquées

### Structure et navigation

- `<html lang="fr">`, un `<title>` distinct par page (`document.title` dans chaque page).
- Un seul `<main id="main">` par page, `<header>`, `<nav aria-label="Navigation principale">`, `<footer>`.
- Lien d'évitement « Aller au contenu principal » visible au focus (`base.css › .skip-link`).
- Hiérarchie de titres respectée : un `h1` par page, `h2` pour les cartes.
- À chaque changement de page, le focus est replacé sur `<main>` (`AppShell.tsx`) : les lecteurs
  d'écran annoncent la nouvelle page, la navigation clavier repart du bon endroit.
- Lien actif de la navigation signalé par `aria-current="page"` (React Router `NavLink`).

### Clavier et focus

- Tout est atteignable au clavier : boutons `<button>`, liens `<a>`, champs natifs.
- Anneau de focus unique et contrasté : `outline: 3px solid #8B7BE8` (`base.css › :focus-visible`).
  Sur les champs, l'état actif reprend le « champ actif » de la charte (bordure bleue + halo).
- Cibles tactiles ≥ 44 px (`--tap-target`) sur boutons, champs, radios.

### Formulaires

- `<label for>` sur chaque champ ; groupes de radios en `<fieldset>` + `<legend>`.
- Aide (`aria-describedby` → `#id-hint`) et erreur (`#id-error`) reliées au champ ; `aria-invalid="true"` en erreur.
- Champs obligatoires : `aria-required` + astérisque expliqué en tête de formulaire.
- Validation à la soumission (`noValidate` pour éviter les bulles navigateur non traduites) : un
  **résumé des erreurs** (`role="alert"`) reçoit le focus et liste des liens vers chaque champ fautif.
- Messages de succès/état en `role="status"` (annonce polie), erreurs bloquantes en `role="alert"`.
- `autocomplete` sur e-mail et mot de passe.

### Tableaux triables

- L'en-tête cliquable est un vrai `<button>` dans le `<th>` : atteignable au clavier, annoncé comme
  bouton, cible de 44 px de haut.
- Le `<th>` porte `aria-sort="ascending" | "descending" | "none"` — c'est ce que les lecteurs d'écran
  annoncent. Une seule colonne est active à la fois.
- La flèche (▲ ▼ ↕) n'est qu'un renfort visuel, marquée `aria-hidden` : l'information ne passe jamais
  par le seul symbole.
- Les dates sont dans un `<time datetime="…">` : valeur machine exacte, affichage en français.
- Le tri par statut suit l'ordre du cycle de vie (Draft → In progress → Conforme → Non conforme →
  Deleted), plus utile qu'un ordre alphabétique.

### Couleurs et contrastes

- Le statut n'est **jamais** porté par la couleur seule : pastille décorative (`aria-hidden`) + libellé.
- Application supprimée : grisée **par la couleur** (pas par une opacité) et barrée.
- Contrastes vérifiés (formule WCAG, arrondis) :

| Texte / fond                              | Ratio | Seuil        | OK |
| ----------------------------------------- | ----- | ------------ | -- |
| Encre `#1A1526` / Crème `#FDF3F6`         | 16:1  | 4,5:1        | ✅ |
| Lien `#C42F66` / Blanc                    | 5,3:1 | 4,5:1        | ✅ |
| Lien `#C42F66` / Crème                    | 4,9:1 | 4,5:1        | ✅ |
| Survol de lien `#12586F` / Crème          | 7,3:1 | 4,5:1        | ✅ |
| Texte secondaire `#6B6280` / Crème        | 5,3:1 | 4,5:1        | ✅ |
| Texte secondaire / Blanc                  | 5,8:1 | 4,5:1        | ✅ |
| Encre / Rose `#FF6F9C` (bouton primaire)  | 6,9:1 | 4,5:1        | ✅ |
| Encre / Bleu `#3BB7E6` (badge manager)    | 7,8:1 | 4,5:1        | ✅ |
| Encre / Violet `#8B7BE8` (badge DPO)      | 5,2:1 | 4,5:1        | ✅ |
| Bleu texte `#12586F` / Bleu pastel        | 6,8:1 | 4,5:1        | ✅ |
| Rouge foncé `#9E1F2F` / Rouge pastel      | 6,3:1 | 4,5:1        | ✅ |
| Vert foncé `#0F6B4F` / Vert pastel        | 5,7:1 | 4,5:1        | ✅ |
| Dégradé titre `#E24E85`→`#1F7E9E` / Crème | 3,4 – 4,3:1 | 3:1 (grand texte ≥ 24 px gras) | ✅ |
| Anneau de focus `#8B7BE8` / Crème         | 3,2:1 | 3:1 (non-texte) | ✅ |

### Mouvement et affichage

- `prefers-reduced-motion: reduce` neutralise l'animation du logo et les transitions.
- Mode contraste forcé (Windows) : le titre en dégradé repasse en couleur système (`forced-colors`).
- Grille fluide : 3 → 2 → 1 colonnes ; les tableaux défilent horizontalement dans leur conteneur,
  jamais la page. Zoom 200 % sans perte de contenu.
- Tailles en px conformes à la charte mais le texte reste zoomable (aucun `user-scalable=no`).

## Écarts assumés par rapport à la charte

| Charte                                   | Appliqué                                  | Pourquoi                                                   |
| ---------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Liens en `#E24E85`, annoncé « ≥ 4,5:1 »  | `--rose-lien` `#C42F66`                   | Mesure faite : `#E24E85` ne donne que **3,71:1** sur blanc et 3,41:1 sur crème. L'affirmation de la charte est inexacte pour du texte sur fond clair. `#C42F66` tient 5,32:1 / 4,90:1. `#E24E85` reste utilisé pour les dégradés et les bordures (non textuels). |
| Survol de lien en bleu `#1F7E9E`         | `#12586F`                                 | 4,26:1 sur crème, sous le seuil ; `#12586F` tient 7,3:1     |
| Badge DPO : texte blanc sur violet       | Texte Encre sur violet                    | Blanc/violet = 3,4:1, insuffisant pour du texte 13 px       |
| Dégradé rose vif → bleu vif sur les titres | Dégradé des versions foncées `#E24E85`→`#1F7E9E` | Le rose vif sur crème ne fait que 2,6:1 ; les foncés passent le seuil grand texte |
| Astérisque « obligatoire » rouge vif      | Rouge foncé `#9E1F2F`                     | 4,2:1 → 7,8:1                                              |

## Tester

Checklist manuelle à dérouler sur `/login`, `/`, `/applications/nouvelle` :

1. **Clavier seul** : Tab depuis l'URL → le lien d'évitement apparaît ; parcourir toute la page ;
   soumettre un formulaire vide avec Entrée → le focus va sur le résumé d'erreurs ; suivre un lien
   du résumé → le focus va sur le champ.
2. **Lecteur d'écran** (NVDA sous Windows, VoiceOver sous macOS) : titre de page annoncé, rôles
   des boutons/liens corrects, libellé + aide + erreur lus sur chaque champ, statut lu avec son libellé.
3. **Zoom 200 %** et fenêtre 375 px de large : rien de tronqué, pas de défilement horizontal de la page.
4. **Outil automatique** : extension navigateur *axe DevTools* ou *Lighthouse › Accessibility* — objectif
   0 violation critique/sérieuse. (Les avertissements sur les polices externes n'en font pas partie.)

## Reste à faire

- Auto-héberger Baloo 2, DM Sans et Space Mono (`client/public/fonts/`, `@font-face` avec `font-display: swap`) :
  supprime la dépendance réseau à Google (RGPD) et les avertissements CSP.
- Ajouter un test automatique axe dans une suite Playwright quand les écrans se multiplieront (lot 2+).
- Déclaration d'accessibilité (obligatoire pour un service public, recommandée en entreprise).
