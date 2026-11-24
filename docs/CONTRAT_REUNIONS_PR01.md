# Contrat Réunions Vogue Mary — état consolidé du 22 octobre 2026

Ce document remplace l'ancien état PR-01 basé sur le commit du 16 octobre 2026. Il décrit le comportement actuellement intégré dans `main` après les renforcements audio, sécurité et reprise.

## Code de référence

- `src/features/meetings/MeetingModePanel.jsx` : préparation de l'escale, permission microphone, session audio persistante, reprise et marqueurs.
- `src/components/MeetingMode.jsx` : chronomètre et marqueurs horodatés.
- `src/lib/audio-chunk-queue.js` : fragments audio persistés dans IndexedDB.
- `src/lib/audio-chunk-sync.js` : reprise réseau, envoi des fragments manquants et finalisation.
- `src/lib/meeting-marker-backup.js` : sauvegarde locale des marqueurs.
- `src/lib/local-api.js` : façade navigateur vers l'API locale 8010.
- `backend/server.js` : escales, fragments audio, finalisation, marqueurs, journaux et mémoire.
- `backend/transcription-server-v6.js` : moteur de transcription interne 8011.

## Parcours actuel

1. L'utilisateur choisit l'île/projet, le titre, le type d'escale, les participants et le contexte.
2. Le navigateur demande la permission microphone.
3. L'escale est créée côté API avant la capture audio.
4. Une session locale reçoit un identifiant unique et est mémorisée dans `localStorage`.
5. `MediaRecorder.start(5000)` produit des fragments environ toutes les cinq secondes.
6. Chaque fragment non vide est écrit dans IndexedDB avant toute tentative de transfert.
7. Le serveur reçoit les fragments de manière idempotente : un même index et un même contenu peuvent être renvoyés sans duplication ; un contenu différent au même index est refusé.
8. Les marqueurs sont conservés localement puis synchronisés avec l'escale.
9. À l'arrêt propre, Vogue Mary attend l'écriture du dernier fragment puis marque la capture comme terminée.
10. La reprise compare les index locaux aux index déjà reçus par le serveur et n'envoie que les fragments manquants.
11. La finalisation est refusée si un fragment manque, si un fragment est vide ou si le nombre annoncé ne correspond pas aux fragments présents.
12. Une relance identique après perte d'accusé de réception retourne `already-finalized` au lieu de recréer ou écraser l'audio.
13. IndexedDB et la session locale ne sont nettoyés qu'après confirmation de la finalisation serveur.
14. Une fois l'audio finalisé, l'escale apparaît dans la mémoire comme contenant un audio.

## Conteneur audio réel

Vogue Mary ne force pas le type MIME du `MediaRecorder`.

Cette règle est volontaire :

- Chromium produit un flux WebM/Opus valide par défaut ;
- Firefox 157 produit par défaut `audio/ogg; codecs=opus` ;
- lors du test réel du 22 octobre 2026, Firefox a produit 12,533667 secondes décodables pour 12,545 secondes capturées en Ogg, sans erreur ffmpeg ;
- le même Firefox, lorsqu'on force `audio/webm;codecs=opus`, produit dans ce test un WebM invalide avec erreur de décodage Opus.

Le type réel de chaque session est donc mémorisé côté serveur. La sortie finale porte la bonne extension : `audio_original.ogg`, `audio_original.webm`, etc. Un audio existant sous un autre format n'est jamais écrasé silencieusement.

## API audio actuelle

- `POST /api/meetings/export` : crée l'escale.
- `POST /api/meetings/audio-chunk` : enregistre un fragment audio indexé.
- `POST /api/meetings/audio-chunks-status` : renvoie les index déjà reçus et le format audio.
- `POST /api/meetings/audio-chunks-finalize` : assemble les fragments après contrôles de complétude et d'intégrité.
- `POST /api/meetings/save-markers` : persiste les marqueurs de réunion.
- `POST /api/meetings/export-audio` : route historique conservée pour compatibilité avec les anciens parcours/imports ; elle n'est plus le mécanisme principal du mode Réunion.
- `POST /api/meetings/read-report`, `save-report`, `validate` : journal de bord et validation.
- `POST /api/transcription/:jobId/speakers` : confirmation manuelle des voix via la façade 8010.

## Reprise et interruptions

### Ce qui est protégé

- coupure réseau après capture : les fragments restent dans IndexedDB ;
- perte d'accusé serveur : les renvois sont idempotents ;
- rechargement après capture terminée mais avant transfert : la session locale et les fragments peuvent être repris ;
- double onglet : la session active est partagée via `localStorage` et un onglet ne doit pas effacer la session d'un autre ;
- erreur d'écriture locale : l'enregistrement est arrêté au lieu de continuer en prétendant que l'audio est sécurisé.

### Limite restante assumée

Une fermeture brutale pendant qu'un fragment de cinq secondes est encore en cours peut perdre ce fragment courant. Les fragments déjà émis restent récupérables. Une session interrompue avant l'arrêt propre n'est pas automatiquement déclarée finalisable : la récupération partielle reste volontairement bloquée tant qu'elle n'a pas été validée spécifiquement.

## Invariants

1. Données réelles exclusivement hors Git dans `~/VOGUE-MERRY-DONNEES`.
2. Aucun secret, audio réel, transcription personnelle ou fichier `.env` dans Git.
3. Aucun écrasement silencieux d'un audio original.
4. Aucun effacement des fragments locaux avant confirmation serveur.
5. Journal validé protégé et historique conservé.
6. Compatibilité avec les escales historiques.
7. API principale uniquement sur `127.0.0.1:8010`; moteur V6 interne sur 8011.
8. Transcription locale par défaut ; cloud uniquement sur demande explicite.
9. Aucun nom réel nécessaire dans les fixtures ou exemples.
10. Les chemins Unicode dangereux, traversées, contrôles invisibles et marques bidi sont refusés.

## Validation automatisée

La CI standard vérifie syntaxe Node/Python, lint, tests, audit des dépendances et build.

Un contrôle Firefox réel vérifie le comportement MediaRecorder et le décodage du flux. Il est destiné à être limité aux changements qui touchent l'audio/réunion.

## Validation encore recommandée avant une réunion importante

- essai réel de durée moyenne à longue avec le microphone du poste utilisateur ;
- contrôle de l'espace disponible pour IndexedDB sur le navigateur réel ;
- essai volontaire de fermeture brutale pendant un fragment pour décider du traitement futur d'une récupération partielle ;
- écoute du fichier final après reprise.

Suivi général : issue #42.
