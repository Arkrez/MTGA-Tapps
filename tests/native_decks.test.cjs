// Offline checks for the shipped adapter. Never attach or call Arena APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function runtime() {
  const calls=[];
  const context={rpc:{}, handlers:{}, Process:{findModuleByName:()=>({getExportByName:name=>name})},
    NativeFunction:function(name){return ()=>{calls.push(name);if(context.handlers[name])return context.handlers[name]();if(name==='il2cpp_gchandle_get_target')return context.manager;throw new Error('Unexpected native call: '+name);};}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/mtga_tracker/assets/arena_decks.js'),'utf8'),context);
  context.manager={equals:other=>other===context.manager};
  vm.runInContext("connection={account:'fixture',managerHandle:'held'};root=()=>globalThis.manager;accountId=()=> 'fixture';deckScreenOpen=()=>true;",context);
  return {context,calls};
}

test('the native account/service guard rejects an account switch',()=>{
  const {context,calls}=runtime();
  vm.runInContext("accountId=()=> 'another-account'",context);
  assert.throws(()=>vm.runInContext("guard('fixture',true)",context),/account or session changed/);
  assert.deepEqual(calls,[]);
});

test('an inactive Decks screen blocks writes before any service request',()=>{
  const {context,calls}=runtime();
  vm.runInContext('deckScreenOpen=()=>false',context);
  assert.throws(()=>vm.runInContext("guard('fixture',true)",context),/outside a match/);
  assert.deepEqual(calls,['il2cpp_gchandle_get_target']);
});

test('read polling survives a native UI rebuild while preserving account/service identity',()=>{
  const {context}=runtime();
  vm.runInContext('deckScreenOpen=()=>false',context);
  assert.equal(vm.runInContext("guard('fixture')",context),context.manager);
});

test('Arena-owned attached threads are never detached',()=>{
  const {context,calls}=runtime();
  context.handlers.il2cpp_thread_current=()=>({isNull:()=>false});
  assert.equal(vm.runInContext('attached(()=>42)',context),42);
  assert.deepEqual(calls,['il2cpp_thread_current']);
});

test('native removal refuses a changed snapshot before a delete call',async()=>{
  const {context,calls}=runtime();
  context.old={arena_id:'original',is_net_deck:false,summary:{Description:''},piles:[{quantity:60}],skins:[]};
  context.current=structuredClone(context.old);context.current.piles[0].quantity=59;
  vm.runInContext(`
    promiseCall=async(account,start,extract,write)=>{guard(account,write);return start();};
    cachedDecks=()=>[{}];ref=()=>({});fieldAt=()=>({});guidText=()=>'original';deckSnapshot=()=>globalThis.current;
  `,context);
  await assert.rejects(vm.runInContext("removeDeck('fixture',old)",context),/changed after backup/);
  assert.deepEqual(calls,['il2cpp_gchandle_get_target']);
});

test('full Arena slots block native construction and creation',async()=>{
  const {context,calls}=runtime();
  vm.runInContext(`
    onUnityThread=async run=>run();
    findMethod=()=>({});invoke=()=>({});
  `,context);
  context.handlers.il2cpp_object_unbox=()=>({readU8:()=>1});
  await assert.rejects(vm.runInContext("createDeck('fixture',{},'new')",context),/slots are full/);
  assert.deepEqual(calls,['il2cpp_gchandle_get_target','il2cpp_object_unbox']);
});

test('native text preparation requires Decks before touching import providers',async()=>{
  const {context,calls}=runtime();
  vm.runInContext('deckScreenOpen=()=>false;onUnityThread=async run=>run()',context);
  await assert.rejects(vm.runInContext("prepareImport('fixture','Deck\\n4 Forest','Test','12345678-1234-1234-1234-123456789abc')",context),/outside a match/);
  assert.deepEqual(calls,['il2cpp_gchandle_get_target']);
});

test('snapshot verification survives sorted persisted keys and still rejects changed cards',()=>{
  const {context}=runtime();
  context.original={name:'Offline fixture',arena_id:'id',summary:{Name:'Offline fixture',Description:null},piles:[{pile:1,entries:[{id:123,quantity:60}]}],skins:[]};
  const sorted=item=>Array.isArray(item)?item.map(sorted):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,sorted(item[key])])):item;
  context.saved=sorted(context.original);context.saved.summary.Description='';
  assert.notEqual(JSON.stringify(context.original),JSON.stringify(context.saved));
  assert.equal(vm.runInContext('sameSourceSnapshot(original,saved)',context),true);
  context.saved.piles[0].entries[0].quantity=59;
  assert.equal(vm.runInContext('sameSourceSnapshot(original,saved)',context),false);
});
