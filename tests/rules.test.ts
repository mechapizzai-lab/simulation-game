/**
 * Moteur de règles : dépendances, budget, jalons — testé sur un mini-arbre
 * (Temps/Espace/Matière) indépendant du contenu réel du jeu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/simulation/ecs.js';
import { RuleEngine } from '../src/simulation/rules.js';

function makeEngine(capacity = 10): { engine: RuleEngine; world: World } {
  const engine = new RuleEngine(capacity);
  engine.define({ id: 'time', label: 'Temps', description: '', requires: [], cost: 2, params: [] });
  engine.define({ id: 'space', label: 'Espace', description: '', requires: [], cost: 1, params: [] });
  engine.define({
    id: 'matter',
    label: 'Matière',
    description: '',
    requires: ['space'],
    cost: 3,
    params: [{ key: 'rate', label: 'taux', default: 5, min: 0, max: 20, step: 1 }],
  });
  return { engine, world: new World() };
}

test('une règle est bloquée tant que ses dépendances ne sont pas codées', () => {
  const { engine, world } = makeEngine();
  assert.match(engine.activationBlocker('matter', world) ?? '', /requiert Espace/);
  assert.equal(engine.activate('matter', world), false);
  assert.equal(engine.activate('space', world), true);
  assert.equal(engine.activationBlocker('matter', world), null);
  assert.equal(engine.activate('matter', world), true);
});

test('le budget refuse ce qui dépasse la capacité, avec la raison', () => {
  const { engine, world } = makeEngine(3);
  assert.equal(engine.activate('space', world), true); // 1/3
  assert.equal(engine.activate('time', world), true); // 3/3
  assert.match(engine.activationBlocker('matter', world) ?? '', /budget insuffisant \(6\/3\)/);
  // Libérer du budget en coupant un processus rend la règle activable.
  assert.equal(engine.deactivate('time'), true);
  assert.equal(engine.activate('matter', world), false); // 1+3=4 > 3 : toujours trop
  engine.capacity = 4;
  assert.equal(engine.activate('matter', world), true);
});

test('on ne peut pas désactiver une règle dont dépend une règle active', () => {
  const { engine, world } = makeEngine();
  engine.activate('space', world);
  engine.activate('matter', world);
  assert.match(engine.deactivationBlocker('space') ?? '', /Matière en dépend/);
  assert.equal(engine.deactivate('space'), false);
  engine.deactivate('matter');
  assert.equal(engine.deactivate('space'), true);
});

test('les jalons créditent la capacité une seule fois', () => {
  const { engine, world } = makeEngine(5);
  let announced = 0;
  engine.onEvent((e) => {
    if (e.kind === 'milestone') announced++;
  });
  engine.defineMilestone({
    id: 'first-entity',
    label: 'Première entité',
    reward: 3,
    check: (w) => w.entityCount > 0,
  });
  engine.checkMilestones(world);
  assert.equal(engine.capacity, 5, 'condition non remplie : rien ne se passe');
  world.createEntity();
  engine.checkMilestones(world);
  engine.checkMilestones(world);
  assert.equal(engine.capacity, 8, 'créditée exactement une fois');
  assert.equal(announced, 1);
});

test('un prérequis d\'état du monde bloque même si les dépendances sont satisfaites', () => {
  const { engine, world } = makeEngine();
  engine.define({
    id: 'life',
    label: 'Vie',
    description: '',
    requires: [],
    cost: 1,
    params: [],
    worldRequirement: { label: 'au moins une entité', check: (w) => w.entityCount > 0 },
  });
  assert.match(engine.activationBlocker('life', world) ?? '', /requiert au moins une entité/);
  world.createEntity();
  assert.equal(engine.activationBlocker('life', world), null);
});

test('les paramètres sont bornés par leur spec et lus en direct', () => {
  const { engine, world } = makeEngine();
  engine.activate('space', world);
  engine.activate('matter', world);
  assert.equal(engine.param('matter', 'rate'), 5);
  engine.setParam('matter', 'rate', 12);
  assert.equal(engine.param('matter', 'rate'), 12);
  engine.setParam('matter', 'rate', 999);
  assert.equal(engine.param('matter', 'rate'), 20, 'écrêté au max de la spec');
});
