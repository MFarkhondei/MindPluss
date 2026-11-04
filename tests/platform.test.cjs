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
