# Vogue Merry

**Vogue Merry** est l’outil de mémoire projet d’Azoth Studio : il transforme réunions, audios, notes, documents, décisions et actions en une mémoire navigable.

> On garde le moteur. On transforme l’expérience.

## État du dépôt

- `main` est le tronc stable et la seule branche de développement à utiliser désormais.
- Les anciennes branches de travail ont été rassemblées sur le même état que `main`.
- `archive/rustines-esthetiques-20260731` reste volontairement séparée : c’est une archive, pas une branche à fusionner.
- Les données personnelles et projets réels restent hors de Git, dans `~/VOGUE-MERRY-DONNEES`.

## Parcours produit

1. **Pont du navire** : vue globale.
2. **Mes îles** : projets.
3. **Carte de l’île** : vue générale d’un projet.
4. **Escales** : réunions et points projet.
5. **Traces audio** : sources et transcriptions.
6. **Journal de bord** : comptes rendus et documents de travail.
7. **Coffre** : documents liés au projet.
8. **Équipage** : personnes et rôles.
9. **Manœuvres** : actions à faire.
10. **Caps validés** : décisions.
11. **Longue-vue** : recherche dans la mémoire du projet.
12. **Log Pose** : synthèse du cap et reprise de contexte.

Cycle documentaire : **source → travail → validé → historique**.

## Architecture active

### Frontend

React + Vite.

### Services locaux

- `backend/server.js` : mémoire projet / API locale principale, port 8010.
- `backend/transcription-server-v6.js` : transcription, diarisation et confirmation des interlocuteurs, port 8011.
- `backend/local_transcribe.py` : Faster-Whisper.
- `backend/local_diarize.py` : Pyannote.

Les services locaux écoutent uniquement sur `127.0.0.1`. Le port 8012 et les anciens moteurs V1 à V5 ont été retirés du code actif.

## Démarrage

```bash
npm ci
npm run transcription:setup
npm run dev:all
```

Interface de développement : `http://localhost:5173`.

## Contrôles

```bash
npm test
npm run build
npm audit --audit-level=high
```

La CI GitHub exécute automatiquement installation verrouillée, contrôles de syntaxe Node/Python, tests, audit des dépendances et build.

## Transcription

Le mode local utilise Faster-Whisper et, lorsqu’il est configuré, Pyannote. Le mode de contrôle renforcé peut utiliser OpenAI, uniquement après consentement explicite dans l’interface.

Les clés et jetons restent locaux et ne doivent jamais être ajoutés au dépôt.

## Règle de développement

Toute évolution doit préserver le moteur fonctionnel existant : projets, escales, sources, documents de travail, validation, historique, recherche, export local et continuité de la mémoire projet.

Dans **Azoth Studio**, le dossier produit associé est `02_PRODUITS/VOGUE_MERRY`.
