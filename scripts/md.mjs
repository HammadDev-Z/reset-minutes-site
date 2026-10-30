// Minimal, dependency-free Markdown + frontmatter parser for this project's content files.
// Supports: frontmatter (scalars, quoted strings, inline [a, b] arrays, "- " lists), headings with {#id},
// paragraphs, **bold**, *italic*, `code`, links, images, ul/ol lists, tables, blockquotes, hr,
// ::: callout fences, raw HTML lines, and strips <!-- comments -->.

export function slugify(s) {
  return String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseScalar(v) {
  v = v.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    const inner = v.slice(1, -1);
    return v[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'");
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => parseScalar(x));
  }
  return v;
}

export function parseFrontmatter(text, file = '') {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) throw new Error(`${file}: content file must start with a --- frontmatter block`);
  const end = src.indexOf('\n---', 4);
  if (end === -1) throw new Error(`${file}: frontmatter block is not closed with ---`);
  const raw = src.slice(4, end).split('\n');
  const data = {};
  let key = null;
  for (const line of raw) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m && !line.startsWith(' ')) {
      key = m[1];
      data[key] = m[2] === '' ? [] : parseScalar(m[2]);
    } else if (/^\s*-\s+/.test(line) && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(parseScalar(line.replace(/^\s*-\s+/, '')));
    } else {
      throw new Error(`${file}: cannot read frontmatter line: "${line}"`);
    }
  }
  const body = src.slice(end + 4).replace(/^\n/, '');
  return { data, body };
}

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => `<img src="${esc(src)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy" decoding="async">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const ext = /^https?:\/\//.test(href);
    return `<a href="${esc(href)}"${ext ? ' rel="noopener"' : ''}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  return s;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// Returns { html, headings:[{level,id,text}], plain }
export function renderMarkdown(md) {
  const text = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split('\n');
  const out = [];
  const headings = [];
  const usedIds = new Set();
  let i = 0;
  const para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { flushPara(); i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*?)(?:\s+\{#([A-Za-z0-9_-]+)\})?\s*$/))) {
      flushPara();
      const level = m[1].length;
      let id = m[3] || slugify(m[2].replace(/\*\*/g, ''));
      let n = 2; const base = id; while (usedIds.has(id)) id = `${base}-${n++}`; usedIds.add(id);
      headings.push({ level, id, text: m[2].replace(/\*\*/g, '') });
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`);
      i++; continue;
    }
    if (/^---+\s*$/.test(line)) { flushPara(); out.push('<hr>'); i++; continue; }
    if ((m = line.match(/^:::\s*(\w+)?\s*(.*)$/)) && line.trim() !== ':::') {
      flushPara();
      const kind = m[1] || 'note'; const title = m[2].trim();
      const buf = []; i++;
      while (i < lines.length && lines[i].trim() !== ':::') { buf.push(lines[i]); i++; }
      i++;
      const inner = renderMarkdown(buf.join('\n'));
      out.push(`<aside class="callout callout-${esc(kind)}">${title ? `<p class="callout-title">${esc(title)}</p>` : ''}${inner.html}</aside>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(`<div class="table-wrap" tabindex="0" role="region" aria-label="Table"><table><thead><tr>${head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, ci) => (ci === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${renderMarkdown(buf.join('\n')).html}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, '')); i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^</.test(line.trim())) { flushPara(); out.push(line); i++; continue; }
    para.push(line.trim()); i++;
  }
  flushPara();
  const plain = text.replace(/[#*`>|]/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  return { html: out.join('\n'), headings, plain };
}
