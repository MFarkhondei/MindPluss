// Forward only to known AI APIs. Keys are supplied per request, never persisted.
const endpoints = {
  openrouter: ['https://openrouter.ai/api/v1/chat/completions', 'https://openrouter.ai/api/v1/models'],
  google: ['https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'https://generativelanguage.googleapis.com/v1beta/openai/models'],
  openai: ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/models'],
  anthropic: ['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/models']
};
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const provider = req.query.provider;
  const models = req.query.resource === 'models';
  if (!Object.hasOwn(endpoints, provider)) return res.status(400).json({ error: { message: 'Unknown provider' } });
  if (req.method !== (models ? 'GET' : 'POST')) return res.status(405).json({ error: { message: 'Method not allowed' } });
  const key = provider === 'anthropic' ? req.headers['x-api-key'] : req.headers.authorization;
  if (!key || typeof key !== 'string' || key.length > 4096) return res.status(401).json({ error: { message: 'Your provider API key is required' } });
  const headers = { 'Content-Type': 'application/json' };
  if (provider === 'anthropic') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
  else headers.Authorization = key;
  if (provider === 'openrouter') headers['X-Title'] = 'MindPluss';
  try {
    const upstream = await fetch(endpoints[provider][models ? 1 : 0], {
      method: req.method, headers, redirect: 'error',
      body: models ? undefined : JSON.stringify(req.body),
      signal: AbortSignal.timeout(55000)
    });
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstream.status).send(await upstream.text());
  } catch {
    return res.status(502).json({ error: { message: 'Provider unavailable or request timed out. Please try again.' } });
  }
};
