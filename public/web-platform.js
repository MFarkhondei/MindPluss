/* MindPluss browser platform. Adapted UI: Copyright (c) 2026 Ramin Turne, MIT. */
(() => {
  'use strict';
  const WORKSPACE = 'mindpluss.workspace.v1';
  const KEYS = ['openrouterKey', 'googleKey', 'openaiKey', 'anthropicKey', 'customKey'];
  let volatileKeys = {};
  let workspaceFile = null;
  let lastFileContent = null;
  let writeQueue = Promise.resolve();
  let pendingWrites = 0;
  let fileDirty = false;
  let reconnectRequired = false;
  function workspaceSession(value) {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open('mindpluss.files.v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('session');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction('session', value ? 'readwrite' : 'readonly');
        const store = transaction.objectStore('session');
        const operation = value ? store.put(value, 'active') : store.get('active');
        transaction.oncomplete = () => { db.close(); resolve(operation.result); };
        transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
  }
  async function rememberWorkspace(data) {
    try { await workspaceSession({ handle: workspaceFile, data, content: lastFileContent }); }
    catch (error) { console.warn('Could not remember workspace file', error); }
  }
  const fileTypes = [{ description: 'MindPluss workspace', accept: { 'application/json': ['.json'] } }];
  function cleanWorkspace(source) {
    const data = structuredClone(source);
    if (data.ai) for (const key of KEYS) {
      volatileKeys[key] = data.ai[key] || '';
      data.ai[key] = '';
    }
    return data;
  }
  function validateWorkspace(data) {
    const ids = new Set();
    function nodeValid(node) {
      return node && typeof node.id === 'string' &&
        (!node.children || (Array.isArray(node.children) && node.children.every(nodeValid)));
    }
    if (!data || !Array.isArray(data.boards) || !data.boards.length ||
      !data.boards.every(board => board && typeof board.id === 'string' &&
        !ids.has(board.id) && ids.add(board.id) && nodeValid(board.root))) {
      throw new Error('فایل معتبر فضای کاری MindPluss نیست / Invalid MindPluss workspace');
    }
    return data;
  }
  function queueFileWrite(data) {
    const handle = workspaceFile;
    const content = JSON.stringify(data, null, 2);
    pendingWrites++;
    fileDirty = true;
    const task = writeQueue.then(async () => {
      const current = await (await handle.getFile()).text();
      if (current !== lastFileContent) {
        throw new Error('فایل بیرون از برنامه تغییر کرده است. ابتدا از تغییرات فعلی خروجی بگیرید، سپس فایل را دوباره باز کنید. / File changed outside MindPluss. Back up your edits and reopen it.');
      }
      const writable = await handle.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (error) {
        try { await writable.abort(); } catch {}
        throw error;
      }
      lastFileContent = content;
      await rememberWorkspace(data);
    });
    writeQueue = task.catch(() => {});
    return task.then(() => { if (pendingWrites === 1) fileDirty = false; })
      .finally(() => { pendingWrites--; });
  }
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
    fileStatus() {
      return { name: workspaceFile ? workspaceFile.name : null, reconnectRequired, pending: pendingWrites > 0 || fileDirty };
    },
    markFileDirty() { if (workspaceFile) fileDirty = true; },
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
          const session = await workspaceSession().catch(() => null);
          if (session && session.handle) {
            workspaceFile = session.handle;
            reconnectRequired = true;
            let data = session.data;
            lastFileContent = session.content ?? JSON.stringify(data, null, 2);
            try {
              const permission = await workspaceFile.queryPermission({ mode: 'readwrite' });
              if (permission === 'granted') {
                const content = await (await workspaceFile.getFile()).text();
                data = cleanWorkspace(validateWorkspace(JSON.parse(content)));
                lastFileContent = content;
                reconnectRequired = false;
              }
            } catch (error) {
              console.warn('Workspace file needs reconnecting', error);
            }
            return { data: validateWorkspace(data), reconnectRequired };
          }
          const data = JSON.parse(localStorage.getItem(WORKSPACE) || 'null');
          if (data && data.ai) Object.assign(data.ai, volatileKeys);
          return { data };
        }
        case 'save_workspace': {
          const data = cleanWorkspace(args.data);
          if (reconnectRequired) throw new Error('برای ادامهٔ ذخیره، فایل فضای کاری را دوباره باز کنید / Reopen the workspace file to resume saving.');
          if (workspaceFile) return queueFileWrite(data);
          try { localStorage.setItem(WORKSPACE, JSON.stringify(data)); }
          catch { throw new Error('فضای ذخیرهٔ مرورگر پر است. خروجی JSON بگیرید و پیوست‌های بزرگ را حذف کنید. / Browser storage is full. Export JSON to back up your work.'); }
          return true;
        }
        case 'reconnect_workspace_file': {
          if (!workspaceFile) throw new Error('No workspace file selected');
          // Request directly from the click, before any other asynchronous work.
          const permission = await workspaceFile.requestPermission({ mode: 'readwrite' });
          if (permission !== 'granted') throw new Error('مجوز نوشتن فایل داده نشد / File write permission denied');
          await writeQueue;
          await queueFileWrite(cleanWorkspace(args.data));
          reconnectRequired = false;
          return { name: workspaceFile.name };
        }
        case 'connect_workspace_file': {
          if (!window.showOpenFilePicker || !window.showSaveFilePicker) {
            throw new Error('برای ذخیره مستقیم فایل، برنامه را در Chrome یا Edge با HTTPS یا localhost باز کنید. / Use Chrome or Edge on HTTPS or localhost.');
          }
          let handle;
          let data;
          let content;
          // Open the picker before any await so the user gesture is preserved.
          if (args.create) {
            handle = await window.showSaveFilePicker({ suggestedName: 'MindPluss-workspace.json', types: fileTypes });
            data = cleanWorkspace(args.data);
            content = await (await handle.getFile()).text();
          } else {
            [handle] = await window.showOpenFilePicker({ multiple: false, types: fileTypes });
            if (handle.requestPermission && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
              throw new Error('مجوز نوشتن فایل داده نشد / File write permission denied');
            }
            content = await (await handle.getFile()).text();
            data = cleanWorkspace(validateWorkspace(JSON.parse(content)));
          }
          await writeQueue;
          const previous = { workspaceFile, lastFileContent, fileDirty, reconnectRequired };
          workspaceFile = handle;
          lastFileContent = content;
          fileDirty = false;
          reconnectRequired = false;
          try {
            if (args.create) await queueFileWrite(data);
          } catch (error) {
            ({ workspaceFile, lastFileContent, fileDirty, reconnectRequired } = previous);
            throw error;
          }
          await rememberWorkspace(data);
          return { data, name: handle.name };
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
