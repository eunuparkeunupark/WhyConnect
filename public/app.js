// WhyConnect front-end: tiny hash router + vanilla DOM (no build step).
const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- helpers ---------- */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v; // only ever used with constant strings
    else node.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return node;
}

const ICONS = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.7 4.8 6.3 4.8c2 0 3.6 1.1 4.5 2.6.3.5 1.1.5 1.4 0 .9-1.5 2.5-2.6 4.5-2.6 3.6 0 5.4 3.6 3.9 7C19.5 16.4 12 21 12 21Z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M12 5C6.5 5 2.4 9 1 12c1.4 3 5.5 7 11 7s9.6-4 11-7c-1.4-3-5.5-7-11-7Zm0 11.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4Zm0-6.4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M12 3C6.5 3 2 6.6 2 11c0 2.3 1.2 4.4 3.2 5.8-.2 1.6-.9 3-1.8 4 2.4-.3 4.3-1.2 5.6-2.2.9.2 1.9.4 3 .4 5.5 0 10-3.6 10-8s-4.5-8-10-8Z"/></svg>',
  play: '<svg viewBox="0 0 64 64"><path fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round" d="M16 10l36 22-36 22Z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H4M10 5l-7 7 7 7"/></svg>',
};
const icon = (name, cls) => h('span', { class: cls, html: ICONS[name], style: { display: 'contents' } });
const statEl = (name, n) => h('span', { class: 'stat' }, icon(name), n);

function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  const units = [['y', 31536000], ['mo', 2592000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]];
  for (const [u, n] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function avatarEl(user, size) {
  const px = { width: `${size}px`, height: `${size}px` };
  if (user?.avatar) return h('img', { class: 'avatar', src: user.avatar, alt: '', style: px });
  const name = user?.name || '?';
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return h('span', { class: 'avatar', style: { ...px, background: `hsl(${hue} 45% 45%)` } }, initials);
}

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
}

/* ---------- state ---------- */
let me = null;
let cleanup = () => {};

/* ---------- account area ---------- */
function renderAccount() {
  const box = $('#account');
  box.replaceChildren();
  if (!me) {
    box.append(h('button', { class: 'login-btn', onClick: () => openAuthModal('login') }, 'Log in'));
    return;
  }
  const menu = h('div', { class: 'menu', hidden: true },
    h('div', { class: 'who' }, `Signed in as @${me.username}`),
    h('a', { href: `#/u/${me.username}` }, 'My page'),
    h('button', { onClick: () => { menu.hidden = true; openEditProfile(); } }, 'Edit profile'),
    h('button', { onClick: logout }, 'Log out'));
  const btn = h('button', {
    class: 'avatar-btn', 'aria-label': 'Account menu', 'aria-haspopup': 'menu',
    onClick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; },
  }, avatarEl(me, 64));
  box.append(btn, menu);
}
document.addEventListener('click', (e) => {
  const menu = $('#account .menu');
  if (menu && !menu.contains(e.target)) menu.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); const m = $('#account .menu'); if (m) m.hidden = true; }
});

async function logout() {
  await api('/logout', { method: 'POST' });
  me = null;
  renderAccount();
  toast('Logged out');
  route();
}

/* ---------- modals ---------- */
let lastFocus = null;
function openModal(content, { onClose } = {}) {
  closeModal();
  lastFocus = document.activeElement;
  const overlay = h('div', { class: 'overlay', onMousedown: (e) => { if (e.target === overlay) closeModal(); } },
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content));
  overlay._onClose = onClose;
  $('#modal-root').append(overlay);
  (overlay.querySelector('input, textarea, button.drop') || overlay.querySelector('button'))?.focus();
  return overlay;
}
function closeModal() {
  const o = $('#modal-root .overlay');
  if (!o) return;
  o._onClose?.();
  o.remove();
  lastFocus?.focus?.();
}

function openAuthModal(mode = 'login', then) {
  const isSignup = mode === 'signup';
  const err = h('p', { class: 'form-error' });
  const username = h('input', { name: 'username', autocomplete: 'username', required: true, maxlength: 24 });
  const name = h('input', { name: 'name', autocomplete: 'name', maxlength: 40 });
  const password = h('input', {
    name: 'password', type: 'password', required: true,
    autocomplete: isSignup ? 'new-password' : 'current-password', minlength: isSignup ? 8 : null,
  });
  const submit = h('button', { class: 'btn', type: 'submit' }, isSignup ? 'Create account' : 'Log in');
  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = ''; submit.disabled = true;
      try {
        const body = { username: username.value, password: password.value };
        if (isSignup) body.name = name.value;
        me = (await api(isSignup ? '/signup' : '/login', { method: 'POST', body })).user;
        closeModal(); renderAccount(); toast(`Welcome, ${me.name}!`);
        route(); then?.();
      } catch (ex) { err.textContent = ex.message; submit.disabled = false; }
    },
  },
  h('h2', {}, isSignup ? 'Join WhyConnect' : 'Welcome back'),
  h('label', { class: 'field' }, h('span', {}, 'Username'), username),
  isSignup && h('label', { class: 'field' }, h('span', {}, 'Display name'), name),
  h('label', { class: 'field' }, h('span', {}, `Password${isSignup ? ' (8+ characters)' : ''}`), password),
  err,
  h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onClick: closeModal }, 'Cancel'), submit),
  h('p', { class: 'switch' }, isSignup ? 'Already have an account? ' : 'New here? ',
    h('button', { type: 'button', onClick: () => openAuthModal(isSignup ? 'login' : 'signup', then) }, isSignup ? 'Log in' : 'Sign up')),
  !isSignup && h('p', { class: 'hint' }, 'Demo: eunu / demo1234  ·  james / demo1234'));
  openModal(form);
}

function requireLogin(then) {
  if (me) return true;
  openAuthModal('login', then);
  return false;
}

/* ---------- media helpers (dimensions + video poster) ---------- */
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

function openUploadModal() {
  if (!requireLogin(openUploadModal)) return;
  let file = null; let info = null; let xhr = null;
  const input = h('input', { type: 'file', class: 'sr', accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime' });
  const drop = h('button', { type: 'button', class: 'drop', onClick: () => input.click() },
    h('div', {}, h('b', {}, 'Choose a photo or video'), h('br'), 'or drag it here'));
  const title = h('input', { maxlength: 100, placeholder: 'Give it a title', required: true });
  const err = h('p', { class: 'form-error' });
  const bar = h('i'); const progress = h('div', { class: 'progress', hidden: true }, bar);
  const submit = h('button', { class: 'btn', type: 'submit', disabled: true }, 'Post');

  async function pick(f) {
    err.textContent = '';
    if (!f) return;
    try {
      if (info) URL.revokeObjectURL(info.url);
      info = await readMedia(f); file = f;
      drop.classList.add('has');
      drop.replaceChildren(info.kind === 'video'
        ? h('video', { src: info.url, controls: true, muted: true, playsinline: true })
        : h('img', { src: info.url, alt: 'Preview' }));
      if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').slice(0, 100);
      submit.disabled = false;
    } catch (ex) { err.textContent = ex.message; }
  }
  input.addEventListener('change', () => pick(input.files[0]));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));

  const form = h('form', {
    onSubmit: (e) => {
      e.preventDefault();
      if (!file) return;
      const fd = new FormData();
      fd.append('title', title.value.trim());
      fd.append('width', info.width); fd.append('height', info.height);
      if (info.thumb) fd.append('thumb', info.thumb, 'thumb.jpg');
      fd.append('media', file); // media last so text fields are parsed first
      submit.disabled = true; progress.hidden = false; err.textContent = '';
      xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/posts');
      xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total) * 100}%`; };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status === 201) {
          const target = `#/u/${me.username}`;
          closeModal(); toast('Posted!');
          if (location.hash === target) route(); else location.hash = target;
        } else { err.textContent = data.error || 'Upload failed'; submit.disabled = false; progress.hidden = true; }
      };
      xhr.onerror = () => { err.textContent = 'Network error'; submit.disabled = false; progress.hidden = true; };
      xhr.send(fd);
    },
  },
  h('h2', {}, 'New post'), input, drop,
  h('label', { class: 'field' }, h('span', {}, 'Title'), title),
  progress, err,
  h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onClick: closeModal }, 'Cancel'), submit));
  openModal(form, { onClose: () => { xhr?.abort(); if (info) URL.revokeObjectURL(info.url); } });
}

function openEditProfile() {
  const name = h('input', { value: me.name, maxlength: 40, required: true });
  const bio = h('textarea', { rows: 3, maxlength: 200 }, me.bio || '');
  const file = h('input', { type: 'file', class: 'sr', accept: 'image/jpeg,image/png,image/webp' });
  const preview = h('div', {}, avatarEl(me, 64));
  file.addEventListener('change', () => {
    if (!file.files[0]) return;
    preview.replaceChildren(h('img', { class: 'avatar', style: { width: '64px', height: '64px' }, src: URL.createObjectURL(file.files[0]), alt: '' }));
  });
  const err = h('p', { class: 'form-error' });
  const submit = h('button', { class: 'btn', type: 'submit' }, 'Save');
  openModal(h('form', {
    onSubmit: async (e) => {
      e.preventDefault(); submit.disabled = true; err.textContent = '';
      const fd = new FormData();
      fd.append('name', name.value.trim()); fd.append('bio', bio.value);
      if (file.files[0]) fd.append('avatar', file.files[0]);
      try {
        me = (await api('/me', { method: 'PATCH', form: fd })).user;
        closeModal(); renderAccount(); toast('Profile updated'); route();
      } catch (ex) { err.textContent = ex.message; submit.disabled = false; }
    },
  },
  h('h2', {}, 'Edit profile'),
  h('div', { class: 'avatar-pick' }, preview, file, h('button', { class: 'btn ghost', type: 'button', onClick: () => file.click() }, 'Change photo')),
  h('label', { class: 'field' }, h('span', {}, 'Name'), name),
  h('label', { class: 'field' }, h('span', {}, 'Bio'), bio),
  err,
  h('div', { class: 'row' }, h('button', { class: 'btn ghost', type: 'button', onClick: closeModal }, 'Cancel'), submit)));
}

/* ---------- masonry grid ---------- */
function postCard(p) {
  const ratio = Math.min(2.2, Math.max(0.45, p.width / p.height));
  const media = p.thumb || p.type === 'photo'
    ? h('img', { src: p.thumb || p.media, alt: p.title, loading: 'lazy', draggable: 'false' })
    : h('video', { src: `${p.media}#t=0.1`, preload: 'metadata', muted: true, playsinline: true });
  return h('a', { class: 'card', href: `#/p/${p.id}`, style: { aspectRatio: String(ratio) }, 'aria-label': p.title },
    media,
    p.type === 'video' && h('span', { class: 'play', html: ICONS.play }),
    h('div', { class: 'over' },
      h('div', { class: 't' }, p.title),
      h('div', { class: 'stats' }, statEl('heart', p.likes), statEl('eye', p.views), statEl('chat', p.comments))));
}

function masonry(posts) {
  const grid = h('div', { class: 'grid' });
  let cols = 0;
  const layout = () => {
    const w = grid.clientWidth || window.innerWidth;
    const n = w >= 900 ? 4 : w >= 560 ? 3 : 2;
    if (n === cols) return;
    cols = n;
    const columns = Array.from({ length: n }, () => ({ el: h('div', { class: 'col' }), height: 0 }));
    for (const p of posts) { // shortest column first, so newest posts stay near the top
      const col = columns.reduce((a, b) => (b.height < a.height ? b : a));
      col.el.append(postCard(p));
      col.height += 1 / Math.min(2.2, Math.max(0.45, p.width / p.height)) + 0.04;
    }
    grid.replaceChildren(...columns.map((c) => c.el));
  };
  window.addEventListener('resize', layout);
  const stop = () => window.removeEventListener('resize', layout);
  queueMicrotask(layout);
  return { grid, layout, stop };
}

/* ---------- views ---------- */
const app = $('#app');
const status = (cls, msg) => app.replaceChildren(h('div', { class: cls }, msg));

async function viewFeed({ username, home } = {}) {
  let type = '';
  let profile = null;
  if (username) {
    try { profile = (await api(`/users/${encodeURIComponent(username)}`)).user; } catch (e) { return status('error-box', e.message); }
  }
  const gridBox = h('div');
  const chips = ['', 'photo', 'video'].map((t) => h('button', {
    class: 'chip', 'aria-pressed': String(t === type),
    onClick: () => { type = t; chips.forEach((c, i) => c.setAttribute('aria-pressed', String(['', 'photo', 'video'][i] === t))); load(); },
  }, t === '' ? 'ALL' : t === 'photo' ? 'Photo' : 'Video'));

  app.replaceChildren(
    profile && h('section', { class: 'profile' },
      avatarEl(profile, 132),
      h('h1', {}, profile.name),
      profile.bio && h('p', { class: 'bio' }, profile.bio),
      me?.id === profile.id && h('button', { class: 'edit', onClick: openEditProfile }, 'Edit profile')),
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter' }, chips),
    gridBox);

  let m = null;
  async function load() {
    m?.stop();
    const q = new URLSearchParams();
    if (type) q.set('type', type);
    if (username) q.set('user', username);
    let posts;
    try { posts = (await api(`/posts?${q}`)).posts; } catch (e) { return gridBox.replaceChildren(h('div', { class: 'error-box' }, e.message)); }
    if (!posts.length) {
      m = null;
      return gridBox.replaceChildren(h('div', { class: 'empty' },
        home || me?.username === username ? 'Nothing here yet — hit the + button to post.' : 'No posts yet.'));
    }
    m = masonry(posts);
    gridBox.replaceChildren(m.grid);
    m.layout();
  }
  cleanup = () => m?.stop();
  await load();
}

async function viewPost(id) {
  let data;
  try { data = await api(`/posts/${id}`); } catch (e) { return status('error-box', e.message); }
  const { post, comments } = data;
  let replyTo = null;
  const list = h('div', { class: 'comments', 'aria-label': 'Comments' });
  const input = h('input', { type: 'text', maxlength: 500, placeholder: 'Type what you think...', 'aria-label': 'Add a comment', autocomplete: 'off' });
  const replying = h('div', { class: 'replying', hidden: true });
  const heartLabel = h('span', {}, post.likes);
  const commentCount = h('span', {}, comments.length);
  const viewsEl = h('span', {}, post.views);

  const setReply = (c) => {
    replyTo = c;
    replying.hidden = !c;
    replying.replaceChildren(h('span', {}, c ? `Replying to ${c.author.name}` : ''),
      h('button', { type: 'button', onClick: () => setReply(null) }, '✕'));
    if (c) input.focus();
  };

  const commentEl = (c, isReply) => h('div', { class: `comment${isReply ? ' reply' : ''}`, 'data-id': c.id },
    h('a', { href: `#/u/${c.author.username}` }, avatarEl(c.author, 28)),
    h('div', {},
      h('div', { class: 'meta' }, h('b', {}, c.author.name), h('span', {}, timeAgo(c.createdAt))),
      h('div', { class: 'body' }, c.body),
      h('div', { class: 'actions' },
        h('button', { onClick: () => { if (requireLogin()) setReply(c); } }, 'Reply'),
        me?.id === c.author.id && h('button', {
          onClick: async () => {
            try { await api(`/comments/${c.id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
            comments.splice(0, comments.length, ...comments.filter((x) => x.id !== c.id && x.parentId !== c.id));
            commentCount.textContent = comments.length;
            paintComments();
          },
        }, 'Delete'))));

  function paintComments() {
    list.replaceChildren();
    const tops = comments.filter((c) => !c.parentId);
    if (!tops.length) list.append(h('p', { class: 'no-comments' }, 'No comments yet. Say something!'));
    for (const t of tops) {
      list.append(commentEl(t, false));
      comments.filter((c) => c.parentId === t.id).forEach((r) => list.append(commentEl(r, true)));
    }
  }
  paintComments();

  const compose = h('form', {
    class: 'compose',
    onSubmit: async (e) => {
      e.preventDefault();
      const body = input.value.trim();
      if (!body || !requireLogin()) return;
      input.disabled = true;
      try {
        const { comment } = await api(`/posts/${post.id}/comments`, { method: 'POST', body: { body, parentId: replyTo?.id } });
        comments.push(comment);
        commentCount.textContent = comments.length;
        input.value = ''; setReply(null); paintComments();
        list.scrollTop = list.scrollHeight;
      } catch (ex) { toast(ex.message); } finally { input.disabled = false; input.focus(); }
    },
  }, replying, input);
  input.addEventListener('focus', () => { if (!me) { input.blur(); requireLogin(); } });

  const like = h('button', { class: 'like-btn', 'aria-pressed': String(post.liked), 'aria-label': 'Like', onClick: async () => {
    if (!requireLogin()) return;
    try {
      const r = await api(`/posts/${post.id}/like`, { method: 'POST' });
      like.setAttribute('aria-pressed', String(r.liked)); heartLabel.textContent = r.likes;
    } catch (e) { toast(e.message); }
  } }, icon('heart'), heartLabel);

  const media = post.type === 'video'
    ? h('video', { src: post.media, poster: post.thumb || null, controls: true, playsinline: true, preload: 'metadata' })
    : h('img', { src: post.media, alt: post.title });

  app.replaceChildren(h('div', { class: 'post-wrap' },
    h('a', { class: 'back', href: `#/u/${post.author.username}` }, icon('back'), `Go back to ${post.author.name}'s page`),
    h('article', { class: 'post-card' },
      h('div', { class: 'media' }, media),
      h('div', { class: 'side' },
        h('a', { class: 'author', href: `#/u/${post.author.username}` }, avatarEl(post.author, 44), post.author.name),
        h('h1', { class: 'post-title' }, post.title),
        h('div', { class: 'post-stats' },
          like,
          h('span', { class: 'stat' }, icon('eye'), viewsEl),
          h('span', { class: 'stat' }, icon('chat'), commentCount),
          me?.id === post.author.id && h('button', {
            class: 'del-post',
            onClick: async () => {
              if (!confirm('Delete this post?')) return;
              try { await api(`/posts/${post.id}`, { method: 'DELETE' }); } catch (e) { return toast(e.message); }
              toast('Post deleted'); location.hash = `#/u/${me.username}`;
            },
          }, 'Delete')),
        list, compose))));
  document.title = `${post.title} · WhyConnect`;

  const seenKey = `wc-viewed-${post.id}`;
  let seen = false;
  try { seen = !!sessionStorage.getItem(seenKey); sessionStorage.setItem(seenKey, '1'); } catch { /* storage blocked */ }
  if (!seen) {
    api(`/posts/${post.id}/view`, { method: 'POST' })
      .then(() => { post.views += 1; viewsEl.textContent = post.views; }).catch(() => {});
  }
}

/* ---------- router ---------- */
let routeToken = 0;
async function route() {
  const token = ++routeToken;
  cleanup(); cleanup = () => {};
  closeModal();
  document.title = 'WhyConnect';
  const [, kind, arg] = location.hash.match(/^#\/(u|p)\/([^/?#]+)/) || [];
  window.scrollTo(0, 0);
  if (kind === 'p') await viewPost(decodeURIComponent(arg));
  else if (kind === 'u') { await viewFeed({ username: decodeURIComponent(arg) }); }
  else await viewFeed({ home: true });
  if (token !== routeToken) return;
  if (kind === 'u') document.title = `${$('.profile h1')?.textContent || 'Profile'} · WhyConnect`;
}

window.addEventListener('hashchange', route);
$('#new-post').addEventListener('click', openUploadModal);

(async () => {
  try { me = (await api('/me')).user; } catch { me = null; }
  renderAccount();
  route();
})();
