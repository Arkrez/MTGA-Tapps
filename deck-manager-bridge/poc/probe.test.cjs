// Offline Frida boundary checks. Never attach to Arena or call native APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function probe() {
  const calls = [];
  const context = {
    rpc: {},
    Process: {findModuleByName: () => ({getExportByName: name => name})},
    NativeFunction: function(name) {
      return (...args) => {
        calls.push(name);
        if (name === 'il2cpp_gchandle_get_target') return context.heldManager;
        throw new Error(`Unexpected native API call: ${name}`);
      };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'probe.js'), 'utf8'), context);
  return {context, calls};
}

function deck() {
  return {
    name: 'Offline fixture',
    summary: {Name: 'Offline fixture', Description: '', Attributes: [{key: 'IsFavorite', value: 'true'}]},
    piles: [{pile: 1, entries: [{id: 123, quantity: 4}]}],
    skins: [{GrpId: '123', CCV: 'style', ArtId: '456'}],
  };
}

test('fresh roster can represent an empty description as null without changing the deck', () => {
  const {context, calls} = probe();
  context.left = deck();
  context.right = structuredClone(context.left);
  context.right.summary.Description = null;
  assert.equal(vm.runInContext('sameSourceSnapshot(left,right)', context), true);
  assert.equal(context.right.summary.Description, null); // Comparison never mutates the archive.
  assert.deepEqual(calls, []);
});

for (const change of ['description', 'name', 'printing', 'quantity', 'skin', 'attribute']) {
  test(`source verification still rejects a changed ${change}`, () => {
    const {context} = probe();
    context.left = deck();
    context.right = structuredClone(context.left);
    if (change === 'description') context.right.summary.Description = 'Changed';
    if (change === 'name') context.right.name = 'Changed';
    if (change === 'printing') context.right.piles[0].entries[0].id = 987;
    if (change === 'quantity') context.right.piles[0].entries[0].quantity = 1;
    if (change === 'skin') context.right.skins[0].ArtId = '789';
    if (change === 'attribute') context.right.summary.Attributes[0].value = 'false';
    assert.equal(vm.runInContext('sameSourceSnapshot(left,right)', context), false);
  });
}

function screenless(context) {
  context.manager = {equals: other => other === context.manager};
  context.heldManager = context.manager;
  vm.runInContext(`
    testCopy={managerHandle:'test-handle',phase:'prepared'};
    root=()=>globalThis.manager;
    selectorObjects=()=>[];
  `, context);
}

test('read checks retain their service identity during a temporary UI rebuild', () => {
  const {context, calls} = probe();
  screenless(context);
  assert.equal(vm.runInContext('copyManager(false)', context), context.manager);
  assert.deepEqual(calls, ['il2cpp_gchandle_get_target']);
});

for (const operation of ['createCopy()', 'deleteCopy({})']) {
  test(`${operation} cannot write while Decks is closed`, () => {
    const {context, calls} = probe();
    screenless(context);
    assert.throws(() => vm.runInContext(operation, context), /Decks screen changed/);
    assert.deepEqual(calls, ['il2cpp_gchandle_get_target']);
  });
}

test('a service change still blocks reads and writes', () => {
  const {context, calls} = probe();
  screenless(context);
  context.heldManager = {};
  assert.throws(() => vm.runInContext('copyManager(false)', context), /Deck service changed/);
  assert.deepEqual(calls, ['il2cpp_gchandle_get_target']);
});
