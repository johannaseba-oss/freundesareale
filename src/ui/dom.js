export const $ = (sel, root = document) => root.querySelector(sel);

// h('div.cls#id', {attrs/on*}, ...kinder)
export function h(tag, attrs, ...kids) {
  const [, name = 'div', rest = ''] = /^([a-z0-9]*)(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === '.' ? el.classList.add(m[2]) : (el.id = m[2]);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export function toast(msg, bad = false) {
  const t = h('div' + (bad ? '.bad' : ''), msg);
  $('#toast').append(t);
  setTimeout(() => t.remove(), bad ? 4200 : 2600);
}

export function bar(cls, value) {
  return h('div.bar.' + cls, h('i', { style: { width: Math.max(0, Math.min(100, value)) + '%' } }));
}

export function modal(build) {
  const m = $('#modal');
  const close = () => { m.classList.add('hidden'); m.replaceChildren(); };
  const inner = h('div.modal-inner');
  m.replaceChildren(inner);
  m.classList.remove('hidden');
  m.onclick = (e) => { if (e.target === m) close(); };
  build(inner, close);
  return close;
}

export function confirmDialog(text, okLabel = 'Ja') {
  return new Promise((res) => {
    modal((el, close) => {
      el.append(h('p', text), h('div.row',
        h('button.btn', { onclick: () => { close(); res(false); } }, 'Abbrechen'),
        h('button.btn.primary', { onclick: () => { close(); res(true); } }, okLabel)));
    });
  });
}
