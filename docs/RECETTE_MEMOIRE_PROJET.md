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
