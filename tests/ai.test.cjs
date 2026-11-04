const {test} = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/ai.js');
function response() {
  return { headers: {}, setHeader(k,v){this.headers[k]=v;}, status(code){this.code=code;return this;}, json(body){this.body=body;}, send(body){this.body=body;} };
}
test('AI proxy refuses arbitrary destinations and absent credentials', async () => {
  let res = response();
  await handler({query:{provider:'http://localhost'},headers:{},method:'POST'},res);
  assert.equal(res.code,400);
  res = response();
  await handler({query:{provider:'openrouter'},headers:{},method:'POST'},res);
  assert.equal(res.code,401);
});
test('AI proxy restricts methods', async () => {
  const res = response();
  await handler({query:{provider:'google'},headers:{},method:'DELETE'},res);
  assert.equal(res.code,405);
});
test('AI proxy uses fixed provider endpoint and no caching', async () => {
  const original = global.fetch;
  let target, options;
  global.fetch = async (url, init) => { target=url; options=init; return {status:200,text:async()=>'{"choices":[]}'}; };
  try {
    const res = response();
    await handler({query:{provider:'openrouter'},headers:{authorization:'Bearer test-only'},method:'POST',body:{model:'example',messages:[]}},res);
    assert.equal(target,'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer test-only');
    assert.equal(options.redirect,'error');
    assert.equal(res.headers['Cache-Control'],'no-store');
    assert.equal(res.code,200);
  } finally { global.fetch=original; }
});
