# Architecture cible de Vogue Marry

## Principe

Vogue Marry est un outil local de mémoire projet. L'interface maritime est une manière de naviguer dans les données ; elle ne doit jamais remplacer les vraies données.

Le parcours fonctionnel de référence est :

**Projet → Escale → Source / audio → Transcription → Journal de bord → Validation → Besoins / actions / décisions → Mémoire → Reprise du cap**

Chaque projet possède un petit manifeste `projet.json`. Il conserve le nom affiché, le contexte de reprise et la date de création sans déduire ces informations du slug technique. Une escale porte également son `projectSlug`, son nom d’escale et sa date de création ; deux escales portant le même titre le même jour ne s’écrasent jamais.

Quand une transcription est liée à une escale, V6 conserve le résultat technique dans `transcription_v6.json` et `transcription_v6.md`, puis remplace sa section gérée dans `journal_de_bord_exporte.md`. L'interface peut ensuite lire le journal et le valider manuellement.

Le Coffre expose les documents locaux via `/api/documents`. Un dépôt arrive d'abord dans `00_WATER_SEVEN_PORT_ENTREE`, reçoit une proposition de classement, puis n'est déplacé vers `08_coffre_documents_sources` qu'après validation humaine. L'API ne renvoie que des chemins relatifs à la mémoire locale, jamais de chemin absolu.

La Longue-vue cherche dans les sources textuelles locales et permet de lire le fichier relatif trouvé. Les versions `99_versions` restent de l'historique et ne polluent pas la recherche courante ; elles ne sont pas ouvertes par défaut depuis cet écran.

Les journaux de bord validés alimentent ensuite trois sorties structurées : les actions proposées dans `03_manoeuvres_actions`, les décisions proposées dans `02_caps_valides_decisions` et les besoins de construction dans `05_ecrans_parcours/besoins.json` / `besoins.md`. Elles restent en attente tant qu'une personne ne les a pas relues et validées ; les marqueurs `Action`, `Décision` et `Besoin utilisateur` sans détail demandent une précision avant enregistrement.

Le journal suit une chaîne de confiance : version exportée modifiable, corrections enregistrées avec historique, puis copie validée protégée contre les modifications. Une validation répétée est idempotente et ne recrée pas de version inutile.

Après validation, ces éléments alimentent le Log Pose persistant du projet dans `10_log_pose/log_pose.json` et `10_log_pose/log_pose.md`. Le résumé conserve le dernier cap validé, les manœuvres prioritaires, les éléments encore en attente et la prochaine direction utile.

## Sources de vérité

Les données utilisateur ne vivent pas dans le code React.

Elles vivent dans :

`~/VOGUE-MERRY-DONNEES`

Le dépôt Git contient le moteur, les composants, les règles et la documentation technique. Il ne contient pas les dossiers réels de l'utilisateur, les audios, les transcriptions de travail ni les secrets.

## Frontend

L'application doit évoluer vers des fonctions séparées :

- `projects` : projets / îles ;
- `meetings` : escales et mode réunion ;
- `transcription` : audio, texte et interlocuteurs ;
- `journal` : compte rendu de travail, validation, historique ;
- `documents` : coffre ;
- `search` : Longue-vue ;
- `needs` : besoins identifiés et construction ;
- `resume` : Log Pose et reprise du contexte.

Pendant la migration, l'écran actuel reste fonctionnel : on extrait les fonctions progressivement au lieu de refaire l'application d'un seul coup.

## Backend local

### API locale unifiée — port 8010

Responsabilités :

- projets ;
- escales ;
- journaux ;
- versions ;
- coffre / dépôt ;
- recherche ;
- validation ;
- accès aux transcriptions ;
- confirmation des interlocuteurs ;
- identification et suivi des besoins.

Les routes documentaires principales sont :

- `GET /api/documents` : documents classés, pièces jointes d'escales et documents entrants à valider ;
- `POST /api/water-seven/deposit` : dépôt local d'un fichier ;
- `POST /api/documents/validate` : classement confirmé vers une île et le Coffre ;
- `GET /api/knowledge/action` et `GET /api/knowledge/decision` : propositions et éléments validés ;
- `POST /api/knowledge/action/validate` et `POST /api/knowledge/decision/validate` : validation humaine d'une action ou d'une décision.
- `GET /api/log-pose` : reprise de contexte globale ou par île ;
- `POST /api/log-pose/save` : sauvegarde des repères manuels du Log Pose.

Le service doit écouter uniquement sur `127.0.0.1`.

L'interface ne connaît que cette adresse. Elle ne contacte jamais directement le moteur de transcription.

### Moteur de transcription V6 — port interne 8011

Responsabilités :

- Faster-Whisper local ;
- Pyannote local ;
- récupération des participants d'une escale ;
- structuration des interventions ;
- cache anti-double lancement ;
- seconde lecture OpenAI uniquement sur demande explicite.

Le moteur écoute uniquement sur `127.0.0.1` et n'est accessible que par la façade 8010. Il reste séparé parce que Faster-Whisper et Pyannote sont lourds et doivent pouvoir travailler sans bloquer l'API mémoire.

### Confirmation des interlocuteurs — exposée par 8010

La confirmation est exécutée par le moteur V6, mais elle passe par la façade unifiée :
`POST /api/transcription/:jobId/speakers`.

Il n'existe plus de service séparé ni de port 8012. La pile locale visible par l'interface se limite à 8010 ; 8011 reste un port interne de travail.

## Règles de sécurité

- aucun service métier exposé sur le réseau local ;
- CORS limité aux origines de développement locales ;
- aucun secret dans Git ni dans le navigateur ;
- clés enregistrées uniquement dans `~/.config/vogue-merry/` avec permissions restreintes ;
- chemins utilisateurs résolus sous une racine connue avant lecture ou écriture ;
- limites explicites sur les uploads ;
- une opération payante ne doit pas pouvoir partir deux fois pour la même demande ;
- le mode local reste le mode par défaut.

## Règles de confiance pour les interlocuteurs

Un nom ne doit être associé automatiquement à une voix que lorsque la personne s'identifie elle-même de manière explicite, par exemple :

- « je suis … » ;
- « je m'appelle … » ;
- « moi c'est … » ;
- « mon nom est … ».

Une salutation contenant le nom d'un tiers ne constitue pas une preuve d'identité.

Le nombre de participants d'une escale est une information de contexte, pas l'obligation pour le moteur de détecter exactement le même nombre de voix.

Quand l'identité reste incertaine, Vogue Marry conserve `Intervenant N` et demande confirmation.

## Règle Git

- `main` : stable ;
- une branche de consolidation / développement active ;
- une fonctionnalité importante doit être testée avant intégration ;
- les anciennes versions restent dans l'historique Git au lieu de rester dans le code actif ;
- les branches d'archive ne sont jamais fusionnées dans le produit courant.
