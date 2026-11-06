# Préparation de Vogue Marry sous Windows natif

Cible de cette étape : Windows 10/11 64 bits, Node 22 LTS (>=22.12), Python 3.12
et un dossier local NTFS. Aucun WSL ni Git Bash n'est nécessaire aux commandes
npm. Il s'agit encore d'une installation depuis les sources, pas d'un installateur
Windows graphique ni d'une déclaration de réception 1.0.

## Prérequis

1. Installer Node.js 22 LTS et Python 3.12 depuis leurs distributions officielles.
   Pour Python, activer le lanceur `py` et l'ajout au PATH.
2. Installer le paquet FFmpeg complet, avec `ffmpeg.exe` et `ffprobe.exe` dans le
   PATH. Une option avec le gestionnaire Windows est :

   ```powershell
   winget install --id Gyan.FFmpeg --exact
   ```

3. Rouvrir le terminal après les installations. Conserver le dépôt dans un dossier
   local accessible à l'utilisateur, avec suffisamment d'espace disque pour les
   dépendances Python, les modèles et les enregistrements.

## Installer et démarrer

Dans PowerShell, ouvert dans le dossier du dépôt :

```powershell
node --version
py -3.12 --version
ffmpeg -version
ffprobe -version
npm.cmd ci
npm.cmd run transcription:setup -- --check
npm.cmd run transcription:setup
npm.cmd run dev:all
```

`npm.cmd` évite de devoir changer la politique d'exécution PowerShell pour lancer
npm. L'installateur choisit `.venv-transcription\Scripts\python.exe` sous Windows
et `bin/python` sous Unix. Il n'écrase pas un venv incompatible ou incomplet : le
conserver sous un autre nom avant de relancer l'installation. Une variable
`PYTHON_BIN` peut désigner un chemin d'exécutable Python ; ne pas y inclure des
options comme `-3.12`.

Le contrôle `--check` ne crée pas de venv, n'installe pas de dépendance et ne charge
pas de modèle. L'installation complète télécharge les dépendances Python. Les
poids Whisper sont téléchargés au premier usage ; Pyannote nécessite les
conditions de son modèle et un jeton local. Aucun audio n'est envoyé au cloud
par le mode local ; le contrôle OpenAI exige toujours son consentement distinct.

Ouvrir ensuite `http://localhost:5173`. Dans un autre terminal :

```powershell
npm.cmd run check:local
```

## Données et secrets

Les données restent hors du dépôt, sous `%USERPROFILE%\VOGUE-MERRY-DONNEES`.
Les secrets sont sous `%USERPROFILE%\.config\vogue-merry`. Le mode Unix 0600
ne suffit pas sous Windows : le démarrage applique des ACL NTFS limitant l'accès
au compte courant et à SYSTEM, au moyen de PowerShell fourni avec Windows.
Si cette protection échoue, le service refuse de démarrer ; il ne passe pas en
mode non protégé. Les services 8010 et 8011 restent limités à 127.0.0.1 et le moteur
interne exige son secret partagé.

## Ce qui doit encore être reçu sur le PC cible

La CI Windows prévue dans cette tranche vérifie le build, un venv avec un chemin
contenant des espaces, le démarrage des deux API, l'accès par la façade et l'ACL
du secret interne. Elle n'installe pas les gros modèles et n'utilise pas de vrai
microphone.

Restent à recetter sous Windows : microphone et navigateur du poste, transcription
Faster-Whisper/Pyannote sur un audio synthétique, longue réunion, reprise après panne,
et sauvegarde/restauration chiffrée. Les scripts d'archives utilisent actuellement
des options GNU tar ; leur fonctionnement avec le tar fourni par Windows n'est
pas encore validé et n'est pas revendiqué par cette adaptation du démarrage.
