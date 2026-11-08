# Transcription : identité et corrections humaines

Une voix n'est associée à un participant que si son nom suit une formule
explicite d'auto-présentation. Les apostrophes droites et typographiques sont
reconnues. Une salutation contenant le nom d'un tiers ou une formule « je suis »
éloignée du nom ne suffit pas. Si une voix revendique plusieurs noms ou si un
nom apparaît pour plusieurs voix, les identités restent à confirmer.
La liste des participants reste un contexte ; elle ne force pas le nombre de voix.

## Conservation avant modification

Les nouveaux résultats créent `transcription_originale.json` avant intégration
au journal. Les anciens résultats en sont dotés lors de leur première correction :
c'est alors l'état disponible avant cette correction, pas une reconstruction
fiable des éventuelles versions déjà perdues.

Chaque intégration initiale et chaque nouvelle confirmation sauvegarde d'abord
un dossier sous `99_versions/transcription-*` dans la tâche technique. Il conserve
les résultats moteur, leur état et, pour une escale liée, les documents techniques,
les métadonnées et le journal exporté présents avant modification. Si la copie
de cet historique échoue, la correction est refusée avant les réécritures.
Les snapshots ne recopient pas les gros fichiers audio : leurs originaux restent
à leur emplacement et ne sont jamais modifiés par la confirmation.

Le résultat courant, les métadonnées et les fichiers gérés du journal sont écrits
via des fichiers temporaires privés, synchronisés puis renommés. Cette protection
évite les fichiers JSON partiellement écrits ; ce n'est pas une transaction globale
sur tous les fichiers. Après une interruption entre deux publications, l'historique
conserve l'état antérieur pour examen et récupération.

La répétition d'une correspondance déjà enregistrée est idempotente : aucun nouvel
historique ni horodatage après une publication complète. Si la publication vers
l'escale était incomplète, la même confirmation retente cette publication en
conservant un nouvel état antérieur. Une correspondance vers une voix absente du résultat
est refusée. Le journal validé n'est pas réécrit. Un texte humain modifié dans la
section gérée du journal exporté peut être remplacé lors de la mise à jour, mais
sa version antérieure est désormais conservée dans le snapshot de l'escale.

## Portée des tests

Les tests couvrent les règles d'identité, la vraie route HTTP de confirmation,
les corrections successives, les appels répétés et un échec de sauvegarde de
l'historique, sur des données synthétiques. Ils ne valident pas la qualité des
modèles Faster-Whisper et Pyannote sur des réunions réelles. Aucun envoi cloud
n'est nécessaire pour ces vérifications.

## Fin explicite des moteurs locaux

Le dialogue JSONL avec Faster-Whisper et Pyannote exige désormais un événement
`done` unique, dont `segments` correspond au nombre d'événements de segments
reçus. Un code de sortie zéro sans cette fin ne suffit plus à publier un succès.
Un flux silencieux terminé explicitement avec zéro segment reste valide.

Un JSON invalide ou tronqué, un événement après la fin, un décompte incohérent,
une erreur annoncée par le moteur ou une erreur du traitement des événements
interrompt la tâche. Les exceptions de persistance/progression ne sont plus
ignorées par le parseur. Le sous-processus fautif est arrêté ; le flux UTF-8 est
décodé en continu, y compris quand un caractère est réparti entre plusieurs
lectures. Une ligne est bornée à 1 Mio et les diagnostics stderr sont bornés.

Une erreur de transcription locale suit le parcours d'échec existant et garde
l'audio original. Une erreur de diarisation suit le repli existant avec
avertissement et intervenants non identifiés, sans inventer de noms. Les
corrections humaines, leurs versions et la copie originale restent inchangées.

Les tests lancent de vrais sous-processus Node avec des événements fictifs :
ils contrôlent le contrat de transport, pas la justesse acoustique de Whisper,
la séparation réelle des voix par Pyannote ou la qualité du microphone Windows.
Aucun modèle cloud n'est appelé par cette validation.

## Tâches interrompues après redémarrage

Un ancien état `queued`, `transcribing`, `diarizing` ou `verifying` sur disque ne
prouve pas qu'un traitement existe encore. Le moteur conserve désormais un
registre des tâches acceptées par son processus. Une tâche sans exécution active
est présentée par l'API avec `state: error`, `interrupted: true`, une progression
remise à zéro et une consigne de relance ; aucun résultat terminé n'est annoncé.
Cette lecture ne réécrit pas le statut historique, l'audio ou les corrections.

Le cache ne renvoie plus `already-running` pour ces anciennes tâches. Une nouvelle
soumission explicite crée une nouvelle tâche et conserve l'ancienne. Les tâches
réellement actives restent réutilisables et les résultats `done` avec leur fichier
résultat continuent à être servis depuis le cache, corrections humaines incluses.
Il n'y a pas de redémarrage automatique d'un calcul ni d'envoi cloud automatique.
Une seule instance du moteur doit être utilisée par mémoire locale ; plusieurs
tâches peuvent être suivies par cette instance.

Le registre est nettoyé même si l'enregistrement de l'état d'échec rencontre une
erreur. Cette erreur ne doit pas provoquer un rejet asynchrone non traité ni
maintenir indéfiniment une tâche fictivement active.

La recette utilise des métadonnées et audios fictifs, un arrêt SIGKILL du vrai
backend, puis son redémarrage. Elle vérifie les quatre anciens états, la création
d'une nouvelle tâche, l'intégrité de l'ancien audio et du statut historique, ainsi
que le maintien en cache d'une transcription corrigée. Elle ne lance pas Whisper
ou Pyannote et ne valide pas leur précision acoustique.
