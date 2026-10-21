# Contrat existant — Réunions Vogue Mary (PR-01)

État de référence : `main`, commit `84cf99457ec915df5d4abd12a4f80785edc3b3cb` du 16 octobre 2026.

Ce document décrit le comportement **constaté dans le code** et les exigences à verrouiller avant de changer la capture audio. Il ne constitue pas une preuve de recette sur le poste utilisateur.

## Code de référence

- `src/features/meetings/MeetingModePanel.jsx` : préparation, permission microphone, `MediaRecorder`, export de l'escale et de l'audio après arrêt.
- `src/components/MeetingMode.jsx` : chronomètre et marqueurs à timestamps.
- `src/features/meetings/MeetingsView.jsx` : liste d'escales, corrections et validation du journal.
- `src/lib/local-api.js` : appels à l'API locale unifiée 8010.
- `src/TranscriptionView.jsx` : import audio existant, transcription et confirmation d'intervenants.
- `backend/server.js` : API mémoire, persistance des escales.
- `backend/transcription-server-v6.js` : moteur de transcription V6, service interne 8011.

## Parcours actuel constaté

1. L'utilisateur choisit projet, titre, type d'escale, participants et contexte.
2. Le navigateur demande la permission microphone lors de `startRecording`.
3. Après autorisation, `MediaRecorder.start()` démarre **sans timeslice**.
4. Les événements `dataavailable` alimentent une liste de blocs **en mémoire** (`chunksRef`).
5. Les marqueurs ajoutés contiennent `id`, `type`, `label`, `timeSeconds`, `timeLabel` et `createdAt`.
6. L'arrêt construit un Blob de tous les blocs, appelle `POST /api/meetings/export`, puis `POST /api/meetings/export-audio`.
7. L'escale devient consultable dans la liste; le journal peut être corrigé puis validé.

## API historique à ne pas casser

- `POST /api/meetings/export` : création d'escale à partir du formulaire et des marqueurs.
- `POST /api/meetings/export-audio` : rattachement d'un fichier audio à une escale existante.
- `POST /api/meetings/read-report` : lecture du journal.
- `POST /api/meetings/save-report` : corrections.
- `POST /api/meetings/validate` : validation.
- `POST /api/transcription/:jobId/speakers` : confirmation manuelle des voix via la façade 8010.

Les formats complets de requêtes/réponses doivent être caractérisés dans les tests **avant** refactoring.

## Limites constatées

- Absence de persistance progressive de l'audio dans le mode Réunion.
- Absence de protocole de reprise des blocs après interruption réseau.
- Absence de démarrage de session sans microphone dans `MeetingModePanel`.
- Participants stockés dans un simple champ texte côté préparation; pas d'animateur désigné.
- Marqueurs temporisés mais pas encore reliés à la commande de saut d'un lecteur audio dans le mode Réunion.
- Tests unitaires/API déjà présents, mais pas de test navigateur complet simulant perte réseau et reprise de capture.

## Invariants à préserver

1. Données réelles stockées exclusivement hors Git sous `~/VOGUE-MERRY-DONNEES`.
2. Aucun secret, nom de participant réel, contenu audio ou transcription personnelle dans les fixtures.
3. Aucun écrasement de source audio ou de document validé.
4. Historique et validation humaine maintenus.
5. Compatibilité avec les escales historiques, sans migration implicite destructive.
6. API principale uniquement sur `127.0.0.1:8010`; moteur local V6 interne sur 8011.
7. Transcription locale par défaut, contrôle cloud seulement avec consentement.

## Conditions pour clôturer PR-01

- [ ] Ajouter fixtures synthétiques de réunion/audio/échec, sans données personnelles.
- [ ] Ajouter tests qui verrouillent la forme des requêtes/réponses API historiques et la persistance sur disque.
- [ ] Tester création d'une escale, rattachement audio, relecture, corrections et validation.
- [ ] Tester refus de chemin illégal, d'audio sans escale et absence d'écrasement silencieux.
- [ ] Documenter stratégie de migration incrémentale de l'ancien `audio_original.*` vers les futures sessions à blocs.
- [ ] Exécuter lint, tests, build et audit des dépendances; CI verte.
- [ ] Tester sur la machine réelle avant de déclarer la capture audio utilisable pour une réunion importante.

## Suite

PR-02 introduira la session persistante sans modifier immédiatement le mécanisme actuel de capture; PR-03 et PR-04 traiteront ensuite les blocs audio et leur reprise.

Suivi général : issue #42.
