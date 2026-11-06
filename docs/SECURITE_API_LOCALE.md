# Accès aux API locales

Les deux services écoutent exclusivement sur `127.0.0.1`. L'interface utilise
uniquement 8010. Les hôtes HTTP admis sont `localhost` et `127.0.0.1`, avec le
port exact du service, afin de refuser le DNS rebinding.

## Navigateur et lectures

Les origines autorisées sont `http://localhost:5173` et
`http://127.0.0.1:5173`. La garde s'applique aux lectures comme aux écritures,
avant CORS, les parseurs et les uploads. Une provenance `cross-site` est refusée.
Avec Fetch Metadata mais sans Origin, une provenance Referer de l'interface
est nécessaire, notamment pour le lecteur audio. Un autre port sur localhost
ne reçoit pas d'autorisation au seul motif qu'il est `same-site`.

Les réponses admises sont marquées `no-store` et `nosniff`. Une navigation directe
sans provenance de l'interface peut être refusée. Une politique navigateur qui
supprime entièrement le Referer peut donc empêcher la lecture audio : conserver
la politique par défaut de l'interface.

Les scripts locaux sans Origin ni Fetch Metadata restent compatibles sur 8010.
Cette frontière protège contre les pages Web étrangères ; elle ne constitue pas
une authentification des programmes exécutés sous le même compte utilisateur.

## Moteur interne 8011

Chaque appel à 8011 exige désormais un secret interne, y compris les diagnostics,
la lecture des transcriptions, les audios, les uploads et la configuration.
8010 ajoute lui-même ce secret et remplace toute valeur reçue du client.
Le navigateur n'obtient jamais le secret.

Les deux processus chargent `~/.config/vogue-merry/internal_api_token`, créé
atomiquement avec 32 octets aléatoires et des permissions `0600`. Un fichier
invalide, trop ouvert, appartenant à un autre compte ou un lien symbolique
provoque un refus au démarrage. Les services doivent utiliser le même compte
et le même répertoire personnel. Aucun paramètre cloud n'est activé.

Pour renouveler le secret : arrêter les deux services, supprimer uniquement ce
fichier de secret interne, puis redémarrer les deux services. Ne pas supprimer
les clés OpenAI/Hugging Face ni les sources utilisateur. Les outils de diagnostic
qui interrogeaient directement 8011 doivent maintenant passer par 8010.

## Validation et limites

Les tests utilisent des répertoires temporaires et des données synthétiques.
Ils couvrent le refus de lecture et d'écriture directe, les secrets invalides,
la substitution d'en-tête, les permissions, les liens symboliques du secret,
les origines étrangères, les autres ports locaux et la compatibilité du proxy.
La recette microphone et les moteurs de transcription sur le poste utilisateur
restent distincts de ces tests de contrôle d'accès.

## Confinement physique des fichiers

Les contrôles de chemins examinent maintenant le chemin logique et sa destination
physique, y compris les liens symboliques et les jonctions NTFS. Pour un fichier
qui n'existe pas encore, le plus proche parent existant est résolu avant de valider
la destination future. Un lien cassé n'est pas traité comme une destination libre.

Les chemins complets sont vérifiés avant les accès aux projets, journaux, Log Pose,
documents et résultats de transcription. Les partitions projets, entrée documentaire
et tâches de transcription ne peuvent pas se rediriger entre elles. La protection
s'applique également aux dossiers temporaires d'upload et aux versions créées.
Les liens internes restant dans leur racine demeurent utilisables et une racine
mémoire volontairement liée à un volume connu est conservée comme ancrage.

Une requête rencontrant un lien sortant est refusée ; le lien et sa cible ne sont
ni supprimés, ni déplacés, ni modifiés. Les erreurs de confinement ne renvoient pas
le chemin absolu de la cible. La recette couvre lecture, sauvegarde, validation,
fragments audio, résultats de transcription et refus d'upload sans arrêt du moteur.
Les jonctions sont également vérifiées dans le job Windows natif.

Ces vérifications précèdent les accès fichiers : elles ne constituent pas une
sandbox contre un programme exécuté sous le compte de confiance qui remplacerait
les chemins pendant les opérations. Aucun chiffrement de volume ou changement
d'ACL sur les données réelles du poste n'est effectué par cette correction.

## Création concurrente du token

Le fichier temporaire est complet avant publication par lien physique exclusif.
Une autre instance qui rencontre le fichier publié le charge au lieu de remplacer
son contenu. Un test lance huit processus sur le même dossier temporaire et compare
les empreintes des tokens obtenus, sans exposer leurs valeurs ; ils doivent tous
charger le même token complet et ne laisser aucun temporaire. Ce contrôle confirme
le démarrage concurrent testé, pas une protection contre un compte OS compromis.
