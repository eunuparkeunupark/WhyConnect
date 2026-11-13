// Composer page (#/new): create a Post (rich text rows with optional media), a Photo or a Video.
import { createToolbar, sanitizeHtml } from './richtext.js';

const OK_IMAGE = /^image\/(jpeg|png|webp|gif|avif)$/;
const OK_VIDEO = /^video\/(mp4|webm|quicktime)$/;
const ACCEPT_IMAGE = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
const ACCEPT_VIDEO = 'video/mp4,video/webm,video/quicktime';
const MODES = [['post', 'Post'], ['photo', 'Photo'], ['video', 'Video']];

class UserError extends Error {}

/** Reads dimensions (and a poster frame for videos) from a local file. */
export
function readMedia(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight, kind: 'photo' });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Can't read this image")); };
      img.src = url;
    });
  }
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata'; v.muted = true; v.playsInline = true;
    v.onloadeddata = () => {
      const finish = () => {
        const w = v.videoWidth; const hgt = v.videoHeight;
        const scale = Math.min(1, 720 / Math.max(w, hgt));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale); canvas.height = Math.round(hgt * scale);
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((thumb) => resolve({ url, width: w, height: hgt, kind: 'video', thumb }), 'image/jpeg', 0.85);
      };
      v.onseeked = finish;
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Can't read this video")); };
    v.src = url;
  });
}

export function renderComposer({ app, me, h, avatarEl, toast, data, go }) {
  let mode = 'post';
  const single = { file: null, info: null }; // photo / video mode
  const rows = [];                            // post mode
  let abort = null;
  let busy = false;
  const toolbar = createToolbar();

  const titleEl = h('input', { type: 'text', maxlength: 100, placeholder: 'Show your best title', 'aria-label': 'Title', autocomplete: 'off' });
  const err = h('p', { class: 'form-error' });
  const bar = h('i');
  const progress = h('div', { class: 'progress', hidden: true }, bar);
  const publish = h('button', { type: 'button', class: 'btn publish', onClick: submit }, 'Publish');
  const body = h('div', { class: 'composer-body' });
  const switcher = h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Post type' });

  /* ----- mode switch (selected option floats to the top) ----- */
  function paintSwitch() {
    const ordered = [...MODES].sort((a, b) => (a[0] === mode ? -1 : 0) - (b[0] === mode ? -1 : 0));
    switcher.replaceChildren(...ordered.map(([m, label]) => h('button', {
      type: 'button', class: `mode-opt${m === mode ? ' on' : ''}`, 'aria-pressed': String(m === mode), onClick: () => setMode(m),
    }, label)));
  }
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    const t = single.file?.type || '';
    if (single.file && ((m === 'photo' && !OK_IMAGE.test(t)) || (m === 'video' && !OK_VIDEO.test(t)))) clearSingle();
    err.textContent = '';
    paint();
  }

  /* ----- photo / video mode ----- */
  function clearSingle() {
    if (single.info) URL.revokeObjectURL(single.info.url);
    single.file = null; single.info = null;
  }
  async function pickSingle(f) {
    if (!f) return;
    err.textContent = '';
    const ok = mode === 'photo' ? OK_IMAGE.test(f.type) : OK_VIDEO.test(f.type);
    if (!ok) { err.textContent = mode === 'photo' ? 'Choose a JPG, PNG, WebP, GIF or AVIF image.' : 'Choose an MP4, WebM or MOV video.'; return; }
    try {
      const info = await readMedia(f);
      clearSingle();
      single.file = f; single.info = info;
      if (!titleEl.value) titleEl.value = f.name.replace(/\.[^.]+$/, '').slice(0, 100);
      paint();
    } catch (ex) { err.textContent = ex.message; }
  }
  function singleBody() {
    const input = h('input', { type: 'file', class: 'sr', accept: mode === 'photo' ? ACCEPT_IMAGE : ACCEPT_VIDEO });
    input.addEventListener('change', () => pickSingle(input.files[0]));
    const preview = single.info
      ? (mode === 'video' ? h('video', { src: single.info.url, controls: true, muted: true, playsinline: true }) : h('img', { src: single.info.url, alt: 'Preview' }))
      : h('div', {}, 'ADD', h('br'), mode === 'photo' ? 'Image' : 'Video');
    const drop = h('div', { class: `bigdrop${single.info ? ' has' : ''}`, tabindex: '0', role: 'button', 'aria-label': 'Choose a file',
      onClick: (e) => { if (e.target.tagName !== 'VIDEO') input.click(); },
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } }, preview);
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => pickSingle(e.dataTransfer.files[0]));
    return [titleEl, drop, input];
  }

  /* ----- post mode ----- */
  function makeRow(side) {
    const row = { side, file: null, info: null, editor: toolbar.makeEditor('Write your thoughts') };
    const input = h('input', { type: 'file', class: 'sr', accept: `${ACCEPT_IMAGE},${ACCEPT_VIDEO}` });
    const box = h('button', { type: 'button', class: 'mediabox', 'aria-label': 'Add photo or video', onClick: () => input.click() });
    const swap = h('button', { type: 'button', class: 'row-btn', 'aria-label': 'Move the media to the other side', title: 'Switch side',
      onClick: () => { row.side = row.side === 'left' ? 'right' : 'left'; sync(); } });
    const del = h('button', { type: 'button', class: 'row-btn del', 'aria-label': 'Remove this row', title: 'Remove row',
      onClick: () => removeRow(row) }, '✕');
    row.el = h('div', { class: 'row-edit' }, h('div', { class: 'media-col' }, box, h('div', { class: 'row-ctl' }, swap, del), input), row.editor);
    const sync = () => {
      row.el.classList.toggle('right', row.side === 'right');
      swap.textContent = row.side === 'left' ? '→' : '←';
    };
    row.paint = () => {
      box.classList.toggle('has', !!row.info);
      box.replaceChildren(row.info
        ? (row.info.kind === 'video' ? h('video', { src: row.info.url, muted: true, playsinline: true }) : h('img', { src: row.info.url, alt: '' }))
        : h('div', {}, 'ADD', h('br'), 'Image / Video'));
    };
    row.clearMedia = () => { if (row.info) URL.revokeObjectURL(row.info.url); row.file = null; row.info = null; row.paint(); };
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      if (!OK_IMAGE.test(f.type) && !OK_VIDEO.test(f.type)) { toast('Use JPG, PNG, WebP, GIF, AVIF, MP4, WebM or MOV'); return; }
      try { const info = await readMedia(f); row.clearMedia(); row.file = f; row.info = info; row.paint(); } catch (ex) { toast(ex.message); }
    });
    sync(); row.paint();
    return row;
  }
  function removeRow(row) {
    if (rows.length === 1) { row.clearMedia(); row.editor.replaceChildren(); return; } // keep at least one row
    rows.splice(rows.indexOf(row), 1);
    row.clearMedia();
    row.el.remove();
  }
  const rowsWrap = h('div', { class: 'rows' });
  const addBtn = h('button', { type: 'button', class: 'add-row', 'aria-label': 'Add another row', onClick: () => {
    const row = makeRow(rows.at(-1)?.side === 'left' ? 'right' : 'left');
    rows.push(row); rowsWrap.append(row.el); row.editor.focus();
  } }, '+');
  rows.push(makeRow('left'));
  rowsWrap.append(rows[0].el);

  /* ----- layout ----- */
  function paint() {
    paintSwitch();
    titleEl.className = mode === 'post' ? 'title-big' : 'title-pill';
    const publishRow = h('div', { class: 'publish-row' }, publish);
    body.replaceChildren(...(mode === 'post' ? [titleEl, toolbar.el, rowsWrap, addBtn] : singleBody()), err, progress, publishRow);
    body.classList.toggle('is-post', mode === 'post');
  }

  async function submit() {
    if (busy) return;
    err.textContent = '';
    try {
      const title = titleEl.value.trim();
      if (!title) throw new UserError('Please add a title.');
      const onProgress = (f) => { bar.style.width = `${f * 100}%`; };
      busy = true; publish.disabled = true; progress.hidden = false; bar.style.width = '0';
      abort = new AbortController();
      if (mode === 'post') {
        const blocks = rows.map((r) => ({
          side: r.side, file: r.file, thumb: r.info?.thumb || null, width: r.info?.width || 0, height: r.info?.height || 0,
          html: sanitizeHtml(r.editor.innerHTML), text: r.editor.textContent.trim(),
        })).filter((b) => b.file || b.text);
        if (!blocks.length) throw new UserError('Add a photo, a video or some text first.');
        if (blocks.some((b) => b.html.length > 20000)) throw new UserError('One of the text blocks is too long.');
        await data.createArticle({ title, blocks: blocks.map(({ text, ...b }) => b), onProgress, signal: abort.signal });
      } else {
        if (!single.file) throw new UserError(`Choose a ${mode} first.`);
        await data.createPost({ file: single.file, thumb: single.info.thumb, title, width: single.info.width, height: single.info.height, onProgress, signal: abort.signal });
      }
      toast('Posted!');
      go(`#/u/${me.username}`);
    } catch (ex) {
      if (ex.code === 'storage/canceled') return;
      err.textContent = ex instanceof UserError ? ex.message
        : (ex.code === 'storage/unauthorized' || ex.code === 'permission-denied'
          ? 'Upload was rejected. Check the file type/size (max 200MB) and that Firebase rules are published.' : ex.message)
          + (ex.code ? ` (${ex.code})` : '');
      busy = false; publish.disabled = false; progress.hidden = true;
    }
  }

  app.replaceChildren(h('div', { class: 'post-wrap' },
    h('a', { class: 'back', href: `#/u/${me.username}` }, h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M20 12H4M10 5l-7 7 7 7"/></svg>', style: { display: 'contents' } }), 'Cancel and go back'),
    h('article', { class: 'post-card composer' },
      h('div', { class: 'composer-head' }, h('div', { class: 'author' }, avatarEl(me, 44), me.name), switcher),
      body)));
  paint();
  document.title = 'New post · WhyConnect';

  return () => { // cleanup when leaving the page
    abort?.abort();
    toolbar.destroy();
    clearSingle();
    rows.forEach((r) => r.clearMedia());
  };
}
