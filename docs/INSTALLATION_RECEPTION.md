# Installation et réception locale

## Préparer le poste

Le socle est local : interface Vite sur 5173, façade sur 127.0.0.1:8010 et moteur
interne sur 127.0.0.1:8011. Utiliser Node 22 LTS à partir de 22.12, ou une version
ultérieure compatible. `.nvmrc` sélectionne la branche 22 ; package.json annonce
le minimum exact. Prévoir Python 3 avec venv et le paquet ffmpeg complet, dont
ffprobe. Le script actuel de transcription est prévu pour Bash et un venv Unix.

```bash
npm ci
npm run transcription:setup
npm run dev:all
```

L'installation Python et le premier chargement des modèles nécessitent le
 téléchargement de dépendances et de poids de modèles. Cela ne constitue pas
une validation de reconnaissance. Les audios restent locaux par défaut ; le
mode OpenAI doit faire l'objet du consentement explicite dans l'interface.
Ne pas utiliser de réunion privée pour vérifier une installation.

Depuis un autre terminal :

```bash
npm run check:local
```

Le diagnostic ne lit ni les enregistrements, ni les transcriptions, ni les secrets.
`reachable` indique qu'une réponse HTTP a été reçue ; `healthy` exige une réponse
réussie du service attendu. Une réponse 403, 503, du JSON invalide ou un autre
service n'est pas un succès. `localPythonEnvironment` vérifie seulement la
présence du chemin du venv ; il ne garantit ni les imports, ni les modèles.
Le premier diagnostic du moteur peut prendre plusieurs secondes lors de l'import
Pyannote. Le diagnostic retrouve le dépôt à partir de son script, même lancé
depuis un autre dossier.

## Critères de réception à consigner sur le poste cible

Ces cases sont une liste de travail, pas une déclaration de validation :

- [ ] Installation depuis une copie propre et le lockfile, avec les prérequis annoncés.
- [ ] Deux services locaux sains ; 8011 refuse un appel direct sans secret interne.
- [ ] Création d'une île et d'une escale, microphone, marqueurs et écoute du résultat.
- [ ] Perte réseau, fermeture brutale et récupération sans disparition des fragments.
- [ ] Réunion longue sur le matériel cible, avec suivi mémoire et contrôle du décodage.
- [ ] Faster-Whisper et Pyannote sur un audio synthétique ou public autorisé.
- [ ] Voix inconnues, corrections humaines, historique et conservation des originaux.
- [ ] Journal relu, validation humaine, décisions/actions, puis reprise par Log Pose.
- [ ] Sauvegarde chiffrée et restauration dans un répertoire distinct, services arrêtés.
- [ ] Lint, tests, build, audit et workflows GitHub Actions réussis sur le commit publié.

Les tests API et les simulations logiques ne remplacent pas ces vérifications.
Le lint ignore uniquement les sorties de build, le venv et les fichiers de travail,
et continue à contrôler le code produit, les tests et les configurations concernés.
