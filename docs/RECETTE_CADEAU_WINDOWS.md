# Recette cadeau — poste Windows

Objectif de remise : 19 novembre 2026, avec une journée de marge avant le 20.
Ce document est une fiche à remplir, pas une preuve de validation. Une case
vide reste non vérifiée, même si les tests automatisés correspondants passent.

## Préparer la séance

Suivre [l'installation Windows](INSTALLATION_WINDOWS.md). Utiliser uniquement
un projet fictif nommé « Recette cadeau », sans données personnelles. Prévoir
un casque, un microphone et un audio de test autorisé. Télécharger les modèles
locaux nécessaires avant une utilisation hors ligne, avec l'accord de
l'utilisateur pour les téléchargements et les conditions éventuelles.
Ne pas activer le mode OpenAI pour cette recette locale.

Noter sans publier de nom de compte, de chemin personnel ou de secret :

| Élément | Valeur à renseigner |
| --- | --- |
| Date et commit (`git rev-parse HEAD`) | |
| Version Windows et navigateur | |
| Processeur, mémoire, espace disque disponible | |
| Modèle Whisper et mode CPU/GPU | |
| Attribution des voix activée ou désactivée | |

## Première séance — environ une heure hors installation

1. Démarrer avec `npm.cmd run dev:all`, puis exécuter
   `npm.cmd run check:local` dans un second terminal. Consigner les champs faux
   ou incomplets. Un diagnostic positif ne valide pas les modèles ni le micro.
2. Créer l'île et l'escale fictives. Autoriser le micro dans le navigateur.
   Enregistrer deux minutes, poser trois marqueurs, arrêter puis écouter.
   Vérifier que le son est audible et que les marqueurs correspondent.
3. Transcrire en mode local. Employer un texte fictif connu comportant une
   décision et une action. Comparer le résultat au texte prononcé ; noter les
   omissions et erreurs, au lieu d'exiger une transcription parfaite.
4. Si Pyannote est prévu pour le cadeau, essayer deux voix avec consentement,
   sans noms réels. Vérifier les inconnus et corriger une attribution. Sinon,
   consigner explicitement « attribution des voix non reçue ».
5. Corriger le texte, recharger la page, vérifier la correction et l'accès à
   l'original. Relire le journal ; valider séparément décision et action.
   Vérifier leur présence dans le Log Pose, puis terminer l'action.
6. Fermer et relancer normalement l'application. Vérifier l'accès à l'audio,
   aux corrections, au journal et aux validations.

## Séance d'endurance et récupération

- Enregistrer au moins une heure sur le poste cible. Noter la durée, le nombre
  de marqueurs et l'évolution de la mémoire. Écouter début, milieu et fin ;
  comparer la durée obtenue à celle de la séance et relever toute coupure.
- Dans une escale fictive distincte, attendre plusieurs fragments puis fermer
  brutalement uniquement le navigateur de test. Relancer, récupérer et écouter
  les fragments proposés. Consigner la portion éventuellement perdue. Ne pas
  couper l'alimentation du PC pour ce test.
- Services arrêtés, effectuer la sauvegarde chiffrée selon
  [la procédure dédiée](SAUVEGARDES_SECURITE.md). Restaurer dans un dossier
  distinct : ne jamais écraser les données actives. Vérifier les fichiers
  restaurés et l'écoute de l'audio. Conserver les originaux.

## Décision de remise

| Contrôle | Réussi / échec / non testé | Observation factuelle |
| --- | --- | --- |
| Installation et redémarrage | | |
| Microphone, écoute et marqueurs | | |
| Transcription locale réelle | | |
| Attribution des voix, si annoncée | | |
| Corrections et originaux conservés | | |
| Journal → décisions/actions → Log Pose | | |
| Réunion longue | | |
| Récupération après arrêt du navigateur | | |
| Sauvegarde chiffrée et restauration distincte | | |

Toute perte d'original, impossibilité de restaurer, exposition de données ou
fonction essentielle inutilisable bloque la remise comme version fiable.
Une fonction optionnelle non reçue doit être signalée comme telle dans la note
de remise. Ne pas déclarer la version 1.0 reçue sur la seule base de la CI.

Conserver cette fiche remplie localement. Pour signaler un problème sur GitHub,
utiliser une reproduction fictive et retirer noms, chemins personnels, extraits
de réunion et secrets. Après correction, rejouer le contrôle concerné et noter
le nouveau commit ; ne pas transformer rétroactivement un échec en réussite.
