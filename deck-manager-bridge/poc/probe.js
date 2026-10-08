'use strict';

// Explicit IL2CPP experiment. Write RPCs can only operate on one new test copy.
const targets = new Set([
  'DecksManager', 'WrapperController', 'DeckManagerController', 'DeckViewSelector',
  'DeckFolderView', 'Client_Deck', 'Client_DeckSummary', 'WrapperDeckUtilities',
  'DeckServiceWrapperHelpers',
  'UnitySynchronizationContext',
  'Object', 'Resources', 'Component', 'Transform', 'Localize', 'Client_DeckContents',
  'Client_DeckCard', 'Client_CardSkin', 'EDeckPile',
  'TMP_Text', 'Application', 'GameObject',
  'Guid',
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
let testFolder = null;
let testCopy = null;
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
  const thread = threadAttach(domainGet());
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
  const found = new Map();
  for (let k = klass; !k.isNull(); k = classParent(k)) {
    for (const field of iterate(classFields, k)) {
      const name = fieldName(field).readUtf8String();
      if (!found.has(name)) found.set(name, field);
    }
  }
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
function serviceProbe() {
  const manager = root();
  const decks = dictionary(ref(ref(manager,'_deckDataProvider'),'_allDecks')).map(e=>e.value.readPointer());
  const deck = decks.find(d => !fieldAt(ref(d,'_summary'),'IsNetDeck').readU8());
  if (!deck) throw new Error('No ordinary deck is available to read.');
  const guid = fieldAt(ref(deck,'_summary'),'DeckId');
  const promise = invoke(findMethod('.DecksManager','GetFullDeck',['System.Guid']),manager,[guid]);
  if (promise.isNull()) throw new Error('GetFullDeck returned no promise.');
  const done=Boolean(objectUnbox(invoke(objectMethod(promise,'get_IsDone',[]),promise)).readU8());
  const successful=done && Boolean(objectUnbox(invoke(objectMethod(promise,'get_Successful',[]),promise)).readU8());
  const result=successful ? invoke(objectMethod(promise,'get_Result',[]),promise) : NULL;
  return {schema:1, arch:Process.arch, get_full_deck_invoked:true,
    promise_done:done, promise_successful:successful,
    result_identity_verified:!result.isNull() && guidText(fieldAt(ref(result,'_summary'),'DeckId'))===guidText(guid),
    promise_fields:[...fields(objectClass(promise))].map(([name,f])=>({name,type:typeLabel(fieldType(f))})),
    promise_methods:hierarchyMethods(objectClass(promise)).filter(m=>methodName(m).readUtf8String().startsWith('get_')).map(m=>({name:methodName(m).readUtf8String(),returns:typeLabel(methodReturn(m)),parameters:Array.from({length:methodCount(m)},(_,i)=>typeLabel(methodParam(m,i)))})),
    native_transfers_proven:false, native_folder_proven:false};
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
function folderLabel(folder) {
  const loc = ref(folder, 'FolderNameLocKey');
  const includeInactive = Memory.alloc(1); includeInactive.writeU8(1);
  const component = invoke(findMethod('UnityEngine.Component','GetComponentInChildren',['System.Type','System.Boolean']),
    loc, [typeObject(classType(classes.get('TMPro.TMP_Text'))),includeInactive]);
  if (component.isNull()) throw new Error('Native folder label is unavailable.');
  return text(invoke(findMethod('TMPro.TMP_Text','get_text',[]), component));
}
function addTestFolder() {
  if (testFolder) throw new Error('The temporary folder already exists.');
  root(); // Fail outside the wrapper/home scene.
  const selectors = selectorObjects();
  if (selectors.length !== 1) throw new Error('Open Arena\'s Decks screen; expected one active selector.');
  checkedHandleABI();
  const selector = selectors[0];
  const folderList = ref(selector,'_deckFolders');
  const checkHandle = handleNew(folderList,0);
  try {
    if (!handleTarget(checkHandle).equals(folderList)) throw new Error('GC handle ABI validation failed.');
  } finally { handleFree(checkHandle); }
  const folders = list(folderList).map(p => p.readPointer());
  const starter = folders.filter(folder => /^starter decks\b/i.test(folderLabel(folder) ?? ''));
  if (starter.length !== 1) throw new Error('Could not uniquely locate Starter Decks; no UI changes made.');
  const original = starter[0];
  const transformMethod = findMethod('UnityEngine.Component','get_transform',[]);
  const starterTransform = invoke(transformMethod,original);
  const sibling = objectUnbox(invoke(findMethod('UnityEngine.Transform','GetSiblingIndex',[]),starterTransform)).readS32();
  const clone = invoke(findMethod('UnityEngine.Object','Instantiate',['UnityEngine.Object','UnityEngine.Transform']),
    NULL,[ref(selector,'_deckFolderViewPrefab'),ref(selector,'_folderParent')]);
  const cloneHandle = handleNew(clone,0);
  const listHandle = handleNew(folderList,0);
  testFolder = {cloneHandle,listHandle};
  const temporaryHandles = [];
  function string(value) {
    const object = stringNew(Memory.allocUtf8String(value));
    temporaryHandles.push(handleNew(object,0));
    return object;
  }
  try {
    const guid = Memory.alloc(16);
    guid.writeByteArray([0xc5,0x8f,0x05,0x4b,0xed,0xf0,0x0b,0x4a,0xa8,0xb8,0x16,0xb3,0x91,0x86,0xc8,0xd4]);
    const idField = fields(objectClass(clone)).get('FolderId');
    if (typeLabel(fieldType(idField)) !== 'System.Guid') throw new Error('Unexpected folder identity layout.');
    fieldSet(clone,idField,guid); // Only the newly cloned, temporary UI component.
    invoke(findMethod('Wizards.Mtga.Decks.DeckFolderView','Initialize',[
      'System.Action<Wizards.Mtga.Decks.DeckViewInfo>','System.Action<Wizards.Mtga.Decks.DeckViewInfo>',
      'System.Action<Wizards.Mtga.Decks.DeckViewInfo,System.String>','System.Action<System.Guid>',
    ]),clone,['_onDeckSelected','_onDeckDoubleClicked','_onDeckNameEndEdit','_onFolderToggle'].map(name => ref(original,name)));
    invoke(findMethod('Wotc.Mtga.Loc.Localize','SetText',[
      'System.String','System.Collections.Generic.List<MTGA.Loc.MTGALocalizable.LocParam>','System.String',
    ]),ref(clone,'FolderNameLocKey'),[string(''),NULL,string('Tapps Collection (proof of concept)')]);
    const index = Memory.alloc(4); index.writeS32(sibling+1);
    invoke(findMethod('UnityEngine.Transform','SetSiblingIndex',['System.Int32']),invoke(transformMethod,clone),[index]);
    invoke(objectMethod(folderList,'Add',['Wizards.Mtga.Decks.DeckFolderView']),folderList,[clone]);
    const actualSibling = objectUnbox(invoke(findMethod('UnityEngine.Transform','GetSiblingIndex',[]),invoke(transformMethod,clone))).readS32();
    const active = Boolean(objectUnbox(invoke(findMethod('UnityEngine.GameObject','get_activeInHierarchy',[]),
      invoke(findMethod('UnityEngine.Component','get_gameObject',[]),clone))).readU8());
    if (actualSibling!==sibling+1 || !active) throw new Error('Temporary section placement or activation failed.');
    return {label:folderLabel(clone), placed_after:'Starter Decks', native_folder_proven:true,
      starter_sibling:sibling, test_sibling:actualSibling, active_in_hierarchy:active,
      scope:'temporary empty UI folder; no saved decks or transfers', native_transfers_proven:false};
  } catch (error) {
    clearTestFolder();
    throw error;
  } finally {
    temporaryHandles.forEach(handle => handleFree(handle));
  }
}
function checkedHandleABI() {
  const version = text(invoke(findMethod('UnityEngine.Application','get_unityVersion',[])));
  if (!/^6000\./.test(version)) throw new Error('This mutation experiment requires the verified Unity 6 GC-handle ABI.');
}
function folderStatus() {
  const selectors=selectorObjects();
  if (selectors.length!==1) throw new Error('Decks scene changed before cleanup verification.');
  const flag=Memory.alloc(1);flag.writeU8(1);
  const objects=array(invoke(findMethod('UnityEngine.Object','FindObjectsOfType',['System.Type','System.Boolean']),NULL,
    [typeObject(classType(classes.get('Wizards.Mtga.Decks.DeckFolderView'))),flag]));
  const remaining=Array.from({length:objects.length},(_,i)=>objects.data.add(i*objects.stride).readPointer())
    .filter(folder=>folderLabel(folder)==='Tapps Collection (proof of concept)').length;
  return {temporary_sections_remaining:remaining};
}
function clearTestFolder() {
  if (!testFolder) return {removed:true};
  const {cloneHandle,listHandle} = testFolder;
  const clone = handleTarget(cloneHandle);
  const folderList = handleTarget(listHandle);
  invoke(objectMethod(folderList,'Remove',['Wizards.Mtga.Decks.DeckFolderView']),folderList,[clone]);
  // Destroy the entire cloned GameObject, including its native child UI.
  const gameObject = invoke(findMethod('UnityEngine.Component','get_gameObject',[]),clone);
  invoke(findMethod('UnityEngine.Object','Destroy',['UnityEngine.Object']),NULL,[gameObject]);
  handleFree(cloneHandle); handleFree(listHandle); testFolder = null;
  return {removed:true};
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
function copyManager(requireDecks=true) {
  if (!testCopy) throw new Error('No prepared test copy.');
  const manager=root();
  if (!manager.equals(handleTarget(testCopy.managerHandle))) throw new Error('Deck service changed; stop and review the test copy.');
  if (requireDecks && selectorObjects().length!==1) throw new Error(`Decks screen changed during ${testCopy.phase}; stop and review the test copy.`);
  return manager;
}
function prepareCopy(sourceId, operationId) {
  if (testCopy) throw new Error('A test copy is already prepared.');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuid.test(sourceId) || !uuid.test(operationId)) throw new Error('Valid source and operation UUIDs are required.');
  checkedHandleABI();
  const report=snapshot();
  if (report.live_deck_selectors!==1) throw new Error('Open Arena\'s Decks screen before the disposable-copy test.');
  if (report.service_calls.limit_reached) throw new Error('Arena reports its deck limit reached; no test copy created.');
  const manager=root(), cached=cachedDecks(manager);
  const beforeIds=cached.map(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId')));
  if (beforeIds.includes(operationId)) throw new Error('The test identity already exists; refusing reuse.');
  const original=cached.find(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===sourceId);
  const source=report.decks.find(d=>d.arena_id===sourceId);
  if (!original || !source || source.is_net_deck || !source.contents_loaded || source.piles.length!==4) throw new Error('Select a complete ordinary source deck.');
  const model=invoke(findMethod('Wizards.Mtga.Decks.DeckServiceWrapperHelpers','ToAzureModel',['Wizards.Mtga.Decks.Client_Deck']),NULL,[original]);
  const modelHandle=handleNew(model,0);
  let draft;
  try { draft=invoke(findMethod('Wizards.Mtga.Decks.DeckServiceWrapperHelpers','ToClientModel',['Wizards.Mtga.FrontDoorModels.DeckInfo']),NULL,[model]); }
  finally { handleFree(modelHandle); }
  const draftHandle=handleNew(draft,0);
  try {
    const summary=ref(draft,'_summary');
    if (summary.equals(ref(original,'_summary')) || ref(draft,'_contents').equals(ref(original,'_contents'))) throw new Error('Client helper did not produce an independent copy.');
    const guid=parseGuid(operationId), guidHandle=handleNew(guid,0);
    try { fieldSet(summary,fields(objectClass(summary)).get('DeckId'),objectUnbox(guid)); }
    finally { handleFree(guidHandle); }
    const name=`Tapps POC ${operationId.slice(0,8)}`, nameObject=stringObject(name), nameHandle=handleNew(nameObject,0);
    try { fieldSetObject(summary,fields(objectClass(summary)).get('Name'),nameObject); }
    finally { handleFree(nameHandle); }
    const expected=deckSnapshot(draft);
    if (JSON.stringify(expected.piles)!==JSON.stringify(source.piles)
      || JSON.stringify(expected.skins)!==JSON.stringify(source.skins)) throw new Error('Native conversion changed card piles or skins.');
    if (JSON.stringify(deckSnapshot(original))!==JSON.stringify(source)) throw new Error('Source changed during preparation.');
    testCopy={phase:'prepared',draftHandle,managerHandle:handleNew(manager,0),beforeIds,name,
      expected,sourceSnapshot:source,promiseHandle:null};
    return {operation_id:operationId,phase:'prepared',source_snapshot:source,test_snapshot:testCopy.expected,
      scope:'Create and remove only a new disposable duplicate. Existing source deck is never removed.'};
  } catch(error) { handleFree(draftHandle); throw error; }
}
function createCopy() {
  const manager=copyManager();
  if (testCopy.phase!=='prepared') throw new Error('Test creation cannot be repeated.');
  if (objectUnbox(invoke(findMethod('.DecksManager','get_DeckLimitReached',[]),manager)).readU8()) throw new Error('Deck limit reached.');
  testCopy.phase='create_unknown'; // Set before the call: never retry an uncertain write.
  const imported=stringObject('Imported'), importedHandle=handleNew(imported,0);
  const flag=Memory.alloc(1); flag.writeU8(0);
  try {
    const promise=invoke(findMethod('.DecksManager','CreateDeck',['Wizards.Mtga.Decks.Client_Deck','System.String','System.Boolean']),
      manager,[handleTarget(testCopy.draftHandle),imported,flag]);
    if (promise.isNull()) throw new Error('No create promise returned; outcome unknown.');
    testCopy.promiseHandle=handleNew(promise,0); testCopy.phase='create_pending';
    return {phase:testCopy.phase};
  } finally { handleFree(importedHandle); }
}
function pollCopy() {
  // Polling/refresh are reads. Refresh can temporarily rebuild the Decks UI;
  // retain the service identity guard. Create/delete still require Decks open.
  const manager=copyManager(false);
  if (!['create_pending','delete_pending','refresh_pending'].includes(testCopy.phase)) throw new Error('No pending disposable-copy operation.');
  const promise=handleTarget(testCopy.promiseHandle);
  if (!objectUnbox(invoke(objectMethod(promise,'get_IsDone',[]),promise)).readU8()) return {phase:testCopy.phase};
  if (!objectUnbox(invoke(objectMethod(promise,'get_Successful',[]),promise)).readU8()) throw new Error('Test request failed; stop without retrying.');
  if (testCopy.phase==='create_pending') {
    const summary=invoke(objectMethod(promise,'get_Result',[]),promise);
    const id=guidText(fieldAt(summary,'DeckId'));
    if (testCopy.beforeIds.includes(id)) throw new Error('Returned identity belongs to an existing deck; no deletion allowed.');
    const created=cachedDecks(manager).find(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===id);
    if (!created) throw new Error('Created copy is not available for verification.');
    const actual=deckSnapshot(created);
    if (actual.is_net_deck || actual.name!==testCopy.name || JSON.stringify(actual.piles)!==JSON.stringify(testCopy.expected.piles)
      || JSON.stringify(actual.skins)!==JSON.stringify(testCopy.expected.skins)) throw new Error('Created copy differs; retain it for review.');
    testCopy.created=actual; testCopy.phase='created_verified';
    return {phase:testCopy.phase,created_snapshot:actual};
  }
  if (testCopy.phase==='delete_pending') {
    const result=invoke(objectMethod(promise,'get_Result',[]),promise);
    if (result.isNull() || !objectUnbox(result).readU8()) throw new Error('Deletion was not confirmed; stop for review.');
    handleFree(testCopy.promiseHandle); testCopy.promiseHandle=null;
    const refresh=invoke(findMethod('.DecksManager','ForceRefreshCachedDecks',[]),manager);
    if (refresh.isNull()) throw new Error('No refresh promise returned; roster unverified.');
    testCopy.promiseHandle=handleNew(refresh,0); testCopy.phase='refresh_pending';
    return {phase:testCopy.phase};
  }
  const remaining=cachedDecks(manager).map(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId')));
  if (remaining.includes(testCopy.created.arena_id)) throw new Error('Test deck is still present after refresh.');
  if (testCopy.beforeIds.some(id=>!remaining.includes(id))) throw new Error('Roster changed during test; review required.');
  const source=cachedDecks(manager).find(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===testCopy.sourceSnapshot.arena_id);
  if (!source || !sameSourceSnapshot(deckSnapshot(source),testCopy.sourceSnapshot)) throw new Error('Source snapshot changed during test; review required.');
  testCopy.phase='complete';
  return {phase:'complete',test_copy_absence_verified:true,original_roster_preserved:true,
    native_create_delete_proven:true,native_transfers_proven:false};
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
function deleteCopy(archive) {
  const manager=copyManager();
  if (testCopy.phase!=='created_verified' || JSON.stringify(archive)!==JSON.stringify(testCopy.created)) throw new Error('A verified archive of this test copy is required.');
  const current=cachedDecks(manager).find(d=>guidText(fieldAt(ref(d,'_summary'),'DeckId'))===archive.arena_id);
  if (!current || JSON.stringify(deckSnapshot(current))!==JSON.stringify(archive)) throw new Error('Test deck changed; refuse deletion.');
  const guid=parseGuid(archive.arena_id), guidHandle=handleNew(guid,0);
  testCopy.phase='delete_unknown';
  try {
    handleFree(testCopy.promiseHandle); testCopy.promiseHandle=null;
    const promise=invoke(findMethod('.DecksManager','DeleteDeck',['System.Guid']),manager,[objectUnbox(guid)]);
    if (promise.isNull()) throw new Error('No delete promise returned; outcome unknown.');
    testCopy.promiseHandle=handleNew(promise,0); testCopy.phase='delete_pending';
    return {phase:testCopy.phase};
  } finally { handleFree(guidHandle); }
}
function releaseCopy() {
  if (testCopy) {
    [testCopy.draftHandle,testCopy.managerHandle,testCopy.promiseHandle].filter(h=>h!==null).forEach(handle => handleFree(handle));
    testCopy=null;
  }
}
async function refreshRoster() {
  attached(discover);
  const handles=[];
  try {
    const state=await onUnityThread(() => {
      checkedHandleABI();
      const manager=root();
      const managerHandle=handleNew(manager,0); handles.push(managerHandle);
      const promise=invoke(findMethod('.DecksManager','ForceRefreshCachedDecks',[]),manager);
      if (promise.isNull()) throw new Error('No roster refresh promise returned.');
      const promiseHandle=handleNew(promise,0); handles.push(promiseHandle);
      return {managerHandle,promiseHandle};
    });
    const deadline=Date.now()+20000;
    while (Date.now()<deadline) {
      const report=await onUnityThread(() => {
        if (!root().equals(handleTarget(state.managerHandle))) throw new Error('Deck service changed during roster refresh.');
        // A normal refresh can temporarily disable/rebuild the Decks selector.
        // This is read-only: require the same service, not an active UI component.
        const promise=handleTarget(state.promiseHandle);
        if (!objectUnbox(invoke(objectMethod(promise,'get_IsDone',[]),promise)).readU8()) return null;
        if (!objectUnbox(invoke(objectMethod(promise,'get_Successful',[]),promise)).readU8()) throw new Error('Roster refresh failed.');
        return {...snapshot(),force_refresh_done:true,force_refresh_successful:true};
      });
      if (report) return report;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw new Error('Roster refresh did not complete within 20 seconds.');
  } finally {
    if (handles.length) await onUnityThread(()=>handles.forEach(handle=>handleFree(handle)));
  }
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
rpc.exports = {
  inspect() { return attached(discover); },
  cache() { attached(discover); return onUnityThread(snapshot); },
  service() { attached(discover); return onUnityThread(serviceProbe); },
  refresh() { return refreshRoster(); },
  folder() { attached(discover); return onUnityThread(addTestFolder); },
  clearfolder() { return onUnityThread(clearTestFolder); },
  folderstatus() { return onUnityThread(folderStatus); },
  preparecopy(sourceId,operationId) { attached(discover); return onUnityThread(()=>prepareCopy(sourceId,operationId)); },
  createcopy() { return onUnityThread(createCopy); },
  pollcopy() { return onUnityThread(pollCopy); },
  deletecopy(archive) { return onUnityThread(()=>deleteCopy(archive)); },
  releasecopy() { return onUnityThread(releaseCopy); },
};
