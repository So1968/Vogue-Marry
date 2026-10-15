# Consolidation Vogue Marry — septembre 2026

## But

Remettre Vogue Marry sur un tronc lisible, sûr et testable avant toute nouvelle extension fonctionnelle.

## Branche de travail

`consolidation/vogue-marry-2026-09`

Cette branche part de l'état fonctionnel le plus récent de `agent/stabilise-structure-ecran`.

`main` reste intacte jusqu'à validation complète de la consolidation.

## Règles de consolidation

1. Une seule version active de chaque moteur.
2. Les anciennes expérimentations restent accessibles dans l'historique Git, pas dans le code actif.
3. Les données utilisateur restent hors du dépôt, dans `~/VOGUE-MERRY-DONNEES`.
4. Les services locaux écoutent uniquement sur la boucle locale.
5. Les opérations payantes sont explicites et protégées contre les doubles lancements.
6. L'interface doit progressivement afficher les vraies données du moteur plutôt qu'une maquette statique.
7. Le parcours cible reste : projet → escale → source/audio → transcription → journal → validation → mémoire.

## Architecture cible

Le détail est dans `docs/ARCHITECTURE_CIBLE.md`.

Pendant la consolidation :

- `backend/server.js` : façade API locale unifiée sur 8010 et mémoire projet ;
- `backend/transcription-server-v6.js` : unique moteur de transcription actif, interne sur 8011 ;
- la confirmation des interlocuteurs est exécutée par V6 et exposée par la façade 8010 via `/api/transcription/:jobId/speakers` ;
- `backend/local_transcribe.py` : Faster-Whisper ;
- `backend/local_diarize.py` : Pyannote.

## État au 19 septembre 2026

### Fait

- [x] création de la branche de consolidation ;
- [x] `main` conservée intacte et `agent/stabilise-structure-ecran` figée comme référence historique ;
- [x] pull request de consolidation ouverte en brouillon vers `main` ;
- [x] suppression du code actif des anciens moteurs de transcription V1 à V5 ;
- [x] suppression des pages de démonstration obsolètes du dossier `public/` ;
- [x] façade locale unifiée sur 8010 ; moteur V6 interne sur 8011, tous deux limités à `127.0.0.1` ; le port 8012 a été supprimé ;
- [x] CORS limité aux origines locales de Vogue Marry ;
- [x] validation renforcée des chemins côté API principale et transcription ;
- [x] limites d'upload ajoutées ;
- [x] détection de l'audio d'une escale corrigée pour toutes les extensions `audio_original.*` ;
- [x] protection contre deux lancements simultanés d'une transcription identique ;
- [x] Pyannote ne force plus le nombre de voix à partir du seul nombre de participants ;
- [x] attribution automatique des noms limitée aux présentations explicites de soi ;
- [x] suppression de l'attribution automatique « par élimination » ;
- [x] suppression du patch global de `Storage.prototype.setItem` ;
- [x] confirmation des interlocuteurs enregistrée explicitement via le service local ;
- [x] consentement explicite obligatoire avant l'envoi d'un audio, du contexte et des noms vers OpenAI ;
- [x] Multer mis à jour et verrouillé en `2.4.0` et `package-lock.json` régénéré ;
- [x] nom du paquet harmonisé en `vogue-merry` dans le lockfile ;
- [x] versions frontend auparavant déclarées en `latest` verrouillées sur les versions déjà validées par le lockfile ;
- [x] garde-fous automatisés ajoutés pour empêcher une régression de Multer ou un retour à `latest` ;
- [x] tests de garde-fou ajoutés avec `node:test` ;
- [x] CI GitHub : `npm ci`, syntaxe Node/Python, tests et build frontend ;
- [x] workflows temporaires de migration retirés après usage ;
- [x] CI complète réussie après les migrations techniques.

### À faire avant intégration

- [x] service de confirmation des interlocuteurs absorbé dans `transcription-server-v6.js` ; le port 8012 a été supprimé ;
- [x] dépendances Python directes verrouillées dans `requirements-transcription.txt` ;
- [x] lint frontend et backend ajouté à `npm run lint` ;
- [x] tests fonctionnels des routes locales renforcés ;
- [x] première tranche d'interface branchée sur `/api/projects`, `/api/inbox` et `/api/search` ;
- [x] `MeetingMode` relié à la création d'une escale, aux marqueurs et à l'export audio ;
- [x] interface et tests de transcription branchés sur la façade unifiée 8010 ;
- [x] transcription V6 recopiée dans l'escale et affichée dans le journal ; lecture et validation reliées à l'interface ;
- [x] projets persistés avec nom/contexte métier, création d’île depuis l’interface et aucune fuite de chemin absolu ;
- [x] escales identiques conservées séparément, rattachement audio refusé si l’escale n’existe pas, validation idempotente et journal validé protégé ;
- [x] journal de travail corrigeable dans l’interface avant validation, avec historique des sauvegardes ;
- [x] Coffre branché sur les documents locaux, avec dépôt Water Seven, proposition de classement et validation humaine vers une île ;
- [x] Manœuvres et Caps validés alimentés par les journaux de bord validés, avec proposition puis validation humaine ;
- [x] besoins de construction repérables pendant une réunion, soumis à validation humaine et repris dans le Log Pose ;
- [x] Log Pose persisté par île, recalculé après validation des journaux/actions/caps et affiché depuis la mémoire locale ;
- [ ] faire tourner les tests locaux sur le poste de développement ;
- [ ] tester une courte transcription locale sans appel API payant.

## Priorités suivantes

### P0 — terminer la consolidation technique

1. Retester CI après réunification de l'accès sur 8010.
2. Valider le lint et les tests fonctionnels sur le poste réel.
3. Valider une transcription locale courte sur le poste réel.

### P1 — validation sur le poste réel

1. `npm ci`, `npm test`, `npm run build` sur le poste de développement.
2. Vérifier que les services répondent uniquement en boucle locale.
3. Tester la récupération d'un job identique sans double lancement.
4. Tester une courte transcription locale gratuite.
5. Tester ensuite le contrôle renforcé uniquement sur un échantillon choisi.

### P2 — réunification produit

1. Enrichir le Log Pose avec les questions ouvertes et les documents à retrouver issus des briques dédiées.
2. Ajouter une lecture source ciblée dans Longue-vue, avec ouverture contrôlée du document relatif plutôt qu’un simple extrait.
3. Extraire progressivement `App.jsx` en composants de navigation et de shell sans modifier le contrat métier.

## Condition avant intégration dans `main`

- CI verte ;
- tests locaux des routes critiques ;
- build local réussi ;
- test court de transcription locale sans API payante ;
- test explicite du mode contrôle renforcé sur un échantillon choisi ;
- aucune donnée ou clé sensible dans Git ;
- revue finale des changements entre `main` et la branche de consolidation.

## Branches

- `main` : futur tronc stable, encore ancien pour le moment ;
- `consolidation/vogue-marry-2026-09` : seule branche active de consolidation ;
- `agent/stabilise-structure-ecran` : point de sauvegarde historique, ne plus développer dessus ;
- `archive/rustines-esthetiques-20260731` : archive, ne pas fusionner dans le produit.
