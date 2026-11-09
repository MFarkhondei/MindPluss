const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function platform(storage = new Map(), browser = {}) {
  const context = { window: browser, structuredClone, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) } };
  vm.runInNewContext(fs.readFileSync('public/web-platform.js','utf8'), context);
  return { invoke: context.window.MindPlussPlatform.invoke, storage };
}
test('workspace and embedded attachments survive reload, API secrets do not', async () => {
  const {invoke, storage} = platform();
  const data = {boards:[{id:'one',root:{text:'سلام',attachments:[{data_url:'data:image/png;base64,aGVsbG8='}]}}],ai:{provider:'openrouter',openrouterKey:'private-secret',googleKey:'other-secret'}};
  await invoke('save_workspace',{data});
  const serialized = [...storage.values()][0];
  assert.ok(!serialized.includes('private-secret'));
  assert.ok(!serialized.includes('other-secret'));
  assert.equal((await invoke('load_workspace')).data.ai.openrouterKey,'private-secret');
  const reloaded = (await platform(storage).invoke('load_workspace')).data;
  assert.equal(reloaded.boards[0].root.text,'سلام');
  assert.equal(reloaded.ai.openrouterKey,'');
  assert.equal(reloaded.boards[0].root.attachments[0].data_url,'data:image/png;base64,aGVsbG8=');
  assert.equal(data.ai.openrouterKey,'private-secret');
});
test('quota failure is surfaced rather than reporting a successful save', async () => {
  const storage = { get:()=>null, set:()=>{ throw new Error('QuotaExceeded'); } };
  await assert.rejects(platform(storage).invoke('save_workspace',{data:{boards:[]}}),/storage is full/);
});
test('unknown desktop operations fail explicitly', async () => {
  await assert.rejects(platform().invoke('unknown'), /Desktop-only action/);
});

function workspaceFile(initial = '') {
  let content = initial;
  let failure = false;
  return {
    name: 'workspace.json',
    get content() { return content; },
    replace(value) { content = value; },
    fail(value) { failure = value; },
    async getFile() { return { text: async () => content }; },
    async createWritable() {
      if (failure) throw new Error('disk full');
      let next;
      return { write: async value => { next = value; }, close: async () => { content = next; }, abort: async () => {} };
    }
  };
}
const workspace = () => ({boards:[{id:'one',root:{id:'root',children:[],attachments:[{path:'data:audio/webm;base64,aGVsbG8='}]}}],ai:{openaiKey:'secret'}});
function filePlatform(file) {
  return platform(new Map(), {showSaveFilePicker:async()=>file,showOpenFilePicker:async()=>[file]});
}
test('direct file contains all data without secrets and serializes autosaves', async () => {
  const file = workspaceFile();
  const {invoke,storage} = filePlatform(file);
  await invoke('connect_workspace_file',{create:true,data:workspace()});
  assert.ok(!file.content.includes('secret'));
  assert.ok(file.content.includes('data:audio/webm'));
  const first=workspace(), second=workspace();
  first.boards[0].title='first'; second.boards[0].title='second';
  await Promise.all([invoke('save_workspace',{data:first}),invoke('save_workspace',{data:second})]);
  assert.equal(JSON.parse(file.content).boards[0].title,'second');
  assert.equal(storage.size,0);
  const reopened=await filePlatform(file).invoke('connect_workspace_file',{create:false});
  assert.equal(reopened.data.boards[0].title,'second');
});
test('external file edits and disk errors reject without overwriting', async () => {
  const file=workspaceFile(); const {invoke}=filePlatform(file);
  await invoke('connect_workspace_file',{create:true,data:workspace()});
  const saved=file.content;
  file.replace('external edit');
  await assert.rejects(invoke('save_workspace',{data:workspace()}),/File changed outside/);
  assert.equal(file.content,'external edit');
  file.replace(saved); file.fail(true);
  await assert.rejects(invoke('save_workspace',{data:workspace()}),/disk full/);
  assert.equal(file.content,saved);
  file.fail(false);
  await invoke('save_workspace',{data:workspace()});
});
test('invalid workspace and cancelled picker leave current file connected', async () => {
  const file=workspaceFile();
  const browser={showSaveFilePicker:async()=>file,showOpenFilePicker:async()=>[workspaceFile('{"boards":[]}') ]};
  const {invoke}=platform(new Map(),browser);
  await invoke('connect_workspace_file',{create:true,data:workspace()});
  await assert.rejects(invoke('connect_workspace_file',{create:false}),/Invalid MindPluss workspace/);
  browser.showOpenFilePicker=async()=>{const error=new Error('cancelled');error.name='AbortError';throw error;};
  await assert.rejects(invoke('connect_workspace_file',{create:false}),{name:'AbortError'});
  await invoke('save_workspace',{data:workspace()});
  assert.ok(file.content.includes('data:audio/webm'));
});

function sessionDatabase() {
  const records = new Map();
  return { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction() {
          const transaction = {objectStore: () => ({
            get(key) {
              const operation = {result: records.get(key)};
              queueMicrotask(() => transaction.oncomplete());
              return operation;
            },
            put(value, key) {
              records.set(key, value);
              queueMicrotask(() => transaction.oncomplete());
              return {};
            }
          })};
          return transaction;
        }
      };
      request.onsuccess();
    });
    return request;
  }};
}

test('both workspace buttons reconnect with pending edits instead of flushing or replacing state', async () => {
  const source = fs.readFileSync('public/app.js', 'utf8');
  const handler = source.slice(source.indexOf('    async function connectWorkspaceFile(create)'), source.indexOf("    document.getElementById('btnCreateWorkspace').addEventListener"));
  for (const create of [true, false]) {
    const state = workspace();
    const calls = [];
    const context = {
      state, saveTimer: 123, panX: 10, panY: 20, zoom: 1,
      window: {MindPlussPlatform: {fileStatus: () => ({reconnectRequired: true, pending: true})}},
      clearTimeout() {},
      flushSave() { throw new Error('Must reconnect before autosaving'); },
      getActiveBoard: () => state.boards[0],
      document: {getElementById: () => ({disabled: false})},
      invoke: async (command, args) => { calls.push({command, args}); return {name: 'workspace.json'}; },
      updateWorkspaceFileStatus() {},
      autosaveBadge: {classList: {remove() {}}},
      t: key => key, showToast() {}
    };
    vm.createContext(context);
    vm.runInContext(handler, context);
    await context.connectWorkspaceFile(create);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'reconnect_workspace_file');
    assert.equal(calls[0].args.data, state);
    assert.equal(context.state, state);
    assert.equal(context.saveTimer, null);
    assert.equal(context.autosaveBadge.textContent, 'saved');
  }
});

test('reload restores selected workspace file, active board and subsequent file saves', async () => {
  const file = workspaceFile();
  file.queryPermission = async () => 'granted';
  const browser = {indexedDB: sessionDatabase(), showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file]};
  const first = platform(new Map(), browser);
  const data = workspace();
  data.activeBoardId = 'one';
  await first.invoke('connect_workspace_file', {create: true, data});
  const reloaded = platform(new Map(), browser);
  const restored = await reloaded.invoke('load_workspace');
  assert.equal(restored.data.activeBoardId, 'one');
  assert.equal(restored.reconnectRequired, false);
  restored.data.boards[0].title = 'After reload';
  await reloaded.invoke('save_workspace', {data: restored.data});
  assert.equal(JSON.parse(file.content).boards[0].title, 'After reload');
  assert.ok(!file.content.includes('secret'));
});

test('expired file permission restores cached workspace and requires reconnect before saving', async () => {
  const file = workspaceFile();
  file.queryPermission = async () => 'prompt';
  const browser = {indexedDB: sessionDatabase(), showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file]};
  await platform(new Map(), browser).invoke('connect_workspace_file', {create: true, data: workspace()});
  const reloaded = platform(new Map(), browser);
  const restored = await reloaded.invoke('load_workspace');
  assert.equal(restored.data.boards[0].id, 'one');
  assert.equal(restored.reconnectRequired, true);
  await assert.rejects(reloaded.invoke('save_workspace', {data: restored.data}), /permission confirmation required/);
});

test('reconnect requests permission and saves current edits without reopening old data', async () => {
  const file = workspaceFile();
  file.queryPermission = async () => 'prompt';
  let permission = 'denied';
  file.requestPermission = async () => permission;
  const browser = {indexedDB: sessionDatabase(), showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file]};
  await platform(new Map(), browser).invoke('connect_workspace_file', {create: true, data: workspace()});
  const reloaded = platform(new Map(), browser);
  const {data} = await reloaded.invoke('load_workspace');
  data.boards[0].title = 'Unsaved edit';
  const original = file.content;
  await assert.rejects(reloaded.invoke('reconnect_workspace_file', {data}), /permission denied/);
  assert.equal(file.content, original);
  permission = 'granted';
  file.replace('external changes');
  await assert.rejects(reloaded.invoke('reconnect_workspace_file', {data}), /File changed outside/);
  assert.equal(file.content, 'external changes');
  file.replace(original);
  await reloaded.invoke('reconnect_workspace_file', {data});
  assert.equal(JSON.parse(file.content).boards[0].title, 'Unsaved edit');
  data.boards[0].title = 'Next edit';
  await reloaded.invoke('save_workspace', {data});
  assert.equal(JSON.parse(file.content).boards[0].title, 'Next edit');
  assert.ok(!file.content.includes('secret'));
});

test('saving requests expired permission and writes after approval', async () => {
  const file = workspaceFile();
  file.queryPermission = async () => 'prompt';
  let requests = 0;
  file.requestPermission = async () => { requests++; return 'granted'; };
  const browser = {indexedDB: sessionDatabase(), showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file]};
  await platform(new Map(), browser).invoke('connect_workspace_file', {create: true, data: workspace()});
  const reloaded = platform(new Map(), browser);
  const {data} = await reloaded.invoke('load_workspace');
  data.boards[0].title = 'Approved save';
  await reloaded.invoke('save_workspace', {data});
  assert.equal(requests, 1);
  assert.equal(JSON.parse(file.content).boards[0].title, 'Approved save');
});

test('background permission restriction waits for a click without repeatedly prompting', async () => {
  const file = workspaceFile();
  file.queryPermission = async () => 'prompt';
  let requests = 0;
  file.requestPermission = async () => {
    requests++;
    const error = new Error('User gesture required');
    error.name = 'SecurityError';
    throw error;
  };
  const browser = {indexedDB: sessionDatabase(), showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file]};
  await platform(new Map(), browser).invoke('connect_workspace_file', {create: true, data: workspace()});
  const reloaded = platform(new Map(), browser);
  const {data} = await reloaded.invoke('load_workspace');
  const original = file.content;
  for (let i = 0; i < 2; i++) await assert.rejects(reloaded.invoke('save_workspace', {data}), /permission confirmation required/);
  assert.equal(requests, 1);
  assert.equal(file.content, original);
  file.requestPermission = async () => 'granted';
  await reloaded.invoke('reconnect_workspace_file', {data});
});
