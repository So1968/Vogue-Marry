# Recette de la mémoire projet

Le test API « mémoire projet : escale → résultat synthétique → journal relu →
validations → Log Pose » utilise les deux services locaux avec un HOME jetable.
Il crée un projet et une escale, rattache un faux audio puis injecte un résultat
technique synthétique. Il ne mesure pas la qualité de Faster-Whisper ou Pyannote.

Le test confirme ensuite une voix via 8010, lit le journal enrichi, enregistre une
note humaine, valide le journal puis valide séparément l'action et la décision.
Il vérifie qu'avant ces validations humaines les propositions ne sont pas prises
pour des caps ou des manœuvres acceptés. Le Log Pose sur disque conserve ensuite
la décision et l'action. Une action terminée disparaît des priorités sans effacer
les repères humains, ni la source audio. La validation répétée du journal reste
idempotente.

Le Log Pose global applique désormais les mêmes règles de priorité que chaque
île avant de limiter l'affichage : actions en cours en premier, puis date ; besoins
par date. Les premières îles dans l'ordre du système de fichiers ne peuvent plus
masquer une action en cours d'une autre île. Les tests inversent l'ordre de deux
îles pour verrouiller ce comportement.

Cette recette API complète les tests unitaires ; la recette visuelle, les vrais
modèles de transcription et les interruptions matérielles restent à vérifier
sur le poste cible avant de déclarer la version 1.0 reçue.

## Reprise après publication partielle d'une validation

Une validation peut être enregistrée alors que l'écriture d'un document dérivé
échoue. Deux recettes API provoquent ce refus uniquement dans des dossiers fictifs :

- Journal validé publié puis Log Pose Markdown indisponible : répéter la validation
  doit régénérer le Log Pose, conserver les notes manuelles et laisser les octets
  du journal validé inchangés. Le journal reste protégé contre les corrections.
- Action acceptée dans le JSON puis Markdown indisponible : répéter la validation
  doit régénérer le Markdown et le Log Pose, sans ajouter d'entrée ni réécrire le
  JSON déjà accepté. Une charge utile différente lors de la relance ne remplace
  pas la première correction humaine. Une action préexistante reste conservée.

Ces relances doivent encore signaler une erreur si les documents dérivés restent
inaccessibles ; elles ne renvoient un succès qu'après leur réparation. Le même
chemin de reprise s'applique aux décisions et besoins déjà validés.

Les fichiers du journal validé, des listes JSON/Markdown et du Log Pose sont
publiés par écriture temporaire puis renommage. Cela protège chaque fichier
contre une publication tronquée ; ce n'est pas une transaction globale entre
plusieurs fichiers, ni une garantie contre une panne physique. La relance reste
nécessaire si une interruption survient entre les publications. Les sauvegardes
restent indispensables.

La CI Windows exécute aussi ces deux scénarios et les lecteurs/rédacteurs Log Pose.
Les processus de recette doivent confirmer leur propre écoute avant tout appel
API, utiliser HOME et USERPROFILE fictifs, puis être arrêtés avant le nettoyage.
Aucun service personnel déjà présent sur un port n'est utilisé par ces recettes.

Un test réserve aussi les ports 8010 puis 8011 avec un serveur fictif répondant
positivement à la santé. Les deux processus Vogue Marry doivent refuser ce conflit
avec un code de sortie en échec, sans imprimer leur confirmation d'écoute. Sous
Express 5, le callback d'écoute peut recevoir l'erreur : il faut la traiter avant
le message de démarrage. La recette vérifie qu'aucune requête n'est envoyée au
service déjà présent, même si celui-ci aurait répondu positivement à la santé.
