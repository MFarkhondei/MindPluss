/* MindPluss browser platform. Adapted UI: Copyright (c) 2026 Ramin Turne, MIT. */
(() => {
  'use strict';
  const WORKSPACE = 'mindpluss.workspace.v1';
  const KEYS = ['openrouterKey', 'googleKey', 'openaiKey', 'anthropicKey', 'customKey'];
  let volatileKeys = {};
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name.replace(/[\\/:*?"<>|]/g, '-');
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
  }
  function pick(accept = '') {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.hidden = true;
      document.body.append(input);
      input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
      input.oncancel = () => { resolve(null); input.remove(); };
      input.click();
    });
  }
  function readData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read file')); reader.readAsDataURL(file);
    });
  }
  function attachment(name, data, size, flags = {}) {
    if (data.length > 6 * 1024 * 1024) throw new Error('حداکثر اندازهٔ هر پیوست ۴ مگابایت است / Maximum attachment size: 4 MB');
    const mime = data.split(';')[0].slice(5);
    return { id: crypto.randomUUID(), name, ext: name.split('.').pop().toLowerCase(), path: data, size,
      is_image: flags.isImage || mime.startsWith('image/'),
      is_video: flags.isVideo || mime.startsWith('video/'),
      is_audio: flags.isAudio || mime.startsWith('audio/') };
  }
  window.MindPlussPlatform = {
    aiUrl(url) {
      const providers = {
        'https://openrouter.ai/api/v1/': 'openrouter',
        'https://generativelanguage.googleapis.com/v1beta/openai/': 'google',
        'https://api.openai.com/v1/': 'openai',
        'https://api.anthropic.com/v1/': 'anthropic'
      };
      for (const [base, provider] of Object.entries(providers)) {
        if (url === base + 'models' || url === base + 'chat/completions' || url === base + 'messages') {
          return `/api/ai?provider=${provider}&resource=${url.endsWith('/models') ? 'models' : 'chat'}`;
        }
      }
      return url;
    },
    async invoke(command, args = {}) {
      switch (command) {
        case 'load_workspace': {
          const data = JSON.parse(localStorage.getItem(WORKSPACE) || 'null');
          if (data && data.ai) Object.assign(data.ai, volatileKeys);
          return { data };
        }
        case 'save_workspace': {
          const data = structuredClone(args.data);
          if (data.ai) for (const key of KEYS) { volatileKeys[key] = data.ai[key] || ''; data.ai[key] = ''; }
          try { localStorage.setItem(WORKSPACE, JSON.stringify(data)); }
          catch { throw new Error('فضای ذخیرهٔ مرورگر پر است. خروجی JSON بگیرید و پیوست‌های بزرگ را حذف کنید. / Browser storage is full. Export JSON to back up your work.'); }
          return true;
        }
        case 'save_text_dialog':
          return download(new Blob([args.content], { type: 'text/plain;charset=utf-8' }), `${args.defaultName}.${args.ext}`);
        case 'save_project_dialog':
          return download(new Blob([args.content], { type: 'application/json' }), args.defaultName);
        case 'open_project_dialog': {
          const file = await pick('.json,application/json');
          return file ? { content: await file.text(), name: file.name } : null;
        }
        case 'export_png_dialog':
          return download(await (await fetch(args.base64Png)).blob(), args.defaultName);
        case 'pick_image_dialog': case 'pick_video_dialog': case 'pick_audio_dialog': case 'pick_file_dialog': {
          const accept = { pick_image_dialog: 'image/*', pick_video_dialog: 'video/*', pick_audio_dialog: 'audio/*' }[command];
          const file = await pick(accept);
          if (!file) return null;
          if (file.size > 4 * 1024 * 1024) throw new Error('Maximum attachment size: 4 MB / حداکثر حجم پیوست: ۴ مگابایت');
          return attachment(file.name, await readData(file), file.size);
        }
        case 'save_dropped_file':
          return attachment(args.name, args.base64Data, Math.floor(args.base64Data.length * .75), args);
        case 'read_media_base64': return args.path;
        case 'open_attachment': case 'reveal_in_explorer': {
          if (!args.path.startsWith('data:')) throw new Error('Unsupported attachment');
          return download(await (await fetch(args.path)).blob(), 'MindPluss-attachment');
        }
        case 'win_toggle_fullscreen':
          if (document.fullscreenElement) { await document.exitFullscreen(); return false; }
          await document.documentElement.requestFullscreen(); return true;
        case 'load_noteprompt_ai': return null;
        case 'win_start_drag': case 'win_toggle_maximize': return false;
        default: throw new Error(`Desktop-only action: ${command}`);
      }
    }
  };
})();
