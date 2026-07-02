# Simulation Univers — prototype

Prototype web d'un god game sur la théorie de la simulation. Le joueur est
l'intelligence supérieure qui **code l'univers depuis rien** : au lancement il
n'y a que le Vide — pas d'étoiles, pas d'entités, pas même le temps. Chaque
règle codée a un effet visible qui se déroule dans le temps, et la boucle
centrale du jeu est :

> **coder une règle → observer l'émergence → intervenir → recommencer**

**Stack** : TypeScript strict + Canvas2D, zéro dépendance à l'exécution
(Vite et TypeScript en dev uniquement). Prototype destiné à valider le game
design et l'architecture logique avant un portage Godot.

## Lancer

```bash
npm install
npm run dev      # serveur de dev (Vite)
npm test         # tests console (moteur pur, sans navigateur)
npm run build    # type-check strict + bundle de production
```

## Jouer

1. **Le Vide.** Rien n'existe. Le panneau gauche (« Code de l'univers ») liste
   les règles ; seules Temps et Espace sont codables.
2. **Codez.** Chaque règle a un effet immédiat ou progressif : la Matière
   condense des particules, la Gravité les fait dériver, l'Agrégation les
   amasse, la Fusion allume les étoiles (l'allumage est un *destin* écrit
   ~250 ticks à l'avance — sélectionnez l'amas pour le voir pulser dans sa
   timeline, le replanifier ou l'annuler), la Chimie enrichit les planètes
   refroidies, les Conditions de Vie font monter les eaux dans la zone
   tempérée, la Vie déclenche l'abiogenèse.
3. **Observez.** Molette = zoom continu (la caméra plonge sur le corps visé),
   drag = déplacement, clic = inspection/édition de n'importe quelle entité
   (panneau droit). x1/x10/x100 pour accélérer les ères.
4. **Arbitrez.** Chaque règle active coûte du calcul ; la capacité augmente
   quand l'univers franchit un jalon observable. Deux dilemmes sont calibrés :
   à Fusion et à Vie, il faut couper un processus pour financer le suivant.
5. **Défendez.** L'univers écrit ses propres destins hostiles : astéroïdes
   (trajectoire pointillée + compte à rebours), sécheresses, éruptions —
   annoncés longtemps à l'avance dans le journal ET dans la timeline de leur
   cible. Trois réponses possibles : payer pour réécrire le destin (annuler
   coûte le double de replanifier, l'urgence multiplie jusqu'à ×3), contrer
   par une règle (pomper la montée des eaux avant la sécheresse, éloigner une
   planète de l'éruption), ou laisser faire — l'échec laisse un cratère, mais
   le potentiel demeure : l'eau peut remonter, la vie peut renaître.

## Les règles du méta-jeu (contrats de design, documentés dans le code)

### Règle = processus, entité = produit
Désactiver une règle arrête son *processus* (plus de condensation, plus de
naissances) mais ne détruit jamais ses *produits* (les amas restent, les
vivants continuent de vieillir et de mourir selon leur destin). C'est ce qui
rend la désactivation stratégique et non punitive.

### Dépendance = savoir acquis
Une règle codée une fois compte pour l'arbre même désactivée. Fusion requiert
Agrégation *déjà écrite*, pas *en marche* — sinon le dilemme « couper
l'Agrégation pour financer la Fusion » serait impossible.

### Rétroactivité à deux niveaux (voir `rules.ts`)
- **(a) Paramètres en direct** : les systems lisent les paramètres des règles
  à chaque tick. Éditer `gravity.strength` ou `montée des eaux` agit dès le
  tick suivant, sur toutes les entités, anciennes comme nouvelles.
- **(b) Destins figés** : les événements déjà écrits dans la Fate Queue ont
  été calculés avec les paramètres du moment de leur création et ne sont pas
  recalculés. Changer `délai d'allumage` n'affecte que les allumages écrits
  après.
- **Le scalpel** : pour réécrire un destin existant, on sélectionne l'entité
  et on replanifie/annule ses événements un par un (panneau droit).

### Budget par jalons d'émergence
Capacité initiale 10 (Temps 2 + Espace 1 + Matière 3 + Gravité 3, pas un bit
de plus). Jalons : matière ≥ 40 (+2), premier amas dense (+3), première
étoile (+4), première planète refroidie (+3), premier monde habitable (+2),
première vie (+4), premier destin réécrit (+2). Observer finance le code
suivant — la boucle de gameplay est aussi la boucle d'économie.

### Intervenir brûle du calcul libre
Réécrire un destin déjà écrit consomme du calcul libre (capacité − règles −
brûlé), qui se régénère lentement (1 point / 250 ticks). Coût = ampleur du
type d'événement × urgence (< 500 ticks : ×3) × 2 si annulation. Les édits de
paramètres de règles restent gratuits (prospectifs) ; muter l'état présent
d'une entité (position, température) aussi — seul le FUTUR déjà écrit se paie.
En fin de partie, couper les règles de cosmogonie devenues inutiles est LE
moyen de libérer du calcul d'intervention : les produits persistent.

## Architecture

```
src/
  simulation/       logique PURE : aucune dépendance de rendu ni DOM
    ecs.ts          World, entités (ids), components (données), systems
    fate.ts         Fate Queue : min-heap d'événements de destin par tick
    rules.ts        moteur de règles : dépendances, budget, jalons, params
    cosmos.ts       les 9 règles concrètes, leurs systems et leurs jalons
    components.ts   définitions de components (données pures)
    systems.ts      évolutions continues : âge, croissance, mouvement, orbites
    archetypes.ts   fabriques (Personne, Arbre...) + destins à la naissance
    loop.ts         SimulationClock : temps réel → ticks (vitesse = fréquence)
    rng.ts          RNG seedé (mulberry32) : simulation reproductible
  rendering/        Canvas2D : caméra multi-échelle, LOD, sprites
  ui/               éditeur de règles + panneau divin + HUD (DOM)
  scenario.ts       buildVoidScenario : le Vide + câblage des systems
tests/              tests console (node --test), dont la genèse complète
```

### Les invariants du moteur

1. **Tick canonique.** `world.step()` avance d'exactement un tick ; la vitesse
   ne change que la fréquence d'appel (testé : x100 == x1). La règle Temps
   gate le *pilote* (la boucle d'animation), jamais `World.step` — la logique
   reste pure et testable.
2. **Fate Queue.** Les événements ponctuels (mort, allumage, abiogenèse) sont
   écrits à l'avance dans une min-heap indexée par tick ; la boucle continue
   les rencontre au tick exact, sans jamais sauter. Les cycles écologiques
   sont des événements auto-reconductibles portés par la planète.
3. **Règles gated, produits libres.** Chaque system de règle est enveloppé
   dans un `gated(engine, ruleId, system)` ; les systems cœur (âge,
   croissance, orbites) ne sont pas gated : ils animent des produits et ne
   font rien tant qu'aucune règle n'a créé d'entité.
4. **Zoom continu multi-échelle.** Un seul espace de coordonnées : la surface
   d'une planète est dessinée SUR elle (échelle 1/50), révélée par le zoom en
   cross-fade, clippée au globe. La caméra s'ancre au corps le plus proche
   (< 300 u) au-delà d'un seuil de zoom : la cible saute dessus (plongée
   cinématique) et suit son mouvement orbital.

### Choix d'émergence notables

- **Effondrement hiérarchique** : les amas sont attirés par plus massif
  qu'eux → la première étoile naît de l'effondrement total ; la matière qui
  condense ensuite forme le disque protoplanétaire (les planètes sont des
  amas capturés en orbite, sans téléportation).
- **Masse finie** : la condensation ralentit à mesure que la masse totale
  approche `masse totale de l'univers` (paramètre) — sans ce frein, 200
  planètes au tick 53 000 (vécu).
- **Zone habitable** : l'eau ne se forme que sur les orbites 100–220 — sans
  elle, toutes les planètes refroidies deviennent habitables et l'émergence
  perd sa saillance. Déplacer l'orbite d'une planète (panneau divin) peut
  l'y faire entrer : terraformation par édition d'orbite.

## Notes pour le portage Godot

- `src/simulation/` se traduit mécaniquement : components → `Resource`/struct,
  stores → `Dictionary`, Fate Queue et RuleEngine → mêmes structures (aucune
  API web). Tout l'état est dans les components : sérialisable pour save/load.
- `SimulationClock.advance()` devient le `_process(delta)` d'un noeud
  SimulationDriver ; les orbites sont paramétriques (position = f(tick)),
  déterministes à toute vitesse.
- Caméra : `Camera2D` + re-parentage au noeud planète pour l'ancrage ; les
  seuils LOD/cross-fade se gardent tels quels.
- Rendu HD-2D : les `draw*` de `surface.ts` (sprites verticaux, ombres, tri
  par Y) deviennent des `Sprite3D` billboard sur un sol 3D.
- `ui/` ne contient aucune logique de jeu (tout passe par RuleEngine/world/
  fate) : seul l'habillage Control est à refaire.

## Limites connues (choix de prototype)

- Les personnages ne connaissent pas l'eau (ils marchent dessus) ; la mer qui
  monte peut noyer la première forêt — émergent et assumé.
- Le suivi caméra d'une planète rapide à x100 peut traîner derrière (lissage).
- Pas de sauvegarde/chargement (toutes les données y sont prêtes).
- Le « HD-2D » est évoqué (billboards + ombres + tri Y), pas du vrai 3D.
