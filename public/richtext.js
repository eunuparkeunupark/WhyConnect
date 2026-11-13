// Rich-text helpers: a formatting toolbar for contenteditable blocks and a strict HTML sanitizer.
// Post text is stored as HTML, so it is ALWAYS passed through sanitizeToFragment() before display
// (anyone can write arbitrary data into Firestore, the rules cannot inspect HTML).

export const FONTS = ['Inter', 'Asta Sans', 'Playfair Display', 'Georgia', 'Courier New', 'Noto Sans KR'];

/* ---------- sanitizer ---------- */
const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SPAN', 'DIV', 'P', 'FONT']);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;

function cleanStyle(style) {
  const out = [];
  if (COLOR.test(style.color)) out.push(`color:${style.color}`);
  if (COLOR.test(style.backgroundColor)) out.push(`background-color:${style.backgroundColor}`);
  const size = parseFloat(style.fontSize);
  if (/^\d+(\.\d+)?px$/.test(style.fontSize) && size >= 8 && size <= 96) out.push(`font-size:${size}px`);
  const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  if (FONTS.includes(family)) out.push(`font-family:"${family}"`);
  if (/^(bold|[5-9]00)$/.test(style.fontWeight)) out.push('font-weight:700');
  if (style.fontStyle === 'italic') out.push('font-style:italic');
  if ((style.textDecorationLine || style.textDecoration || '').includes('underline')) out.push('text-decoration:underline');
  return out.join(';');
}

/** Rebuilds untrusted HTML from scratch using only whitelisted tags and style properties. */
export function sanitizeToFragment(html) {
  const src = new DOMParser().parseFromString(`<body>${String(html)}`, 'text/html').body; // inert document
  const frag = document.createDocumentFragment();
  const walk = (node, parent, depth) => {
    if (depth > 30) return;
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) parent.append(document.createTextNode(n.nodeValue));
      else if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === 'BR') parent.append(document.createElement('br'));
        else if (TAGS.has(n.tagName)) {
          const el = document.createElement(n.tagName === 'FONT' ? 'span' : n.tagName.toLowerCase());
          const css = cleanStyle(n.style);
          if (css) el.setAttribute('style', css);
          parent.append(el);
          walk(n, el, depth + 1);
        } else if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(n.tagName)) {
          walk(n, parent, depth + 1); // unknown tag: keep its text, drop the tag
        }
      }
    }
  };
  walk(src, frag, 0);
  return frag;
}

export function sanitizeHtml(html) {
  const box = document.createElement('div');
  box.append(sanitizeToFragment(html));
  return box.innerHTML;
}

export const plainText = (html) => new DOMParser().parseFromString(`<body>${String(html)}`, 'text/html').body.textContent || '';

/* ---------- toolbar + editors ---------- */
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids);
  return n;
};

export function createToolbar() {
  const editors = new Set();
  let active = null;
  let lastRange = null;

  const restore = () => {
    if (!active || !lastRange) return false;
    active.focus({ preventScroll: true });
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(lastRange);
    return true;
  };
  const exec = (cmd, value) => {
    if (!restore()) return;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, value);
    lastRange = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : lastRange;
    refresh();
  };
  const noFocusSteal = { onMousedown: (e) => e.preventDefault() }; // keep the text selection when clicking buttons

  const font = el('select', { class: 'tb-font', 'aria-label': 'Font', onChange: () => exec('fontName', font.value) },
    ...FONTS.map((f) => el('option', { value: f, style: `font-family:"${f}"` }, f)));
  const size = el('input', { class: 'tb-size', type: 'text', inputmode: 'numeric', value: '14', 'aria-label': 'Font size' });
  const applySize = () => {
    const px = Math.min(72, Math.max(8, parseInt(size.value, 10) || 14));
    size.value = px;
    if (!restore()) return;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7'); // placeholder size, replaced by an exact px value below
    for (const n of active.querySelectorAll('font[size="7"], span')) {
      if (n.tagName === 'FONT') {
        const span = el('span', { style: `font-size:${px}px` });
        span.append(...n.childNodes);
        n.replaceWith(span);
      } else if (/xxx-large/.test(n.style.fontSize)) n.style.fontSize = `${px}px`;
    }
  };
  size.addEventListener('change', applySize);
  const step = (d) => { size.value = Math.min(72, Math.max(8, (parseInt(size.value, 10) || 14) + d)); applySize(); };

  const toggle = (label, cmd, aria, cls) => el('button', { type: 'button', class: `tb-btn ${cls}`, 'aria-label': aria, 'aria-pressed': 'false', 'data-cmd': cmd, onClick: () => exec(cmd), ...noFocusSteal }, label);
  const bold = toggle('B', 'bold', 'Bold', 'b');
  const italic = toggle('I', 'italic', 'Italic', 'i');
  const underline = toggle('U', 'underline', 'Underline', 'u');

  const colorPicker = (label, cmd, aria, initial, cls) => {
    const input = el('input', { type: 'color', value: initial, 'aria-label': aria, class: 'tb-colorinput' });
    const bar = el('span', { class: 'tb-bar', style: `background:${initial}` });
    input.addEventListener('input', () => { bar.style.background = input.value; });
    input.addEventListener('change', () => exec(cmd, input.value));
    return el('label', { class: `tb-btn ${cls}`, title: aria, ...noFocusSteal }, label, bar, input);
  };
  const color = colorPicker('A', 'foreColor', 'Text color', '#000000', 'color');
  const marker = colorPicker('✎', 'hiliteColor', 'Highlight color', '#ffe066', 'marker');

  const sep = () => el('span', { class: 'tb-sep' });
  const bar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': 'Text formatting' },
    font, sep(),
    el('button', { type: 'button', class: 'tb-btn', 'aria-label': 'Smaller', onClick: () => step(-1), ...noFocusSteal }, '−'),
    size,
    el('button', { type: 'button', class: 'tb-btn', 'aria-label': 'Larger', onClick: () => step(1), ...noFocusSteal }, '+'),
    sep(), bold, italic, underline, color, marker);

  function refresh() {
    for (const b of [bold, italic, underline]) {
      let on = false;
      try { on = active && document.queryCommandState(b.dataset.cmd); } catch { /* ignore */ }
      b.setAttribute('aria-pressed', String(!!on));
    }
  }
  const onSelection = () => {
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    for (const ed of editors) {
      if (ed.contains(r.commonAncestorContainer)) { active = ed; lastRange = r.cloneRange(); refresh(); return; }
    }
  };
  document.addEventListener('selectionchange', onSelection);

  return {
    el: bar,
    /** A formatted-text box; paste is forced to plain text so no foreign markup sneaks in. */
    makeEditor(placeholder) {
      const ed = el('div', { class: 'rt', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'data-placeholder': placeholder });
      ed.addEventListener('paste', (e) => {
        e.preventDefault();
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
      });
      editors.add(ed);
      return ed;
    },
    destroy() { document.removeEventListener('selectionchange', onSelection); },
  };
}
