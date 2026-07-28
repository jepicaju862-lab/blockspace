'use strict';

const Core = require('./core.cjs');

const LOSSLESS_DATA_START = '<!-- blockspace:page-data:start -->';
const LOSSLESS_DATA_END = '<!-- blockspace:page-data:end -->';
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
const EXPORT_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp',
});

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value ?? ''));
}

function utf8Text(bytes) {
  return new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0));
}

function concatBytes(...values) {
  const arrays = values.flat().filter(Boolean).map((value) => (
    value instanceof Uint8Array ? value : new Uint8Array(value)
  ));
  const output = new Uint8Array(arrays.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + step)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const source = String(value || '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(source, 'base64'));
  const binary = atob(source);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

function wrappedBase64(value, width = 120) {
  const encoded = bytesToBase64(utf8Bytes(value));
  const lines = [];
  for (let offset = 0; offset < encoded.length; offset += width) lines.push(encoded.slice(offset, offset + width));
  return lines.join('\n');
}

function unwrappedBase64(value) {
  return utf8Text(base64ToBytes(value));
}

function propertyFrontmatter(page) {
  const normalized = Core.normalizePage(page);
  const properties = normalized.properties;
  const lines = [
    '---',
    `blockspace-id: ${JSON.stringify(normalized.id)}`,
    `blockspace-format-version: ${Core.DATA_VERSION}`,
    `blockspace-revision: ${normalized.revision}`,
    'blockspace-export: lossless',
    `status: ${JSON.stringify(properties.status)}`,
    `priority: ${JSON.stringify(properties.priority)}`,
    `tags: [${properties.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    `aliases: [${JSON.stringify(normalized.title)}]`,
  ];
  for (const [key, value] of [
    ['source', properties.source], ['author', properties.author],
    ['publishedAt', properties.publishedAt], ['description', properties.description],
  ]) if (String(value || '').trim()) lines.push(`${key}: ${JSON.stringify(value)}`);
  for (const property of Core.normalizeCustomProperties(properties.custom)) {
    lines.push(`${JSON.stringify(property.name)}: ${JSON.stringify(property.value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function pagePayload(page) {
  const normalized = Core.normalizePage(page);
  return {
    kind: 'blockspace-page',
    schema: Core.DATA_VERSION,
    exportedAt: Core.nowIso(),
    page: normalized,
  };
}

function losslessMarkdownForPage(page) {
  const normalized = Core.normalizePage(page);
  const body = Core.blocksToMarkdown(normalized, normalized.title);
  // Keep the user-facing Markdown clean. Exact Blockspace recovery data is
  // written to a hidden sidecar by the plugin instead of leaking Base64 into
  // the editable document body.
  return `${propertyFrontmatter(normalized)}${body.trimEnd()}\n`;
}

function validatedPayloadPage(payload) {
  if (!payload || payload.kind !== 'blockspace-page' || !payload.page) return null;
  const page = Core.normalizePage(payload.page);
  return Core.validatePage(page).length ? null : page;
}

function losslessSidecarForPage(page, markdownPath = '') {
  return `${JSON.stringify({ ...pagePayload(page), markdownPath: String(markdownPath || '') }, null, 2)}\n`;
}

function extractLosslessSidecar(sidecar) {
  try {
    const payload = typeof sidecar === 'string' ? JSON.parse(sidecar) : sidecar;
    return validatedPayloadPage(payload);
  } catch (_error) {
    return null;
  }
}

function extractLosslessPage(markdown) {
  const source = String(markdown || '');
  const start = source.indexOf(LOSSLESS_DATA_START);
  const end = source.indexOf(LOSSLESS_DATA_END, start + LOSSLESS_DATA_START.length);
  if (start < 0 || end < 0) return null;
  const encoded = source.slice(start + LOSSLESS_DATA_START.length, end).trim();
  try {
    return validatedPayloadPage(JSON.parse(unwrappedBase64(encoded)));
  } catch (_error) {
    return null;
  }
}

function markdownLosslessReference(markdown) {
  const source = String(markdown || '');
  const frontmatter = source.match(/^\s*---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return null;
  const read = (key) => {
    const match = frontmatter[1].match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.+?)\\s*$`, 'm'));
    if (!match) return null;
    const raw = match[1].trim();
    try { return JSON.parse(raw); } catch (_error) { return raw.replace(/^['"]|['"]$/g, ''); }
  };
  const id = String(read('blockspace-id') || '').trim();
  const revision = Number(read('blockspace-revision'));
  if (!id || !Number.isInteger(revision) || revision < 0) return null;
  return { id, revision };
}

function stripLosslessPayload(markdown) {
  const source = String(markdown || '');
  const pattern = new RegExp(`${LOSSLESS_DATA_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${LOSSLESS_DATA_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g');
  return source.replace(pattern, '').trimEnd();
}

function colorValue(value, fallback = '#202124') {
  return ({
    gray: '#6b7280', brown: '#8b5e3c', orange: '#d66b0b', yellow: '#9a6700',
    green: '#287d4f', blue: '#2563a6', purple: '#7c4db3', pink: '#b33f7b', red: '#c93d3d',
  })[value] || fallback;
}

function backgroundValue(value, fallback = 'transparent') {
  return ({
    gray: '#eef0f2', brown: '#f4e8e2', orange: '#fff0df', yellow: '#fff5cf',
    green: '#e6f4ea', blue: '#e4effa', purple: '#f0e7f7', pink: '#fae8f2', red: '#fde8e7',
  })[value] || fallback;
}

function inlineSegments(block) {
  const normalized = Core.normalizeBlock(block);
  const boundaries = new Set([0, normalized.text.length]);
  for (const mark of normalized.marks) {
    boundaries.add(mark.from);
    boundaries.add(mark.to);
  }
  const sorted = Array.from(boundaries).sort((a, b) => a - b);
  return sorted.slice(0, -1).map((from, index) => {
    const to = sorted[index + 1];
    return {
      from,
      to,
      text: normalized.text.slice(from, to),
      marks: normalized.marks.filter((mark) => mark.from <= from && mark.to >= to),
    };
  }).filter((segment) => segment.to > segment.from);
}

function storedLinkHref(value) {
  const reference = Core.parseStoredReference(value);
  if (!reference) return '';
  if (reference.kind === 'external') return reference.target;
  if (reference.kind === 'obsidian') return `obsidian://open?file=${encodeURIComponent(reference.target)}`;
  if (reference.kind === 'blockspace-page') return `blockspace://page/${encodeURIComponent(reference.pageId)}`;
  if (reference.kind === 'blockspace-block') return `blockspace://block/${encodeURIComponent(reference.blockId)}`;
  return '';
}

function inlineHtml(block) {
  const normalized = Core.normalizeBlock(block);
  if (!normalized.text) return '';
  return inlineSegments(normalized).map((segment) => {
    let text = htmlEscape(segment.text).replace(/\n/g, '<br>');
    const active = segment.marks;
    if (active.some((mark) => mark.type === 'code')) text = `<code>${text}</code>`;
    if (active.some((mark) => mark.type === 'bold')) text = `<strong>${text}</strong>`;
    if (active.some((mark) => mark.type === 'italic')) text = `<em>${text}</em>`;
    if (active.some((mark) => mark.type === 'underline')) text = `<u>${text}</u>`;
    if (active.some((mark) => mark.type === 'strike')) text = `<s>${text}</s>`;
    const foreground = active.find((mark) => mark.type === 'textColor');
    const highlight = active.find((mark) => mark.type === 'highlight');
    const styles = [];
    if (foreground) styles.push(`color:${colorValue(foreground.value)}`);
    if (highlight) styles.push(`background:${backgroundValue(highlight.value)}`);
    if (styles.length) text = `<span style="${styles.join(';')}">${text}</span>`;
    const link = active.find((mark) => mark.type === 'link');
    const href = link && storedLinkHref(link.value);
    if (href) text = `<a href="${htmlEscape(href)}">${text}</a>`;
    return text;
  }).join('');
}

function exportAsset(options, blockId) {
  if (!options || !options.assets) return null;
  return options.assets instanceof Map ? options.assets.get(blockId) : options.assets[blockId];
}

function exportAssetDataUrl(options, blockId) {
  const asset = exportAsset(options, blockId);
  if (!asset) return '';
  if (asset.dataUrl) return asset.dataUrl;
  if (asset.bytes) return `data:${asset.mime || 'application/octet-stream'};base64,${bytesToBase64(asset.bytes)}`;
  return '';
}

function blockAppearanceStyle(block) {
  const appearance = Core.normalizeBlockAppearance(block.appearance);
  const styles = [`text-align:${appearance.align}`];
  if (appearance.textColor !== 'default') styles.push(`color:${colorValue(appearance.textColor)}`);
  if (appearance.background !== 'default') styles.push(`background:${backgroundValue(appearance.background)}`);
  return styles.join(';');
}

function renderPropertyHtml(page) {
  const properties = page.properties;
  const rows = [
    ['状态', properties.status],
    ['优先级', properties.priority],
    ...(properties.tags.length ? [['标签', properties.tags.map((tag) => `#${tag}`).join('  ')]] : []),
    ...([['来源', properties.source], ['作者', properties.author], ['发布日期', properties.publishedAt], ['说明', properties.description]]
      .filter((entry) => String(entry[1] || '').trim())),
    ...Core.normalizeCustomProperties(properties.custom).map((property) => [
      property.name,
      Array.isArray(property.value) ? property.value.join(', ') : property.value === true ? '是' : property.value === false ? '否' : String(property.value ?? ''),
    ]),
  ];
  if (!rows.length) return '';
  return `<dl class="bs-export-properties">${rows.map(([label, value]) => (
    `<div><dt>${htmlEscape(label)}</dt><dd>${htmlEscape(value)}</dd></div>`
  )).join('')}</dl>`;
}

function renderHtmlBlocks(page, ids, options, depth = 0) {
  const map = Core.blockMap(page);
  const source = Array.from(ids || []).map((id) => map.get(id)).filter(Boolean);
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const block = source[index];
    if (block.type === 'column') continue;
    if (block.type === 'image') {
      const imageData = Core.normalizeBlockData('image', block.data);
      if (imageData.wrapMode !== 'top-bottom') {
        const paragraphs = [];
        let cursor = index + 1;
        while (cursor < source.length && source[cursor].type === 'paragraph') {
          paragraphs.push(source[cursor]);
          cursor += 1;
        }
        if (paragraphs.length) {
          const imageHtml = renderHtmlBlock(page, block, options, depth);
          const textHtml = paragraphs.map((paragraph) => renderHtmlBlock(page, paragraph, options, depth)).join('');
          const direction = imageData.wrapMode === 'square-right' ? 'row-reverse' : 'row';
          output.push(`<section class="bs-export-wrap" style="--wrap-gap:${imageData.wrapGap}px;flex-direction:${direction}" data-export-block="${htmlEscape(block.id)}"><div class="bs-export-wrap-image">${imageHtml}</div><div class="bs-export-wrap-text" style="align-self:${imageData.wrapTextAlign === 'center' ? 'center' : imageData.wrapTextAlign === 'bottom' ? 'flex-end' : 'flex-start'}">${textHtml}</div></section>`);
          index = cursor - 1;
          continue;
        }
      }
    }
    output.push(renderHtmlBlock(page, block, options, depth));
  }
  return output.join('');
}

function renderHtmlBlock(page, block, options, depth = 0) {
  const map = Core.blockMap(page);
  const children = block.children.map((id) => map.get(id)).filter(Boolean);
  const content = inlineHtml(block);
  const style = blockAppearanceStyle(block);
  const id = htmlEscape(block.id);
  const childHtml = () => renderHtmlBlocks(page, block.children, options, depth + 1);
  const frame = (body, cls = '') => `<section class="bs-export-block ${cls}" data-block-type="${block.type}" data-export-block="${id}" style="${style};--depth:${depth}">${body}</section>`;
  if (block.type === 'columns') {
    const config = Core.normalizeColumnsConfig(block.columns);
    const ratios = config.ratio.split(':').map((value) => Math.max(1, Number(value) || 1));
    const columns = children.filter((child) => child.type === 'column');
    return frame(`<div class="bs-export-columns" style="grid-template-columns:${ratios.map((ratio) => `${ratio}fr`).join(' ')}">${columns.map((column) => `<div class="bs-export-column">${renderHtmlBlocks(page, column.children, options, depth + 1)}</div>`).join('')}</div>`, 'is-columns');
  }
  if (block.type === 'heading-1' || block.type === 'heading-2' || block.type === 'heading-3') {
    const level = Number(block.type.slice(-1));
    return frame(`<h${level}>${content}</h${level}>${childHtml()}`, `is-heading is-h${level}`);
  }
  if (block.type === 'paragraph') return frame(`<p>${content || '&nbsp;'}</p>${childHtml()}`);
  if (block.type === 'todo') return frame(`<div class="bs-export-list"><span class="marker">${block.checked ? '☒' : '☐'}</span><div>${content}${childHtml()}</div></div>`, 'is-list');
  if (block.type === 'bulleted-list') return frame(`<div class="bs-export-list"><span class="marker">•</span><div>${content}${childHtml()}</div></div>`, 'is-list');
  if (block.type === 'numbered-list') return frame(`<div class="bs-export-list"><span class="marker">${Core.numberedOrdinal(page, block.id)}.</span><div>${content}${childHtml()}</div></div>`, 'is-list');
  if (block.type === 'quote') return frame(`<blockquote>${content}${childHtml()}</blockquote>`, 'is-quote');
  if (block.type === 'callout') return frame(`<aside class="bs-export-callout"><strong>提示</strong><div>${content}${childHtml()}</div></aside>`, 'is-callout');
  if (block.type === 'toggle') return frame(`<div class="bs-export-toggle"><strong>${content || '详情'}</strong>${childHtml()}</div>`, 'is-toggle');
  if (block.type === 'code' || block.type === 'markdown') return frame(`<pre><code>${htmlEscape(block.text)}</code></pre>`, `is-${block.type}`);
  if (block.type === 'divider') return frame('<hr>', 'is-divider');
  if (block.type === 'table-of-contents') {
    const items = Core.deriveOutline(page, block.toc);
    return frame(`<nav class="bs-export-toc"><strong>目录</strong>${items.map((item) => `<div style="padding-left:${Math.max(0, item.level - block.toc.minLevel) * 18}px">${block.toc.showNumbers && item.numberPath ? `${htmlEscape(item.numberPath)} ` : ''}${htmlEscape(item.title)}</div>`).join('')}</nav>`, 'is-toc');
  }
  if (block.type === 'table') {
    const data = Core.normalizeBlockData('table', block.data);
    const header = data.header ? `<thead><tr>${data.columns.map((column) => `<th style="text-align:${column.align}">${htmlEscape(column.name)}</th>`).join('')}</tr></thead>` : '';
    const body = `<tbody>${data.rows.map((row) => `<tr>${data.columns.map((column) => `<td style="text-align:${column.align}">${htmlEscape(row.cells[column.id]).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return frame(`<table>${header}${body}</table>`, 'is-table');
  }
  if (block.type === 'image') {
    const data = Core.normalizeBlockData('image', block.data);
    const source = exportAssetDataUrl(options, block.id);
    const width = data.widthMode === 'fixed' && data.width ? `width:${Math.min(680, data.width)}px` : data.widthMode === 'full' ? 'width:100%' : 'max-width:100%';
    const image = source ? `<img src="${source}" alt="${htmlEscape(data.alt || data.caption || block.text)}" style="${width}">` : `<div class="bs-export-media-placeholder">图片：${htmlEscape(data.alt || data.caption || data.path || data.url || '未提供来源')}</div>`;
    const caption = data.caption ? `<figcaption style="text-align:${data.captionAlign};font-size:${data.captionSize === 'small' ? '12px' : '14px'};font-style:${data.captionStyle === 'italic' ? 'italic' : 'normal'};font-weight:${data.captionStyle === 'bold' ? '700' : '400'}">${htmlEscape(data.caption)}</figcaption>` : '';
    return frame(`<figure>${image}${caption}</figure>`, 'is-image');
  }
  if (block.type === 'bookmark') {
    const data = Core.normalizeBlockData('bookmark', block.data);
    return frame(`<div class="bs-export-bookmark"><a href="${htmlEscape(data.url)}"><strong>${htmlEscape(data.title || data.url || '书签')}</strong></a>${data.description ? `<p>${htmlEscape(data.description)}</p>` : ''}${data.siteName ? `<small>${htmlEscape(data.siteName)}</small>` : ''}</div>`, 'is-bookmark');
  }
  if (['video', 'audio', 'attachment'].includes(block.type)) {
    const data = Core.normalizeBlockData(block.type, block.data);
    const source = data.sourceType === 'vault' ? data.path : data.url;
    const label = data.title || data.name || block.text || source || block.type;
    return frame(`<div class="bs-export-attachment"><strong>${htmlEscape(label)}</strong>${source ? `<div>${htmlEscape(source)}</div>` : ''}</div>`, `is-${block.type}`);
  }
  return frame(`<p>${content}</p>${childHtml()}`);
}

const EXPORT_CSS = `
  *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#202124;font-family:"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif}
  body{width:${A4_WIDTH_PX}px}.bs-export-document{width:${A4_WIDTH_PX}px;padding:68px 72px 72px;background:#fff;font-size:15px;line-height:1.65;overflow-wrap:anywhere}
  .bs-export-title{margin:0 0 18px;font-size:34px;line-height:1.22;letter-spacing:-.02em}.bs-export-properties{margin:0 0 24px;padding:14px 16px;border-radius:10px;background:#f6f7f9}
  .bs-export-properties>div{display:grid;grid-template-columns:88px 1fr;gap:12px;padding:4px 0}.bs-export-properties dt{color:#68707c}.bs-export-properties dd{margin:0}
  .bs-export-block{margin:0 0 9px;padding-left:calc(var(--depth,0)*18px)}.bs-export-block p{margin:0}.bs-export-block h1,.bs-export-block h2,.bs-export-block h3{margin:18px 0 8px;line-height:1.3}
  .bs-export-block h1{font-size:24px}.bs-export-block h2{font-size:20px}.bs-export-block h3{font-size:17px}.bs-export-list{display:grid;grid-template-columns:24px 1fr;gap:4px}.marker{text-align:right}
  blockquote{margin:0;padding:7px 14px;border-left:3px solid #9aa0a6;color:#4c5158}.bs-export-callout{display:grid;grid-template-columns:auto 1fr;gap:12px;padding:12px 14px;border-radius:8px;background:#eef4fb;border-left:4px solid #5b8fc9}
  pre{margin:0;padding:13px 15px;white-space:pre-wrap;background:#f4f5f7;border-radius:8px;font-family:"Cascadia Mono","SFMono-Regular",Consolas,monospace;font-size:13px;line-height:1.5}.bs-export-toggle{padding:8px 12px;border-left:2px solid #d5d9df}
  hr{border:0;border-top:1px solid #d7dbe0;margin:18px 0}.bs-export-toc{padding:14px 16px;border:1px solid #e0e3e7;border-radius:8px}.bs-export-toc>div{padding-top:4px}
  table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:8px 10px;border:1px solid #d7dbe0;vertical-align:middle}th{background:#f1f3f5;font-weight:650}
  .bs-export-columns{display:grid;gap:18px;align-items:start}.bs-export-column{min-width:0;padding-left:0}.bs-export-column+.bs-export-column{border-left:1px solid #e1e4e8;padding-left:18px}
  figure{margin:0}figure img{display:block;height:auto;border-radius:6px}figcaption{margin-top:7px;color:#747b84}.bs-export-wrap{display:flex;gap:var(--wrap-gap,20px);align-items:flex-start;margin-bottom:12px}.bs-export-wrap-image{flex:0 0 auto;max-width:60%}.bs-export-wrap-text{flex:1;min-width:0}
  .bs-export-bookmark,.bs-export-attachment,.bs-export-media-placeholder{padding:13px 15px;border:1px solid #dfe3e8;border-radius:8px;background:#fafbfc}.bs-export-bookmark p{margin:5px 0}.bs-export-bookmark small,.bs-export-attachment div{color:#717984}
  a{color:#2563a6;text-decoration:none}code{font-family:"Cascadia Mono","SFMono-Regular",Consolas,monospace;background:#f1f3f5;padding:1px 4px;border-radius:4px}
  [data-export-block]{break-inside:avoid-page}@media print{@page{size:A4;margin:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;

function htmlDocumentForPage(page, options = {}) {
  const normalized = Core.normalizePage(page);
  const body = renderHtmlBlocks(normalized, normalized.rootBlockIds, options);
  const payload = safeJson(pagePayload(normalized));
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${htmlEscape(normalized.title)}</title><style>${EXPORT_CSS}</style></head><body><main class="bs-export-document"><h1 class="bs-export-title">${htmlEscape(normalized.title)}</h1>${renderPropertyHtml(normalized)}${body}</main><script type="application/vnd.blockspace+json">${payload}</script></body></html>`;
}

function uint16(value) {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, Number(value) >>> 0, true);
  return output;
}

function uint32(value) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, Number(value) >>> 0, true);
  return output;
}

let crcTable = null;
function crc32(value) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let current = index;
      for (let bit = 0; bit < 8; bit += 1) current = (current >>> 1) ^ ((current & 1) ? 0xedb88320 : 0);
      crcTable[index] = current >>> 0;
    }
  }
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function zipArchive(entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const safeEntries = Array.from(entries || []).map((entry) => ({
    name: String(entry.name || '').replace(/\\/g, '/'),
    bytes: entry.bytes instanceof Uint8Array ? entry.bytes : utf8Bytes(entry.bytes || ''),
  }));
  for (const entry of safeEntries) {
    const name = utf8Bytes(entry.name);
    const crc = crc32(entry.bytes);
    const local = concatBytes(
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
      uint32(crc), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0),
      name, entry.bytes,
    );
    localParts.push(local);
    centralParts.push(concatBytes(
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
      uint32(crc), uint32(entry.bytes.length), uint32(entry.bytes.length), uint16(name.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(localOffset), name,
    ));
    localOffset += local.length;
  }
  const central = concatBytes(...centralParts);
  const end = concatBytes(
    uint32(0x06054b50), uint16(0), uint16(0), uint16(safeEntries.length), uint16(safeEntries.length),
    uint32(central.length), uint32(localOffset), uint16(0),
  );
  return concatBytes(...localParts, central, end);
}

function wordText(value) {
  const parts = String(value ?? '').split('\n');
  return parts.map((part, index) => `${index ? '<w:br/>' : ''}<w:t xml:space="preserve">${xmlEscape(part)}</w:t>`).join('');
}

function wordRun(value, properties = '') {
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${wordText(value)}</w:r>`;
}

function wordParagraph(body = '', properties = '') {
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${body || '<w:r><w:t/></w:r>'}</w:p>`;
}

function docxAlignment(value) {
  return value === 'center' || value === 'right' ? value : 'left';
}

function docxShade(value) {
  const color = backgroundValue(value, '').replace('#', '').toUpperCase();
  return color ? `<w:shd w:val="clear" w:color="auto" w:fill="${color}"/>` : '';
}

function docxColor(value) {
  return colorValue(value, '').replace('#', '').toUpperCase();
}

function wordRelationshipTarget(value) {
  const href = storedLinkHref(value);
  return href || '';
}

class DocxBuilder {
  constructor(page, options = {}) {
    this.page = Core.normalizePage(page);
    this.options = options;
    this.map = Core.blockMap(this.page);
    this.entries = [];
    this.relationships = [];
    this.nextRelationship = 3;
    this.nextImage = 1;
    this.imageExtensions = new Set();
  }

  addRelationship(type, target, mode = '') {
    const id = `rId${this.nextRelationship++}`;
    this.relationships.push({ id, type, target, mode });
    return id;
  }

  addHyperlink(target) {
    return this.addRelationship('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', target, 'External');
  }

  addImage(block) {
    const asset = exportAsset(this.options, block.id);
    if (!asset || !asset.bytes) return null;
    const mime = String(asset.mime || '').toLowerCase();
    let extension = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpeg' : '';
    if (!extension) return null;
    const name = `image${this.nextImage++}.${extension}`;
    this.imageExtensions.add(extension);
    this.entries.push({ name: `word/media/${name}`, bytes: asset.bytes });
    const relationshipId = this.addRelationship('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `media/${name}`);
    return { asset, relationshipId, extension };
  }

  inline(block) {
    const segments = inlineSegments(block);
    if (!segments.length) return wordRun('');
    return segments.map((segment) => {
      const properties = [];
      for (const mark of segment.marks) {
        if (mark.type === 'bold') properties.push('<w:b/>');
        else if (mark.type === 'italic') properties.push('<w:i/>');
        else if (mark.type === 'underline') properties.push('<w:u w:val="single"/>');
        else if (mark.type === 'strike') properties.push('<w:strike/>');
        else if (mark.type === 'code') properties.push('<w:rFonts w:ascii="Cascadia Mono" w:hAnsi="Cascadia Mono" w:eastAsia="Microsoft YaHei"/><w:shd w:val="clear" w:fill="F1F3F5"/>');
        else if (mark.type === 'textColor') properties.push(`<w:color w:val="${docxColor(mark.value)}"/>`);
        else if (mark.type === 'highlight') properties.push(`<w:shd w:val="clear" w:fill="${backgroundValue(mark.value, '#FFF2CC').replace('#', '').toUpperCase()}"/>`);
      }
      const run = wordRun(segment.text, properties.join(''));
      const link = segment.marks.find((mark) => mark.type === 'link');
      const target = link && wordRelationshipTarget(link.value);
      if (!target) return run;
      const relationshipId = this.addHyperlink(target);
      return `<w:hyperlink r:id="${relationshipId}" w:history="1">${run}</w:hyperlink>`;
    }).join('');
  }

  paragraph(block, depth = 0, extra = '') {
    const appearance = Core.normalizeBlockAppearance(block.appearance);
    const properties = [
      `<w:jc w:val="${docxAlignment(appearance.align)}"/>`,
      depth ? `<w:ind w:left="${Math.min(2160, depth * 360)}"/>` : '',
      appearance.background !== 'default' ? docxShade(appearance.background) : '',
      extra,
    ].join('');
    let body = this.inline(block);
    if (appearance.textColor !== 'default' && !block.marks.some((mark) => mark.type === 'textColor')) {
      body = `<w:r><w:rPr><w:color w:val="${docxColor(appearance.textColor)}"/></w:rPr>${wordText(block.text)}</w:r>`;
    }
    return wordParagraph(body, properties);
  }

  tableCell(body, width, options = {}) {
    const borders = options.borderless
      ? '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>'
      : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${Math.max(1, Math.round(width))}" w:type="dxa"/>${borders}<w:vAlign w:val="center"/></w:tcPr>${body || wordParagraph()}</w:tc>`;
  }

  tableXml(rows, widths, options = {}) {
    const total = widths.reduce((sum, width) => sum + width, 0);
    const borders = options.borderless
      ? '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>'
      : '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D7DBE0"/><w:left w:val="single" w:sz="4" w:color="D7DBE0"/><w:bottom w:val="single" w:sz="4" w:color="D7DBE0"/><w:right w:val="single" w:sz="4" w:color="D7DBE0"/><w:insideH w:val="single" w:sz="4" w:color="D7DBE0"/><w:insideV w:val="single" w:sz="4" w:color="D7DBE0"/></w:tblBorders>';
    const grid = widths.map((width) => `<w:gridCol w:w="${Math.round(width)}"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${Math.round(total)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;
  }

  imageParagraph(block) {
    const record = this.addImage(block);
    const data = Core.normalizeBlockData('image', block.data);
    if (!record) return this.paragraph({ ...block, text: `图片：${data.alt || data.caption || data.path || data.url || '未提供来源'}` });
    const widthPx = Math.max(80, Math.min(620, Number(data.width || record.asset.width || 560)));
    const naturalWidth = Math.max(1, Number(record.asset.width) || widthPx);
    const naturalHeight = Math.max(1, Number(record.asset.height) || Number(data.height) || Math.round(widthPx * 0.625));
    const heightPx = Math.max(40, Math.round(widthPx * naturalHeight / naturalWidth));
    const cx = Math.round(widthPx * 9525);
    const cy = Math.round(heightPx * 9525);
    const drawing = `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${this.nextImage + 100}" name="${xmlEscape(data.alt || data.caption || 'Image')}" descr="${xmlEscape(data.alt || data.caption || '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${record.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    const align = Core.normalizeBlockAppearance(block.appearance).align;
    const image = wordParagraph(`<w:r>${drawing}</w:r>`, `<w:jc w:val="${docxAlignment(align)}"/>`);
    const caption = data.caption ? wordParagraph(wordRun(data.caption, `${data.captionStyle === 'italic' ? '<w:i/>' : ''}${data.captionStyle === 'bold' ? '<w:b/>' : ''}<w:color w:val="6B7280"/><w:sz w:val="${data.captionSize === 'small' ? 18 : 22}"/>`), `<w:pStyle w:val="Caption"/><w:jc w:val="${docxAlignment(data.captionAlign)}"/>`) : '';
    return image + caption;
  }

  renderSequence(ids, depth = 0) {
    const blocks = Array.from(ids || []).map((id) => this.map.get(id)).filter(Boolean);
    const output = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.type === 'column') continue;
      if (block.type === 'image') {
        const data = Core.normalizeBlockData('image', block.data);
        const paragraphs = [];
        let cursor = index + 1;
        while (data.wrapMode !== 'top-bottom' && cursor < blocks.length && blocks[cursor].type === 'paragraph') paragraphs.push(blocks[cursor++]);
        if (paragraphs.length) {
          const imageWidth = Math.max(1800, Math.min(5200, Math.round((data.width || 320) * 9)));
          const textWidth = 9360 - imageWidth;
          const imageCell = this.tableCell(this.imageParagraph(block), imageWidth, { borderless: true });
          const textCell = this.tableCell(paragraphs.map((paragraph) => this.renderBlock(paragraph, depth)).join(''), textWidth, { borderless: true });
          const cells = data.wrapMode === 'square-right' ? textCell + imageCell : imageCell + textCell;
          output.push(this.tableXml([`<w:tr>${cells}</w:tr>`], data.wrapMode === 'square-right' ? [textWidth, imageWidth] : [imageWidth, textWidth], { borderless: true }) + wordParagraph());
          index = cursor - 1;
          continue;
        }
      }
      output.push(this.renderBlock(block, depth));
    }
    return output.join('');
  }

  renderBlock(block, depth = 0) {
    if (block.type === 'columns') {
      const config = Core.normalizeColumnsConfig(block.columns);
      const columns = block.children.map((id) => this.map.get(id)).filter((child) => child && child.type === 'column');
      const ratios = config.ratio.split(':').map((value) => Math.max(1, Number(value) || 1));
      const sum = ratios.reduce((total, value) => total + value, 0);
      const widths = ratios.map((value) => Math.round(9360 * value / sum));
      widths[widths.length - 1] += 9360 - widths.reduce((total, value) => total + value, 0);
      const cells = columns.map((column, index) => this.tableCell(this.renderSequence(column.children, depth + 1), widths[index] || widths[0], { borderless: true })).join('');
      return this.tableXml([`<w:tr>${cells}</w:tr>`], widths, { borderless: true }) + wordParagraph();
    }
    if (block.type === 'table') {
      const data = Core.normalizeBlockData('table', block.data);
      const requested = data.columns.map((column) => Math.max(0, Number(column.width) || 0));
      const totalRequested = requested.reduce((sum, value) => sum + value, 0);
      const widths = data.columns.map((_column, index) => totalRequested ? Math.max(720, Math.round(9360 * requested[index] / totalRequested)) : Math.round(9360 / data.columns.length));
      widths[widths.length - 1] += 9360 - widths.reduce((sum, value) => sum + value, 0);
      const rows = [];
      if (data.header) rows.push(`<w:tr><w:trPr><w:tblHeader/></w:trPr>${data.columns.map((column, index) => this.tableCell(wordParagraph(wordRun(column.name, '<w:b/>'), `<w:shd w:val="clear" w:fill="F1F3F5"/><w:jc w:val="${column.align}"/>`), widths[index])).join('')}</w:tr>`);
      for (const row of data.rows) rows.push(`<w:tr>${data.columns.map((column, index) => this.tableCell(wordParagraph(wordRun(row.cells[column.id]), `<w:jc w:val="${column.align}"/>`), widths[index])).join('')}</w:tr>`);
      return this.tableXml(rows, widths) + wordParagraph();
    }
    if (block.type === 'image') return this.imageParagraph(block);
    if (block.type === 'heading-1' || block.type === 'heading-2' || block.type === 'heading-3') {
      const level = Number(block.type.slice(-1));
      return this.paragraph(block, depth, `<w:pStyle w:val="Heading${level}"/><w:keepNext/>`) + this.renderSequence(block.children, depth + 1);
    }
    if (block.type === 'paragraph') return this.paragraph(block, depth) + this.renderSequence(block.children, depth + 1);
    if (block.type === 'todo') return wordParagraph(wordRun(`${block.checked ? '☒' : '☐'} `) + this.inline(block), `<w:pStyle w:val="ListParagraph"/><w:ind w:left="${720 + depth * 360}" w:hanging="360"/>`) + this.renderSequence(block.children, depth + 1);
    if (block.type === 'bulleted-list' || block.type === 'numbered-list') {
      const numId = block.type === 'bulleted-list' ? 1 : 2;
      return this.paragraph(block, 0, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(8, depth)}"/><w:numId w:val="${numId}"/></w:numPr>`) + this.renderSequence(block.children, depth + 1);
    }
    if (block.type === 'quote') return this.paragraph(block, depth, '<w:pStyle w:val="Quote"/>') + this.renderSequence(block.children, depth + 1);
    if (block.type === 'callout') return this.paragraph(block, depth, '<w:pStyle w:val="Callout"/>') + this.renderSequence(block.children, depth + 1);
    if (block.type === 'toggle') return this.paragraph(block, depth, '<w:pStyle w:val="Toggle"/>') + this.renderSequence(block.children, depth + 1);
    if (block.type === 'code' || block.type === 'markdown') return String(block.text || '').split('\n').map((line) => wordParagraph(wordRun(line), '<w:pStyle w:val="Code"/>')).join('');
    if (block.type === 'divider') return wordParagraph('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D7DBE0"/></w:pBdr>');
    if (block.type === 'table-of-contents') {
      const items = Core.deriveOutline(this.page, block.toc);
      return wordParagraph(wordRun('目录', '<w:b/>')) + items.map((item) => wordParagraph(wordRun(`${block.toc.showNumbers && item.numberPath ? `${item.numberPath} ` : ''}${item.title}`), `<w:ind w:left="${Math.max(0, item.level - block.toc.minLevel) * 360}"/>`)).join('');
    }
    if (block.type === 'bookmark') {
      const data = Core.normalizeBlockData('bookmark', block.data);
      const relationshipId = data.url ? this.addHyperlink(data.url) : '';
      const title = wordRun(data.title || data.url || '书签', '<w:b/><w:color w:val="2563A6"/>');
      return wordParagraph(relationshipId ? `<w:hyperlink r:id="${relationshipId}">${title}</w:hyperlink>` : title) + (data.description ? wordParagraph(wordRun(data.description, '<w:color w:val="6B7280"/>')) : '');
    }
    if (['video', 'audio', 'attachment'].includes(block.type)) {
      const data = Core.normalizeBlockData(block.type, block.data);
      const source = data.sourceType === 'vault' ? data.path : data.url;
      const label = data.title || data.name || block.text || source || block.type;
      const relationshipId = /^https?:/i.test(source || '') ? this.addHyperlink(source) : '';
      const body = wordRun(label, '<w:b/>') + (source ? wordRun(`\n${source}`, '<w:color w:val="6B7280"/>') : '');
      return wordParagraph(relationshipId ? `<w:hyperlink r:id="${relationshipId}">${body}</w:hyperlink>` : body, '<w:pStyle w:val="Attachment"/>');
    }
    return this.paragraph(block, depth) + this.renderSequence(block.children, depth + 1);
  }

  propertyTable() {
    const properties = this.page.properties;
    const rows = [
      ['状态', properties.status], ['优先级', properties.priority],
      ...(properties.tags.length ? [['标签', properties.tags.map((tag) => `#${tag}`).join('  ')]] : []),
      ...([['来源', properties.source], ['作者', properties.author], ['发布日期', properties.publishedAt], ['说明', properties.description]].filter((entry) => String(entry[1] || '').trim())),
      ...Core.normalizeCustomProperties(properties.custom).map((property) => [property.name, Array.isArray(property.value) ? property.value.join(', ') : property.value === true ? '是' : property.value === false ? '否' : String(property.value ?? '')]),
    ];
    return this.tableXml(rows.map(([label, value]) => `<w:tr>${this.tableCell(wordParagraph(wordRun(label, '<w:color w:val="6B7280"/>')), 1680, { borderless: true })}${this.tableCell(wordParagraph(wordRun(value)), 7680, { borderless: true })}</w:tr>`), [1680, 7680], { borderless: true });
  }

  build() {
    const payload = pagePayload(this.page);
    const payloadBase64 = wrappedBase64(JSON.stringify(payload), 160);
    const markdownBase64 = wrappedBase64(losslessMarkdownForPage(this.page), 160);
    const customXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><blockspace:export xmlns:blockspace="https://blockspace.local/schema/export/1" formatVersion="${Core.DATA_VERSION}" pageId="${xmlEscape(this.page.id)}"><blockspace:page encoding="base64">${payloadBase64}</blockspace:page><blockspace:markdown encoding="base64">${markdownBase64}</blockspace:markdown></blockspace:export>`;
    const customIdHash = Core.hashString(this.page.id).toUpperCase().padEnd(32, '0').slice(0, 32);
    const itemId = `{${customIdHash.slice(0, 8)}-${customIdHash.slice(8, 12)}-${customIdHash.slice(12, 16)}-${customIdHash.slice(16, 20)}-${customIdHash.slice(20, 32)}}`;
    const customProps = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="${itemId}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="https://blockspace.local/schema/export/1"/></ds:schemaRefs></ds:datastoreItem>`;
    const documentBody = wordParagraph(wordRun(this.page.title), '<w:pStyle w:val="Title"/>') + this.propertyTable() + wordParagraph() + this.renderSequence(this.page.rootBlockIds) + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="312"/></w:sectPr>';
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14 wp14" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"><w:body>${documentBody}</w:body></w:document>`;
    const dynamicRelationships = this.relationships.map((relationship) => `<Relationship Id="${relationship.id}" Type="${relationship.type}" Target="${xmlEscape(relationship.target)}"${relationship.mode ? ` TargetMode="${relationship.mode}"` : ''}/>`).join('');
    const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${dynamicRelationships}<Relationship Id="rId${this.nextRelationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>`;
    const stylesXml = docxStylesXml();
    const numberingXml = docxNumberingXml();
    const contentTypes = docxContentTypes(this.imageExtensions);
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    const coreProps = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(this.page.title)}</dc:title><dc:creator>Blockspace Workspace</dc:creator><cp:lastModifiedBy>Blockspace Workspace</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${xmlEscape(this.page.createdAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${xmlEscape(this.page.updatedAt)}</dcterms:modified><cp:keywords>Blockspace;lossless export;${xmlEscape(this.page.properties.tags.join(';'))}</cp:keywords></cp:coreProperties>`;
    const appProps = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Blockspace Workspace</Application><AppVersion>1.0</AppVersion></Properties>';
    const customRels = '<?xml version="1.0" encoding="UTF-8" standalone="no"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps1.xml"/></Relationships>';
    const allEntries = [
      { name: '[Content_Types].xml', bytes: contentTypes }, { name: '_rels/.rels', bytes: rootRels },
      { name: 'docProps/core.xml', bytes: coreProps }, { name: 'docProps/app.xml', bytes: appProps },
      { name: 'word/document.xml', bytes: documentXml }, { name: 'word/styles.xml', bytes: stylesXml },
      { name: 'word/numbering.xml', bytes: numberingXml }, { name: 'word/_rels/document.xml.rels', bytes: documentRels },
      { name: 'customXml/item1.xml', bytes: customXml }, { name: 'customXml/itemProps1.xml', bytes: customProps },
      { name: 'customXml/_rels/item1.xml.rels', bytes: customRels }, ...this.entries,
    ];
    return zipArchive(allEntries);
  }
}

function docxStylesXml() {
  const paragraphStyle = (id, name, properties, runProperties = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${properties || runProperties ? `<w:pPr>${properties}</w:pPr><w:rPr>${runProperties}</w:rPr>` : ''}</w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:style>${paragraphStyle('Title', 'Title', '<w:spacing w:before="0" w:after="280"/><w:keepNext/>', '<w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="202124"/>')}${paragraphStyle('Heading1', 'heading 1', '<w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/><w:keepNext/>', '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/><w:color w:val="202124"/>')}${paragraphStyle('Heading2', 'heading 2', '<w:spacing w:before="260" w:after="120"/><w:outlineLvl w:val="1"/><w:keepNext/>', '<w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="202124"/>')}${paragraphStyle('Heading3', 'heading 3', '<w:spacing w:before="220" w:after="100"/><w:outlineLvl w:val="2"/><w:keepNext/>', '<w:b/><w:sz w:val="26"/><w:szCs w:val="26"/><w:color w:val="343A40"/>')}${paragraphStyle('ListParagraph', 'List Paragraph', '<w:spacing w:after="80"/>')}${paragraphStyle('Quote', 'Quote', '<w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="16" w:space="8" w:color="9AA0A6"/></w:pBdr>', '<w:color w:val="4C5158"/>')}${paragraphStyle('Callout', 'Callout', '<w:ind w:left="240" w:right="240"/><w:shd w:val="clear" w:fill="EEF4FB"/><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="5B8FC9"/></w:pBdr><w:spacing w:before="80" w:after="80"/>')}${paragraphStyle('Toggle', 'Toggle', '<w:ind w:left="240"/><w:pBdr><w:left w:val="single" w:sz="8" w:space="6" w:color="D5D9DF"/></w:pBdr>', '<w:b/>')}${paragraphStyle('Code', 'Code', '<w:spacing w:after="0" w:line="260" w:lineRule="auto"/><w:shd w:val="clear" w:fill="F4F5F7"/><w:ind w:left="240" w:right="240"/>', '<w:rFonts w:ascii="Cascadia Mono" w:hAnsi="Cascadia Mono" w:eastAsia="Microsoft YaHei"/><w:sz w:val="19"/><w:szCs w:val="19"/>')}${paragraphStyle('Caption', 'Caption', '<w:spacing w:before="80" w:after="160"/>', '<w:color w:val="6B7280"/><w:sz w:val="19"/>')}${paragraphStyle('Attachment', 'Attachment', '<w:ind w:left="240" w:right="240"/><w:shd w:val="clear" w:fill="FAFBFC"/><w:pBdr><w:top w:val="single" w:sz="4" w:color="DFE3E8"/><w:left w:val="single" w:sz="4" w:color="DFE3E8"/><w:bottom w:val="single" w:sz="4" w:color="DFE3E8"/><w:right w:val="single" w:sz="4" w:color="DFE3E8"/></w:pBdr><w:spacing w:before="80" w:after="80"/>')}</w:styles>`;
}

function docxNumberingXml() {
  const levels = (bullet) => Array.from({ length: 9 }, (_value, level) => {
    const left = 720 + level * 360;
    return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${bullet ? 'bullet' : 'decimal'}"/><w:lvlText w:val="${bullet ? ['•', '◦', '▪'][level % 3] : `%${level + 1}.`}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="${left}"/></w:tabs><w:ind w:left="${left}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/></w:rPr></w:lvl>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${levels(false)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
}

function docxContentTypes(imageExtensions) {
  const imageDefaults = Array.from(imageExtensions || []).map((extension) => `<Default Extension="${extension}" ContentType="${extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : 'image/jpeg'}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`;
}

function docxForPage(page, options = {}) {
  return new DocxBuilder(page, options).build();
}

function canvasToJpegBytes(canvas, quality = 0.92) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error('无法生成 PDF 页面图像'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/jpeg', quality);
      return;
    }
    try {
      const encoded = canvas.toDataURL('image/jpeg', quality).split(',')[1] || '';
      resolve(base64ToBytes(encoded));
    } catch (error) {
      reject(error);
    }
  });
}

function waitWithin(promise, timeoutMs, fallback, rejectMessage = '') {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise).finally(() => { if (timer !== null) clearTimeout(timer); }),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (rejectMessage) reject(new Error(rejectMessage));
        else resolve(fallback);
      }, timeoutMs);
    }),
  ]);
}

async function waitForFrameImages(documentRef) {
  const images = Array.from(documentRef.images || []);
  await waitWithin(Promise.all(images.map((image) => {
    if (image.complete) return typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  })), 10000, undefined);
}

async function waitForLayout(ownerWindow) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 120);
    if (!ownerWindow || typeof ownerWindow.requestAnimationFrame !== 'function') return;
    ownerWindow.requestAnimationFrame(() => ownerWindow.requestAnimationFrame(finish));
  });
}

function prepareRasterPagination(documentRef, pageHeight = A4_HEIGHT_PX) {
  const root = documentRef.querySelector('.bs-export-document');
  if (!root) return pageHeight;
  const topMargin = 68;
  const bottomMargin = 72;
  const usable = pageHeight - topMargin - bottomMargin;
  const blocks = Array.from(root.querySelectorAll('[data-export-block]'));
  for (const block of blocks) {
    const rootRect = root.getBoundingClientRect();
    const rect = block.getBoundingClientRect();
    const top = rect.top - rootRect.top;
    const height = rect.height;
    const page = Math.max(0, Math.floor(top / pageHeight));
    const contentBottom = page * pageHeight + pageHeight - bottomMargin;
    if (height < usable && top + height > contentBottom) {
      const nextTop = (page + 1) * pageHeight + topMargin;
      const currentMargin = Number.parseFloat(block.style.marginTop || '0') || 0;
      block.style.marginTop = `${currentMargin + Math.max(0, nextTop - top)}px`;
    }
  }
  const height = Math.max(pageHeight, root.scrollHeight + bottomMargin);
  const pages = Math.ceil(height / pageHeight);
  root.style.minHeight = `${pages * pageHeight}px`;
  return pages * pageHeight;
}

async function renderHtmlToJpegPages(html, ownerDocument, options = {}) {
  if (!ownerDocument || !ownerDocument.body) throw new Error('当前环境无法创建 PDF 打印画布');
  const frame = ownerDocument.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;border:0;opacity:0;pointer-events:none;z-index:-1`;
  ownerDocument.body.appendChild(frame);
  try {
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = String(html || '');
    await waitWithin(loaded, 5000, undefined);
    const frameDocument = frame.contentDocument;
    if (!frameDocument) throw new Error('无法初始化 PDF 打印文档');
    await waitForFrameImages(frameDocument);
    if (frameDocument.fonts && frameDocument.fonts.ready) {
      await waitWithin(frameDocument.fonts.ready.catch(() => undefined), 5000, undefined);
    }
    // Chromium throttles requestAnimationFrame in invisible/off-screen iframes. Use the
    // visible owner window and a bounded timer so PDF export cannot wait forever.
    await waitForLayout(ownerDocument.defaultView || frame.contentWindow);
    const totalHeight = prepareRasterPagination(frameDocument, A4_HEIGHT_PX);
    const pageCount = Math.max(1, Math.ceil(totalHeight / A4_HEIGHT_PX));
    const root = frameDocument.querySelector('.bs-export-document');
    if (!root) throw new Error('PDF 打印文档缺少正文');
    const rootMarkup = root.outerHTML;
    const scale = Math.max(1, Math.min(3, Number(options.scale) || 2));
    const pages = [];
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const offset = pageIndex * A4_HEIGHT_PX;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${A4_WIDTH_PX}" height="${A4_HEIGHT_PX}" viewBox="0 0 ${A4_WIDTH_PX} ${A4_HEIGHT_PX}"><foreignObject x="0" y="${-offset}" width="${A4_WIDTH_PX}" height="${totalHeight}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${A4_WIDTH_PX}px;height:${totalHeight}px;background:#fff"><style>${EXPORT_CSS}</style>${rootMarkup}</div></foreignObject></svg>`;
      const ownerWindow = ownerDocument.defaultView || globalThis;
      const UrlApi = ownerWindow.URL || URL;
      const BlobType = ownerWindow.Blob || Blob;
      const ImageType = ownerWindow.Image || Image;
      const url = UrlApi.createObjectURL(new BlobType([svg], { type: 'image/svg+xml;charset=utf-8' }));
      try {
        const image = new ImageType();
        image.decoding = 'sync';
        const imageLoaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('PDF 页面图像解码失败'));
        });
        image.src = url;
        const decoded = typeof image.decode === 'function' ? image.decode().catch(() => imageLoaded) : imageLoaded;
        await waitWithin(decoded, 15000, undefined, 'PDF 页面图像渲染超时');
        const canvas = ownerDocument.createElement('canvas');
        canvas.width = Math.round(A4_WIDTH_PX * scale);
        canvas.height = Math.round(A4_HEIGHT_PX * scale);
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.scale(scale, scale);
        context.drawImage(image, 0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
        pages.push({
          bytes: await waitWithin(
            canvasToJpegBytes(canvas, Number(options.quality) || 0.93),
            15000,
            undefined,
            'PDF 页面编码超时',
          ),
          width: canvas.width,
          height: canvas.height,
        });
      } finally {
        UrlApi.revokeObjectURL(url);
      }
    }
    return pages;
  } finally {
    frame.remove();
  }
}

const CANVAS_FONT_FAMILY = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",Arial,sans-serif';
const CANVAS_MONO_FAMILY = '"Cascadia Mono","SFMono-Regular",Consolas,monospace';

function canvasStyle(block, marks = [], base = {}) {
  const appearance = Core.normalizeBlockAppearance(block && block.appearance);
  const foreground = marks.find((mark) => mark.type === 'textColor');
  const highlight = marks.find((mark) => mark.type === 'highlight');
  const link = marks.find((mark) => mark.type === 'link');
  const code = marks.some((mark) => mark.type === 'code');
  return {
    size: Number(base.size) || 15,
    family: code || base.mono ? CANVAS_MONO_FAMILY : CANVAS_FONT_FAMILY,
    bold: !!base.bold || marks.some((mark) => mark.type === 'bold'),
    italic: !!base.italic || marks.some((mark) => mark.type === 'italic'),
    underline: !!link || marks.some((mark) => mark.type === 'underline'),
    strike: marks.some((mark) => mark.type === 'strike'),
    color: link ? '#2563a6' : foreground ? colorValue(foreground.value) : colorValue(appearance.textColor, base.color || '#202124'),
    background: code ? '#eef0f2' : highlight ? backgroundValue(highlight.value) : '',
  };
}

function canvasFont(style) {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '400 '}${style.size}px ${style.family}`;
}

class CanvasPageRenderer {
  constructor(page, ownerDocument, options = {}) {
    if (!ownerDocument || typeof ownerDocument.createElement !== 'function') throw new Error('当前环境无法创建 PDF 画布');
    this.page = Core.normalizePage(page);
    this.map = Core.blockMap(this.page);
    this.document = ownerDocument;
    this.window = ownerDocument.defaultView || globalThis;
    this.options = options;
    this.scale = Math.max(1, Math.min(3, Number(options.scale) || 2));
    this.quality = Math.max(0.75, Math.min(1, Number(options.quality) || 0.93));
    this.margin = { top: 66, right: 70, bottom: 70, left: 70 };
    this.pages = [];
    this.images = new Map();
    this.widths = new Map();
    this.pageBreakLocked = false;
    this.newPage();
  }

  get bottom() { return A4_HEIGHT_PX - this.margin.bottom; }
  get bounds() { return { x: this.margin.left, width: A4_WIDTH_PX - this.margin.left - this.margin.right }; }

  newPage() {
    const canvas = this.document.createElement('canvas');
    canvas.width = Math.round(A4_WIDTH_PX * this.scale);
    canvas.height = Math.round(A4_HEIGHT_PX * this.scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境无法初始化 PDF 画布');
    context.scale(this.scale, this.scale);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
    context.textBaseline = 'top';
    context.lineCap = 'round';
    this.pages.push(canvas);
    this.canvas = canvas;
    this.context = context;
    this.y = this.margin.top;
  }

  ensure(height) {
    if (this.pageBreakLocked || this.y <= this.margin.top || this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  applyFont(style) {
    this.context.font = canvasFont(style);
    this.context.fillStyle = style.color || '#202124';
  }

  characterWidth(character, style) {
    const styleKey = `${style.size}|${style.family}|${style.bold ? 1 : 0}|${style.italic ? 1 : 0}`;
    const key = `${styleKey}|${character}`;
    if (this.widths.has(key)) return this.widths.get(key);
    this.applyFont(style);
    const width = this.context.measureText(character).width;
    this.widths.set(key, width);
    return width;
  }

  layout(block, width, base = {}) {
    const normalized = Core.normalizeBlock(block);
    const segments = inlineSegments(normalized);
    const source = segments.length ? segments : [{ text: normalized.text || '', marks: [] }];
    const lines = [{ pieces: [], width: 0 }];
    const addLine = () => lines.push({ pieces: [], width: 0 });
    for (const segment of source) {
      const style = canvasStyle(normalized, segment.marks, base);
      const styleKey = JSON.stringify(style);
      for (const character of Array.from(segment.text || '')) {
        if (character === '\r') continue;
        if (character === '\n') {
          addLine();
          continue;
        }
        const measured = this.characterWidth(character, style);
        if (lines[lines.length - 1].pieces.length && lines[lines.length - 1].width + measured > width) addLine();
        const line = lines[lines.length - 1];
        const previous = line.pieces[line.pieces.length - 1];
        if (previous && previous.styleKey === styleKey) {
          previous.text += character;
          previous.width += measured;
        } else line.pieces.push({ text: character, width: measured, style, styleKey });
        line.width += measured;
      }
    }
    return lines;
  }

  drawLine(line, bounds, y, height, align = 'left') {
    let x = bounds.x;
    if (align === 'center') x += Math.max(0, (bounds.width - line.width) / 2);
    else if (align === 'right') x += Math.max(0, bounds.width - line.width);
    for (const piece of line.pieces) {
      const style = piece.style;
      const textY = y + Math.max(0, (height - style.size * 1.3) / 2);
      if (style.background) {
        this.context.fillStyle = style.background;
        this.context.fillRect(x - 1, textY - 1, piece.width + 2, style.size * 1.35);
      }
      this.applyFont(style);
      this.context.fillText(piece.text, x, textY);
      this.context.strokeStyle = style.color;
      this.context.lineWidth = 1;
      if (style.underline || style.strike) {
        const lineY = textY + style.size * (style.strike ? 0.68 : 1.25);
        this.context.beginPath();
        this.context.moveTo(x, lineY);
        this.context.lineTo(x + piece.width, lineY);
        this.context.stroke();
      }
      x += piece.width;
    }
  }

  drawText(block, bounds, options = {}) {
    const appearance = Core.normalizeBlockAppearance(block.appearance);
    const size = Number(options.size) || 15;
    const lineHeight = Number(options.lineHeight) || Math.ceil(size * 1.65);
    const markerWidth = options.marker ? 26 : 0;
    const textBounds = { x: bounds.x + markerWidth, width: Math.max(24, bounds.width - markerWidth) };
    const lines = this.layout(block, textBounds.width, options);
    if (options.topGap) {
      this.ensure(options.topGap + lineHeight);
      this.y += options.topGap;
    }
    let markerDrawn = false;
    for (const line of lines) {
      this.ensure(lineHeight + 8);
      const background = options.background || (appearance.background !== 'default' ? backgroundValue(appearance.background) : '');
      if (background) {
        this.context.fillStyle = background;
        this.context.fillRect(bounds.x - 4, this.y, bounds.width + 8, lineHeight);
      }
      if (options.leftBar) {
        this.context.fillStyle = options.leftBar;
        this.context.fillRect(bounds.x, this.y, 3, lineHeight);
      }
      if (options.marker && !markerDrawn) {
        this.applyFont(canvasStyle(block, [], { size, color: options.color }));
        this.context.fillText(options.marker, bounds.x + 2, this.y + Math.max(0, (lineHeight - size * 1.3) / 2));
        markerDrawn = true;
      }
      this.drawLine(line, textBounds, this.y, lineHeight, appearance.align);
      this.y += lineHeight;
    }
    this.y += Number.isFinite(options.bottomGap) ? options.bottomGap : 7;
  }

  plain(text, bounds, options = {}) {
    this.drawText(Core.normalizeBlock({ id: 'canvas-text', type: 'paragraph', text: String(text || ''), marks: [], children: [], appearance: options.appearance || {} }), bounds, options);
  }

  estimate(block, width) {
    if (!block) return 0;
    if (block.type === 'image') return this.imageSize(block, { width }).height + 32;
    if (block.type === 'divider') return 24;
    if (block.type === 'table') {
      const data = Core.normalizeBlockData('table', block.data);
      return (data.rows.length + (data.header ? 1 : 0)) * 34 + 12;
    }
    const size = block.type === 'heading-1' ? 24 : block.type === 'heading-2' ? 20 : block.type === 'heading-3' ? 17 : ['code', 'markdown'].includes(block.type) ? 13 : 15;
    return this.layout(block, Math.max(40, width), { size, mono: ['code', 'markdown'].includes(block.type) }).length * Math.ceil(size * 1.65) + 12
      + block.children.reduce((sum, id) => sum + this.estimate(this.map.get(id), Math.max(40, width - 18)), 0);
  }

  async loadImages() {
    const ImageType = this.window.Image || Image;
    for (const block of this.page.blocks) {
      if (block.type !== 'image') continue;
      const asset = exportAsset(this.options, block.id);
      if (!asset || (!asset.dataUrl && !asset.bytes) || String(asset.mime || '').toLowerCase() === 'image/svg+xml') continue;
      const source = asset.dataUrl || `data:${asset.mime || 'image/png'};base64,${bytesToBase64(asset.bytes)}`;
      try {
        const image = new ImageType();
        const loaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('图片解码失败'));
        });
        image.src = source;
        await waitWithin(typeof image.decode === 'function' ? image.decode().catch(() => loaded) : loaded, 10000, undefined, '图片解码超时');
        this.images.set(block.id, image);
      } catch (_error) {
        // Unsupported images remain labelled placeholders; the lossless attachment still preserves their metadata.
      }
    }
  }

  imageSize(block, bounds) {
    const data = Core.normalizeBlockData('image', block.data);
    const image = this.images.get(block.id);
    const asset = exportAsset(this.options, block.id);
    const naturalWidth = Number(image && (image.naturalWidth || image.width)) || Number(asset && asset.width) || 960;
    const naturalHeight = Number(image && (image.naturalHeight || image.height)) || Number(asset && asset.height) || 540;
    let width = data.widthMode === 'full' ? bounds.width : data.widthMode === 'fixed' && data.width ? data.width : Math.min(bounds.width, naturalWidth / 2);
    width = Math.max(80, Math.min(bounds.width, width));
    return { width, height: Math.min(600, width * naturalHeight / Math.max(1, naturalWidth)) };
  }

  drawImageAt(block, x, y, size) {
    const data = Core.normalizeBlockData('image', block.data);
    const image = this.images.get(block.id);
    if (image) this.context.drawImage(image, x, y, size.width, size.height);
    else {
      this.context.fillStyle = '#f2f4f7';
      this.context.fillRect(x, y, size.width, size.height);
      this.context.strokeStyle = '#cfd4dc';
      this.context.strokeRect(x, y, size.width, size.height);
      this.applyFont({ size: 13, family: CANVAS_FONT_FAMILY, bold: false, italic: false, color: '#68707c' });
      this.context.fillText(String(data.alt || data.caption || data.path || data.url || '图片').slice(0, 50), x + 12, y + 12);
    }
    return data;
  }

  drawImage(block, bounds) {
    const data = Core.normalizeBlockData('image', block.data);
    const size = this.imageSize(block, bounds);
    this.ensure(size.height + (data.caption ? 28 : 10));
    let x = bounds.x;
    if (data.align === 'center') x += (bounds.width - size.width) / 2;
    else if (data.align === 'right') x += bounds.width - size.width;
    this.drawImageAt(block, x, this.y, size);
    this.y += size.height + 4;
    if (data.caption) this.plain(data.caption, { x, width: size.width }, { size: data.captionSize === 'small' ? 12 : 14, italic: data.captionStyle === 'italic', bold: data.captionStyle === 'bold', lineHeight: 20, bottomGap: 5, appearance: { align: data.captionAlign } });
    else this.y += 7;
  }

  drawTable(block, bounds) {
    const data = Core.normalizeBlockData('table', block.data);
    if (!data.columns.length) return;
    const total = data.columns.reduce((sum, column) => sum + Math.max(40, Number(column.width) || 120), 0);
    const widths = data.columns.map((column) => bounds.width * Math.max(40, Number(column.width) || 120) / total);
    const drawRow = (values, header = false) => {
      const layouts = values.map((value, index) => {
        const cell = Core.normalizeBlock({ id: `cell-${index}`, type: 'paragraph', text: String(value || ''), marks: [], children: [] });
        return this.layout(cell, Math.max(20, widths[index] - 14), { size: 13, bold: header });
      });
      const height = Math.max(30, ...layouts.map((lines) => lines.length * 20 + 10));
      const changed = this.ensure(height + 2);
      if (changed && data.header && !header) drawRow(data.columns.map((column) => column.name), true);
      let x = bounds.x;
      for (let index = 0; index < data.columns.length; index += 1) {
        this.context.fillStyle = header ? '#f1f3f5' : '#ffffff';
        this.context.fillRect(x, this.y, widths[index], height);
        this.context.strokeStyle = '#d3d8df';
        this.context.strokeRect(x, this.y, widths[index], height);
        let lineY = this.y + 5;
        for (const line of layouts[index]) {
          this.drawLine(line, { x: x + 7, width: widths[index] - 14 }, lineY, 20, data.columns[index].align || 'left');
          lineY += 20;
        }
        x += widths[index];
      }
      this.y += height;
    };
    if (data.header) drawRow(data.columns.map((column) => column.name), true);
    for (const row of data.rows) drawRow(data.columns.map((column) => row.cells[column.id]), false);
    this.y += 10;
  }

  drawColumns(block, bounds) {
    const columns = block.children.map((id) => this.map.get(id)).filter((item) => item && item.type === 'column');
    if (!columns.length) return;
    const ratios = Core.normalizeColumnsConfig(block.columns).ratio.split(':').map((value) => Math.max(1, Number(value) || 1)).slice(0, columns.length);
    while (ratios.length < columns.length) ratios.push(1);
    const gap = 22;
    const available = bounds.width - gap * (columns.length - 1);
    const ratioTotal = ratios.reduce((sum, value) => sum + value, 0);
    const widths = ratios.map((ratio) => available * ratio / ratioTotal);
    const heights = columns.map((column, index) => column.children.reduce((sum, id) => sum + this.estimate(this.map.get(id), widths[index]), 0));
    const required = Math.max(34, ...heights);
    if (required > this.bottom - this.margin.top) {
      for (const column of columns) this.renderBlocks(column.children, bounds);
      return;
    }
    this.ensure(required + 10);
    const startY = this.y;
    let x = bounds.x;
    let maxY = startY;
    const prior = this.pageBreakLocked;
    this.pageBreakLocked = true;
    for (let index = 0; index < columns.length; index += 1) {
      this.y = startY;
      this.renderBlocks(columns[index].children, { x, width: widths[index] });
      maxY = Math.max(maxY, this.y);
      if (index < columns.length - 1) {
        const dividerX = x + widths[index] + gap / 2;
        this.context.strokeStyle = '#e0e3e7';
        this.context.beginPath();
        this.context.moveTo(dividerX, startY);
        this.context.lineTo(dividerX, startY + required);
        this.context.stroke();
      }
      x += widths[index] + gap;
    }
    this.pageBreakLocked = prior;
    this.y = maxY + 7;
  }

  drawImageWrap(block, paragraphs, bounds) {
    const data = Core.normalizeBlockData('image', block.data);
    const gap = Math.max(8, Math.min(48, Number(data.wrapGap) || 16));
    const size = this.imageSize(block, { width: Math.min(bounds.width * 0.56, bounds.width - 160) });
    const textWidth = bounds.width - size.width - gap;
    const textHeight = paragraphs.reduce((sum, paragraph) => sum + this.estimate(paragraph, textWidth), 0);
    const totalHeight = Math.max(size.height + (data.caption ? 24 : 0), textHeight);
    if (textWidth < 150 || totalHeight > this.bottom - this.margin.top) return false;
    this.ensure(totalHeight + 10);
    const startY = this.y;
    const imageX = data.wrapMode === 'square-right' ? bounds.x + bounds.width - size.width : bounds.x;
    const textX = data.wrapMode === 'square-right' ? bounds.x : bounds.x + size.width + gap;
    this.drawImageAt(block, imageX, startY, size);
    if (data.caption) {
      const saved = this.y;
      this.y = startY + size.height + 4;
      this.plain(data.caption, { x: imageX, width: size.width }, { size: data.captionSize === 'small' ? 12 : 14, italic: data.captionStyle === 'italic', bold: data.captionStyle === 'bold', lineHeight: 20, bottomGap: 0, appearance: { align: data.captionAlign } });
      this.y = saved;
    }
    const textY = data.wrapTextAlign === 'center' ? startY + Math.max(0, (totalHeight - textHeight) / 2) : data.wrapTextAlign === 'bottom' ? startY + Math.max(0, totalHeight - textHeight) : startY;
    const prior = this.pageBreakLocked;
    this.pageBreakLocked = true;
    this.y = textY;
    for (const paragraph of paragraphs) this.drawBlock(paragraph, { x: textX, width: textWidth });
    this.pageBreakLocked = prior;
    this.y = startY + totalHeight + 10;
    return true;
  }

  drawBlock(block, bounds) {
    if (!block || block.type === 'column') return;
    if (block.type === 'heading-1') this.drawText(block, bounds, { size: 24, lineHeight: 34, bold: true, topGap: 10, bottomGap: 8 });
    else if (block.type === 'heading-2') this.drawText(block, bounds, { size: 20, lineHeight: 29, bold: true, topGap: 8 });
    else if (block.type === 'heading-3') this.drawText(block, bounds, { size: 17, lineHeight: 26, bold: true, topGap: 6, bottomGap: 6 });
    else if (block.type === 'paragraph') this.drawText(block, bounds);
    else if (block.type === 'todo') this.drawText(block, bounds, { marker: block.checked ? '☒' : '☐' });
    else if (block.type === 'bulleted-list') this.drawText(block, bounds, { marker: '•' });
    else if (block.type === 'numbered-list') this.drawText(block, bounds, { marker: `${Core.numberedOrdinal(this.page, block.id)}.` });
    else if (block.type === 'quote') this.drawText(block, { x: bounds.x + 10, width: bounds.width - 10 }, { italic: true, color: '#4c5158', leftBar: '#9aa0a6', bottomGap: 9 });
    else if (block.type === 'callout') this.drawText(block, bounds, { background: '#eef4fb', leftBar: '#5b8fc9', bold: true, bottomGap: 10 });
    else if (block.type === 'toggle') this.drawText(block, bounds, { marker: '▸', bold: true });
    else if (block.type === 'code' || block.type === 'markdown') this.drawText(block, bounds, { size: 13, lineHeight: 21, mono: true, background: '#f4f5f7', bottomGap: 10 });
    else if (block.type === 'divider') {
      this.ensure(24);
      this.y += 10;
      this.context.strokeStyle = '#d7dbe0';
      this.context.beginPath();
      this.context.moveTo(bounds.x, this.y);
      this.context.lineTo(bounds.x + bounds.width, this.y);
      this.context.stroke();
      this.y += 13;
    } else if (block.type === 'table') this.drawTable(block, bounds);
    else if (block.type === 'columns') this.drawColumns(block, bounds);
    else if (block.type === 'image') this.drawImage(block, bounds);
    else if (block.type === 'table-of-contents') {
      this.plain('目录', bounds, { bold: true, size: 17, bottomGap: 4 });
      for (const item of Core.deriveOutline(this.page, block.toc)) {
        const indent = Math.max(0, item.level - block.toc.minLevel) * 18;
        this.plain(`${block.toc.showNumbers && item.numberPath ? `${item.numberPath} ` : ''}${item.title}`, { x: bounds.x + indent, width: bounds.width - indent }, { size: 14, lineHeight: 22, bottomGap: 1 });
      }
      this.y += 7;
    } else if (block.type === 'bookmark') {
      const data = Core.normalizeBlockData('bookmark', block.data);
      this.plain(data.title || data.url || '书签', bounds, { bold: true, background: '#f6f7f9', bottomGap: 2 });
      if (data.description) this.plain(data.description, bounds, { size: 13, background: '#f6f7f9', color: '#68707c', bottomGap: 6 });
    } else if (['video', 'audio', 'attachment'].includes(block.type)) {
      const data = Core.normalizeBlockData(block.type, block.data);
      this.plain(data.title || data.name || block.text || data.path || data.url || block.type, bounds, { bold: true, background: '#f6f7f9', bottomGap: 8 });
    } else this.drawText(block, bounds);
    if (block.type !== 'columns' && block.children.length) this.renderBlocks(block.children, { x: bounds.x + 18, width: Math.max(60, bounds.width - 18) });
  }

  renderBlocks(ids, bounds = this.bounds) {
    const blocks = Array.from(ids || []).map((id) => this.map.get(id)).filter(Boolean);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.type === 'column') continue;
      if (block.type === 'image') {
        const data = Core.normalizeBlockData('image', block.data);
        if (data.wrapMode !== 'top-bottom') {
          const paragraphs = [];
          let cursor = index + 1;
          while (cursor < blocks.length && blocks[cursor].type === 'paragraph') paragraphs.push(blocks[cursor++]);
          if (paragraphs.length && this.drawImageWrap(block, paragraphs, bounds)) {
            index = cursor - 1;
            continue;
          }
        }
      }
      this.drawBlock(block, bounds);
    }
  }

  drawProperties(bounds) {
    const properties = this.page.properties;
    const rows = [
      ['状态', properties.status], ['优先级', properties.priority],
      ...(properties.tags.length ? [['标签', properties.tags.map((tag) => `#${tag}`).join('  ')]] : []),
      ...([['来源', properties.source], ['作者', properties.author], ['发布日期', properties.publishedAt], ['说明', properties.description]].filter((entry) => String(entry[1] || '').trim())),
      ...Core.normalizeCustomProperties(properties.custom).map((property) => [property.name, Array.isArray(property.value) ? property.value.join(', ') : property.value === true ? '是' : property.value === false ? '否' : String(property.value ?? '')]),
    ];
    if (!rows.length) return;
    for (const [label, value] of rows) {
      this.ensure(25);
      this.context.fillStyle = '#f6f7f9';
      this.context.fillRect(bounds.x, this.y, bounds.width, 24);
      this.plain(label, { x: bounds.x + 12, width: 82 }, { size: 13, color: '#68707c', lineHeight: 20, bottomGap: -20 });
      this.plain(String(value ?? ''), { x: bounds.x + 104, width: bounds.width - 116 }, { size: 13, lineHeight: 20, bottomGap: 4 });
    }
    this.y += 14;
  }

  async render() {
    await this.loadImages();
    const title = Core.normalizeBlock({ id: 'page-title', type: 'heading-1', text: this.page.title, marks: [], children: [] });
    this.drawText(title, this.bounds, { size: 34, lineHeight: 44, bold: true, bottomGap: 18 });
    this.drawProperties(this.bounds);
    this.renderBlocks(this.page.rootBlockIds, this.bounds);
    const output = [];
    for (const canvas of this.pages) {
      output.push({
        bytes: await waitWithin(canvasToJpegBytes(canvas, this.quality), 15000, undefined, 'PDF 页面编码超时'),
        width: canvas.width,
        height: canvas.height,
      });
    }
    return output;
  }
}

async function renderPageToJpegPages(page, ownerDocument, options = {}) {
  return new CanvasPageRenderer(page, ownerDocument, options).render();
}

function pdfUtf16Hex(value) {
  const text = String(value || '');
  let hex = 'FEFF';
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfUtf16TextHex(value) {
  const text = String(value || '');
  let hex = '';
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfToUnicodeCMap(value) {
  const codes = Array.from(new Set(Array.from(String(value || '')).flatMap((character) => {
    const units = [];
    for (let index = 0; index < character.length; index += 1) units.push(character.charCodeAt(index));
    return units;
  }))).sort((left, right) => left - right);
  const sections = [];
  for (let offset = 0; offset < codes.length; offset += 100) {
    const chunk = codes.slice(offset, offset + 100);
    sections.push(`${chunk.length} beginbfchar\n${chunk.map((code) => {
      const hex = code.toString(16).padStart(4, '0').toUpperCase();
      return `<${hex}> <${hex}>`;
    }).join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /BlockspaceIdentity def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${sections.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

function pdfDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()];
  return `D:${parts.map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('')}`;
}

function pdfStream(dictionary, bytes) {
  const payload = bytes instanceof Uint8Array ? bytes : utf8Bytes(bytes || '');
  return concatBytes(utf8Bytes(`<< ${dictionary} /Length ${payload.length} >>\nstream\n`), payload, utf8Bytes('\nendstream'));
}

function pdfFromJpegPages(inputPages, page, options = {}) {
  const pages = Array.from(inputPages || []).filter((item) => item && item.bytes && item.bytes.length);
  if (!pages.length) throw new Error('PDF 至少需要一页图像');
  const normalized = Core.normalizePage(page);
  const objects = [null];
  const reserve = () => { objects.push(null); return objects.length - 1; };
  const set = (id, value) => { objects[id] = value instanceof Uint8Array ? value : utf8Bytes(value); };
  const catalogId = reserve();
  const pagesId = reserve();
  const infoId = reserve();
  const searchText = Core.pageSearchText(normalized);
  const searchCidFontId = reserve();
  const searchToUnicodeId = reserve();
  const searchFontId = reserve();
  set(searchCidFontId, '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /DW 1000 >>');
  set(searchToUnicodeId, pdfStream('', pdfToUnicodeCMap(searchText)));
  set(searchFontId, `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${searchCidFontId} 0 R] /ToUnicode ${searchToUnicodeId} 0 R >>`);
  const pageIds = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const item = pages[pageIndex];
    const imageId = reserve();
    const contentId = reserve();
    const pageId = reserve();
    const imageWidth = Math.max(1, Number(item.width) || A4_WIDTH_PX * 2);
    const imageHeight = Math.max(1, Number(item.height) || A4_HEIGHT_PX * 2);
    set(imageId, pdfStream(`/Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, item.bytes));
    const imagePaint = `q\n${A4_WIDTH_PT.toFixed(2)} 0 0 ${A4_HEIGHT_PT.toFixed(2)} 0 0 cm\n/Im0 Do\nQ`;
    const searchablePaint = pageIndex === 0
      ? `${imagePaint}\n/Span << /ActualText ${pdfUtf16Hex(searchText)} >> BDC\nBT /F1 1 Tf 3 Tr 0 0 Td ${pdfUtf16TextHex(searchText)} Tj ET\nEMC`
      : imagePaint;
    set(contentId, pdfStream('', searchablePaint));
    set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4_WIDTH_PT.toFixed(2)} ${A4_HEIGHT_PT.toFixed(2)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 ${searchFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  const attachmentBytes = utf8Bytes(JSON.stringify(pagePayload(normalized), null, 2));
  const embeddedFileId = reserve();
  const fileSpecId = reserve();
  set(embeddedFileId, pdfStream(`/Type /EmbeddedFile /Subtype /application#2Fjson /Params << /Size ${attachmentBytes.length} /ModDate (${pdfDate(normalized.updatedAt)}) >>`, attachmentBytes));
  set(fileSpecId, `<< /Type /Filespec /F (blockspace-page.json) /UF ${pdfUtf16Hex('blockspace-page.json')} /Desc ${pdfUtf16Hex('Blockspace lossless page data')} /EF << /F ${embeddedFileId} 0 R /UF ${embeddedFileId} 0 R >> /AFRelationship /Data >>`);
  set(pagesId, `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (zh-CN) /MarkInfo << /Marked true >> /Names << /EmbeddedFiles << /Names [(blockspace-page.json) ${fileSpecId} 0 R] >> >> /AF [${fileSpecId} 0 R] /ViewerPreferences << /DisplayDocTitle true >> >>`);
  set(infoId, `<< /Title ${pdfUtf16Hex(normalized.title)} /Author ${pdfUtf16Hex('Blockspace Workspace')} /Subject ${pdfUtf16Hex('Lossless Blockspace PDF export')} /Keywords ${pdfUtf16Hex(['Blockspace', ...normalized.properties.tags].join('; '))} /Creator (Blockspace Workspace) /Producer (Blockspace Workspace PDF exporter) /CreationDate (${pdfDate()}) /ModDate (${pdfDate(normalized.updatedAt)}) >>`);
  const header = concatBytes(utf8Bytes('%PDF-1.7\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), utf8Bytes('\n'));
  const body = [header];
  const offsets = [0];
  let offset = header.length;
  for (let id = 1; id < objects.length; id += 1) {
    const object = concatBytes(utf8Bytes(`${id} 0 obj\n`), objects[id], utf8Bytes('\nendobj\n'));
    offsets[id] = offset;
    body.push(object);
    offset += object.length;
  }
  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length}\n`, '0000000000 65535 f \n'];
  for (let id = 1; id < objects.length; id += 1) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  const trailer = `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return concatBytes(...body, utf8Bytes(xref.join('')), utf8Bytes(trailer));
}

module.exports = {
  LOSSLESS_DATA_START,
  LOSSLESS_DATA_END,
  A4_WIDTH_PX,
  A4_HEIGHT_PX,
  utf8Bytes,
  utf8Text,
  concatBytes,
  bytesToBase64,
  base64ToBytes,
  zipArchive,
  pagePayload,
  propertyFrontmatter,
  losslessMarkdownForPage,
  losslessSidecarForPage,
  extractLosslessSidecar,
  markdownLosslessReference,
  extractLosslessPage,
  stripLosslessPayload,
  htmlDocumentForPage,
  docxForPage,
  renderHtmlToJpegPages,
  renderPageToJpegPages,
  pdfFromJpegPages,
};
