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
