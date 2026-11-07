# Sauvegardes locales Vogue Merry — procédure de contrôle

Les commandes ci-dessous sont **manuelles**. Elles ne modifient pas le dossier
`~/VOGUE-MERRY-DONNEES` et ne remplacent pas une sauvegarde automatisée.

## Outil d'archivage requis

Les scripts contrôlent la présence de GNU tar avant de créer leur destination.
Le tar fourni avec Windows ne propose pas tous les contrôles requis ; GNU tar
fourni avec Git for Windows est recherché automatiquement aux emplacements
usuels. Une installation personnalisée peut être indiquée par `VOGUE_TAR_PATH`
(chemin d'exécutable, sans arguments). Le dossier de cet outil est ajouté au PATH
uniquement pour ses sous-processus, notamment gzip. Aucun téléchargement
ni repli vers une comparaison moins stricte n'est effectué. Voir
[les instructions Windows](INSTALLATION_WINDOWS.md#sauvegardes-sous-windows).

## Méthode recommandée : archive directement chiffrée

Pour éviter une archive temporaire non chiffrée, privilégier la commande suivante
après avoir défini la variable d'environnement secrète (voir plus bas) :

```bash
read -r -s -p "Phrase secrète : " VOGUE_BACKUP_PASSPHRASE; echo
export VOGUE_BACKUP_PASSPHRASE
node scripts/backup-encrypted-local-data.mjs
unset VOGUE_BACKUP_PASSPHRASE
```

L'archive produite est `.tar.gz.enc`. Aucune copie `.tar.gz` en clair
n'est créée par cette commande. **Vérifier le déchiffrement** sur un dossier
distinct avant de considérer la sauvegarde comme acquise. La commande n'est
pas automatique : il faut la lancer volontairement.

## Créer une sauvegarde

```bash
node scripts/backup-local-data.mjs
```

La commande crée une archive `.tar.gz` et son empreinte `.sha256` dans
`~/VOGUE-MERRY-SAUVEGARDES`. Par défaut, **l'archive n'est pas chiffrée** :
ne la transmettre à personne, ne pas la mettre dans Git, un dossier public
ou une synchronisation non maîtrisée.

## Chiffrer (après avoir créé l'archive)

Choisir une longue phrase secrète privée, conservée en lieu sûr. Ne pas
écrire ce secret dans l'historique des commandes, dans Git ni dans un fichier
de configuration partagé. Exemple d'utilisation interactive Bash :

```bash
read -r -s -p "Phrase secrète : " VOGUE_BACKUP_PASSPHRASE; echo
export VOGUE_BACKUP_PASSPHRASE
node scripts/crypt-local-backup.mjs encrypt "$HOME/VOGUE-MERRY-SAUVEGARDES/NOM_DU_FICHIER.tar.gz"
unset VOGUE_BACKUP_PASSPHRASE
```

La sortie `.enc` utilise AES-256-GCM et un sel indépendant, avec dérivation
de clé scrypt. **Attention : la copie non chiffrée reste sur le disque** :
vérifier la sauvegarde chiffrée avant de prendre une décision de conservation
ou de suppression de l'archive non chiffrée. Une suppression classique sur SSD
ne garantit pas l'effacement physique.

## Vérifier le déchiffrement et la récupération

```bash
read -r -s -p "Phrase secrète : " VOGUE_BACKUP_PASSPHRASE; echo
export VOGUE_BACKUP_PASSPHRASE
node scripts/crypt-local-backup.mjs decrypt "/chemin/sauvegarde.tar.gz.enc"
unset VOGUE_BACKUP_PASSPHRASE
```

Le déchiffrement crée une nouvelle sortie `.decrypted`, ne remplace pas
l'archive originale et refuse les mots de passe incorrects ou les données
modifiées. Pour contrôler l'extraction, utiliser la commande de vérification
sur une archive `.tar.gz` accompagnée de son fichier `.sha256`.

```bash
node scripts/verify-local-backup.mjs "/chemin/sauvegarde.tar.gz"
```

Une vraie restauration ne doit se faire que sur un dossier distinct et après
inspection. Aucun de ces scripts n'écrase les données utilisateur.

## Limites connues

- La phrase secrète n'est **pas récupérable** si elle est perdue.
- Le transfert et le stockage des sauvegardes restent à organiser séparément.
- Une sauvegarde lancée pendant une réunion peut contenir un état incohérent
  de certains fichiers en cours de modification : sauvegarder de préférence
  lorsque tous les services sont arrêtés.
- Les scripts ne chiffrent pas les fichiers de travail du dossier de données.
- Le mode d'accès local à l'API n'est pas une authentification multi-utilisateur.

## Garanties et reprise après interruption

Les destinations sont vérifiées après résolution des liens symboliques, avant
création de répertoires. Une sauvegarde ou une restauration ne peut pas entrer
dans les données actives par un alias de chemin. Les archives temporaires en
clair sont privées dès leur création. Le calcul SHA-256 se fait en flux pour
ne pas charger une longue réunion entière en mémoire.

Les sources contenant un lien symbolique ou un fichier spécial sont refusées
avant archivage : elles ne seraient pas acceptées par le vérificateur de
restauration. Ne pas supprimer ces sources pour contourner le refus ; examiner
le lien et préparer une copie régulière hors des données actives. Les liens
physiques entre fichiers réguliers sont archivés comme des copies indépendantes.

La publication des archives et des résultats cryptographiques refuse une
destination existante, même si elle apparaît pendant l'opération. Une erreur
ne publie pas un déchiffrement non authentifié. Les sources et sauvegardes
précédentes restent conservées.

Après une interruption brutale, une sortie `.partial` ou un répertoire privé
`.vogue-crypt-*` peut subsister. Ce n'est pas une sauvegarde validée. Conserver
les sources, arrêter les services, relancer vers une nouvelle destination et
contrôler la récupération. Ne nettoyer les restes qu'après cette vérification.
Une archive claire sans son `.sha256` ne doit pas être déclarée vérifiée.

La cohérence d'un instantané multi-fichiers pendant des écritures simultanées
n'est pas garantie : arrêter les services avant une sauvegarde de référence.
Le statut de création d'une archive chiffrée ne constitue pas à lui seul une
recette de restauration ; vérifier le déchiffrement et les contenus récupérés.

## Changements observés pendant l'archivage

Avant de créer une archive claire ou directement chiffrée, les scripts relèvent
un inventaire des dossiers et des fichiers réguliers, avec taille, permissions et
SHA-256 en flux. Ils comparent ensuite le contenu archivé aux sources, puis
contrôlent à nouveau l'inventaire. Un changement observé, y compris un ajout, un
retrait ou une modification de même taille, interdit la publication du résultat.
Les sources ne sont jamais remises dans leur ancien état pour faire réussir le
contrôle. Une erreur supprime seulement la sortie temporaire de cette tentative.

Pour le format chiffré, le contrôle déchiffre vers un pipe de comparaison tar,
sans extraction ni fichier d'archive en clair. L'authentification AES-GCM doit
également réussir avant publication. Ces contrôles ajoutent plusieurs lectures
disque ; prévoir leur durée sur les longues réunions et les grands dossiers.

Ce contrôle renforce la détection des changements mais ne transforme pas le
système de fichiers en instantané transactionnel. Il faut toujours arrêter les
services et les autres programmes qui écrivent les données avant une sauvegarde
de référence. Une modification externe extrêmement brève peut échapper à deux
inventaires ; aucune garantie d'instantané pendant une capture active n'est revendiquée.
