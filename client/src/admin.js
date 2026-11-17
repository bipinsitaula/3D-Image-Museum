// Curator (admin) mode: login dialog, and the per-frame panel for uploading,
// editing, re-framing, retitling and removing pictures.

import { FRAME_STYLES, DEFAULT_FRAME_STYLE } from '../../shared/layout.js';

const TOKEN_KEY = 'museum_token';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

export function createAdmin({ gallery, editor, onChange, onSectionChange, onState, toast }) {
  let token = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* storage blocked: login lasts for this page only */
  }
  let isAdmin = false;
  let currentSlot = null;
  let pending = null; // image waiting to be uploaded (chosen file or editor result)
  let style = DEFAULT_FRAME_STYLE;
  let previewUrl = null;

  const login = $('login');
  const panel = $('panel');
  const sectionPanel = $('section');
  let currentSection = null;

  const open = (el) => {
    document.exitPointerLock?.();
    el.classList.add('open');
  };
  const close = (el) => el.classList.remove('open');

  async function api(method, url, body) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, { method, headers, body });
    } catch {
      throw new Error('Could not reach the server.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || (res.status === 413 ? 'Image is larger than 15 MB.' : `Request failed (${res.status}).`));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setAdmin(on) {
    isAdmin = on;
    gallery.setAdminMode(on);
    onState(on);
  }

  function logout(message) {
    token = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setAdmin(false);
    settle(false);
    close(panel);
    close(sectionPanel);
    if (message) toast(message);
  }

  // A 401 on an admin call means the token expired or the secret changed.
  const handleError = (err, errorEl) => {
    if (err.status === 401 && isAdmin) return logout('Session expired. Please log in again.');
    errorEl.textContent = err.message;
  };

  // ---- login ----
  const password = $('login-password');
  const toggle = $('login-toggle');
  function showPassword(show) {
    password.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }
  toggle.addEventListener('click', () => {
    showPassword(password.type === 'password');
    password.focus();
  });
  for (const type of ['keydown', 'keyup']) {
    password.addEventListener(type, (e) => {
      $('login-caps').hidden = !e.getModifierState?.('CapsLock');
    });
  }
  password.addEventListener('input', () => ($('login-error').textContent = ''));
  $('login-form').addEventListener('animationend', (e) => e.currentTarget.classList.remove('shake'));

  function openLogin() {
    showPassword(false);
    $('login-caps').hidden = true;
    $('login-error').textContent = '';
    $('login-password').value = '';
    open(login);
    $('login-password').focus();
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector('[type=submit]');
    const submitLabel = submit.querySelector('span');
    submit.disabled = true;
    submitLabel.textContent = 'Checking…';
    $('login-error').textContent = '';
    try {
      const data = await api('POST', '/api/login', { password: $('login-password').value });
      token = data.token;
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* ignore */
      }
      setAdmin(true);
      close(login);
      toast('Curator mode: click a frame to hang a picture, or a board to edit its text.');
    } catch (err) {
      $('login-error').textContent = err.message;
      e.target.classList.add('shake');
      $('login-password').focus();
    } finally {
      submit.disabled = false;
      submitLabel.textContent = 'Unlock curator mode';
      $('login-password').value = '';
    }
  });

  // ---- frame designs ----
  const styleBar = $('panel-styles');
  for (const s of FRAME_STYLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.style = s.id;
    b.setAttribute('role', 'radio');
    const swatch = document.createElement('i');
    b.append(swatch, s.label);
    b.addEventListener('click', () => setStyle(s.id));
    styleBar.append(b);
  }
  function setStyle(id) {
    style = id;
    for (const b of styleBar.children) b.setAttribute('aria-checked', String(b.dataset.style === id));
  }

  // ---- frame panel ----
  function setPreview(src) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = src?.startsWith('blob:') ? src : null;
    $('panel-preview').hidden = !src;
    if (src) $('panel-preview').src = src;
    else $('panel-preview').removeAttribute('src');
  }

  function setPending(blob, label) {
    pending = blob;
    $('panel-file-label').textContent = label;
    $('panel-edit').disabled = false;
    setPreview(URL.createObjectURL(blob));
  }

  function openPanel(slotId) {
    currentSlot = slotId;
    pending = null;
    const frame = gallery.getFrame(slotId);
    $('panel-heading').textContent = frame ? 'Edit picture' : 'Hang a picture';
    $('panel-file').value = '';
    $('panel-file-label').textContent = frame ? 'Replace image…' : 'Choose image…';
    $('panel-edit').disabled = !frame;
    $('panel-title').value = frame?.title || '';
    $('panel-caption').value = frame?.caption || '';
    $('panel-error').textContent = '';
    $('panel-remove').hidden = !frame;
    $('panel-save').textContent = frame ? 'Save' : 'Hang it';
    setStyle(frame?.style || DEFAULT_FRAME_STYLE);
    setPreview(frame ? `/images/${frame.thumb}` : null);
    open(panel);
  }

  $('panel-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    $('panel-error').textContent = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      e.target.value = '';
      $('panel-error').textContent = 'Image is larger than 15 MB.';
      return;
    }
    setPending(file, file.name);
  });

  // Crop & edit works on the newly chosen file, or on the picture already hanging.
  $('panel-edit').addEventListener('click', async () => {
    const frame = gallery.getFrame(currentSlot);
    const source = pending || (frame && `/images/${frame.file}`);
    if (!source) return;
    $('panel-error').textContent = '';
    try {
      const result = await editor.edit(source);
      if (result) setPending(result, 'Edited image');
    } catch (err) {
      $('panel-error').textContent = err.message;
    }
  });

  const setBusy = (busy) => {
    for (const id of ['panel-save', 'panel-remove', 'panel-edit']) $(id).disabled = busy;
  };

  $('panel-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const slot = currentSlot;
    const title = $('panel-title').value;
    const caption = $('panel-caption').value;
    const existing = gallery.getFrame(slot);
    $('panel-error').textContent = '';
    if (!pending && !existing) return ($('panel-error').textContent = 'Choose an image first.');

    setBusy(true);
    const label = $('panel-save').textContent;
    const uploading = !!pending;
    try {
      let data;
      if (uploading) {
        $('panel-save').textContent = 'Uploading…';
        const form = new FormData();
        form.append('title', title);
        form.append('caption', caption);
        form.append('style', style);
        form.append('image', pending, 'image');
        data = await api('POST', `/api/frames/${slot}`, form);
      } else {
        data = await api('PATCH', `/api/frames/${slot}`, { title, caption, style });
      }
      onChange(slot, data.frame);
      close(panel);
      toast(uploading ? 'Picture hung.' : 'Saved.');
    } catch (err) {
      handleError(err, $('panel-error'));
    } finally {
      $('panel-save').textContent = label;
      setBusy(false);
    }
  });

  // ---- remove confirmation ----
  const confirmBox = $('confirm');
  let answer = null;
  const settle = (yes) => {
    close(confirmBox);
    answer?.(yes);
    answer = null;
  };
  $('confirm-cancel').addEventListener('click', () => settle(false));
  $('confirm-ok').addEventListener('click', () => settle(true));
  confirmBox.addEventListener('pointerdown', (e) => e.target === confirmBox && settle(false));

  // Resolves true only if the curator presses Remove.
  function confirmRemove(frame) {
    $('confirm-thumb').src = `/images/${frame.thumb}`;
    $('confirm-text').textContent = frame.title
      ? `“${frame.title}” will be taken off the wall and its file deleted from the server. This can’t be undone.`
      : 'It will be taken off the wall and its file deleted from the server. This can’t be undone.';
    open(confirmBox);
    $('confirm-cancel').focus(); // the safe choice is the default
    return new Promise((resolve) => (answer = resolve));
  }

  $('panel-remove').addEventListener('click', async () => {
    const slot = currentSlot;
    const frame = gallery.getFrame(slot);
    if (!frame || !(await confirmRemove(frame))) return;
    setBusy(true);
    try {
      await api('DELETE', `/api/frames/${slot}`);
      onChange(slot, null);
      close(panel);
      toast('Picture removed.');
    } catch (err) {
      handleError(err, $('panel-error'));
    } finally {
      setBusy(false);
    }
  });

  // ---- section board ----
  function openSection(id) {
    currentSection = id;
    const { title, text } = gallery.getSection(id);
    $('section-title').value = title;
    $('section-text').value = text;
    $('section-error').textContent = '';
    open(sectionPanel);
  }

  $('section-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = currentSection;
    $('section-save').disabled = true;
    $('section-error').textContent = '';
    try {
      const data = await api('PATCH', `/api/sections/${id}`, {
        title: $('section-title').value,
        text: $('section-text').value,
      });
      onSectionChange(id, data.section);
      close(sectionPanel);
      toast('Board updated.');
    } catch (err) {
      handleError(err, $('section-error'));
    } finally {
      $('section-save').disabled = false;
    }
  });

  for (const el of [login, panel, sectionPanel]) {
    el.querySelector('[data-close]').addEventListener('click', () => close(el));
    el.addEventListener('pointerdown', (e) => e.target === el && close(el));
  }
  window.addEventListener('keydown', (e) => {
    // The editor sits on top of the panel and handles its own Esc.
    if (e.key !== 'Escape' || $('editor').classList.contains('open')) return;
    // Esc on the confirmation means "keep it", and leaves the panel open.
    if (confirmBox.classList.contains('open')) return settle(false);
    [login, panel, sectionPanel].forEach(close);
  });

  return {
    get isAdmin() {
      return isAdmin;
    },
    openPanel,
    openSection,
    // Menu button: log in, or log out if already in curator mode.
    toggle() {
      if (isAdmin) logout('Logged out.');
      else openLogin();
    },
    // Restore a saved session; open the login dialog for /?admin links.
    async restore() {
      if (token) {
        try {
          await api('GET', '/api/session');
          return setAdmin(true);
        } catch (err) {
          if (err.status === 401) logout();
        }
      }
      if (new URLSearchParams(location.search).has('admin')) openLogin();
    },
  };
}
