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

## Métadonnées durables du navigateur

La base IndexedDB passe de la version 1 à la version 2, sans effacer le magasin
historique des fragments. Elle contient désormais les sessions. L'écriture d'un
fragment et l'avancement de son compteur se font dans la même transaction.
Le compteur reflète donc le dernier fragment validé, même si des événements plus
récents sont déjà en attente en mémoire.

`localStorage` reste un miroir de compatibilité, mais son refus ou son quota
n'interrompt plus l'écriture d'un fragment dans IndexedDB. Au chargement et avant
une nouvelle capture, l'interface cherche une session dans la base durable.
Une session historique n'existant que dans localStorage reste récupérable.
Après une erreur d'écriture, la capture est arrêtée, mais le dernier événement
émis par MediaRecorder.stop() fait encore l'objet d'une tentative de conservation.
Une transaction avortée n'autorise pas l'avancement du compteur.

La fin de capture est persistée avant la synchronisation. Le nettoyage après
confirmation serveur attend un reçu durable minimal. Ce reçu empêche un vieux
miroir localStorage impossible à supprimer de réactiver une réunion finalisée.
Les reçus ne contiennent plus le contexte de la réunion, uniquement son identifiant
technique et la date du reçu. Ne pas vider les données du navigateur tant qu'une
récupération reste en attente. Fermer les anciens onglets puis recharger lors du
passage à la nouvelle version de la base.

Les tests de transactions utilisent fake-indexeddb et des Blob synthétiques :
ils ne remplacent pas la recette Firefox sur un vrai profil navigateur, ni les
pannes physiques de disque, ni les garanties de durabilité du système d'exploitation.

## Recette d'interruption du processus Firefox

Le scénario de fermeture d'onglet de `validate-firefox-mediarecorder.mjs` reste
un contrôle distinct : il ne simule pas un arrêt du navigateur ni du système.
`validate-firefox-ui-meeting.mjs` ajoute une recette Linux par SIGKILL, sur un
profil Firefox persistant temporaire et un HOME exclusivement fictif. Le
processus ciblé doit être un enfant direct du test portant le chemin exact de
ce profil ; aucun navigateur personnel n'est recherché ou arrêté.

Dans la vraie interface, les envois audio et marqueurs sont interrompus pendant
la capture. Après au moins trois fragments confirmés dans IndexedDB, le test
relève leurs indices, tailles et SHA-256, puis interrompt le processus sans
appeler MediaRecorder.stop() ou context.close(). Il rouvre le même profil et
compare les fragments et marqueurs récupérés. L'export de secours est comparé
aux octets capturés et décodé par ffmpeg. Les fragments restent conservés après
export et aucune capture incomplète ne doit être présentée comme un original
finalisé. Les résultats effectifs sont consignés dans la PR et les journaux CI.

Ce scénario court utilise le faux microphone Firefox. Il ne démontre ni la
conservation du fragment encore en mémoire au moment de l'arrêt, ni une panne
électrique, ni la durabilité physique du disque, ni une réunion de plusieurs
heures. La recette du navigateur et du microphone réels sous Windows reste à
faire séparément.


## Capture de deux minutes sans transfert réseau

La recette Firefox de la vraie interface comprend également une capture de deux
minutes avec refus des requêtes réunion après sa création. Trois repères
(décision, action, question) sont ajoutés au début, après une minute et après deux
minutes. Le test vérifie la conservation locale des fragments et des marqueurs,
leur récupération après rechargement, puis leur transfert après rétablissement.

Avant la reprise, aucun original ne doit être publié. Après confirmation serveur,
les SHA-256 et tailles de chaque fragment sur disque et de l'original assemblé
sont comparés aux données IndexedDB capturées avant rechargement. Le décodage
ffmpeg doit être sans erreur, la durée doit correspondre aux deux minutes et les
repères doivent garder leurs identifiants et positions. La session finalisée ne
doit plus être proposée après un nouveau rechargement.

Ce test ajoute une preuve sur une coupure prolongée de transfert, pas une panne
complète du réseau du poste : la page et la création initiale de l'escale restent
accessibles. Les résultats réellement exécutés sont consignés en CI. Deux minutes
ne constituent pas une validation de plusieurs heures de réunion, d'une veille
Windows ou d'un disque plein. Aucune donnée personnelle n'est utilisée.


## Refus du stockage et arrêt du backend

Deux scénarios supplémentaires de la vraie interface Firefox couvrent des pannes
indépendantes. Leurs résultats effectifs sont consignés dans les journaux CI et
la pull request correspondante.

- Après un premier fragment confirmé, une injection provoque des
  `QuotaExceededError` sur les ajouts au magasin audio IndexedDB. La capture doit
  s'arrêter automatiquement et tenter de conserver le dernier événement. Les
  fragments précédemment validés, leur compteur et les marqueurs restent
  disponibles après rechargement. L'export de secours ne doit ni supprimer ces
  fragments, ni faire apparaître un original finalisé.
- Après un premier fragment entièrement reçu sur disque, seul le processus
  backend du test est arrêté par SIGKILL. La capture continue localement pendant
  la panne puis s'arrête normalement. Après redémarrage du backend avec le même
  HOME fictif, la reprise doit préserver le premier fragment, transférer les
  suivants et finaliser un original dont le SHA-256 correspond aux blocs locaux.
  Les marqueurs sont également repris et le décodage ne doit signaler aucune erreur.

L'injection de quota ne remplit pas le disque : elle teste le traitement d'un
refus d'écriture, pas la durabilité matérielle ni le comportement d'un volume
réel saturé. Les fragments refusés par IndexedDB ne sont pas annoncés comme
sauvegardés. Ces recettes utilisent uniquement des profils, données et signaux
audio fictifs ; elles ne valident pas la veille ou le microphone Windows réel.
