# Rangement Git — audit du 6 novembre 2026

L'inventaire a été vérifié sur les références GitHub et les PR, sans suppression.
Il révèle **88 branches distantes** :

- **77** correspondent exactement à la tête d'une PR fusionnée dans main ;
- **2** autres pointent sur un ancêtre de main ;
- **7** portent une PR ouverte et doivent être conservées ;
- **2** sont protégées : main et archive/rustines-esthetiques-20260731.

Les **79 candidates au nettoyage** sont donc identifiées par une preuve
d'intégration, pas seulement par leur nom ou leur ancienneté. Aucune n'a été
supprimée : l'accès d'écriture GitHub renvoie HTTP 403, et ce rapport constitue
un inventaire, pas une autorisation de suppression. Recontrôler les têtes et les
PR juste avant tout nettoyage ; ne jamais supprimer une branche qui a avancé
ou porte une nouvelle PR. Une suppression doit utiliser la tête attendue comme
condition pour refuser une modification concurrente.

## Branches portant une PR ouverte

- `ci/firefox-audio-paths` : [PR #56](https://github.com/So1968/Vogue-Marry/pull/56)
- `dependabot/npm_and_yarn/main/globals-17.13.0` : [PR #90](https://github.com/So1968/Vogue-Marry/pull/90)
- `dependabot/npm_and_yarn/main/lucide-react-1.61.0` : [PR #92](https://github.com/So1968/Vogue-Marry/pull/92)
- `dependabot/npm_and_yarn/main/multer-2.5.0` : [PR #93](https://github.com/So1968/Vogue-Marry/pull/93)
- `dependabot/npm_and_yarn/main/react-19.3.1` : [PR #89](https://github.com/So1968/Vogue-Marry/pull/89)
- `dependabot/npm_and_yarn/main/react-dom-19.3.1` : [PR #91](https://github.com/So1968/Vogue-Marry/pull/91)
- `docs/audio-contract-2026-10-22` : [PR #57](https://github.com/So1968/Vogue-Marry/pull/57)

## Travail local en attente de publication

Les consolidations de cette mission forment une suite linéaire depuis main ;
les références par lot sont des repères pour de futures PR, pas des développements
concurrents. Elles sont conservées tant que la publication et l'intégration ne
sont pas possibles. La branche de consolidation active est `codex/consolidation-v1`. Une branche locale
`main` suit `origin/main` sans modification de ses commits. La branche locale
antérieure fix/local-api-browser-access
est également conservée et ne doit pas être supprimée implicitement.

Organisation visée : main stable, une branche de consolidation active, les
branches des PR encore ouvertes et l'archive volontaire. Après intégration et
vérification CI, supprimer les branches de travail devenues inutiles et activer
la suppression automatique des branches après fusion si le propriétaire le souhaite.

Le README a été corrigé pour distinguer la politique cible et l'état constaté.
Une tête ancienne différente de main ne signifie pas que ses modifications
manquent dans main : les PR peuvent avoir été fusionnées par squash, ce que
l'audit prend en compte.
