# Simulation Univers — prototype

Prototype web d'un god game sur la théorie de la simulation : le joueur code
les lois d'un univers, observe son évolution, et zoome de la vue système
jusqu'au sol d'une planète pour voir les entités vivre en temps réel.

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

- **Molette** : zoom continu vers le curseur — de la vue système au sol de
  Gaïa, sans écran de chargement. En redescendant sous un seuil de zoom, la
  caméra se libère de la planète.
- **Drag** : déplacer la caméra (à fort zoom, elle suit automatiquement le
  mouvement orbital de la planète ancrée).
- **Clic** : sélectionner une entité (personne, arbre, mer, planète, étoile)
  → le panneau de code divin s'ouvre.
- **Panneau divin** : éditer les components en direct (espérance de vie,
  croissance, vitesse, orbite…) et lire/réécrire/annuler les événements de la
  Fate Queue de l'entité.
- **⏸ / x1 / x10 / x100** : vitesse de simulation. À x100, on voit la mer
  s'étendre, la forêt s'auto-ensemencer, les générations se succéder.

Idées à essayer : sélectionner un mourant et décupler son `Lifespan.max`
(sa mort est replanifiée) ; sélectionner Gaïa et annuler ses cycles
« Germination »/« Naissance » (le monde s'éteint en quelques milliers de
ticks) ; éditer le `GrowthRate` de la mer intérieure.

## Architecture

```
src/
  simulation/     logique PURE : aucune dépendance de rendu ni DOM
    ecs.ts        World, entités (ids), components (données), systems
    fate.ts       Fate Queue : min-heap d'événements de destin par tick
    components.ts définitions de components (données pures)
    systems.ts    évolutions continues : âge, croissance, mouvement, orbites
    archetypes.ts fabriques (Personne, Arbre, Mer, Étoile, Planète) + destins
    loop.ts       SimulationClock : temps réel → ticks (vitesse = fréquence)
    rng.ts        RNG seedé (mulberry32) : simulation reproductible
  rendering/      Canvas2D : caméra multi-échelle, LOD, sprites
  ui/             panneau divin + HUD (DOM)
  scenario.ts     contenu : l'univers de démo et ses cycles écologiques
tests/            tests console du moteur (node --test)
```

### Les trois invariants du moteur

1. **Tick canonique.** `world.step()` avance la simulation d'exactement un
   tick. La vitesse (x1/x10/x100) ne change que la fréquence d'appel — jamais
   la logique. Une simulation à x100 produit un état identique à x1 (testé).
2. **Fate Queue.** À sa naissance, une entité reçoit ses événements de destin
   (mort, maturité…) dans une min-heap indexée par tick. La boucle continue
   les *rencontre* au bon tick — elle ne saute jamais dessus. Le joueur peut
   consulter, replanifier ou annuler tout événement non réalisé. Les cycles
   écologiques (germinations, naissances) sont eux-mêmes des événements
   auto-reconductibles portés par la planète.
3. **Évolution continue + événements ponctuels.** Les systems font progresser
   les attributs visibles à chaque tick (taille, âge, position) ; la Fate
   Queue réalise les discontinuités (mort). Les deux se rejoignent : éditer
   `Lifespan.max` recalcule la date de mort depuis l'âge déjà vécu.

### Zoom continu multi-échelle

Un seul espace de coordonnées (unités univers). La surface d'une planète
(coordonnées locales, component `OnPlanet`) est dessinée **sur** la planète à
l'échelle `SURFACE_TO_UNIVERSE` : elle n'est lisible qu'en zoomant. Le passage
espace → sol est un simple cross-fade entre le disque planétaire et la couche
surface, clippée au globe. La caméra s'ancre à la planète à fort zoom (le sol
paraît immobile malgré l'orbite) avec une assistance de plongée pendant la
traversée de l'atmosphère.

## Notes pour le portage Godot

- `src/simulation/` se traduit mécaniquement : components → `Resource`/struct,
  stores → `Dictionary`, Fate Queue → mêmes structures (aucune API web).
  L'état des « cerveaux » (`Wanderer`) vit dans les components, donc tout est
  sérialisable pour save/load.
- `SimulationClock.advance()` devient le `_process(delta)` d'un noeud
  SimulationDriver qui appelle `world.step()` en rafale.
- Les orbites sont **paramétriques** (position = f(tick absolu), pas
  d'intégration) : déterministes à toute vitesse, et triviales à porter.
- Caméra : `Camera2D`/`Camera3D` remplace `camera.ts` ; l'ancrage se fait en
  re-parentant la caméra au noeud planète ; les seuils LOD/cross-fade se
  gardent tels quels.
- Rendu HD-2D : les `draw*` de `surface.ts` (sprites verticaux, ombres, tri
  par Y) deviennent des `Sprite3D` billboard sur un sol 3D — Godot offre le
  tri et l'éclairage nativement.
- `ui/panel.ts` ne contient aucune logique de jeu (tout passe par des setters
  vers world/fate) : seul l'habillage Control est à refaire.
- Le RNG seedé correspond à `RandomNumberGenerator.seed`.

## Limites connues (choix de prototype)

- Les personnages ne connaissent pas l'eau : ils marchent sur la mer (la
  forêt, elle, ne germe pas sous l'eau).
- Une seule planète habitée (la liste `surfacePlanets` est prête pour plus).
- Pas de sauvegarde/chargement (toutes les données y sont prêtes).
- Le « HD-2D » est évoqué (billboards + ombres + tri Y), pas du vrai 3D.
