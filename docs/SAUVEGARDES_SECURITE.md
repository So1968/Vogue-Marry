# Sauvegardes locales Vogue Merry — procédure de contrôle

Les commandes ci-dessous sont **manuelles**. Elles ne modifient pas le dossier
`~/VOGUE-MERRY-DONNEES` et ne remplacent pas une sauvegarde automatisée.

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
