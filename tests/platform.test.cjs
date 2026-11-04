const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function platform(storage = new Map()) {
  const context = { window: {}, structuredClone, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) } };
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
