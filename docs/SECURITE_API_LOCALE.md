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
