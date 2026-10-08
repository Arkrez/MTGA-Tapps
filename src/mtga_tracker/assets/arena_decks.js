'use strict';

// Native deck adapter. Checked IL2CPP helpers carried forward from the live POC.
const targets = new Set([
  'DecksManager', 'WrapperController', 'DeckManagerController', 'DeckViewSelector',
  'DeckFolderView', 'Client_Deck', 'Client_DeckSummary', 'WrapperDeckUtilities',
  'DeckServiceWrapperHelpers',
  'UnitySynchronizationContext',
  'Object', 'Resources', 'Component', 'Transform', 'Localize', 'Client_DeckContents',
  'Client_DeckCard', 'Client_CardSkin', 'EDeckPile',
  'TMP_Text', 'Application', 'GameObject',
  'Guid',
  'JsonConvert', 'DeckInfo',
]);
const game = Process.findModuleByName('GameAssembly.dylib')
  ?? Process.findModuleByName('GameAssembly.dll');
if (!game) throw new Error('An IL2CPP GameAssembly module is required.');
function api(name, returns, args) {
  return new NativeFunction(game.getExportByName(`il2cpp_${name}`), returns, args);
}
const domainGet = api('domain_get', 'pointer', []);
const threadAttach = api('thread_attach', 'pointer', ['pointer']);
const threadDetach = api('thread_detach', 'void', ['pointer']);
const threadCurrent = api('thread_current', 'pointer', []);
const assembliesGet = api('domain_get_assemblies', 'pointer', ['pointer', 'pointer']);
const assemblyImage = api('assembly_get_image', 'pointer', ['pointer']);
const imageName = api('image_get_name', 'pointer', ['pointer']);
const imageCount = api('image_get_class_count', 'size_t', ['pointer']);
const imageClass = api('image_get_class', 'pointer', ['pointer', 'size_t']);
const className = api('class_get_name', 'pointer', ['pointer']);
const classNamespace = api('class_get_namespace', 'pointer', ['pointer']);
const classMethods = api('class_get_methods', 'pointer', ['pointer', 'pointer']);
const classFields = api('class_get_fields', 'pointer', ['pointer', 'pointer']);
const fieldName = api('field_get_name', 'pointer', ['pointer']);
const fieldType = api('field_get_type', 'pointer', ['pointer']);
const fieldOffset = api('field_get_offset', 'size_t', ['pointer']);
const methodName = api('method_get_name', 'pointer', ['pointer']);
const methodCount = api('method_get_param_count', 'uint', ['pointer']);
const methodParam = api('method_get_param', 'pointer', ['pointer', 'uint']);
const methodReturn = api('method_get_return_type', 'pointer', ['pointer']);
const typeName = api('type_get_name', 'pointer', ['pointer']);
const free = api('free', 'void', ['pointer']);
const objectClass = api('object_get_class', 'pointer', ['pointer']);
const classParent = api('class_get_parent', 'pointer', ['pointer']);
const staticValue = api('field_static_get_value', 'void', ['pointer', 'pointer']);
const fieldFlags = api('field_get_flags', 'int', ['pointer']);
const arrayLength = api('array_length', 'uint', ['pointer']);
const arrayElementSize = api('array_element_size', 'int', ['pointer']);
const elementClass = api('class_get_element_class', 'pointer', ['pointer']);
const stringLength = api('string_length', 'int', ['pointer']);
const stringChars = api('string_chars', 'pointer', ['pointer']);
const runtimeInvoke = api('runtime_invoke', 'pointer', ['pointer', 'pointer', 'pointer', 'pointer']);
const objectUnbox = api('object_unbox', 'pointer', ['pointer']);
const classType = api('class_get_type', 'pointer', ['pointer']);
const typeObject = api('type_get_object', 'pointer', ['pointer']);
const stringNew = api('string_new', 'pointer', ['pointer']);
const fieldSet = api('field_set_value', 'void', ['pointer', 'pointer', 'pointer']);
const fieldSetObject = api('field_set_value_object', 'void', ['pointer', 'pointer', 'pointer']);
// Unity 6 uses Il2CppGCHandle = void*, not the older uint32_t ABI.
const handleNew = api('gchandle_new', 'pointer', ['pointer', 'bool']);
const handleTarget = api('gchandle_get_target', 'pointer', ['pointer']);
const handleFree = api('gchandle_free', 'void', ['pointer']);
const classes = new Map();
const fieldCache = new Map();
let connection = null;
let pending = null;
function number(value) { return Number(value.toString()); }
function typeLabel(type) {
  const text = typeName(type);
  try { return text.readUtf8String(); } finally { free(text); }
}
function iterate(fn, owner) {
  const iterator = Memory.alloc(Process.pointerSize);
  iterator.writePointer(NULL);
  const results = [];
  for (let i = 0; i < 10000; i++) {
    const item = fn(owner, iterator);
    if (item.isNull()) return results;
    results.push(item);
  }
  throw new Error('Metadata enumeration exceeded the bound.');
}
function attached(run) {
  // Promise continuations can execute on Unity's already-attached main thread.
  // Never detach a thread owned by Arena; only detach our own fresh attachment.
  if (!threadCurrent().isNull()) return run();
  const thread = threadAttach(domainGet());
  if (thread.isNull()) throw new Error('Could not attach the probe thread to IL2CPP.');
  try { return run(); } finally { threadDetach(thread); }
}
function discover() {
  const count = Memory.alloc(Process.pointerSize);
  const assemblies = assembliesGet(domainGet(), count);
  const length = Process.pointerSize === 8 ? number(count.readU64()) : count.readU32();
  if (length > 1000) throw new Error('Unexpected assembly count.');
  const found = [];
  for (let i = 0; i < length; i++) {
    const image = assemblyImage(assemblies.add(i * Process.pointerSize).readPointer());
    const classCount = number(imageCount(image));
    if (classCount > 100000) throw new Error('Unexpected class count.');
    for (let j = 0; j < classCount; j++) {
      const klass = imageClass(image, j);
      const name = className(klass).readUtf8String();
      if (!targets.has(name)) continue;
      const namespace = classNamespace(klass).readUtf8String();
      const key = `${namespace}.${name}`;
      classes.set(key, klass);
      found.push({ name, namespace, image: imageName(image).readUtf8String(),
        fields: iterate(classFields, klass).map(field => ({
          name: fieldName(field).readUtf8String(), type: typeLabel(fieldType(field)),
          offset: number(fieldOffset(field)),
        })),
        methods: iterate(classMethods, klass).map(method => ({
          name: methodName(method).readUtf8String(), returns: typeLabel(methodReturn(method)),
          parameters: Array.from({length: methodCount(method)}, (_, p) => typeLabel(methodParam(method, p))),
        })),
      });
    }
  }
  return { schema: 1, arch: Process.arch, runtime: 'IL2CPP', classes: found,
    native_transfers_proven: false, native_folder_proven: false };
}
function fields(klass) {
  const key=klass.toString();
  if (fieldCache.has(key)) return fieldCache.get(key);
  const found = new Map();
  for (let k = klass; !k.isNull(); k = classParent(k)) {
    for (const field of iterate(classFields, k)) {
      const name = fieldName(field).readUtf8String();
      if (!found.has(name)) found.set(name, field);
    }
  }
  fieldCache.set(key,found);
  return found;
}
function fieldAt(object, name) {
  if (object.isNull()) throw new Error(`Null object for ${name}.`);
  const field = fields(objectClass(object)).get(name);
  if (!field || (fieldFlags(field) & 0x10)) throw new Error(`Missing instance field ${name}.`);
  return object.add(number(fieldOffset(field)));
}
function ref(object, name) { return fieldAt(object, name).readPointer(); }
function text(object) {
  if (object.isNull()) return null;
  const length = stringLength(object);
  if (length < 0 || length > 20000) throw new Error('String length exceeded the bound.');
  return stringChars(object).readUtf16String(length);
}
function array(object) {
  if (object.isNull()) return {length: 0, data: NULL, stride: 0, klass: NULL};
  const klass = objectClass(object);
  const length = arrayLength(object);
  const stride = arrayElementSize(klass);
  if (length > 10000 || stride < 1 || stride > 256) throw new Error('Unexpected array layout.');
  // IL2CPP 64-bit array header: object header, bounds pointer, max_length.
  if (Process.pointerSize !== 8) throw new Error('This experiment requires a 64-bit client.');
  return {length, data: object.add(4 * Process.pointerSize), stride, klass};
}
function dictionary(object) {
  if (object.isNull()) return [];
  const count = fieldAt(object, '_count').readS32();
  const entries = array(ref(object, '_entries'));
  if (count < 0 || count > entries.length) throw new Error('Invalid dictionary count.');
  if (!count) return [];
  const entryFields = fields(elementClass(entries.klass));
  if (typeLabel(fieldType(entryFields.get('hashCode'))) !== 'System.Int32') throw new Error('Unsupported dictionary entry layout.');
  const offset = name => {
    const field = entryFields.get(name);
    if (!field) throw new Error(`Missing dictionary entry ${name}.`);
    const value = number(fieldOffset(field)) - 2 * Process.pointerSize;
    if (value < 0 || value >= entries.stride) throw new Error('Invalid dictionary entry offset.');
    return value;
  };
  const items = [];
  for (let i = 0; i < count; i++) {
    const base = entries.data.add(i * entries.stride);
    if (base.add(offset('hashCode')).readS32() < 0) continue;
    items.push({key: base.add(offset('key')), value: base.add(offset('value'))});
  }
  return items;
}
function list(object, expectedStride) {
  if (object.isNull()) return [];
  const count = fieldAt(object, '_size').readS32();
  const items = array(ref(object, '_items'));
  if (count < 0 || count > items.length) throw new Error('Invalid list count.');
  if (count && expectedStride && items.stride !== expectedStride) throw new Error('Unsupported list element layout.');
  return Array.from({length:count}, (_, i) => items.data.add(i * items.stride));
}
function root() {
  const klass = classes.get('.WrapperController');
  const field = klass && fields(klass).get('<Instance>k__BackingField');
  if (!field) throw new Error('Wrapper singleton metadata is unavailable.');
  const value = Memory.alloc(Process.pointerSize);
  staticValue(field, value);
  const wrapper = value.readPointer();
  if (wrapper.isNull()) throw new Error('Arena must be on its home/decks screen.');
  const manager = ref(wrapper, 'DecksManager');
  if (manager.isNull()) throw new Error('Deck service is not loaded.');
  return manager;
}
function snapshot() {
  for (const [key,expected] of [
    ['Wizards.Mtga.Decks.Client_DeckCard',{Id:['System.UInt32',16],Quantity:['System.UInt32',20]}],
    ['Wizards.Mtga.Decks.Client_CardSkin',{GrpId:['System.Int64',16],CCV:['System.String',24],ArtId:['System.Int64',32]}],
  ]) {
    const metadata=fields(classes.get(key));
    for (const [name,[type,offset]] of Object.entries(expected)) {
      const field=metadata.get(name);
      if (!field || typeLabel(fieldType(field))!==type || number(fieldOffset(field))!==offset) {
        throw new Error(`Unsupported ${key} layout; no partial capture returned.`);
      }
    }
  }
  const manager = root();
  const provider = ref(manager, '_deckDataProvider');
  const cached = dictionary(ref(provider, '_allDecks'));
  const decks = cached.map(entry => deckSnapshot(entry.value.readPointer()));
  const serviceLimit = invoke(findMethod('.DecksManager','GetDeckLimit',[]), manager);
  const serviceReached = invoke(findMethod('.DecksManager','get_DeckLimitReached',[]), manager);
  const selectors = selectorObjects();
  const pileNames = {};
  for (const [name,field] of fields(classes.get('Wizards.Mtga.Decks.EDeckPile'))) {
    if (!(fieldFlags(field) & 0x40)) continue;
    const value=Memory.alloc(4); staticValue(field,value); pileNames[value.readS32()]=name;
  }
  return {schema:1, arch:Process.arch, runtime:'IL2CPP', unity_thread_observed:true,
    catalog_scope:'loaded cache; not an authoritative freshness or capacity claim',
    deck_limit_field:fieldAt(manager,'_deckLimit').readS32(), decks, pile_names:pileNames,
    service_calls:{get_deck_limit:objectUnbox(serviceLimit).readS32(), limit_reached:Boolean(objectUnbox(serviceReached).readU8())},
    live_deck_selectors:selectors.length,
    provider_fields:[...fields(objectClass(provider))].map(([name,f])=>({name,type:typeLabel(fieldType(f))})),
    native_transfers_proven:false, native_folder_proven:false};
}
function deckSnapshot(deck) {
    const summary = ref(deck, '_summary');
    const contents = ref(deck, '_contents');
    const result = {name: text(ref(summary, 'Name')), arena_id:guidText(fieldAt(summary,'DeckId')),
      summary:summarySnapshot(summary), is_net_deck: Boolean(fieldAt(summary, 'IsNetDeck').readU8()),
      contents_loaded: !contents.isNull()};
    if (!contents.isNull()) {
      result.contents_fields = [...fields(objectClass(contents))].map(([name,f]) => ({name,type:typeLabel(fieldType(f))}));
      const pileField = [...fields(objectClass(contents))].find(([name]) => name.includes('Piles'));
      if (pileField) {
        result.piles = dictionary(contents.add(number(fieldOffset(pileField[1]))).readPointer()).map(pile => ({
          pile: pile.key.readS32(), entries: list(pile.value.readPointer(),8).map(card => ({
            id: card.readU32(), quantity: card.add(4).readU32(),
          })),
        }));
      }
      result.skins = list(ref(contents,'Skins'),24).map(skin => ({
        GrpId:skin.readS64().toString(), CCV:text(skin.add(8).readPointer()), ArtId:skin.add(16).readS64().toString(),
      }));
    }
    return result;
}
function guidText(address) {
  const hex = offset => address.add(offset).readU8().toString(16).padStart(2,'0');
  return [[3,2,1,0],[5,4],[7,6],[8,9],[10,11,12,13,14,15]].map(group => group.map(hex).join('')).join('-');
}
function summarySnapshot(summary) {
  const result = {};
  for (const [name,field] of fields(objectClass(summary))) {
    if (fieldFlags(field) & 0x10) continue;
    const type = typeLabel(fieldType(field));
    const address = summary.add(number(fieldOffset(field)));
    if (type === 'System.String') result[name] = text(address.readPointer());
    else if (type === 'System.UInt32') result[name] = address.readU32();
    else if (type === 'System.Boolean') result[name] = Boolean(address.readU8());
    else if (type === 'System.Guid') result[name] = guidText(address);
    else if (type === 'System.Nullable<System.Guid>') {
      // Preserve bytes as well as presence; do not guess the inline Guid offset.
      result[name] = {raw_bytes:Array.from(new Uint8Array(address.readByteArray(20)))};
    } else if (type === 'System.Collections.Generic.List<System.String>') result[name] = list(address.readPointer()).map(p=>text(p.readPointer()));
    else if (type === 'System.Collections.Generic.Dictionary<System.String,System.String>') result[name] = dictionary(address.readPointer()).map(e=>({key:text(e.key.readPointer()),value:text(e.value.readPointer())}));
    else throw new Error(`Unsupported deck-summary field ${name}: ${type}; refusing a partial snapshot.`);
  }
  return result;
}

function hierarchyMethods(klass) {
  const methods = [];
  for (let k=klass;!k.isNull();k=classParent(k)) methods.push(...iterate(classMethods,k));
  return methods;
}
function findMethod(key, name, parameters) {
  const klass = classes.get(key);
  const found = klass && iterate(classMethods, klass).filter(m =>
    methodName(m).readUtf8String() === name && methodCount(m) === parameters.length
    && parameters.every((p,i) => typeLabel(methodParam(m,i)) === p));
  if (!found || found.length !== 1) throw new Error(`Expected one ${key}.${name} with the checked signature.`);
  return found[0];
}
function invoke(method, object = NULL, arguments_ = []) {
  const params = arguments_.length ? Memory.alloc(arguments_.length * Process.pointerSize) : NULL;
  arguments_.forEach((value,i) => params.add(i * Process.pointerSize).writePointer(value));
  const error = Memory.alloc(Process.pointerSize);
  error.writePointer(NULL);
  const result = runtimeInvoke(method, object, params, error);
  if (!error.readPointer().isNull()) throw new Error('Arena rejected the managed call; no further calls made.');
  return result;
}
function selectorObjects() {
  const type = typeObject(classType(classes.get('Wizards.Mtga.Decks.DeckViewSelector')));
  const includeInactive = Memory.alloc(1); includeInactive.writeU8(0);
  const method = findMethod('UnityEngine.Object','FindObjectsOfType',['System.Type','System.Boolean']);
  const result = array(invoke(method, NULL, [type,includeInactive]));
  return Array.from({length:result.length}, (_,i) => result.data.add(i * result.stride).readPointer());
}
function objectMethod(object, name, parameters) {
  for (let klass=objectClass(object);!klass.isNull();klass=classParent(klass)) {
    const key = `${classNamespace(klass).readUtf8String()}.${className(klass).readUtf8String()}`;
    classes.set(key,klass);
    const matches = iterate(classMethods,klass).filter(m=>methodName(m).readUtf8String()===name
      && methodCount(m)===parameters.length && parameters.every((p,i)=>typeLabel(methodParam(m,i))===p));
    if (matches.length===1) return matches[0];
    if (matches.length>1) throw new Error(`Ambiguous ${key}.${name}.`);
  }
  throw new Error(`Missing checked method ${name}.`);
}

function checkedHandleABI() {
  const version = text(invoke(findMethod('UnityEngine.Application','get_unityVersion',[])));
  if (!/^6000\./.test(version)) throw new Error('This mutation experiment requires the verified Unity 6 GC-handle ABI.');
}

function cachedDecks(manager) {
  return dictionary(ref(ref(manager,'_deckDataProvider'),'_allDecks')).map(e=>e.value.readPointer());
}
function stringObject(value) { return stringNew(Memory.allocUtf8String(value)); }
function parseGuid(value) {
  const text=stringObject(value), handle=handleNew(text,0);
  try { return invoke(findMethod('System.Guid','Parse',['System.String']),NULL,[text]); }
  finally { handleFree(handle); }
}

function serializeModel(object) {
  const result=invoke(findMethod('Newtonsoft.Json.JsonConvert','SerializeObject',['System.Object']),NULL,[object]);
  if (result.isNull()) throw new Error('Native serializer returned no data.');
  const handle=handleNew(result,0);
  try { return text(result); } finally { handleFree(handle); }
}
function physicalSummaryJson(json,sourceSummary) {
  const serialized=JSON.parse(json), physical={};
  for (const key of Object.keys(sourceSummary)) {
    if (!(key in serialized)) throw new Error(`Serializer omitted summary field ${key}.`);
    physical[key]=serialized[key];
  }
  // Computed IsFavorite/Format/date property setters can rewrite Attributes.
  // Persist only verified physical fields, retaining the serializer's Guid codec.
  return JSON.stringify(physical);
}
function deserializeModel(json,key) {
  if (typeof json!=='string' || json.length>20000) throw new Error('Invalid bounded model archive.');
  const klass=classes.get(key);
  if (!klass) throw new Error('The required archive model type is unavailable.');
  const input=stringObject(json), handle=handleNew(input,0);
  try {
    const result=invoke(findMethod('Newtonsoft.Json.JsonConvert','DeserializeObject',['System.String','System.Type']),NULL,
      [input,typeObject(classType(klass))]);
    if (result.isNull() || !objectClass(result).equals(klass)) throw new Error('Archive did not deserialize into the checked type.');
    return result;
  } finally { handleFree(handle); }
}

function sameSourceSnapshot(left,right) {
  const normalized=deck=>{
    // A fresh summary represents an empty description as null, while a
    // previously loaded full-deck model can use "". Preserve all other fields.
    const value=JSON.parse(JSON.stringify(deck));
    if (value.summary.Description===null) value.summary.Description='';
    return JSON.stringify(value);
  };
  return normalized(left)===normalized(right);
}

function onUnityThread(run) {
  const klass = classes.get('UnityEngine.UnitySynchronizationContext');
  const exec = klass && iterate(classMethods, klass).find(m => methodName(m).readUtf8String() === 'Exec' && methodCount(m) === 0);
  if (!exec) throw new Error('Unity main-thread dispatcher is unavailable.');
  const address = exec.readPointer();
  if (!Process.findRangeByAddress(address)?.protection.includes('x')) throw new Error('Invalid Unity method address.');
  return new Promise((resolve, reject) => {
    let complete = false;
    const timer = setTimeout(() => {
      if (complete) return;
      complete = true; listener.detach(); reject(new Error('No Unity main-thread frame within 10 seconds.'));
    }, 10000);
    const listener = Interceptor.attach(address, {onEnter() {
      if (complete) return;
      complete = true; clearTimeout(timer); listener.detach();
      try { resolve(run()); } catch (error) { reject(error); }
    }});
  });
}

function wrapperObject() {
  const field=fields(classes.get('.WrapperController')).get('<Instance>k__BackingField');
  const value=Memory.alloc(Process.pointerSize); staticValue(field,value);
  const wrapper=value.readPointer();
  if (wrapper.isNull()) throw new Error('Return to Arena’s Decks screen outside a match.');
  return wrapper;
}
function accountId() {
  const client=ref(wrapperObject(),'<AccountClient>k__BackingField');
  if (client.isNull()) throw new Error('Arena is not signed in.');
  const info=invoke(objectMethod(client,'get_AccountInformation',[]),client);
  if (info.isNull()) throw new Error('Arena is not signed in.');
  const field=fields(objectClass(info)).get('AccountID');
  if (!field || typeLabel(fieldType(field))!=='System.String') throw new Error('Unsupported account identity layout.');
  // Read only the stable account ID. Never read tokens, email or credentials.
  const id=text(ref(info,'AccountID'));
  if (!id || id.length>256) throw new Error('Arena account identity is unavailable.');
  return id;
}
function deckScreenOpen() {
  const klass=classes.get('.DeckManagerController');
  if (!klass) return false;
  const flag=Memory.alloc(1); flag.writeU8(0);
  const found=array(invoke(findMethod('UnityEngine.Object','FindObjectsOfType',['System.Type','System.Boolean']),NULL,
    [typeObject(classType(klass)),flag]));
  return found.length===1 && selectorObjects().length===1;
}
function guard(expectedAccount, requireDecks=false) {
  if (!connection || accountId()!==expectedAccount || connection.account!==expectedAccount
    || !root().equals(handleTarget(connection.managerHandle))) throw new Error('Arena account or session changed. Reconnect Deck Manager.');
  if (requireDecks && !deckScreenOpen()) throw new Error('Open Arena’s Decks screen outside a match to transfer decks.');
  return root();
}
function releaseConnection() {
  if (pending) throw new Error('A native request is still pending.');
  if (connection) handleFree(connection.managerHandle);
  connection=null;
  return true;
}
async function openConnection() {
  attached(discover);
  return onUnityThread(()=>{
    if (connection) throw new Error('Deck Manager is already connected.');
    checkedHandleABI();
    const version=text(invoke(findMethod('UnityEngine.Application','get_unityVersion',[])));
    if (Process.arch!=='arm64' || version!=='6000.3.14f1') throw new Error('This Arena build is not supported by the native deck adapter yet.');
    if (!deckScreenOpen()) throw new Error('Open Arena’s Decks screen outside a match before connecting Deck Manager.');
    const account=accountId(), manager=root();
    connection={account,managerHandle:handleNew(manager,0)};
    return {account_id:account,unity_version:version,deck_screen_open:deckScreenOpen()};
  });
}
async function promiseCall(account, start, extract, write=false) {
  if (pending) throw new Error('A native request is already pending.');
  let handle;
  try {
    handle=await onUnityThread(()=>{
      guard(account,write);
      const promise=start();
      if (promise.isNull()) throw new Error('Arena returned no request. Outcome must be reconciled.');
      pending=handleNew(promise,0); return pending;
    });
    const deadline=Date.now()+45000;
    while (Date.now()<deadline) {
      const result=await onUnityThread(()=>{
        guard(account);
        const promise=handleTarget(handle);
        if (!objectUnbox(invoke(objectMethod(promise,'get_IsDone',[]),promise)).readU8()) return null;
        if (!objectUnbox(invoke(objectMethod(promise,'get_Successful',[]),promise)).readU8()) throw new Error('Arena request did not succeed. Refresh to reconcile its outcome.');
        return {value:extract(invoke(objectMethod(promise,'get_Result',[]),promise))};
      });
      if (result) return result.value;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    throw new Error('Arena request timed out. Refresh to reconcile its outcome.');
  } finally {
    if (handle) await onUnityThread(()=>{handleFree(handle);pending=null;});
  }
}
async function roster(account) {
  await promiseCall(account,()=>invoke(findMethod('.DecksManager','ForceRefreshCachedDecks',[]),root()),()=>true);
  return promiseCall(account,()=>invoke(findMethod('.DecksManager','GetAllDecks',[]),root()),result=>{
    if (result.isNull()) throw new Error('Arena returned no roster. No transfer can proceed.');
    const report=snapshot();
    const decks=list(result).map(p=>deckSnapshot(p.readPointer()));
    const ids=decks.filter(d=>!d.is_net_deck).map(d=>d.arena_id);
    if (new Set(ids).size!==ids.length) throw new Error('Arena returned duplicate deck identities.');
    return {account_id:account,deck_screen_open:deckScreenOpen(),limit:report.service_calls.get_deck_limit,
      limit_reached:report.service_calls.limit_reached,pile_names:report.pile_names,
      decks:decks.filter(d=>!d.is_net_deck),roster_refreshed:true};
  });
}
async function fullDeck(account,id) {
  return promiseCall(account,()=>{
    const guid=parseGuid(id),handle=handleNew(guid,0);
    try { return invoke(findMethod('.DecksManager','GetFullDeck',['System.Guid']),root(),[objectUnbox(guid)]); }
    finally { handleFree(handle); }
  },result=>{
    const actual=deckSnapshot(result);
    if (actual.arena_id!==id || actual.is_net_deck) throw new Error('Arena returned a different deck identity.');
    return actual;
  });
}
async function archiveDecks(account,ids) {
  if (!Array.isArray(ids) || ids.length>2000 || new Set(ids).size!==ids.length) throw new Error('Invalid deck selection.');
  for (const id of ids) await fullDeck(account,id);
  return onUnityThread(()=>{
    guard(account);
    const report=snapshot();
    const archives=ids.map(id=>{
      const deck=cachedDecks(root()).find(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===id);
      if (!deck) throw new Error('Deck is no longer present in Arena.');
      const source=deckSnapshot(deck);
      if (source.is_net_deck || !source.contents_loaded || source.piles.length!==4) throw new Error('Arena has not loaded all deck piles.');
      const model=invoke(findMethod('Wizards.Mtga.Decks.DeckServiceWrapperHelpers','ToAzureModel',['Wizards.Mtga.Decks.Client_Deck']),NULL,[deck]);
      const handle=handleNew(model,0);
      try { return {schema:1,archive_kind:'arena_typed_model_poc',model_json:serializeModel(model),
        summary_json:physicalSummaryJson(serializeModel(ref(deck,'_summary')),source.summary),source_snapshot:source,
        pile_names:report.pile_names,runtime:'IL2CPP',unity_thread_observed:true,unity_version:'6000.3.14f1'}; }
      finally { handleFree(handle); }
    });
    return archives;
  });
}
async function createDeck(account,archive,id) {
  let draftHandle;
  try {
    draftHandle=await onUnityThread(()=>{
      const manager=guard(account,true);
      if (objectUnbox(invoke(findMethod('.DecksManager','get_DeckLimitReached',[]),manager)).readU8()) throw new Error('Arena’s deck slots are full. Move a deck to your collection first.');
      if (!/^[0-9a-f-]{36}$/.test(id) || cachedDecks(manager).some(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===id)) throw new Error('Restore identity already exists. Reconcile instead of creating again.');
      const model=deserializeModel(archive.model_json,'Wizards.Mtga.FrontDoorModels.DeckInfo'),modelHandle=handleNew(model,0);
      let draft;
      try {draft=invoke(findMethod('Wizards.Mtga.Decks.DeckServiceWrapperHelpers','ToClientModel',['Wizards.Mtga.FrontDoorModels.DeckInfo']),NULL,[model]);}
      finally {handleFree(modelHandle);}
      const held=handleNew(draft,0);
      try {
        const summary=deserializeModel(archive.summary_json,'Wizards.Mtga.Decks.Client_DeckSummary'),summaryHandle=handleNew(summary,0);
        try {fieldSetObject(draft,fields(objectClass(draft)).get('_summary'),summary);}
        finally {handleFree(summaryHandle);}
        if (!sameSourceSnapshot(deckSnapshot(draft),archive.source_snapshot)) throw new Error('The rebuilt deck differs from its saved backup.');
        const guid=parseGuid(id),guidHandle=handleNew(guid,0);
        try {fieldSet(summary,fields(objectClass(summary)).get('DeckId'),objectUnbox(guid));}
        finally {handleFree(guidHandle);}
        return held;
      } catch(error) {handleFree(held);throw error;}
    });
    const createdId=await promiseCall(account,()=>{
      const imported=stringObject('Imported'),held=handleNew(imported,0),flag=Memory.alloc(1);flag.writeU8(0);
      try {return invoke(findMethod('.DecksManager','CreateDeck',['Wizards.Mtga.Decks.Client_Deck','System.String','System.Boolean']),root(),[handleTarget(draftHandle),imported,flag]);}
      finally {handleFree(held);}
    },summary=>guidText(fieldAt(summary,'DeckId')),true);
    // A client returning a different identity is an unknown result, never retried.
    if (createdId!==id) throw new Error('Arena returned an unexpected restore identity. Refresh to reconcile.');
    await roster(account);
    return fullDeck(account,id);
  } finally {if(draftHandle) await onUnityThread(()=>handleFree(draftHandle));}
}
async function removeDeck(account,snapshot) {
  const id=snapshot.arena_id;
  return promiseCall(account,()=>{
    const current=cachedDecks(root()).find(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===id);
    if (!current || snapshot.is_net_deck || !sameSourceSnapshot(deckSnapshot(current),snapshot)) throw new Error('The deck changed after backup. Refresh before moving it.');
    const guid=parseGuid(id),held=handleNew(guid,0);
    try {return invoke(findMethod('.DecksManager','DeleteDeck',['System.Guid']),root(),[objectUnbox(guid)]);}
    finally {handleFree(held);}
  },result=>{
    if (result.isNull() || !objectUnbox(result).readU8()) throw new Error('Arena did not confirm removal. Refresh to reconcile.');
    return true;
  },true);
}
rpc.exports={open:openConnection,roster,archive:archiveDecks,fetchdeck:fullDeck,create:createDeck,remove:removeDeck,
  close(){return onUnityThread(releaseConnection);}};
