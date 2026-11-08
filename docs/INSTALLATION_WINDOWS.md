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

## Lire le diagnostic local

`npm.cmd run check:local` ne lit aucun enregistrement et ne lance aucun modèle.
Le contrôle charge les dépendances Python avec les options hors ligne des
bibliothèques, sans installer de paquet ni télécharger de poids. Il distingue
`localPythonEnvironment` (exécutable présent), `pythonDependencies` (imports
contrôlés), `prerequisitesOk` et `servicesOk`.

Le code de sortie est 0 seulement si `readyForLocalAttempt` est vrai : les
prérequis de transcription locale et les deux services sont disponibles. Le
code 1 demande d'examiner les champs faux ou incomplets ; il est attendu si les
services sont arrêtés. Pyannote reste optionnel pour transcrire sans attribuer
les voix. Une sonde Python interrompue est signalée par `state: incomplete`,
avec les seuls imports effectivement vérifiés avant son interruption.

`modelsTested: false` et `microphoneTested: false` décrivent ce contrôle : ils ne
remplacent pas la recette sur un audio synthétique puis sur le microphone du
poste. Une tentative de transcription peut encore nécessiter les poids du modèle
ou l'acceptation de ses conditions. Aucun secret ni diagnostic brut Python n'est
recopié dans le rapport JSON.

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
et récupération des sauvegardes réelles du poste. Le parcours de sauvegarde est
également couvert par un test natif synthétique décrit ci-dessous.

## Sauvegardes sous Windows

Les sauvegardes exigent **GNU tar**, notamment pour comparer les octets archivés
aux sources. Le `tar.exe` intégré à Windows (bsdtar) ne suffit pas. Installer
Git for Windows depuis sa distribution officielle si GNU tar n'est pas déjà
présent. Aucun WSL ni terminal Git Bash n'est requis.

Les scripts essaient le tar du PATH, puis les emplacements usuels
`Git\usr\bin\tar.exe` de Program Files et LOCALAPPDATA. Pour une installation
personnalisée, définir le chemin complet, sans options :

```powershell
$env:VOGUE_TAR_PATH = 'D:\Outils\Git\usr\bin\tar.exe'
```

L'outil est contrôlé avant création de la destination. S'il est absent ou
incompatible, la commande s'arrête avec une consigne d'installation ; elle
n'utilise pas un archivage moins vérifié. Aucun outil n'est téléchargé par ces
scripts. Les lettres de lecteurs et chemins contenant des espaces sont transmis
comme arguments séparés, sans shell.

Pour lancer la recette exclusivement fictive depuis le dépôt :

```powershell
node --test tests/backup-runtime.test.mjs
```

Cette recette crée un dossier temporaire isolé, vérifie une archive claire,
une archive directement chiffrée, le refus d'une mauvaise phrase secrète et d'une
altération, puis le déchiffrement et l'extraction de contrôle. Elle conserve les
sources et nettoie uniquement ses données fictives. Elle ne valide ni votre
support de sauvegarde réel, ni une récupération après panne physique. Voir
[la procédure de sauvegarde](SAUVEGARDES_SECURITE.md) avant d'utiliser les données
réelles. Les archives déchiffrées sont des données en clair à protéger.
