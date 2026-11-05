# Intégrité et reprise des fragments audio

La présence d'un numéro de bloc sur le serveur ne suffit pas à autoriser
l'effacement de la copie locale. `/api/meetings/audio-chunks-status` conserve
le champ historique `received` et ajoute `chunks`, contenant l'indice, la
taille et l'empreinte SHA-256 calculés sur le fichier réellement stocké.

Avant de sauter un bloc déjà reçu, la reprise compare ces informations avec
le Blob conservé dans IndexedDB. Une différence bloque la finalisation et
conserve les deux copies pour examen. Avec un serveur ancien qui n'expose
pas les empreintes, le bloc est renvoyé : la comparaison idempotente du
serveur vérifie alors le contenu et refuse tout écrasement.

Les blocs absents sont transmis dans l'ordre ; la file locale n'est nettoyée
qu'après une confirmation de finalisation. Les captures incomplètes restent
à récupérer, sans être présentées comme un enregistrement finalisé.

L'assemblage disque et la vérification d'un original déjà finalisé utilisent
des buffers bornés à 1 Mio. Ils ne chargent plus l'enregistrement complet en
mémoire lors d'une relance. Les fichiers audio lus par ces opérations doivent
être réguliers et ne peuvent pas être des liens symboliques. Les fragments
serveur et les originaux restent conservés.

Les calculs disque restent synchrones dans l'API actuelle : une longue archive
peut retarder d'autres requêtes pendant le contrôle. La simulation logique de
2 160 blocs couvre trois heures à cinq secondes par bloc ; elle ne représente
pas trois heures de microphone ni une recette du poste utilisateur. La recette
Firefox synthétique et les tests de décodage sont rapportés séparément.
