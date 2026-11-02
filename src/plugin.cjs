'use strict';

const { t, setLanguage, normalizeLanguage } = require('./i18n.cjs');

const Core = require('./core.cjs');
const Exporters = require('./export.cjs');
const {
  Component,
  FuzzySuggestModal,
  ItemView,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
  setIcon,
} = require('obsidian');

const VIEW_TYPE = 'blockspace-workspace-view';
const INSPECTOR_VIEW_TYPE = 'blockspace-inspector-view';
const DEFAULT_SETTINGS = {
  language: 'en',
  dataFolder: '.blockspace',
  exportFolder: 'Blockspace Exports',
  markdownBridgeEnabled: true,
  markdownBridgeFolder: 'Blockspace Bridge',
  nativeMarkdownSyncEnabled: false,
  nativeMarkdownFolder: 'Blockspace Notes',
  openGeneratedMarkdownInBlockspace: true,
  attachmentFolder: 'Blockspace Assets',
  markdownBlockIdMode: 'referenced',
  autosaveDelay: 350,
  showSidebar: false,
  showRightPanel: false,
  showInspectorOnOpen: false,
  showProperties: false,
  contentWidth: 780,
  compactMode: false,
  fontFamily: 'theme',
  fontSize: 16,
  lineHeight: 1.65,
  historyLimit: 150,
  snapshotLimit: 12,
  snapshotIntervalMinutes: 5,
  visualRefinementVersion: 5,
  interactionRefinementVersion: 1,
  nativeShellRefinementVersion: 1,
  visualStyle: 'notion',
  pageDensity: 'standard',
  markdownRenderMode: 'reading-only',
};

const FIND_INPUT_DEBOUNCE_MS = 70;
const MAX_FIND_MATCHES = 10000;
const MAX_FIND_HIGHLIGHTS = 240;

let SLASH_COMMANDS;

const COLUMN_RATIO_TEMPLATES = Object.freeze({
  '1:1': 'minmax(0, 1fr) minmax(0, 1fr)',
  '1:2': 'minmax(0, 1fr) minmax(0, 2fr)',
  '2:1': 'minmax(0, 2fr) minmax(0, 1fr)',
  '1:1:1': 'repeat(3, minmax(0, 1fr))',
  '1:2:1': 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)',
  '2:1:1': 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
  '1:1:2': 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)',
});


let STATUS_LABELS;
let PRIORITY_LABELS;
const ICON_OPTIONS = ['✨', '📄', '🚀', '💡', '📌', '🎯', '🧠', '🛠️'];
const STYLE_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
let STYLE_COLOR_LABELS;
let FONT_FAMILIES;
let VISUAL_STYLES;
let PAGE_DENSITIES;
let CUSTOM_PROPERTY_TYPE_DETAILS;
let MARKDOWN_RENDER_MODES;
let MARKDOWN_BLOCK_ID_MODES;
const MARKDOWN_ANCHORABLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading-1',
  'heading-2',
  'heading-3',
  'quote',
  'callout',
  'toggle',
  'code',
]);

function metadataText(value, limit = 4000) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ').slice(0, limit);
  if (value && typeof value === 'object') return '';
  return String(value ?? '').trim().slice(0, limit);
}

function metadataTags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? '').replace(/^\[|\]$/g, '').split(/[,，]/);
  return Array.from(new Set(raw.map((item) => String(item).trim().replace(/^#/, '')).filter(Boolean))).slice(0, 50);
}

function firstMetadataValue(source, keys) {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
  }
  return undefined;
}

const IMPORTED_FIXED_PROPERTY_KEYS = new Set([
  'title', 'status', 'priority', 'tags', 'tag', 'source', 'url', 'original', 'link',
  'author', 'authors', 'creator', 'published', 'publishedat', 'published_at', 'date',
  'created', 'createdat', 'created_at', 'description', 'summary', 'excerpt', 'aliases',
  'cssclasses', 'cssclass', 'position', 'blockspace-id', 'blockspace-revision',
  'blockspace-projection',
]);

function importedCustomProperties(source) {
  if (!source || typeof source !== 'object') return [];
  const properties = [];
  const names = [];
  for (const [rawName, rawValue] of Object.entries(source)) {
    const name = String(rawName || '').trim();
    if (IMPORTED_FIXED_PROPERTY_KEYS.has(name.toLocaleLowerCase())) continue;
    if (!Core.isValidCustomPropertyName(name, names)) continue;
    let type = 'text';
    let value = rawValue;
    if (Array.isArray(rawValue)) type = 'list';
    else if (typeof rawValue === 'boolean') type = 'checkbox';
    else if (typeof rawValue === 'number') type = 'number';
    else if (rawValue && typeof rawValue === 'object') continue;
    else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(rawValue || ''))) type = 'datetime';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(String(rawValue || ''))) type = 'date';
    properties.push({ id: Core.randomId('property'), name, type, value });
    names.push(name);
  }
  return Core.normalizeCustomProperties(properties);
}

function importedPageMetadata(frontmatter, looseMetadata = {}) {
  const source = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  const loose = looseMetadata && typeof looseMetadata === 'object' ? looseMetadata : {};
  const value = (keys, looseKey, limit) => metadataText(
    firstMetadataValue(source, keys) ?? loose[looseKey],
    limit,
  );
  const tagsValue = firstMetadataValue(source, ['tags', 'tag']) ?? loose.tags;
  return {
    title: value(['title'], 'title', 1000),
    status: metadataText(firstMetadataValue(source, ['status']), 100),
    priority: metadataText(firstMetadataValue(source, ['priority']), 100),
    tags: metadataTags(tagsValue),
    source: value(['source', 'url', 'original', 'link'], 'source', 8192),
    author: value(['author', 'authors', 'creator'], 'author', 1000),
    publishedAt: value(
      ['published', 'publishedAt', 'published_at', 'date', 'created', 'createdAt', 'created_at'],
      'publishedAt',
      500,
    ),
    description: value(['description', 'summary', 'excerpt'], 'description', 4000),
    custom: importedCustomProperties(source),
  };
}

function customPropertyFrontmatterValue(property) {
  if (property.type === 'list') {
    return `[${(Array.isArray(property.value) ? property.value : [])
      .map((item) => JSON.stringify(String(item)))
      .join(', ')}]`;
  }
  if (property.type === 'number') return property.value == null ? 'null' : String(property.value);
  if (property.type === 'checkbox') return property.value ? 'true' : 'false';
  return JSON.stringify(String(property.value || ''));
}

function extraPropertyFrontmatter(properties) {
  const normalized = properties && typeof properties === 'object' ? properties : {};
  const lines = [
    normalized.source ? `source: ${JSON.stringify(normalized.source)}` : '',
    normalized.author ? `author: ${JSON.stringify(normalized.author)}` : '',
    normalized.publishedAt ? `published: ${JSON.stringify(normalized.publishedAt)}` : '',
    normalized.description ? `description: ${JSON.stringify(normalized.description)}` : '',
  ].filter(Boolean);
  for (const property of Core.normalizeCustomProperties(normalized.custom)) {
    lines.push(`${JSON.stringify(property.name)}: ${customPropertyFrontmatterValue(property)}`);
  }
  return lines;
}

let SAVE_STATE_LABELS;

let ADVANCED_BLOCK_LABELS;

function fileExtension(value) {
  return ((String(value || '').toLowerCase().match(/\.([a-z0-9]{2,8})(?:[?#].*)?$/) || [])[1] || '');
}

function exportImageMime(value, declared = '') {
  const explicit = String(declared || '').toLowerCase();
  if (['image/png', 'image/jpeg', 'image/gif'].includes(explicit)) return explicit;
  const extension = fileExtension(value);
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  return explicit.startsWith('image/') ? explicit : 'application/octet-stream';
}

function exactArrayBuffer(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
}

async function exportedImageDimensions(bytes, mime, ownerWindow) {
  if (!ownerWindow || typeof ownerWindow.Image !== 'function' || typeof ownerWindow.Blob !== 'function') return {};
  const url = ownerWindow.URL.createObjectURL(new ownerWindow.Blob([exactArrayBuffer(bytes)], { type: mime }));
  try {
    const image = new ownerWindow.Image();
    image.src = url;
    if (typeof image.decode === 'function') await image.decode();
    else await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    return { width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 };
  } catch (_error) {
    return {};
  } finally {
    ownerWindow.URL.revokeObjectURL(url);
  }
}

function advancedTypeForFile(name, mime = '') {
  const extension = fileExtension(name);
  const type = String(mime || '').toLowerCase();
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic'].includes(extension)) return 'image';
  if (type.startsWith('video/') || ['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'].includes(extension)) return 'video';
  if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'].includes(extension)) return 'audio';
  return 'attachment';
}

function formatFileSize(value) {
  const size = Math.max(0, Number(value) || 0);
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  if (size < 1024 * 1024 * 1024) return `${Math.round(size / 1024 / 102.4) / 10} MB`;
  return `${Math.round(size / 1024 / 1024 / 102.4) / 10} GB`;
}

function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function createButton(parent, className, ariaLabel, icon, text) {
  const button = parent.createEl('button', { cls: className, attr: { type: 'button', 'aria-label': ariaLabel } });
  if (icon) {
    const iconEl = button.createSpan({ cls: 'bs-icon' });
    setIcon(iconEl, icon);
  }
  if (text) button.createSpan({ text, cls: 'bs-button-label' });
  return button;
}

function setMediaToolbarInteractive(toolbar, interactive) {
  if (!toolbar) return;
  toolbar.toggleAttribute('inert', !interactive);
  toolbar.setAttribute('aria-hidden', interactive ? 'false' : 'true');
}

function syncMediaToolbarInteractive(toolbar, selected = null) {
  if (!toolbar) return;
  const block = toolbar.closest('.bs-block');
  const host = toolbar.parentElement;
  const blockSelected = selected == null
    ? Boolean(block && block.classList.contains('is-block-selected'))
    : Boolean(selected);
  const interactive = blockSelected || Boolean(host && (host.matches(':hover') || host.matches(':focus-within')));
  setMediaToolbarInteractive(toolbar, interactive);
}

function getCaretOffset(element) {
  const selection = element.ownerDocument.defaultView.getSelection();
  if (!selection || selection.rangeCount === 0) return String(element.textContent || '').length;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return String(element.textContent || '').length;
  const clone = range.cloneRange();
  clone.selectNodeContents(element);
  clone.setEnd(range.startContainer, range.startOffset);
  return clone.toString().length;
}

function placeCaret(element, offset = 0) {
  const document = element.ownerDocument;
  const selection = document.defaultView.getSelection();
  const walker = document.createTreeWalker(element, 4);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.nodeValue.length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= node.nodeValue.length;
    node = walker.nextNode();
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertTextAtSelection(element, value, inputType = 'insertText') {
  const document = element.ownerDocument;
  const selection = document.defaultView.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return false;
  range.deleteContents();
  const textNode = document.createTextNode(String(value ?? ''));
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  const ViewInputEvent = document.defaultView.InputEvent;
  const event = typeof ViewInputEvent === 'function'
    ? new ViewInputEvent('input', { bubbles: true, inputType, data: String(value ?? '') })
    : new document.defaultView.Event('input', { bubbles: true });
  element.dispatchEvent(event);
  return true;
}

function isTextInputTarget(target) {
  return target instanceof target.ownerDocument.defaultView.HTMLInputElement
    || target instanceof target.ownerDocument.defaultView.HTMLTextAreaElement
    || target.isContentEditable;
}

function isSelectionCollapsed(element) {
  const selection = element.ownerDocument.defaultView.getSelection();
  return !selection || selection.rangeCount === 0 || selection.isCollapsed;
}

function focusEditorAt(view, blockId, offset = 0) {
  if (!view || !view.contentEl) return false;
  const markdownEditor = view.contentEl.querySelector(`[data-block-id="${blockId}"] .bs-markdown-source-editor`);
  if (markdownEditor && typeof view.activateMarkdownBlockEditor === 'function') {
    const activated = view.activateMarkdownBlockEditor(blockId, offset);
    if (!activated) return false;
    return true;
  }
  if (view && typeof view.activateTextBlockEditor === 'function') view.activateTextBlockEditor(blockId);
  const editor = view.contentEl.querySelector(`[data-block-id="${blockId}"] .bs-block-editor`);
  if (!editor) return false;
  editor.focus();
  placeCaret(editor, offset);
  return true;
}

function getTextSelectionOffsets(element) {
  const selection = element.ownerDocument.defaultView.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  const start = startRange.toString().length;
  const end = endRange.toString().length;
  return { from: Math.min(start, end), to: Math.max(start, end), collapsed: start === end, range };
}

function setTextSelection(element, from, to = from) {
  const document = element.ownerDocument;
  const selection = document.defaultView.getSelection();
  const walker = document.createTreeWalker(element, 4);
  const locate = (offset) => {
    let remaining = Math.max(0, Number(offset) || 0);
    let node = walker.nextNode();
    while (node) {
      if (remaining <= node.nodeValue.length) return { node, offset: remaining };
      remaining -= node.nodeValue.length;
      node = walker.nextNode();
    }
    return { node: element, offset: element.childNodes.length };
  };
  const start = locate(from);
  walker.currentNode = element;
  const end = locate(to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}


function locateTextPoint(element, offset) {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4);
  let remaining = Math.max(0, Number(offset) || 0);
  let node = walker.nextNode();
  while (node) {
    if (remaining <= node.nodeValue.length) return { node, offset: remaining };
    remaining -= node.nodeValue.length;
    node = walker.nextNode();
  }
  return { node: element, offset: element.childNodes.length };
}

function createTextDomRange(element, from, to) {
  if (!element || !element.ownerDocument) return null;
  const start = locateTextPoint(element, from);
  const end = locateTextPoint(element, to);
  const range = element.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch (_error) {
    return null;
  }
}

function editorForSelectionNode(node) {
  const element = node && node.nodeType === 1 ? node : node && node.parentElement;
  return element && element.closest ? element.closest('.bs-block-editor') : null;
}

function offsetInsideEditor(editor, node, nodeOffset) {
  if (!editor || !node || !editor.contains(node)) return 0;
  const range = editor.ownerDocument.createRange();
  range.selectNodeContents(editor);
  try { range.setEnd(node, nodeOffset); } catch (error) { return 0; }
  return range.toString().length;
}

function getLogicalTextSelection(root, page) {
  if (!root || !page || !root.ownerDocument) return null;
  const selection = root.ownerDocument.defaultView.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const startEditor = editorForSelectionNode(range.startContainer);
  const endEditor = editorForSelectionNode(range.endContainer);
  if (!startEditor || !endEditor || !root.contains(startEditor) || !root.contains(endEditor)) return null;
  const startWrapper = startEditor.closest('.bs-block');
  const endWrapper = endEditor.closest('.bs-block');
  const startBlockId = startWrapper && startWrapper.dataset.blockId;
  const endBlockId = endWrapper && endWrapper.dataset.blockId;
  if (!startBlockId || !endBlockId) return null;
  const visible = Core.flattenBlocks(page).filter((block) => block.type !== 'divider' && block.type !== 'table-of-contents');
  const startIndex = visible.findIndex((block) => block.id === startBlockId);
  const endIndex = visible.findIndex((block) => block.id === endBlockId);
  if (startIndex < 0 || endIndex < 0) return null;
  const forward = startIndex <= endIndex;
  const firstEditor = forward ? startEditor : endEditor;
  const lastEditor = forward ? endEditor : startEditor;
  const firstId = forward ? startBlockId : endBlockId;
  const lastId = forward ? endBlockId : startBlockId;
  const firstNode = forward ? range.startContainer : range.endContainer;
  const firstNodeOffset = forward ? range.startOffset : range.endOffset;
  const lastNode = forward ? range.endContainer : range.startContainer;
  const lastNodeOffset = forward ? range.endOffset : range.startOffset;
  const firstIndex = visible.findIndex((block) => block.id === firstId);
  const lastIndex = visible.findIndex((block) => block.id === lastId);
  const startOffset = offsetInsideEditor(firstEditor, firstNode, firstNodeOffset);
  const endOffset = offsetInsideEditor(lastEditor, lastNode, lastNodeOffset);
  const ranges = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    const block = visible[index];
    if (!block || block.type === 'code') return null;
    const from = index === firstIndex ? startOffset : 0;
    const to = index === lastIndex ? endOffset : block.text.length;
    if (to > from) ranges.push({ blockId: block.id, from, to });
  }
  if (!ranges.length) return null;
  return {
    type: ranges.length === 1 ? 'text' : 'cross-block-text',
    ranges,
    startBlockId: firstId,
    startOffset,
    endBlockId: lastId,
    endOffset,
    rect: range.getBoundingClientRect(),
  };
}

function setLogicalTextSelection(view, logicalSelection) {
  if (!view || !view.contentEl || !logicalSelection || !Array.isArray(logicalSelection.ranges) || !logicalSelection.ranges.length) return false;
  const document = view.contentEl.ownerDocument;
  const selection = document.defaultView.getSelection();
  const first = logicalSelection.ranges[0];
  const last = logicalSelection.ranges[logicalSelection.ranges.length - 1];
  const firstEditor = view.contentEl.querySelector(`[data-block-id="${first.blockId}"] .bs-block-editor`);
  const lastEditor = view.contentEl.querySelector(`[data-block-id="${last.blockId}"] .bs-block-editor`);
  if (!firstEditor || !lastEditor) return false;
  const start = locateTextPoint(firstEditor, first.from);
  const end = locateTextPoint(lastEditor, last.to);
  firstEditor.focus({ preventScroll: true });
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function markClasses(mark) {
  if (mark.type === 'textColor') return [`bs-inline-text-${mark.value}`];
  if (mark.type === 'highlight') return [`bs-inline-highlight-${mark.value}`];
  return [`bs-inline-${mark.type}`];
}

function renderInlineContent(editor, block) {
  clearElement(editor);
  const normalized = Core.normalizeBlock(block);
  if (!normalized.text) return;
  if (!normalized.marks.length) {
    editor.appendChild(editor.ownerDocument.createTextNode(normalized.text));
    return;
  }
  const boundaries = new Set([0, normalized.text.length]);
  for (const mark of normalized.marks) {
    boundaries.add(mark.from);
    boundaries.add(mark.to);
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (to <= from) continue;
    const active = normalized.marks.filter((mark) => mark.from <= from && mark.to >= to);
    const text = normalized.text.slice(from, to);
    if (!active.length) {
      editor.appendChild(editor.ownerDocument.createTextNode(text));
      continue;
    }
    const span = editor.ownerDocument.createElement('span');
    span.classList.add('bs-inline-run');
    const types = [];
    for (const mark of active) {
      types.push(mark.type);
      for (const className of markClasses(mark)) span.classList.add(className);
      if (mark.type === 'link') {
        span.dataset.bsHref = mark.value;
        const reference = Core.parseStoredReference(mark.value);
        span.dataset.bsReferenceKind = reference.kind;
        span.dataset.bsReferenceMode = reference.mode || 'link';
        if (reference.kind === 'blockspace-block') span.classList.add('bs-inline-block-reference');
        else if (reference.kind === 'blockspace-page') span.classList.add('bs-inline-page-reference');
        else if (reference.kind === 'obsidian') span.classList.add('bs-inline-obsidian-reference');
        if (reference.mode === 'embed') span.classList.add('is-embed-reference');
        span.title = t("ctrl_cmd_hover_to_preview_ctrl_cmd_click_to_open_5da46b8d");
      } else if (mark.type === 'textColor') span.dataset.bsTextColor = mark.value;
      else if (mark.type === 'highlight') span.dataset.bsHighlight = mark.value;
    }
    span.dataset.bsMarks = types.join(',');
    span.textContent = text;
    editor.appendChild(span);
  }
}

function readInlineContent(editor) {
  let text = '';
  const marks = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      text += node.nodeValue || '';
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node;
    if (element.tagName === 'BR') {
      text += '\n';
      return;
    }
    const blockLike = element !== editor && (element.tagName === 'DIV' || element.tagName === 'P');
    if (blockLike && text && !text.endsWith('\n')) text += '\n';
    const start = text.length;
    for (const child of Array.from(element.childNodes)) walk(child);
    const end = text.length;
    if (end <= start || element === editor) return;
    const types = String(element.dataset.bsMarks || '').split(',').filter(Boolean);
    for (const type of types) {
      const mark = { type, from: start, to: end };
      if (type === 'link') mark.value = element.dataset.bsHref || '';
      else if (type === 'textColor') mark.value = element.dataset.bsTextColor || 'default';
      else if (type === 'highlight') mark.value = element.dataset.bsHighlight || 'default';
      marks.push(mark);
    }
  };
  for (const child of Array.from(editor.childNodes)) walk(child);
  return { text: text.replace(/\u00a0/g, ' '), marks: Core.normalizeInlineMarks(marks, text.length) };
}

function activeMarksForRange(block, from, to) {
  const normalized = Core.normalizeBlock(block);
  return normalized.marks.filter((mark) => mark.from <= from && mark.to >= to);
}

function sanitizeLink(value) {
  const link = String(value || '').trim();
  if (!link) return '';
  if (/^(?:wikilink|wikiembed|blockref|blockembed|blockspace-page|blockspace-block):/i.test(link)) return link.slice(0, 2048);
  const wiki = link.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
  if (wiki) return `wikilink:${wiki[1].trim()}`.slice(0, 2048);
  if (/^(https?:\/\/|mailto:|obsidian:\/\/|blockspace:\/\/|#|\/)/i.test(link)) return link.slice(0, 2048);
  return `https://${link}`.slice(0, 2048);
}

function normalizeSearchText(value) {
  return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function looksLikeStructuredMarkdown(value) {
  const text = Core.normalizeMarkdownLinkWhitespace(String(value || '').replace(/\r\n?/g, '\n'));
  return /(^|\n)(#{1,6}\s+|\s*[-*+]\s+|\s*\d+[.)]\s+|\s*>\s*|\s*```|\s*---\s*$|\s*-\s*\[[ xX]\]\s+)/m.test(text)
    || /<!--\s*blockspace:(?:toc|markdown:start)\s*-->/i.test(text)
    || /!\[\[[^\]]+\]\]|!\[[\s\S]*?\]\([^\n]+?\)/.test(text)
    || /^\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}\s*\|/m.test(text)
    || /\[[^\]\n]+\]\([^\n)]+\)|\[\[[^\]]+\]\]/.test(text)
    || /\*\*[^*\n]+\*\*|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`/.test(text);
}

function fuzzySubsequenceScore(text, query) {
  const source = normalizeSearchText(text);
  const needle = normalizeSearchText(query);
  if (!needle) return 1;
  if (source === needle) return 120;
  if (source.startsWith(needle)) return 90 - Math.min(30, source.length - needle.length);
  const direct = source.indexOf(needle);
  if (direct >= 0) return 70 - Math.min(30, direct);
  let sourceIndex = 0;
  let gaps = 0;
  for (const character of needle) {
    const found = source.indexOf(character, sourceIndex);
    if (found < 0) return -1;
    gaps += found - sourceIndex;
    sourceIndex = found + 1;
  }
  return Math.max(1, 45 - gaps);
}

function scoreSlashCommand(command, query) {
  if (!query) return 1;
  const fields = [command.label, command.type, command.description, ...(command.aliases || []),
    ...(command.searchTerms || [])];
  return Math.max(...fields.map((field) => fuzzySubsequenceScore(field, query)));
}

function rangeMarkState(block, from, to, type) {
  const start = Math.max(0, Math.min(Number(from) || 0, Number(to) || 0));
  const end = Math.max(start, Math.max(Number(from) || 0, Number(to) || 0));
  if (end <= start) return 'inactive';
  const ranges = Core.normalizeBlock(block).marks
    .filter((mark) => mark.type === type && mark.to > start && mark.from < end)
    .map((mark) => [Math.max(start, mark.from), Math.min(end, mark.to)])
    .sort((a, b) => a[0] - b[0]);
  if (!ranges.length) return 'inactive';
  let covered = 0;
  let cursor = start;
  for (const [rangeStart, rangeEnd] of ranges) {
    if (rangeEnd <= cursor) continue;
    if (rangeStart > cursor) break;
    covered += rangeEnd - cursor;
    cursor = rangeEnd;
    if (cursor >= end) break;
  }
  return covered >= end - start ? 'active' : 'mixed';
}

function truncateBlockLabel(block) {
  const value = String(block && block.text || '').replace(/\s+/g, ' ').trim();
  if (!value) return t("empty_block_fb8e593d");
  return value.length > 28 ? `${value.slice(0, 28)}…` : value;
}

async function ensureAdapterFolder(vault, path, locks) {
  const normalized = normalizePath(path);
  const parts = normalized.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const folderPath = current;
    let pending = locks.get(folderPath);
    if (!pending) {
      pending = (async () => {
        const adapter = vault.adapter;
        if (await adapter.exists(folderPath)) return;
        try {
          await adapter.mkdir(folderPath);
        } catch (error) {
          // Hidden folders (for example .blockspace) are not always present in
          // Obsidian's TAbstractFile index even though they exist on disk.
          // Re-check through the adapter before treating mkdir as a failure.
          if (!(await adapter.exists(folderPath))) {
            // Name the path in the message. A bare platform error ("you do not
            // have permission to save") gives no way to tell a locked vault
            // apart from a dot-folder the mobile file layer refuses to create.
            const detail = error && error.message ? error.message : String(error);
            throw new Error(t("could_not_create_folder_0_1_2df7c970", [folderPath, detail]));
          }
        }
      })().finally(() => {
        if (locks.get(folderPath) === pending) locks.delete(folderPath);
      });
      locks.set(folderPath, pending);
    }
    await pending;
  }
}

class ConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ConflictError';
    this.details = details;
  }
}

class BlockspaceStore {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;
    // The data directory is a storage boundary. Capture it for the lifetime of
    // the store so editing the setting cannot split one in-memory workspace
    // across two folders before the plugin is restarted.
    this.dataFolder = normalizePath(settings.dataFolder || DEFAULT_SETTINGS.dataFolder);
    this.workspace = Core.normalizeWorkspace({});
    this.initialized = false;
    this.initPromise = null;
    this.writeQueues = new Map();
    this.folderLocks = new Map();
    this.lastSnapshotAt = new Map();
    this.lastJournalRecovery = { recovered: 0, conflicts: 0, discarded: 0 };
    this.referencePages = new Map();
    this.referenceIndex = Core.buildReferenceIndex([]);
    this.derivedProjectionsPromise = null;
  }

  get folder() {
    return this.dataFolder;
  }

  get pagesFolder() { return normalizePath(`${this.folder}/pages`); }
  get trashFolder() { return normalizePath(`${this.folder}/trash`); }
  get journalFolder() { return normalizePath(`${this.folder}/journal`); }
  get snapshotsFolder() { return normalizePath(`${this.folder}/snapshots`); }
  get recoveryFolder() { return normalizePath(`${this.folder}/recovery`); }
  get workspacePath() { return normalizePath(`${this.folder}/workspace.json`); }
  get bridgeFolder() { return normalizePath(this.settings.markdownBridgeFolder || DEFAULT_SETTINGS.markdownBridgeFolder); }
  get nativeMarkdownFolder() { return normalizePath(this.settings.nativeMarkdownFolder || DEFAULT_SETTINGS.nativeMarkdownFolder); }

  pagePath(id) { return normalizePath(`${this.pagesFolder}/${id}.json`); }
  journalPath(id) { return normalizePath(`${this.journalFolder}/${id}.pending.json`); }

  async ensureFolder(path) {
    await ensureAdapterFolder(this.app.vault, path, this.folderLocks);
  }

  async removePath(path) {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) return;
    if (typeof adapter.remove === 'function') await adapter.remove(path);
    else if (typeof adapter.rmdir === 'function') await adapter.rmdir(path, true);
  }

  async readJson(path, fallback, options = {}) {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path))) return fallback;
    try {
      return JSON.parse(await adapter.read(path));
    } catch (error) {
      console.error('Blockspace: unable to read JSON', path, error);
      if (!options.silent) new Notice(t("blockspace_could_not_read_0_83c08f01", [path]));
      return fallback;
    }
  }

  enqueue(path, task) {
    const previous = this.writeQueues.get(path) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.writeQueues.get(path) === next) this.writeQueues.delete(path);
      });
    this.writeQueues.set(path, next);
    return next;
  }

  atomicWrite(path, text) {
    return this.enqueue(path, async () => {
      const slash = path.lastIndexOf('/');
      if (slash > 0) await this.ensureFolder(path.slice(0, slash));
      const adapter = this.app.vault.adapter;
      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempPath = `${path}.tmp-${token}`;
      const backupPath = `${path}.bak-${token}`;
      let backedUp = false;
      await adapter.write(tempPath, text);
      // Verify serialized JSON before replacing a valid file.
      if (path.endsWith('.json')) JSON.parse(await adapter.read(tempPath));
      try {
        if (await adapter.exists(path)) {
          await adapter.rename(path, backupPath);
          backedUp = true;
        }
        await adapter.rename(tempPath, path);
        if (backedUp) await this.removePath(backupPath);
      } catch (error) {
        try {
          if (await adapter.exists(tempPath)) await this.removePath(tempPath);
          if (backedUp && !(await adapter.exists(path)) && await adapter.exists(backupPath)) {
            await adapter.rename(backupPath, path);
          }
        } catch (rollbackError) {
          console.error('Blockspace: atomic write rollback failed', rollbackError);
        }
        if (error && error.message && !String(error.message).includes(path)) {
          throw new Error(t("could_not_write_0_1_8b53e0ad", [path, error.message]));
        }
        throw error;
      }
    });
  }

  async listFiles(path) {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path)) || typeof adapter.list !== 'function') return [];
    const listed = await adapter.list(path);
    return Array.isArray(listed) ? listed : (listed.files || []);
  }

  async listFilesRecursive(path) {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(path)) || typeof adapter.list !== 'function') return [];
    const result = new Set();
    const visited = new Set();
    const walk = async (folder) => {
      const normalized = normalizePath(folder);
      if (visited.has(normalized)) return;
      visited.add(normalized);
      const listed = await adapter.list(normalized);
      if (Array.isArray(listed)) {
        for (const file of listed) result.add(file);
        return;
      }
      for (const file of listed.files || []) result.add(file);
      for (const child of listed.folders || []) await walk(child);
    };
    await walk(path);
    return Array.from(result);
  }

  async recoverPendingJournals() {
    await this.ensureFolder(this.journalFolder);
    const files = (await this.listFiles(this.journalFolder)).filter((path) => path.endsWith('.pending.json'));
    let recovered = 0;
    let conflicts = 0;
    let discarded = 0;
    for (const path of files) {
      const entry = await this.readJson(path, null, { silent: true });
      if (!entry || !entry.page) {
        const destination = normalizePath(`${this.recoveryFolder}/${Core.safeFileName(path.split('/').pop())}-${Date.now()}.invalid.json`);
        await this.ensureFolder(this.recoveryFolder);
        if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.rename(path, destination);
        continue;
      }
      const pending = Core.normalizePage(entry.page);
      const disk = await this.readJson(this.pagePath(pending.id), null, { silent: true });
      const diskRevision = disk ? Math.max(1, Number(disk.revision) || 1) : 0;
      // Recompute with the current comparable schema. Persisted hashes from an
      // older plugin version may have been produced before optional metadata
      // fields existed and must not create a false recovery conflict.
      const pendingHash = Core.pageContentHash(pending);
      const diskHash = disk ? Core.pageContentHash(disk) : null;
      if (!disk || pending.revision > diskRevision) {
        await this.atomicWrite(this.pagePath(pending.id), `${JSON.stringify(pending, null, 2)}\n`);
        recovered += 1;
      } else if (pendingHash !== diskHash) {
        await this.writeConflict(pending, disk, Number.isFinite(entry.expectedRevision) ? Number(entry.expectedRevision) : null);
        conflicts += 1;
      } else {
        discarded += 1;
      }
      await this.removePath(path);
    }
    this.lastJournalRecovery = { recovered, conflicts, discarded };
    return recovered;
  }

  init() {
    if (this.initialized) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await Promise.all([
          this.ensureFolder(this.pagesFolder),
          this.ensureFolder(this.trashFolder),
          this.ensureFolder(this.journalFolder),
          this.ensureFolder(this.snapshotsFolder),
          this.ensureFolder(this.recoveryFolder),
        ]);
        const recovered = await this.recoverPendingJournals();
        this.workspace = Core.normalizeWorkspace(await this.readJson(this.workspacePath, {}, { silent: true }));
        // Page files are the source of truth. Reconcile the derived index on
        // every startup so a missing/corrupt workspace.json never makes valid
        // pages appear to be lost.
        await this.rebuildWorkspaceIndex();
        if (this.workspace.pages.length === 0) {
          const page = Core.createDefaultPage();
          await this.savePage(page, { saveIndex: false, createSnapshot: false });
          this.workspace.pages = [Core.pageToMeta(page)];
          this.workspace.activePageId = page.id;
          await this.saveWorkspace();
        } else if (recovered > 0) {
          new Notice(t("blockspace_recovered_0_unfinished_saves_6d12cdc0", [recovered]));
        }
        if (this.lastJournalRecovery.conflicts > 0) {
          new Notice(t("blockspace_found_0_recovery_conflicts_copies_wer_d6d86485", [this.lastJournalRecovery.conflicts]));
        }
        await this.rebuildReferenceIndex();
        this.initialized = true;
        // Bridge and native projections are derived artefacts: one atomic write
        // per page, and an atomic write is four to five adapter round trips.
        // Keeping them inside init() meant the workspace could not open until
        // every projection had been rewritten, which is slow enough on mobile
        // to look like the plugin never opens at all.
        this.scheduleDerivedProjections();
      })().catch((error) => {
        this.initialized = false;
        throw error;
      }).finally(() => {
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  // Copies the whole data directory to a new location. iOS and iPadOS restrict
  // dot-prefixed directories much more than desktop does, so `.blockspace` can
  // be unwritable on a vault where ordinary notes save fine; renaming it is the
  // way out. Copy rather than move, and refuse a non-empty target, so a failed
  // migration can never be the thing that loses the pages.
  async migrateDataFolder(nextFolder) {
    const target = normalizePath(String(nextFolder || '').trim());
    const source = this.folder;
    if (!target) throw new Error(t("data_folder_cannot_be_empty_aa5ab19e"));
    if (target === source) return { moved: 0, target, source };
    if (target.startsWith(`${source}/`) || source.startsWith(`${target}/`)) {
      throw new Error(t("the_new_and_existing_data_folders_cannot_contain_28dd7795"));
    }
    await this.init();
    await this.flush();
    if ((await this.listFilesRecursive(target)).length) {
      throw new Error(t("destination_0_is_not_empty_choose_another_folder_0a102a28", [target]));
    }
    const adapter = this.app.vault.adapter;
    const files = await this.listFilesRecursive(source);
    const binary = typeof adapter.readBinary === 'function' && typeof adapter.writeBinary === 'function';
    let moved = 0;
    for (const file of files) {
      const relative = normalizePath(file).slice(source.length + 1);
      if (!relative) continue;
      const destination = normalizePath(`${target}/${relative}`);
      const slash = destination.lastIndexOf('/');
      if (slash > 0) await ensureAdapterFolder(this.app.vault, destination.slice(0, slash), this.folderLocks);
      if (binary) await adapter.writeBinary(destination, await adapter.readBinary(file));
      else await adapter.write(destination, await adapter.read(file));
      moved += 1;
    }
    return { moved, target, source };
  }

  // Runs the derived Markdown projections outside the startup path. A failure
  // here must never keep the workspace closed: the projections are rebuildable
  // from `.blockspace/pages/*.json`, which stays the source of truth.
  scheduleDerivedProjections() {
    if (this.derivedProjectionsPromise) return this.derivedProjectionsPromise;
    this.derivedProjectionsPromise = (async () => {
      try {
        if (this.settings.markdownBridgeEnabled) await this.syncMarkdownBridge();
        if (this.settings.nativeMarkdownSyncEnabled) await this.syncNativeMarkdown();
      } catch (error) {
        console.error('Blockspace: unable to refresh derived Markdown projections', error);
      }
    })().finally(() => { this.derivedProjectionsPromise = null; });
    return this.derivedProjectionsPromise;
  }

  // Test and diagnostics hook: resolves once any in-flight projection pass has
  // settled, so callers can observe the Bridge files init() no longer awaits.
  whenProjectionsSettled() {
    return this.derivedProjectionsPromise || Promise.resolve();
  }

  async saveWorkspace() {
    this.workspace = Core.normalizeWorkspace(this.workspace);
    await this.atomicWrite(this.workspacePath, `${JSON.stringify(this.workspace, null, 2)}\n`);
  }

  async loadPage(id) {
    await this.init();
    const raw = await this.readJson(this.pagePath(id), null);
    if (!raw) return null;
    return Core.normalizePage(raw);
  }

  async rebuildReferenceIndex() {
    const pages = [];
    for (const meta of this.workspace.pages) {
      const raw = await this.readJson(this.pagePath(meta.id), null, { silent: true });
      if (raw) pages.push(Core.normalizePage(raw));
    }
    this.referencePages = new Map(pages.map((page) => [page.id, page]));
    this.referenceIndex = Core.buildReferenceIndex(pages);
    return this.referenceIndex;
  }

  updateReferencePage(page) {
    const normalized = Core.normalizePage(page);
    this.referencePages.set(normalized.id, normalized);
    this.referenceIndex = Core.buildReferenceIndex(this.referencePages.values());
    return this.referenceIndex;
  }

  removeReferencePage(pageId) {
    this.referencePages.delete(pageId);
    this.referenceIndex = Core.buildReferenceIndex(this.referencePages.values());
  }

  resolveStoredReference(value, sourcePageId = null) {
    return Core.resolveStoredReference(value, this.referenceIndex, sourcePageId);
  }

  getBacklinksForPage(pageId) {
    return Array.from(this.referenceIndex.byPage.get(pageId) || []);
  }

  getBacklinksForBlock(blockId) {
    return Array.from(this.referenceIndex.byBlock.get(blockId) || []);
  }

  getReferencePreview(value, sourcePageId = null) {
    const resolved = this.resolveStoredReference(value, sourcePageId);
    if (!resolved || (resolved.kind !== 'blockspace-page' && resolved.kind !== 'blockspace-block')) return null;
    const page = resolved.page || this.referencePages.get(resolved.pageId);
    if (!page) return null;
    const block = resolved.block || (resolved.blockId ? Core.getBlock(page, resolved.blockId) : null);
    const children = block
      ? block.children.map((id) => Core.getBlock(page, id)).filter(Boolean).slice(0, 4)
      : page.rootBlockIds.map((id) => Core.getBlock(page, id)).filter(Boolean).slice(0, 4);
    return {
      kind: resolved.kind,
      mode: resolved.mode || 'link',
      pageId: page.id,
      pageTitle: page.title,
      pageIcon: page.icon,
      blockId: block && block.id || null,
      blockText: block && block.text || '',
      blockType: block && block.type || null,
      children: children.map((child) => ({ id: child.id, text: child.text, type: child.type })),
      backlinkCount: block
        ? this.getBacklinksForBlock(block.id).length
        : this.getBacklinksForPage(page.id).length,
    };
  }

  get markdownBlockIdMode() {
    return MARKDOWN_BLOCK_ID_MODES[this.settings.markdownBlockIdMode]
      ? this.settings.markdownBlockIdMode
      : DEFAULT_SETTINGS.markdownBlockIdMode;
  }

  markdownBlockAnchor(block) {
    if (!block || this.markdownBlockIdMode === 'none' || !MARKDOWN_ANCHORABLE_BLOCK_TYPES.has(block.type)) return '';
    if (this.markdownBlockIdMode === 'referenced') {
      const incoming = this.referenceIndex.byBlock.get(block.id);
      if (!incoming || incoming.length === 0) return '';
    }
    return Core.obsidianBlockAnchor(block.id);
  }

  markdownReferenceSubpath(resolved) {
    if (!resolved || resolved.kind !== 'blockspace-block' || !resolved.block) return '';
    const anchor = this.markdownBlockAnchor(resolved.block);
    if (anchor) return `#^${anchor}`;
    if (Core.isHeadingBlock(resolved.block)) {
      const heading = String(resolved.block.text || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
      return heading ? `#${heading}` : '';
    }
    return '';
  }

  bridgePathForPage(page) {
    const normalized = Core.normalizePage(page);
    const shortId = Core.hashString(normalized.id);
    return normalizePath(`${this.bridgeFolder}/${Core.safeFileName(normalized.title)}~${shortId}.md`);
  }

  bridgeLinkForReference(reference, sourcePageId, plain) {
    const resolved = Core.resolveStoredReference(reference, this.referenceIndex, sourcePageId);
    if (!resolved || (resolved.kind !== 'blockspace-page' && resolved.kind !== 'blockspace-block')) return null;
    const targetPath = this.workspace.bridgePaths && this.workspace.bridgePaths[resolved.pageId];
    if (!targetPath) return null;
    const destination = targetPath.replace(/\.md$/i, '') + this.markdownReferenceSubpath(resolved);
    const label = String(plain || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
    const embed = reference.mode === 'embed';
    return `${embed ? '!' : ''}[[${destination}|${label}]]`;
  }

  bridgeMarkdownForPage(page) {
    const normalized = Core.normalizePage(page);
    const bridgeTags = Array.from(new Set(['blockspace-bridge', ...normalized.properties.tags]));
    const frontmatter = [
      '---',
      `blockspace-id: ${JSON.stringify(normalized.id)}`,
      `blockspace-revision: ${normalized.revision}`,
      'blockspace-projection: bridge',
      `status: ${JSON.stringify(normalized.properties.status)}`,
      `priority: ${JSON.stringify(normalized.properties.priority)}`,
      `tags: [${bridgeTags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
      ...extraPropertyFrontmatter(normalized.properties),
      `aliases: [${JSON.stringify(normalized.title)}]`,
      '---',
      '',
      '<!-- Generated by Blockspace. Edit the source page, not this bridge file. -->',
      '',
    ].join('\n');
    const body = Core.blocksToMarkdown(normalized, normalized.title, {
      blockAnchor: (block) => this.markdownBlockAnchor(block),
      linkResolver: ({ plain, reference }) => this.bridgeLinkForReference(reference, normalized.id, plain),
    });
    return `${frontmatter}${body}`;
  }

  async writeGeneratedMarkdownFile(path, content) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) await this.ensureFolder(path.slice(0, slash));
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const current = await this.app.vault.cachedRead(existing);
      if (current !== content) await this.app.vault.modify(existing, content);
      return existing;
    }
    if (await this.app.vault.adapter.exists(path)) {
      const current = await this.app.vault.adapter.read(path);
      if (current !== content) await this.atomicWrite(path, content);
      return null;
    }
    return this.app.vault.create(path, content);
  }

  writeBridgeFile(path, content) {
    return this.writeGeneratedMarkdownFile(path, content);
  }

  async syncMarkdownBridgePage(page, options = {}) {
    if (!this.settings.markdownBridgeEnabled) return null;
    const normalized = Core.normalizePage(page);
    await this.ensureFolder(this.bridgeFolder);
    if (!this.workspace.bridgePaths || typeof this.workspace.bridgePaths !== 'object') this.workspace.bridgePaths = {};
    const desiredPath = this.bridgePathForPage(normalized);
    const previousPath = options.previousPath === undefined ? this.workspace.bridgePaths[normalized.id] : options.previousPath;
    if (previousPath && previousPath !== desiredPath && await this.app.vault.adapter.exists(previousPath)) {
      const previousFile = this.app.vault.getAbstractFileByPath(previousPath);
      if (previousFile instanceof TFile) await this.app.vault.rename(previousFile, desiredPath);
      else await this.app.vault.adapter.rename(previousPath, desiredPath);
    }
    this.workspace.bridgePaths[normalized.id] = desiredPath;
    if (options.saveWorkspace !== false && previousPath !== desiredPath) await this.saveWorkspace();
    await this.writeBridgeFile(desiredPath, this.bridgeMarkdownForPage(normalized));
    return desiredPath;
  }

  async syncMarkdownBridge() {
    if (!this.settings.markdownBridgeEnabled) return 0;
    await this.ensureFolder(this.bridgeFolder);
    if (!this.workspace.bridgePaths || typeof this.workspace.bridgePaths !== 'object') this.workspace.bridgePaths = {};
    const previousPaths = { ...this.workspace.bridgePaths };
    const activeIds = new Set(this.referencePages.keys());
    this.workspace.bridgePaths = {};
    for (const page of this.referencePages.values()) {
      this.workspace.bridgePaths[page.id] = this.bridgePathForPage(page);
    }
    await this.saveWorkspace();
    for (const page of this.referencePages.values()) {
      await this.syncMarkdownBridgePage(page, { saveWorkspace: false, previousPath: previousPaths[page.id] });
    }
    for (const [pageId, path] of Object.entries(previousPaths)) {
      if (activeIds.has(pageId) || !await this.app.vault.adapter.exists(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.vault.delete(file);
      else await this.removePath(path);
    }
    return this.referencePages.size;
  }

  nativeMarkdownPathForPage(page) {
    const normalized = Core.normalizePage(page);
    const shortId = Core.hashString(normalized.id);
    return normalizePath(`${this.nativeMarkdownFolder}/${Core.safeFileName(normalized.title)}~${shortId}.md`);
  }

  nativeMarkdownLinkForReference(reference, sourcePageId, plain) {
    const resolved = Core.resolveStoredReference(reference, this.referenceIndex, sourcePageId);
    if (!resolved || (resolved.kind !== 'blockspace-page' && resolved.kind !== 'blockspace-block')) return null;
    const page = resolved.page || this.referencePages.get(resolved.pageId);
    const targetPath = this.workspace.nativeMarkdownPaths && this.workspace.nativeMarkdownPaths[resolved.pageId]
      || (page ? this.nativeMarkdownPathForPage(page) : null);
    if (!targetPath) return null;
    const destination = targetPath.replace(/\.md$/i, '') + this.markdownReferenceSubpath(resolved);
    const label = String(plain || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
    return `${reference.mode === 'embed' ? '!' : ''}[[${destination}|${label}]]`;
  }

  nativeMarkdownForPage(page, options = {}) {
    const normalized = Core.normalizePage(page);
    const frontmatter = [
      '---',
      `blockspace-id: ${JSON.stringify(normalized.id)}`,
      `blockspace-revision: ${normalized.revision}`,
      ...(options.projection === false ? [] : ['blockspace-projection: native']),
      `status: ${normalized.properties.status}`,
      `priority: ${normalized.properties.priority}`,
      normalized.properties.tags.length
        ? `tags: [${normalized.properties.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`
        : 'tags: []',
      ...extraPropertyFrontmatter(normalized.properties),
      `aliases: [${JSON.stringify(normalized.title)}]`,
      '---',
      '',
    ].join('\n');
    const body = Core.blocksToMarkdown(normalized, normalized.title, {
      profile: 'obsidian-native',
      blockAnchor: (block) => this.markdownBlockAnchor(block),
      linkResolver: ({ plain, reference }) => this.nativeMarkdownLinkForReference(reference, normalized.id, plain),
    });
    return `${frontmatter}${body}`;
  }

  async syncNativeMarkdownPage(page, options = {}) {
    if (!this.settings.nativeMarkdownSyncEnabled) return null;
    const normalized = Core.normalizePage(page);
    await this.ensureFolder(this.nativeMarkdownFolder);
    if (!this.workspace.nativeMarkdownPaths || typeof this.workspace.nativeMarkdownPaths !== 'object') {
      this.workspace.nativeMarkdownPaths = {};
    }
    const desiredPath = this.nativeMarkdownPathForPage(normalized);
    const previousPath = options.previousPath === undefined
      ? this.workspace.nativeMarkdownPaths[normalized.id]
      : options.previousPath;
    if (previousPath && previousPath !== desiredPath && await this.app.vault.adapter.exists(previousPath)) {
      const previousFile = this.app.vault.getAbstractFileByPath(previousPath);
      if (previousFile instanceof TFile) await this.app.vault.rename(previousFile, desiredPath);
      else await this.app.vault.adapter.rename(previousPath, desiredPath);
    }
    this.workspace.nativeMarkdownPaths[normalized.id] = desiredPath;
    if (options.saveWorkspace !== false && previousPath !== desiredPath) await this.saveWorkspace();
    await this.writeGeneratedMarkdownFile(desiredPath, this.nativeMarkdownForPage(normalized));
    return desiredPath;
  }

  async syncNativeMarkdown() {
    if (!this.settings.nativeMarkdownSyncEnabled) return 0;
    await this.ensureFolder(this.nativeMarkdownFolder);
    if (!this.workspace.nativeMarkdownPaths || typeof this.workspace.nativeMarkdownPaths !== 'object') {
      this.workspace.nativeMarkdownPaths = {};
    }
    const previousPaths = { ...this.workspace.nativeMarkdownPaths };
    const activeIds = new Set(this.referencePages.keys());
    this.workspace.nativeMarkdownPaths = {};
    for (const page of this.referencePages.values()) {
      this.workspace.nativeMarkdownPaths[page.id] = this.nativeMarkdownPathForPage(page);
    }
    await this.saveWorkspace();
    for (const page of this.referencePages.values()) {
      await this.syncNativeMarkdownPage(page, { saveWorkspace: false, previousPath: previousPaths[page.id] });
    }
    for (const [pageId, path] of Object.entries(previousPaths)) {
      if (activeIds.has(pageId) || !await this.app.vault.adapter.exists(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.vault.delete(file);
      else await this.removePath(path);
    }
    return this.referencePages.size;
  }

  async createSnapshot(page) {
    const normalized = Core.normalizePage(page);
    const folder = normalizePath(`${this.snapshotsFolder}/${normalized.id}`);
    await this.ensureFolder(folder);
    const path = normalizePath(`${folder}/r${normalized.revision}-${Date.now()}.json`);
    await this.atomicWrite(path, `${JSON.stringify(normalized, null, 2)}\n`);
    const files = (await this.listFiles(folder)).filter((item) => item.endsWith('.json')).sort((a, b) => {
      const aTime = Number((a.match(/-(\d+)\.json$/) || [])[1]) || 0;
      const bTime = Number((b.match(/-(\d+)\.json$/) || [])[1]) || 0;
      return aTime - bTime;
    });
    const limit = Math.max(1, Math.min(100, Number(this.settings.snapshotLimit) || 12));
    for (const stale of files.slice(0, Math.max(0, files.length - limit))) await this.removePath(stale);
  }

  async writeConflict(page, diskPage, expectedRevision) {
    await this.ensureFolder(this.recoveryFolder);
    const path = normalizePath(`${this.recoveryFolder}/${page.id}-conflict-${Date.now()}.json`);
    const payload = {
      type: 'revision-conflict',
      createdAt: Core.nowIso(),
      expectedRevision,
      diskPage: diskPage ? Core.normalizePage(diskPage) : null,
      localPage: Core.normalizePage(page),
    };
    await this.atomicWrite(path, `${JSON.stringify(payload, null, 2)}\n`);
    return path;
  }

  async savePage(page, options = {}) {
    const opts = typeof options === 'boolean' ? { saveIndex: options } : options;
    const saveIndex = opts.saveIndex !== false;
    const createSnapshot = opts.createSnapshot !== false;
    const expectedRevision = Number.isFinite(opts.expectedRevision) ? Number(opts.expectedRevision) : null;
    let normalized = Core.normalizePage(page);
    if (expectedRevision !== null && normalized.revision <= expectedRevision) {
      normalized.revision = expectedRevision + 1;
      normalized.updatedAt = Core.nowIso();
    }
    const issues = Core.validatePage(normalized);
    if (issues.length) throw new Error(t("page_integrity_check_failed_0_428e82a8", [issues.join('；')]));
    await this.ensureFolder(this.pagesFolder);
    const target = this.pagePath(normalized.id);
    const disk = await this.readJson(target, null, { silent: true });
    if (expectedRevision !== null && (!disk || Number(disk.revision) !== expectedRevision)) {
      const conflictPath = await this.writeConflict(normalized, disk, expectedRevision);
      throw new ConflictError(disk ? t("page_was_modified_in_another_window_or_on_anothe_be39d8f6") : t("page_file_was_deleted_or_could_not_be_read_81612ac0"), {
        expectedRevision,
        actualRevision: disk ? (Number(disk.revision) || 1) : null,
        conflictPath,
      });
    }
    const journal = {
      formatVersion: Core.DATA_VERSION,
      page: normalized,
      expectedRevision,
      contentHash: Core.pageContentHash(normalized),
      createdAt: Core.nowIso(),
    };
    await this.atomicWrite(this.journalPath(normalized.id), `${JSON.stringify(journal, null, 2)}\n`);
    if (createSnapshot && disk) {
      const interval = Math.max(1, Number(this.settings.snapshotIntervalMinutes) || 5) * 60 * 1000;
      const last = this.lastSnapshotAt.get(normalized.id) || 0;
      if (opts.forceSnapshot || Date.now() - last >= interval) {
        await this.createSnapshot(disk);
        this.lastSnapshotAt.set(normalized.id, Date.now());
      }
    }
    await this.atomicWrite(target, `${JSON.stringify(normalized, null, 2)}\n`);
    await this.removePath(this.journalPath(normalized.id));
    this.updateReferencePage(normalized);
    if (saveIndex) {
      const meta = Core.pageToMeta(normalized);
      const index = this.workspace.pages.findIndex((item) => item.id === meta.id);
      if (index >= 0) this.workspace.pages[index] = meta;
      else this.workspace.pages.push(meta);
      this.workspace.activePageId = normalized.id;
      await this.saveWorkspace();
    }
    if (this.initialized && this.settings.markdownBridgeEnabled) await this.syncMarkdownBridgePage(normalized);
    if (this.initialized && this.settings.nativeMarkdownSyncEnabled) await this.syncNativeMarkdownPage(normalized);
    return normalized;
  }

  async createPage(title = t('untitled'), extras = {}) {
    const page = Core.createDefaultPage(title);
    page.icon = extras.icon || '📄';
    page.cover = extras.cover || 'none';
    page.parentId = extras.parentId || null;
    page.properties.status = Core.PAGE_STATUSES.includes(extras.status) ? extras.status : 'todo';
    const initialBlock = Core.createBlock('paragraph', '');
    page.blocks = [initialBlock];
    page.rootBlockIds = [initialBlock.id];
    await this.savePage(page, { expectedRevision: null, createSnapshot: false });
    return page;
  }

  async deletePage(id) {
    const sourcePath = this.pagePath(id);
    const deletedPage = await this.readJson(sourcePath, null, { silent: true });
    let trashPath = null;
    let replacementPageId = null;
    if (await this.app.vault.adapter.exists(sourcePath)) {
      await this.ensureFolder(this.trashFolder);
      trashPath = normalizePath(`${this.trashFolder}/${id}-${Date.now()}.json`);
      await this.app.vault.adapter.rename(sourcePath, trashPath);
    }
    await this.removePath(this.journalPath(id));
    const bridgePath = this.workspace.bridgePaths && this.workspace.bridgePaths[id];
    if (bridgePath && await this.app.vault.adapter.exists(bridgePath)) {
      const bridgeFile = this.app.vault.getAbstractFileByPath(bridgePath);
      if (bridgeFile instanceof TFile) await this.app.vault.delete(bridgeFile);
      else await this.removePath(bridgePath);
    }
    if (this.workspace.bridgePaths) delete this.workspace.bridgePaths[id];
    const nativeMarkdownPath = this.workspace.nativeMarkdownPaths && this.workspace.nativeMarkdownPaths[id];
    if (nativeMarkdownPath && await this.app.vault.adapter.exists(nativeMarkdownPath)) {
      const nativeMarkdownFile = this.app.vault.getAbstractFileByPath(nativeMarkdownPath);
      if (nativeMarkdownFile instanceof TFile) await this.app.vault.delete(nativeMarkdownFile);
      else await this.removePath(nativeMarkdownPath);
    }
    if (this.workspace.nativeMarkdownPaths) delete this.workspace.nativeMarkdownPaths[id];
    this.removeReferencePage(id);
    this.workspace.pages = this.workspace.pages.filter((page) => page.id !== id);
    if (this.workspace.activePageId === id) {
      this.workspace.activePageId = this.workspace.pages[0] ? this.workspace.pages[0].id : null;
    }
    if (this.workspace.pages.length === 0) {
      const page = await this.createPage(t('untitled'));
      this.workspace.activePageId = page.id;
      replacementPageId = page.id;
    } else {
      await this.saveWorkspace();
    }
    return {
      pageId: id,
      page: deletedPage ? Core.normalizePage(deletedPage) : null,
      trashPath,
      replacementPageId,
      deletedAt: Core.nowIso(),
    };
  }

  async restoreDeletedPage(deletion, options = {}) {
    if (!deletion || !deletion.pageId) return null;
    let page = deletion.page ? Core.normalizePage(deletion.page) : null;
    if (!page && deletion.trashPath) {
      const raw = await this.readJson(deletion.trashPath, null, { silent: true });
      if (raw) page = Core.normalizePage(raw);
    }
    if (!page) return null;
    if (deletion.replacementPageId && this.workspace.pages.length === 1 && this.workspace.pages[0].id === deletion.replacementPageId) {
      const replacementPath = this.pagePath(deletion.replacementPageId);
      const replacementRaw = await this.readJson(replacementPath, null, { silent: true });
      const replacement = replacementRaw ? Core.normalizePage(replacementRaw) : null;
      const isPristineReplacement = replacement
        && replacement.title === t('untitled')
        && replacement.blocks.every((block) => !String(block.text || '').trim());
      if (isPristineReplacement) {
        await this.removePath(replacementPath);
        this.workspace.pages = [];
      }
    }
    const target = this.pagePath(page.id);
    if (await this.app.vault.adapter.exists(target)) {
      return this.restorePageAsCopy(page, t("restored_deletion_3313c5d6"));
    }
    await this.atomicWrite(target, `${JSON.stringify(page, null, 2)}\n`);
    if (deletion.trashPath) await this.removePath(deletion.trashPath);
    const meta = Core.pageToMeta(page);
    const index = this.workspace.pages.findIndex((item) => item.id === page.id);
    if (index >= 0) this.workspace.pages[index] = meta;
    else this.workspace.pages.push(meta);
    if (options.activate !== false) this.workspace.activePageId = page.id;
    await this.saveWorkspace();
    return page;
  }

  async rebuildWorkspaceIndex() {
    await this.ensureFolder(this.pagesFolder);
    const files = (await this.listFiles(this.pagesFolder)).filter((path) => path.endsWith('.json'));
    const pages = [];
    for (const path of files) {
      const raw = await this.readJson(path, null, { silent: true });
      if (!raw) continue;
      const normalized = Core.normalizePage(raw);
      if (Core.validatePage(normalized).length === 0) pages.push(Core.pageToMeta(normalized));
    }
    this.workspace.pages = Core.sortPageMetas(pages);
    if (!this.workspace.pages.some((page) => page.id === this.workspace.activePageId)) {
      this.workspace.activePageId = this.workspace.pages[0] ? this.workspace.pages[0].id : null;
    }
    await this.saveWorkspace();
    return this.workspace.pages.length;
  }

  fileTimestamp(path) {
    const matches = String(path || '').match(/(\d{10,})/g);
    return matches && matches.length ? Number(matches[matches.length - 1]) || 0 : 0;
  }

  async restorePageAsCopy(page, suffix) {
    const timestamp = Core.nowIso();
    const restored = Core.normalizePage({
      ...Core.deepClone(page),
      id: Core.randomId('page'),
      title: `${Core.normalizePage(page).title}${suffix}`,
      parentId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
    });
    return this.savePage(restored, { expectedRevision: null, createSnapshot: false });
  }

  async restoreLatestFromFiles(files, extractPage, suffix) {
    const candidates = Array.from(files || [])
      .filter((path) => path.endsWith('.json'))
      .sort((a, b) => this.fileTimestamp(b) - this.fileTimestamp(a));
    for (const path of candidates) {
      const payload = await this.readJson(path, null, { silent: true });
      const page = payload && extractPage(payload);
      if (!page || typeof page !== 'object') continue;
      return this.restorePageAsCopy(page, suffix);
    }
    return null;
  }

  async restoreLatestTrash() {
    return this.restoreLatestFromFiles(await this.listFilesRecursive(this.trashFolder), (payload) => payload, t("restored_from_trash_1765a56b"));
  }

  async restoreLatestSnapshot(pageId) {
    if (!pageId) return null;
    const folder = normalizePath(`${this.snapshotsFolder}/${pageId}`);
    return this.restoreLatestFromFiles(await this.listFilesRecursive(folder), (payload) => payload, t("restored_snapshot_9b55d283"));
  }

  async restoreLatestConflict() {
    return this.restoreLatestFromFiles(
      await this.listFilesRecursive(this.recoveryFolder),
      (payload) => payload.localPage || (payload.page && payload.page.id ? payload.page : null),
      t("restored_conflict_6f42f843"),
    );
  }

  async restoreConflictFile(path) {
    if (!path) return null;
    const payload = await this.readJson(path, null, { silent: true });
    const page = payload && (payload.localPage || (payload.page && payload.page.id ? payload.page : null));
    return page ? this.restorePageAsCopy(page, t("restored_conflict_6f42f843")) : null;
  }

  async diagnose() {
    await this.init();
    const report = {
      checkedAt: Core.nowIso(),
      pages: 0,
      errors: [],
      warnings: [],
      pendingJournals: 0,
      snapshots: 0,
      recoveryFiles: 0,
      trashFiles: 0,
      orphanPages: 0,
      missingIndexedPages: 0,
    };
    const journals = await this.listFiles(this.journalFolder);
    report.pendingJournals = journals.filter((path) => path.endsWith('.pending.json')).length;
    if (report.pendingJournals) report.warnings.push(t("0_recovery_journals_are_pending_347fcae6", [report.pendingJournals]));
    for (const meta of this.workspace.pages) {
      const raw = await this.readJson(this.pagePath(meta.id), null, { silent: true });
      if (!raw) {
        report.errors.push(t("missing_page_file_0_1_d796e87b", [meta.title, meta.id]));
        continue;
      }
      report.pages += 1;
      const issues = Core.validatePage(raw);
      for (const issue of issues) report.errors.push(`${meta.title}：${issue}`);
      if (Number(raw.formatVersion || raw.version || 1) < Core.DATA_VERSION) {
        report.warnings.push(t("0_uses_an_older_data_format_and_will_be_upgraded_8873621b", [meta.title]));
      }
    }
    const pageFiles = (await this.listFiles(this.pagesFolder)).filter((path) => path.endsWith('.json'));
    const indexedIds = new Set(this.workspace.pages.map((page) => page.id));
    const diskIds = new Set(pageFiles.map((path) => path.split('/').pop().replace(/\.json$/, '')));
    report.orphanPages = Array.from(diskIds).filter((id) => !indexedIds.has(id)).length;
    report.missingIndexedPages = Array.from(indexedIds).filter((id) => !diskIds.has(id)).length;
    if (report.orphanPages) report.warnings.push(t("0_page_files_have_not_been_indexed_a9843e3a", [report.orphanPages]));
    report.snapshots = (await this.listFilesRecursive(this.snapshotsFolder)).filter((path) => path.endsWith('.json')).length;
    report.recoveryFiles = (await this.listFilesRecursive(this.recoveryFolder)).filter((path) => path.endsWith('.json')).length;
    report.trashFiles = (await this.listFilesRecursive(this.trashFolder)).filter((path) => path.endsWith('.json')).length;
    return report;
  }

  async flush() {
    await Promise.all(Array.from(this.writeQueues.values()).map((promise) => promise.catch(() => undefined)));
  }
}

class MarkdownImportModal extends FuzzySuggestModal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder(t("select_a_markdown_file_to_import_bc13aba8"));
  }

  getItems() {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    void this.plugin.importMarkdownFile(file);
  }
}

class BlockspaceQuickSwitcherModal extends FuzzySuggestModal {
  constructor(app, plugin, view) {
    super(app);
    this.plugin = plugin;
    this.view = view;
    this.setPlaceholder(t("search_pages_or_run_an_action_09c4a5ff"));
  }

  getItems() {
    const actions = [
      { kind: 'action', id: 'new-page', label: t("new_page_64451e31"), hint: t("create_a_blank_page_64d6fbd9") },
      { kind: 'action', id: 'document', label: t("switch_to_document_544b0667"), hint: t("open_the_current_page_body_f8d61d62") },
      { kind: 'action', id: 'board', label: t("switch_to_board_1a13ad24"), hint: t("view_all_pages_by_status_d4b112ee") },
      { kind: 'action', id: 'focus', label: t("toggle_focus_mode_fcf200c4"), hint: t("focus_on_editing_the_current_page_1beb0f01") },
      { kind: 'action', id: 'inspector', label: t("open_page_inspector_50425586"), hint: t("view_properties_outline_and_statistics_in_obsidi_926e298a") },
      { kind: 'action', id: 'import', label: t("import_markdown_fb4d8201"), hint: t("create_a_page_from_an_existing_note_8e22efc6") },
      { kind: 'action', id: 'diagnostics', label: t("diagnostics_and_recovery_18b77e4a"), hint: t("check_structured_data_382441d9") },
    ];
    const pages = Core.sortPageMetas(this.plugin.store.workspace.pages).map((page) => {
      const fullPage = this.view.page && this.view.page.id === page.id
        ? this.view.page
        : this.plugin.store.referencePages.get(page.id);
      return {
        kind: 'page',
        page,
        searchText: Core.pageSearchText(fullPage || page),
      };
    });
    return actions.concat(pages);
  }

  getItemText(suggestion) {
    const item = suggestion && suggestion.item ? suggestion.item : suggestion;
    if (item.kind === 'page') return `${item.page.title} ${item.page.icon || ''} ${STATUS_LABELS[item.page.status] || ''} ${item.searchText || ''}`;
    return `${item.label} ${item.hint}`;
  }

  renderSuggestion(suggestion, element) {
    const item = suggestion && suggestion.item ? suggestion.item : suggestion;
    element.addClass('bs-switcher-suggestion');
    if (item.kind === 'page') {
      element.createSpan({ cls: 'bs-switcher-icon', text: item.page.icon || '📄' });
      const body = element.createSpan({ cls: 'bs-switcher-body' });
      body.createSpan({ cls: 'bs-switcher-title', text: item.page.title });
      body.createSpan({ cls: 'bs-switcher-hint', text: `${STATUS_LABELS[item.page.status] || t("page_452c7b10")} · ${new Date(item.page.updatedAt).toLocaleDateString()}` });
      return;
    }
    const icon = element.createSpan({ cls: 'bs-switcher-icon is-action' });
    setIcon(icon, item.id === 'new-page' ? 'square-plus' : item.id === 'board' ? 'columns-3' : item.id === 'diagnostics' ? 'stethoscope' : item.id === 'import' ? 'file-input' : item.id === 'focus' ? 'maximize-2' : item.id === 'inspector' ? 'panel-right' : 'file-text');
    const body = element.createSpan({ cls: 'bs-switcher-body' });
    body.createSpan({ cls: 'bs-switcher-title', text: item.label });
    body.createSpan({ cls: 'bs-switcher-hint', text: item.hint });
  }

  onChooseItem(suggestion) {
    const item = suggestion && suggestion.item ? suggestion.item : suggestion;
    if (item.kind === 'page') {
      void this.view.openPage(item.page.id);
      return;
    }
    if (item.id === 'new-page') void this.view.createPage();
    else if (item.id === 'document') this.view.switchTab('document');
    else if (item.id === 'board') this.view.switchTab('board');
    else if (item.id === 'focus') this.view.toggleFocusMode();
    else if (item.id === 'import') void this.plugin.importActiveMarkdown();
    else if (item.id === 'inspector') void this.plugin.activateInspector();
    else if (item.id === 'diagnostics') new BlockspaceDiagnosticsModal(this.app, this.plugin).open();
  }
}

class LinkInputModal extends Modal {
  constructor(app, initialValue, onSubmit) {
    super(app);
    this.initialValue = initialValue || '';
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('bs-style-modal');
    contentEl.createEl('h2', { text: t("add_link_d6ff3cba") });
    contentEl.createDiv({ cls: 'bs-style-modal-description', text: t("enter_a_web_address_obsidian_uri_anchor_or_page__46d259a0") });
    const input = contentEl.createEl('input', { cls: 'bs-style-link-input', attr: { type: 'text', placeholder: t("https_example_com_or_page_name_b7ccf264") } });
    input.value = this.initialValue;
    const actions = contentEl.createDiv({ cls: 'bs-style-modal-actions' });
    const cancel = createButton(actions, '', t("cancel_2cd0f3be"), 'x', t("cancel_2cd0f3be"));
    cancel.addEventListener('click', () => this.close());
    const apply = createButton(actions, 'mod-cta', t("apply_link_213f5505"), 'link', t("apply_63c73c47"));
    const submit = () => {
      const value = sanitizeLink(input.value);
      if (!value) {
        new Notice(t("enter_a_valid_link_d03dd582"));
        return;
      }
      this.onSubmit(value);
      this.close();
    };
    apply.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    input.focus();
    input.select();
  }

  onClose() { clearElement(this.contentEl); }
}

class PageIconModal extends Modal {
  constructor(app, initialValue, onSubmit) {
    super(app);
    this.initialValue = initialValue || '';
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('bs-style-modal');
    contentEl.createEl('h2', { text: t("custom_page_icon_b1a9904e") });
    contentEl.createDiv({ cls: 'bs-style-modal-description', text: t("paste_an_emoji_or_character_to_use_as_the_page_i_09986e1c") });
    const input = contentEl.createEl('input', { cls: 'bs-style-link-input', attr: { type: 'text', placeholder: t("for_example_d97fd418"), maxlength: '8' } });
    input.value = this.initialValue;
    const actions = contentEl.createDiv({ cls: 'bs-style-modal-actions' });
    const cancel = createButton(actions, '', t("cancel_2cd0f3be"), 'x', t("cancel_2cd0f3be"));
    cancel.addEventListener('click', () => this.close());
    const apply = createButton(actions, 'mod-cta', t("apply_icon_c96905bc"), 'check', t("apply_63c73c47"));
    const submit = () => {
      this.onSubmit(String(input.value || '').trim().slice(0, 8));
      this.close();
    };
    apply.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    input.focus();
    input.select();
  }

  onClose() { clearElement(this.contentEl); }
}

class BlockAppearanceModal extends Modal {
  constructor(app, view, blockIds) {
    super(app);
    this.view = view;
    this.blockIds = Array.isArray(blockIds) ? blockIds.filter(Boolean) : [blockIds].filter(Boolean);
  }

  onOpen() {
    const { contentEl } = this;
    const block = this.view.page && this.view.page.blocks.find((candidate) => candidate.id === this.blockIds[0]);
    if (!block) {
      this.close();
      return;
    }
    this.appearance = Core.normalizeBlockAppearance(block.appearance);
    contentEl.addClass('bs-style-modal');
    contentEl.createEl('h2', { text: this.blockIds.length > 1 ? t("block_styles_0_blocks_d4743839", [this.blockIds.length]) : t("block_style_8f82ddc1") });
    contentEl.createDiv({ cls: 'bs-style-modal-description', text: t("colors_use_semantic_theme_values_and_adapt_to_ob_3c6ba9ba") });

    const renderColorSection = (title, key) => {
      const section = contentEl.createDiv({ cls: 'bs-style-section' });
      section.createDiv({ cls: 'bs-style-section-title', text: title });
      const palette = section.createDiv({ cls: 'bs-style-palette' });
      for (const color of STYLE_COLORS) {
        const button = palette.createEl('button', {
          cls: `bs-style-swatch is-${key === 'textColor' ? 'text' : 'background'}-${color}${this.appearance[key] === color ? ' is-selected' : ''}`,
          attr: { type: 'button', 'aria-label': `${title}：${STYLE_COLOR_LABELS[color]}`, title: STYLE_COLOR_LABELS[color] },
        });
        button.dataset.color = color;
        if (color === 'default') {
          const icon = button.createSpan({ cls: 'bs-style-swatch-icon' });
          setIcon(icon, 'rotate-ccw');
        } else button.createSpan({ cls: 'bs-style-swatch-dot' });
        button.addEventListener('click', () => {
          this.appearance[key] = color;
          palette.querySelectorAll('.bs-style-swatch').forEach((candidate) => candidate.toggleClass('is-selected', candidate === button));
        });
      }
    };
    renderColorSection(t("text_color_f21ef4ab"), 'textColor');
    renderColorSection(t("background_color_882fe2e8"), 'background');

    const alignSection = contentEl.createDiv({ cls: 'bs-style-section' });
    alignSection.createDiv({ cls: 'bs-style-section-title', text: t("alignment_46886255") });
    const alignGroup = alignSection.createDiv({ cls: 'bs-style-align-group' });
    for (const [align, label, iconName] of [['left', t("align_left_2bd74486"), 'align-left'], ['center', t("center_4cc3885c"), 'align-center'], ['right', t("align_right_331c711e"), 'align-right']]) {
      const button = createButton(alignGroup, `bs-style-align${this.appearance.align === align ? ' is-selected' : ''}`, label, iconName, label);
      button.addEventListener('click', () => {
        this.appearance.align = align;
        alignGroup.querySelectorAll('.bs-style-align').forEach((candidate) => candidate.toggleClass('is-selected', candidate === button));
      });
    }

    const actions = contentEl.createDiv({ cls: 'bs-style-modal-actions' });
    const reset = createButton(actions, '', t("clear_block_styles_1277e80b"), 'eraser', t("clear_styles_384fbf42"));
    reset.addEventListener('click', () => {
      this.appearance = Core.normalizeBlockAppearance({});
      this.applyAndClose();
    });
    const apply = createButton(actions, 'mod-cta', t("apply_block_styles_5fca7a7a"), 'check', t("apply_63c73c47"));
    apply.addEventListener('click', () => this.applyAndClose());
  }

  applyAndClose() {
    const appearance = Core.normalizeBlockAppearance(this.appearance);
    const changed = this.view.performMutation(this.blockIds.length > 1 ? t("change_multiple_block_styles_b0b5b698") : t("change_block_style_6e4d4714"), (page) => {
      const selected = new Set(this.blockIds);
      for (const target of page.blocks) if (selected.has(target.id)) target.appearance = appearance;
    }, { render: false });
    if (changed) this.view.refreshBlockAppearance(this.blockIds);
    this.close();
  }

  onClose() { clearElement(this.contentEl); }
}

class BlockspaceView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.page = null;
    this.entryPath = '';
    this.activeTab = 'document';
    this.searchQuery = '';
    this.saveTimer = null;
    this.slashState = null;
    this.dragBlockId = null;
    this.dragBlockIds = [];
    this.dropPosition = null;
    this.dragScrollFrame = null;
    this.pendingDragClientY = null;
    this.selectedBlockIds = new Set();
    this.blockSelectionAnchorId = null;
    this.blockSelectionFocusId = null;
    this.blockSelectionToolbarEl = null;
    this.propertiesExpanded = plugin.settings.showProperties !== false;
    this.focusMode = false;
    this.scrollPositions = new Map();
    this.history = Core.createHistory(plugin.settings.historyLimit);
    this.pendingEdit = null;
    this.pendingEditTimer = null;
    this.liveEditGroupDelay = 900;
    this.logicalSelection = null;
    this.gutterSelectionSession = null;
    this.persistedRevision = 0;
    this.dirty = false;
    this.isComposing = false;
    this.saveState = 'saved';
    this.saveIssue = null;
    this.pendingDeletion = null;
    this.changeGeneration = 0;
    this.savePromise = null;
    this.formatToolbarState = null;
    this.formatToolbarEl = null;
    this.selectionFrame = null;
    this.interactionState = { type: 'idle' };
    this.pageViewStates = new Map();
    this.pendingRestoreState = null;
    this.dragPreviewEl = null;
    this.dropHintEl = null;
    this.recentSlashTypes = [];
    this.nativeHeaderActionsInstalled = false;
    this.nativeHeaderActionEls = [];
    this.readingMode = false;
    this.markdownRenderComponents = new Map();
    this.markdownRenderGeneration = 0;
    this.nativePreviewObserver = null;
    this.imageWrapObservers = [];
    this.activeNativePreviewBlockId = null;
    this.hoverPopover = null;
    this.referencePopoverEl = null;
    this.referencePopoverTimer = null;
    this.backlinkTargetBlockId = null;
    this.findReplaceState = {
      open: false,
      showReplace: false,
      query: '',
      replacement: '',
      matchCase: false,
      wholeWord: false,
      matches: [],
      activeIndex: -1,
      focusTarget: 'query',
      searching: false,
      truncated: false,
      position: null,
    };
    this.findReplaceEl = null;
    this.findCountEl = null;
    this.findPreviousButton = null;
    this.findNextButton = null;
    this.findReplaceButton = null;
    this.findReplaceAllButton = null;
    this.findHighlightFrame = null;
    this.findSearchTimer = null;
    this.pendingFindRefreshOptions = null;
    this.findTextIndex = null;
    this.findTextIndexGeneration = -1;
    this.boundKeydown = (event) => this.onGlobalKeydown(event);
    this.boundContextMenu = (event) => this.onContextMenu(event);
    this.boundSelectionChange = () => this.scheduleFormatToolbarUpdate();
    this.boundCopy = (event) => this.handleClipboardCopy(event, false);
    this.boundCut = (event) => this.handleClipboardCopy(event, true);
    this.boundPointerUp = () => this.endGutterSelection();
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.page ? this.page.title : 'Blockspace'; }
  getIcon() { return 'layout-dashboard'; }

  refreshNativeHeader() {
    const title = this.getDisplayText();
    if (this.leaf && typeof this.leaf.updateHeader === 'function') {
      try { this.leaf.updateHeader(); } catch (error) { /* Obsidian version compatibility */ }
    }
    const leafContent = this.contentEl && typeof this.contentEl.closest === 'function'
      ? this.contentEl.closest('.workspace-leaf-content')
      : null;
    if (leafContent) {
      leafContent.setAttribute('data-blockspace-page-title', title);
      const nativeTitle = leafContent.querySelector('.view-header-title');
      if (nativeTitle && nativeTitle.textContent !== title) nativeTitle.textContent = title;
    }
  }

  installNativeHeaderActions() {
    if (this.nativeHeaderActionsInstalled || typeof this.addAction !== 'function') return;
    this.nativeHeaderActionsInstalled = true;
    const add = (icon, title, callback) => {
      const action = this.addAction(icon, title, callback);
      if (action) {
        action.addClass && action.addClass('bs-native-header-action');
        this.nativeHeaderActionEls.push(action);
      }
      return action;
    };
    add('search', t("switch_blockspace_page_821c93bc"), () => this.openQuickSwitcher());
    add('panel-right', t("open_blockspace_outline_dfd76be7"), () => void this.plugin.activateInspector());
    add('book-open', t("toggle_obsidian_native_markdown_reading_mode_d78a92fb"), () => this.toggleReadingMode());
    add('blocks', t("blockspace_page_actions_3b2fb6be"), (event) => this.showWorkspaceMenu(event));
  }

  setPage(page) {
    this.commitPendingEdit(false);
    this.closeFindReplace({ restoreFocus: false });
    if (this.page && this.contentEl) {
      const state = this.captureViewState();
      if (state) this.pageViewStates.set(this.page.id, state);
      const scroll = this.contentEl.querySelector('.bs-document-scroll');
      if (scroll) this.scrollPositions.set(this.page.id, scroll.scrollTop);
    }
    this.page = page ? Core.clonePage(page) : null;
    this.findTextIndex = null;
    this.findTextIndexGeneration = -1;
    if (!this.page || (this.backlinkTargetBlockId && !Core.getBlock(this.page, this.backlinkTargetBlockId))) {
      this.backlinkTargetBlockId = null;
    }
    const markdownRepairs = this.page ? Core.reparseInlineMarkdown(this.page) : 0;
    if (markdownRepairs) this.page = Core.normalizePage(this.page);
    this.pendingRestoreState = this.page ? (this.pageViewStates.get(this.page.id) || null) : null;
    this.persistedRevision = this.page ? this.page.revision : 0;
    this.history = Core.createHistory(this.plugin.settings.historyLimit);
    this.dirty = markdownRepairs > 0;
    this.changeGeneration = markdownRepairs > 0 ? 1 : 0;
    this.closeFormatToolbar();
    this.clearBlockSelection({ updateDom: false });
    this.setSaveState(markdownRepairs > 0 ? 'dirty' : 'saved');
    this.setInteractionState('idle');
    this.refreshNativeHeader();
    this.plugin.notifyContextChanged();
    if (markdownRepairs) this.scheduleSave();
  }

  setInteractionState(type, details = {}) {
    this.interactionState = { type, ...details };
    if (this.rootEl) this.rootEl.dataset.interactionState = type;
  }

  getInteractionType() {
    return this.interactionState && this.interactionState.type || 'idle';
  }

  captureEditorSelection() {
    if (!this.page || !this.contentEl) return null;
    if (this.selectedBlockIds.size) {
      return {
        type: 'blocks',
        blockIds: this.getOrderedSelectedBlockIds(),
        anchorId: this.blockSelectionAnchorId,
        focusId: this.blockSelectionFocusId,
      };
    }
    const logical = getLogicalTextSelection(this.contentEl, this.page);
    if (logical) return { type: logical.type, ranges: logical.ranges };
    const active = this.contentEl.ownerDocument.activeElement;
    if (active && active.matches && active.matches('.bs-block-editor')) {
      const wrapper = active.closest('.bs-block');
      const blockId = wrapper && wrapper.dataset.blockId;
      const offsets = getTextSelectionOffsets(active);
      const offset = offsets ? offsets.from : getCaretOffset(active);
      return { type: 'caret', blockId, offset, to: offsets ? offsets.to : offset };
    }
    if (active && active.matches && active.matches('.bs-page-title')) return { type: 'title', offset: getCaretOffset(active) };
    return null;
  }

  restoreEditorSelection(selection) {
    if (!selection || !this.page || !this.contentEl) return false;
    if (selection.type === 'blocks') {
      this.setBlockSelection(selection.blockIds || [], selection.anchorId, selection.focusId);
      return true;
    }
    if ((selection.type === 'text' || selection.type === 'cross-block-text') && Array.isArray(selection.ranges)) {
      const restored = setLogicalTextSelection(this, selection);
      if (restored) {
        this.logicalSelection = { type: selection.type, ranges: selection.ranges.map((range) => ({ ...range })) };
        this.setInteractionState(selection.type === 'cross-block-text' ? 'cross-block-text-selecting' : 'text-selecting', { ranges: selection.ranges });
        this.scheduleFormatToolbarUpdate();
      }
      return restored;
    }
    if (selection.type === 'caret' && selection.blockId) {
      const editor = this.contentEl.querySelector(`[data-block-id="${selection.blockId}"] .bs-block-editor`);
      if (!editor) return false;
      editor.focus({ preventScroll: true });
      setTextSelection(editor, selection.offset || 0, selection.to == null ? selection.offset || 0 : selection.to);
      this.setInteractionState(selection.to != null && selection.to !== selection.offset ? 'text-selecting' : 'text-editing', { blockId: selection.blockId });
      return true;
    }
    if (selection.type === 'title') {
      const title = this.contentEl.querySelector('.bs-page-title');
      if (!title) return false;
      title.focus({ preventScroll: true });
      placeCaret(title, selection.offset || 0);
      return true;
    }
    return false;
  }

  handleClipboardCopy(event, cut = false) {
    if (!this.page || !this.contentEl || !event.clipboardData) return false;
    const active = this.contentEl.ownerDocument.activeElement;
    if (!active || !this.contentEl.contains(active)) return false;
    if (this.selectedBlockIds.size) {
      const roots = Core.normalizeTopLevelSelection(this.page, this.getOrderedSelectedBlockIds());
      if (!roots.length) return false;
      const payload = Core.serializeSubtrees(this.page, roots);
      const selected = new Set(roots.flatMap((id) => Core.getSubtreeIds(this.page, id)));
      const clone = Core.clonePage(this.page);
      clone.rootBlockIds = roots.slice();
      clone.blocks = clone.blocks.filter((block) => selected.has(block.id));
      for (const block of clone.blocks) {
        if (!selected.has(block.parentId)) block.parentId = null;
        block.children = block.children.filter((id) => selected.has(id));
      }
      const markdown = Core.blocksToMarkdown(clone).trimEnd();
      event.preventDefault();
      event.clipboardData.setData('application/x-blockspace-blocks', JSON.stringify(payload));
      event.clipboardData.setData('text/plain', markdown);
      event.clipboardData.setData('text/html', `<pre>${markdown.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]))}</pre>`);
      if (cut) this.deleteSelectedBlocks();
      return true;
    }
    const logical = getLogicalTextSelection(this.contentEl, this.page);
    if (!logical || logical.ranges.length < 2) return false;
    event.preventDefault();
    event.clipboardData.setData('text/plain', Core.textFromRanges(this.page, logical.ranges));
    if (cut) this.deleteCrossBlockSelection(logical);
    return true;
  }

  beginGutterSelection(blockId, event) {
    if (!this.page || event.button !== 0) return;
    event.preventDefault();
    this.gutterSelectionSession = { anchorId: blockId, focusId: blockId };
    this.setBlockSelection([blockId], blockId, blockId);
    this.setInteractionState('gutter-selecting', { anchorId: blockId, focusId: blockId });
  }

  extendGutterSelection(blockId) {
    if (!this.gutterSelectionSession || !this.page || this.gutterSelectionSession.focusId === blockId) return;
    this.gutterSelectionSession.focusId = blockId;
    const visible = this.getVisibleBlocks();
    const anchorIndex = visible.findIndex((block) => block.id === this.gutterSelectionSession.anchorId);
    const focusIndex = visible.findIndex((block) => block.id === blockId);
    if (anchorIndex < 0 || focusIndex < 0) return;
    const start = Math.min(anchorIndex, focusIndex);
    const end = Math.max(anchorIndex, focusIndex);
    this.setBlockSelection(visible.slice(start, end + 1).map((block) => block.id), this.gutterSelectionSession.anchorId, blockId);
    this.setInteractionState('gutter-selecting', { anchorId: this.gutterSelectionSession.anchorId, focusId: blockId });
  }

  endGutterSelection() {
    if (!this.gutterSelectionSession) return;
    this.gutterSelectionSession = null;
    this.setInteractionState(this.selectedBlockIds.size ? 'block-selecting' : 'idle', { blockIds: this.getOrderedSelectedBlockIds() });
  }

  deleteCrossBlockSelection(logical = getLogicalTextSelection(this.contentEl, this.page)) {
    if (!logical || logical.ranges.length < 2 || !this.page) return false;
    const selectionBefore = { type: logical.type, ranges: logical.ranges.map((range) => ({ ...range })) };
    let result = null;
    const changed = this.performMutation(t("delete_text_across_blocks_aa8086d6"), (page) => {
      result = Core.deleteSiblingTextRange(page, {
        startBlockId: logical.ranges[0].blockId,
        startOffset: logical.ranges[0].from,
        endBlockId: logical.ranges[logical.ranges.length - 1].blockId,
        endOffset: logical.ranges[logical.ranges.length - 1].to,
      });
    }, { selectionBefore, render: true });
    if (!changed || !result) return false;
    this.restoreEditorSelection({ type: 'caret', blockId: result.blockId, offset: result.offset });
    const latest = this.history.undo[this.history.undo.length - 1];
    if (latest) latest.selectionAfter = { type: 'caret', blockId: result.blockId, offset: result.offset };
    return true;
  }

  handleEscape(event, context = {}) {
    if (this.findReplaceState && this.findReplaceState.open) {
      event && event.preventDefault();
      this.closeFindReplace();
      return true;
    }
    const palette = this.formatToolbarEl && this.formatToolbarEl.querySelector('.bs-format-palette');
    if (palette) {
      event && event.preventDefault();
      palette.remove();
      return true;
    }
    if (this.slashState) {
      event && event.preventDefault();
      this.closeSlashMenu();
      return true;
    }
    if (this.formatToolbarEl) {
      event && event.preventDefault();
      this.closeFormatToolbar();
      return true;
    }
    if (this.selectedBlockIds.size) {
      event && event.preventDefault();
      this.clearBlockSelection();
      return true;
    }
    if (context.editor && context.blockId) {
      event && event.preventDefault();
      this.selectBlock(context.blockId);
      const handle = context.wrapper && context.wrapper.querySelector('.bs-drag-handle');
      context.editor.blur();
      if (handle) handle.focus({ preventScroll: true });
      this.setInteractionState('block-selecting', { blockIds: [context.blockId] });
      return true;
    }
    if (this.getInteractionType() !== 'idle') {
      event && event.preventDefault();
      this.setInteractionState('idle');
      return true;
    }
    return false;
  }

  applyFocusDirective(directive) {
    if (!directive || !this.page) return;
    if (directive.type === 'block' && directive.blockId) {
      const offset = Math.max(0, Number(directive.offset) || 0);
      focusEditorAt(this, directive.blockId, offset);
      const editor = this.contentEl.querySelector(`[data-block-id="${directive.blockId}"] .bs-block-editor`);
      if (editor && directive.to != null) setTextSelection(editor, offset, Math.max(offset, Number(directive.to) || offset));
      if (directive.scroll !== 'none') {
        const wrapper = editor && editor.closest('.bs-block');
        if (wrapper) wrapper.scrollIntoView({ block: directive.scroll === 'center' ? 'center' : 'nearest' });
      }
      this.setInteractionState('text-editing', { blockId: directive.blockId });
      return;
    }
    if (directive.type === 'select-blocks') {
      const ids = Array.isArray(directive.blockIds) ? directive.blockIds : [];
      this.setBlockSelection(ids, ids[0] || null, ids[ids.length - 1] || null);
    }
  }

  runCommand(label, mutator, options = {}) {
    let outcome = {};
    const changed = this.performMutation(label, (page) => {
      const value = mutator(page);
      if (value && typeof value === 'object') outcome = value;
    }, { render: options.render !== false });
    if (!changed) return null;
    const directive = typeof options.focus === 'function' ? options.focus(outcome, this.page) : options.focus;
    if (directive) this.applyFocusDirective(directive);
    const latest = this.history.undo[this.history.undo.length - 1];
    if (latest && !latest.selectionAfter) latest.selectionAfter = this.captureEditorSelection();
    return outcome;
  }

  getState() {
    return {
      pageId: this.page ? this.page.id : null,
      activeTab: this.activeTab,
      readingMode: this.readingMode,
      entryPath: this.entryPath || '',
    };
  }

  async setState(state) {
    await this.plugin.ensureStore();
    this.entryPath = normalizePath(String(state && state.entryPath || ''));
    const pageId = state && state.pageId;
    const targetId = pageId || this.plugin.store.workspace.activePageId || (this.plugin.store.workspace.pages[0] && this.plugin.store.workspace.pages[0].id);
    if (targetId) {
      const page = await this.plugin.store.loadPage(targetId);
      if (page) this.setPage(page);
    }
    if (state && (state.activeTab === 'document' || state.activeTab === 'board')) this.activeTab = state.activeTab;
    this.readingMode = Boolean(state && state.readingMode && this.activeTab === 'document');
    this.render();
    return true;
  }

  setSaveState(state) {
    this.saveState = state;
    if (state === 'saved' && this.saveIssue) {
      this.saveIssue = null;
      this.renderStatusBanners();
    }
    // Save state is rendered by one plugin-owned status bar item. Publishing
    // here keeps multiple Blockspace views from creating competing indicators.
    this.plugin.notifyContextChanged();
  }

  renderStatusBanners(main = this.contentEl && this.contentEl.querySelector('.bs-main')) {
    if (!main) return;
    main.querySelectorAll('.bs-status-banner').forEach((element) => element.remove());
    const viewHost = main.querySelector('.bs-view-host');
    const mount = (className, role, message, detail, buildActions) => {
      const banner = main.createDiv({ cls: `bs-status-banner ${className}` });
      banner.setAttribute('role', role);
      banner.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
      if (detail) banner.setAttribute('title', detail);
      const icon = banner.createSpan({ cls: 'bs-status-banner-icon' });
      setIcon(icon, className === 'is-conflict' ? 'git-compare-arrows' : className === 'is-error' ? 'triangle-alert' : 'archive-restore');
      banner.createSpan({ cls: 'bs-status-banner-message', text: message });
      const actions = banner.createDiv({ cls: 'bs-status-banner-actions' });
      buildActions(actions);
      if (viewHost) main.insertBefore(banner, viewHost);
      return banner;
    };
    if (this.saveIssue) {
      const issue = this.saveIssue;
      if (issue.type === 'conflict') {
        mount(
          'is-conflict',
          'alert',
          t("this_page_was_modified_in_another_window_or_on_a_fad04a30"),
          issue.conflictPath || '',
          (actions) => {
            const keepLocal = createButton(actions, 'bs-status-banner-action mod-cta', t("restore_local_conflicting_content_as_a_new_page_f77df21e"), 'copy-plus', t("keep_local_copy_8491b0b6"));
            keepLocal.addEventListener('click', () => void this.restoreConflictCopy(keepLocal));
            const reload = createButton(actions, 'bs-status-banner-action', t("discard_unsaved_changes_and_load_the_disk_versio_ed0dd4dc"), 'refresh-cw', t("load_disk_version_3ca790c8"));
            reload.addEventListener('click', () => void this.reloadDiskPage(reload));
          },
        );
      } else {
        mount(
          'is-error',
          'alert',
          t("save_failed_the_recovery_journal_is_preserved_ch_c66d91a8"),
          issue.message || '',
          (actions) => {
            const retry = createButton(actions, 'bs-status-banner-action mod-cta', t("try_saving_the_current_page_again_0f4fecf1"), 'refresh-cw', t("retry_save_917e7504"));
            retry.addEventListener('click', () => void this.retrySave(retry));
            const diagnostics = createButton(actions, 'bs-status-banner-action', t("open_diagnostics_and_recovery_7acf8511"), 'life-buoy', t("diagnostics_and_recovery_18b77e4a"));
            diagnostics.addEventListener('click', () => new BlockspaceDiagnosticsModal(this.app, this.plugin).open());
          },
        );
      }
    }
    if (this.pendingDeletion) {
      const title = this.pendingDeletion.page && this.pendingDeletion.page.title || t("page_452c7b10");
      mount(
        'is-undo',
        'status',
        t("0_was_moved_to_blockspace_trash_ae1c5e03", [title]),
        '',
        (actions) => {
          const undo = createButton(actions, 'bs-status-banner-action mod-cta', t("undo_deletion_of_0_aa6d9743", [title]), 'undo-2', t("undo_deletion_d1ff25a7"));
          undo.addEventListener('click', () => void this.undoPageDeletion(undo));
          const dismiss = createButton(actions, 'bs-status-banner-action', t("dismiss_deletion_notice_d59c3257"), 'x', t("close_3fd47edc"));
          dismiss.addEventListener('click', () => {
            this.pendingDeletion = null;
            this.renderStatusBanners();
          });
        },
      );
    }
  }

  async restoreConflictCopy(button) {
    const issue = this.saveIssue;
    if (!issue || issue.type !== 'conflict') return;
    button.disabled = true;
    try {
      const restored = await this.plugin.store.restoreConflictFile(issue.conflictPath);
      if (!restored) {
        new Notice(t("no_recoverable_local_conflict_copy_found_f8e96eff"));
        return;
      }
      this.saveIssue = null;
      this.setPage(restored);
      this.render();
      new Notice(t("restored_local_content_as_a_new_page_0_8db41f3a", [restored.title]));
    } finally {
      button.disabled = false;
    }
  }

  async reloadDiskPage(button) {
    if (!this.page) return;
    button.disabled = true;
    try {
      const disk = await this.plugin.store.loadPage(this.page.id);
      if (!disk) {
        new Notice(t("disk_version_is_missing_the_local_conflict_copy__50b11605"));
        return;
      }
      this.saveIssue = null;
      this.setPage(disk);
      this.render();
      new Notice(t("loaded_disk_version_5ec7173b"));
    } finally {
      button.disabled = false;
    }
  }

  async retrySave(button) {
    button.disabled = true;
    try {
      await this.saveCurrentPage();
    } catch (error) {
      /* saveCurrentPage keeps the actionable error banner visible */
    } finally {
      button.disabled = false;
    }
  }

  async undoPageDeletion(button) {
    const deletion = this.pendingDeletion;
    if (!deletion) return;
    button.disabled = true;
    try {
      const restored = await this.plugin.store.restoreDeletedPage(deletion, { activate: deletion.wasActive !== false });
      if (!restored) {
        new Notice(t("could_not_restore_the_deleted_page_check_trash_i_4c9f0307"));
        return;
      }
      this.pendingDeletion = null;
      if (deletion.wasActive !== false) this.setPage(restored);
      this.render();
      new Notice(t("restored_page_0_e0fca678", [restored.title]));
    } finally {
      button.disabled = false;
    }
  }

  updateHistoryControls() {
    if (this.undoButton) this.undoButton.disabled = this.history.undo.length === 0;
    if (this.redoButton) this.redoButton.disabled = this.history.redo.length === 0;
  }

  getVisibleBlockEntries() {
    return this.page ? Core.flattenBlockEntries(this.page) : [];
  }

  getVisibleBlocks() {
    return this.getVisibleBlockEntries().map((entry) => entry.block).filter((block) => block.type !== 'column');
  }

  getEditableVisibleBlocks() {
    return this.getVisibleBlocks().filter((block) => block.type !== 'columns');
  }

  getVisibleBlockIds() {
    return this.getVisibleBlocks().map((block) => block.id);
  }

  getVisibleBlockIndex(blockId) {
    return this.getVisibleBlockIds().indexOf(blockId);
  }


  closeBlockSelectionToolbar() {
    if (this.blockSelectionToolbarEl) this.blockSelectionToolbarEl.remove();
    this.blockSelectionToolbarEl = null;
  }

  getOrderedSelectedBlockIds() {
    if (!this.page || !this.selectedBlockIds.size) return [];
    return this.getVisibleBlockIds().filter((id) => this.selectedBlockIds.has(id));
  }

  clearBlockSelection(options = {}) {
    this.selectedBlockIds.clear();
    this.blockSelectionAnchorId = null;
    this.blockSelectionFocusId = null;
    this.closeBlockSelectionToolbar();
    if (['block-selecting', 'gutter-selecting'].includes(this.getInteractionType())) this.setInteractionState('idle');
    if (options.updateDom === false || !this.contentEl) return;
    this.contentEl.querySelectorAll('.bs-block.is-block-selected').forEach((element) => {
      element.removeClass('is-block-selected');
      element.setAttribute('aria-selected', 'false');
      element.querySelectorAll('.bs-media-toolbar').forEach((toolbar) => syncMediaToolbarInteractive(toolbar, false));
    });
    this.contentEl.querySelectorAll('.bs-drag-handle[aria-pressed="true"]').forEach((element) => element.setAttribute('aria-pressed', 'false'));
    this.contentEl.querySelectorAll('.bs-gutter-select-zone[aria-pressed="true"]').forEach((element) => element.setAttribute('aria-pressed', 'false'));
  }

  updateBlockSelectionDom() {
    if (!this.contentEl) return;
    const valid = new Set(this.page ? this.page.blocks.map((block) => block.id) : []);
    this.selectedBlockIds = new Set(Array.from(this.selectedBlockIds).filter((id) => valid.has(id)));
    this.contentEl.querySelectorAll('.bs-block').forEach((element) => {
      const selected = this.selectedBlockIds.has(element.dataset.blockId);
      element.toggleClass('is-block-selected', selected);
      element.setAttribute('aria-selected', selected ? 'true' : 'false');
      const handle = element.querySelector('.bs-drag-handle');
      if (handle) handle.setAttribute('aria-pressed', selected ? 'true' : 'false');
      const selectRail = element.querySelector('.bs-gutter-select-zone');
      if (selectRail) selectRail.setAttribute('aria-pressed', selected ? 'true' : 'false');
      element.querySelectorAll('.bs-media-toolbar').forEach((toolbar) => syncMediaToolbarInteractive(toolbar, selected));
    });
    this.renderBlockSelectionToolbar();
  }

  setBlockSelection(ids, anchorId, focusId) {
    const valid = new Set(this.page ? this.page.blocks.map((block) => block.id) : []);
    const requested = Array.from(ids || []).filter((id) => valid.has(id));
    const normalized = this.page ? Core.normalizeTopLevelSelection(this.page, requested) : requested;
    this.selectedBlockIds = new Set(normalized);
    const ordered = this.getOrderedSelectedBlockIds();
    this.blockSelectionAnchorId = this.selectedBlockIds.has(anchorId) ? anchorId : (ordered[0] || null);
    this.blockSelectionFocusId = this.selectedBlockIds.has(focusId) ? focusId : (ordered.length ? ordered[ordered.length - 1] : null);
    this.closeFormatToolbar();
    this.closeSlashMenu();
    this.setInteractionState(this.selectedBlockIds.size ? 'block-selecting' : 'idle', { blockIds: ordered });
    this.updateBlockSelectionDom();
  }

  selectBlock(blockId, options = {}) {
    if (!this.page) return;
    this.commitPendingEdit();
    const visible = this.getVisibleBlocks();
    const index = visible.findIndex((block) => block.id === blockId);
    if (index < 0) return;
    if (options.range && this.blockSelectionAnchorId) {
      const anchorIndex = visible.findIndex((block) => block.id === this.blockSelectionAnchorId);
      const start = Math.min(anchorIndex < 0 ? index : anchorIndex, index);
      const end = Math.max(anchorIndex < 0 ? index : anchorIndex, index);
      this.setBlockSelection(visible.slice(start, end + 1).map((block) => block.id), this.blockSelectionAnchorId, blockId);
      return;
    }
    if (options.toggle) {
      const next = new Set(this.selectedBlockIds);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      const anchor = next.size ? (this.blockSelectionAnchorId && next.has(this.blockSelectionAnchorId) ? this.blockSelectionAnchorId : blockId) : null;
      this.setBlockSelection(next, anchor, blockId);
      return;
    }
    this.setBlockSelection([blockId], blockId, blockId);
  }

  extendBlockSelection(direction) {
    if (!this.page || !this.selectedBlockIds.size) return;
    const visible = this.getVisibleBlocks();
    const ordered = this.getOrderedSelectedBlockIds();
    const focusId = this.blockSelectionFocusId || ordered[ordered.length - 1];
    const focusIndex = visible.findIndex((block) => block.id === focusId);
    const targetIndex = Math.max(0, Math.min(visible.length - 1, focusIndex + direction));
    const target = visible[targetIndex];
    if (target) this.selectBlock(target.id, { range: true });
  }

  navigateBlockSelection(direction) {
    if (!this.page || !this.selectedBlockIds.size) return;
    const visible = this.getVisibleBlocks();
    const ordered = this.getOrderedSelectedBlockIds();
    const edgeId = direction < 0 ? ordered[0] : ordered[ordered.length - 1];
    const edgeIndex = visible.findIndex((block) => block.id === edgeId);
    const target = visible[Math.max(0, Math.min(visible.length - 1, edgeIndex + direction))];
    if (target) {
      this.selectBlock(target.id);
      const handle = this.contentEl.querySelector(`[data-block-id="${target.id}"] .bs-drag-handle`);
      if (handle) handle.focus({ preventScroll: true });
      const wrapper = handle && handle.closest('.bs-block');
      if (wrapper) wrapper.scrollIntoView({ block: 'nearest' });
    }
  }

  renderBlockSelectionToolbar() {
    this.closeBlockSelectionToolbar();
    if (this.activeTab !== 'document') return;
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length || !this.contentEl || !this.contentEl.ownerDocument) return;
    const document = this.contentEl.ownerDocument;
    const toolbar = document.createElement('div');
    toolbar.className = 'bs-block-selection-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', t("0_blocks_selected_0ebe0a3f", [ids.length]));
    toolbar.addEventListener('mousedown', (event) => event.preventDefault());
    const count = document.createElement('span');
    count.className = 'bs-block-selection-count';
    count.textContent = t("0_blocks_984091af", [ids.length]);
    toolbar.appendChild(count);
    const makeButton = (iconName, label, handler, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bs-block-selection-button';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.disabled = disabled;
      const icon = document.createElement('span');
      setIcon(icon, iconName);
      button.appendChild(icon);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler(event, button);
      });
      toolbar.appendChild(button);
      return button;
    };
    makeButton('copy', t("duplicate_selected_blocks_ctrl_cmd_d_c1840961"), () => this.duplicateSelectedBlocks());
    makeButton('clipboard-copy', t("copy_as_markdown_ctrl_cmd_c_213aca37"), () => void this.copySelectedBlocks());
    makeButton('arrow-up', t("move_up_among_siblings_alt_21ba3db1"), () => this.moveSelectedBlocks(-1));
    makeButton('arrow-down', t("move_down_among_siblings_alt_e40c9df2"), () => this.moveSelectedBlocks(1));
    makeButton('palette', t("style_selected_blocks_6b63a377"), () => new BlockAppearanceModal(this.app, this, ids).open());
    makeButton('replace', t("change_block_type_ea166358"), (event) => this.showBlockTypeMenu(event, ids), ids.some((id) => Core.getBlock(this.page, id)?.type === 'columns'));
    const separator = document.createElement('span');
    separator.className = 'bs-block-selection-separator';
    toolbar.appendChild(separator);
    makeButton('trash-2', t("delete_selected_blocks_delete_70dce6a3"), () => this.deleteSelectedBlocks()).classList.add('is-destructive');
    makeButton('x', t("clear_selection_esc_3a9909ae"), () => this.clearBlockSelection());
    const host = this.contentEl.querySelector('.bs-main') || document.body;
    host.appendChild(toolbar);
    this.blockSelectionToolbarEl = toolbar;
  }

  showBlockTypeMenu(event, blockIds = this.getOrderedSelectedBlockIds()) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const menu = new Menu();
    const containsColumnsLayout = blockIds.some((blockId) => Core.getBlock(this.page, blockId)?.type === 'columns');
    for (const command of SLASH_COMMANDS) {
      const disabled = containsColumnsLayout || (command.type === 'columns' && blockIds.length !== 1);
      menu.addItem((item) => item.setTitle(command.label).setIcon(command.icon).setDisabled(disabled).onClick(() => {
        this.performMutation(blockIds.length > 1 ? t("convert_selected_blocks_to_0_dc0aa68f", [command.label]) : t("convert_to_0_605a845f", [command.label]), (page) => {
          if (command.type === 'columns') {
            for (const blockId of blockIds) Core.convertBlockToColumns(page, blockId, 2);
          } else Core.convertBlockType(page, blockIds, command.type);
        });
      }));
    }
    menu.showAtMouseEvent(event);
  }

  duplicateSelectedBlocks() {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length || !this.page) return;
    let copiedIds = [];
    this.performMutation(ids.length > 1 ? t("duplicate_blocks_and_their_children_0c3db023") : t("duplicate_block_and_its_children_959f4542"), (page) => {
      copiedIds = Core.duplicateSubtrees(page, ids);
    }, { render: false });
    if (!copiedIds.length) return;
    this.selectedBlockIds = new Set(copiedIds);
    this.blockSelectionAnchorId = copiedIds[0];
    this.blockSelectionFocusId = copiedIds[copiedIds.length - 1];
    this.render();
  }

  moveSelectedBlocks(direction) {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length || !this.page) return;
    this.performMutation(direction < 0 ? t("move_selected_subtrees_up_68d0fe75") : t("move_selected_subtrees_down_435043a8"), (page) => {
      Core.moveSiblingGroup(page, ids, direction);
    });
  }

  indentSelectedBlocks(delta) {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length) return;
    this.performMutation(delta < 0 ? t("outdent_selected_blocks_9118bc55") : t("move_selected_blocks_into_the_previous_container_b61eaabb"), (page) => {
      if (delta < 0) Core.outdentBlocks(page, ids);
      else Core.indentBlocks(page, ids);
    });
  }

  deleteSelectedBlocks() {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length || !this.page) return;
    const visible = this.getVisibleBlocks();
    const firstIndex = Math.min(...ids.map((id) => visible.findIndex((block) => block.id === id)).filter((index) => index >= 0));
    this.performMutation(ids.length > 1 ? t("delete_blocks_and_their_children_95cab2da") : t("delete_block_and_its_children_eb336aa1"), (page) => {
      Core.removeSubtrees(page, ids);
    }, { render: false });
    this.clearBlockSelection({ updateDom: false });
    this.render();
    const nextVisible = this.getVisibleBlocks();
    const target = nextVisible[Math.max(0, Math.min(firstIndex, nextVisible.length - 1))];
    if (target) focusEditorAt(this, target.id, 0);
    new Notice(t("deleted_0_blocks_ctrl_cmd_z_to_undo_3ad5774d", [ids.length]));
  }

  async copySelectedBlocks() {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length || !this.page) return;
    const selectedRoots = Core.normalizeTopLevelSelection(this.page, ids);
    const selected = new Set(selectedRoots.flatMap((id) => Core.getSubtreeIds(this.page, id)));
    const clone = Core.clonePage(this.page);
    clone.rootBlockIds = selectedRoots.slice();
    clone.blocks = clone.blocks.filter((block) => selected.has(block.id));
    for (const block of clone.blocks) {
      if (!selected.has(block.parentId)) block.parentId = null;
      block.children = block.children.filter((id) => selected.has(id));
    }
    const markdown = Core.blocksToMarkdown(clone).trimEnd();
    try {
      await this.contentEl.ownerDocument.defaultView.navigator.clipboard.writeText(markdown);
      new Notice(t("copied_0_block_subtrees_a879125a", [selectedRoots.length]));
    } catch (error) {
      const textarea = this.contentEl.ownerDocument.createElement('textarea');
      textarea.value = markdown;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      this.contentEl.ownerDocument.body.appendChild(textarea);
      textarea.select();
      this.contentEl.ownerDocument.execCommand('copy');
      textarea.remove();
      new Notice(t("copied_0_block_subtrees_a879125a", [selectedRoots.length]));
    }
  }

  async writeClipboardText(text, message = t("copied_8f6f8d97")) {
    try {
      await this.contentEl.ownerDocument.defaultView.navigator.clipboard.writeText(text);
    } catch (error) {
      const textarea = this.contentEl.ownerDocument.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      this.contentEl.ownerDocument.body.appendChild(textarea);
      textarea.select();
      this.contentEl.ownerDocument.execCommand('copy');
      textarea.remove();
    }
    new Notice(message);
  }

  async copyBlockReference(block, mode = 'reference') {
    if (!block) return;
    const label = String(block.text || t("untitled_block_f28874e8")).replace(/\s+/g, ' ').trim().slice(0, 120) || t("untitled_block_f28874e8");
    if (mode === 'link') {
      await this.writeClipboardText(`[${label}](blockspace://block/${encodeURIComponent(block.id)})`, t("copied_block_link_45cf587c"));
      return;
    }
    const escaped = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await this.writeClipboardText(`((${block.id} "${escaped}"))`, t("copied_siyuan_compatible_block_reference_7fd8e19a"));
  }

  showBacklinksForBlock(blockId) {
    this.backlinkTargetBlockId = blockId || null;
    void this.plugin.activateInspector();
    this.render();
    this.plugin.notifyContextChanged();
  }

  scheduleDragAutoScroll(clientY) {
    this.pendingDragClientY = clientY;
    if (this.dragScrollFrame !== null || !this.contentEl) return;
    const win = this.contentEl.ownerDocument.defaultView;
    this.dragScrollFrame = win.requestAnimationFrame(() => {
      this.dragScrollFrame = null;
      const scroll = this.contentEl.querySelector('.bs-document-scroll');
      if (!scroll || this.pendingDragClientY == null) return;
      const rect = scroll.getBoundingClientRect();
      const threshold = Math.min(84, Math.max(48, rect.height * 0.12));
      let delta = 0;
      if (this.pendingDragClientY < rect.top + threshold) delta = -Math.ceil((rect.top + threshold - this.pendingDragClientY) / 5);
      else if (this.pendingDragClientY > rect.bottom - threshold) delta = Math.ceil((this.pendingDragClientY - (rect.bottom - threshold)) / 5);
      if (delta) scroll.scrollTop += Math.max(-24, Math.min(24, delta));
    });
  }

  cancelDragAutoScroll() {
    this.pendingDragClientY = null;
    if (this.dragScrollFrame !== null && this.contentEl) {
      this.contentEl.ownerDocument.defaultView.cancelAnimationFrame(this.dragScrollFrame);
      this.dragScrollFrame = null;
    }
  }

  closeFormatToolbar() {
    if (this.selectionFrame !== null && this.contentEl && this.contentEl.ownerDocument) {
      this.contentEl.ownerDocument.defaultView.cancelAnimationFrame(this.selectionFrame);
      this.selectionFrame = null;
    }
    if (this.formatToolbarEl) this.formatToolbarEl.remove();
    this.formatToolbarEl = null;
    this.formatToolbarState = null;
    this.logicalSelection = null;
    if (['text-selecting', 'cross-block-text-selecting'].includes(this.getInteractionType())) {
      const active = this.contentEl && this.contentEl.ownerDocument && this.contentEl.ownerDocument.activeElement;
      const wrapper = active && active.closest ? active.closest('.bs-block') : null;
      this.setInteractionState(active && active.matches && active.matches('.bs-block-editor') ? 'text-editing' : 'idle', { blockId: wrapper && wrapper.dataset.blockId });
    }
  }

  scheduleFormatToolbarUpdate() {
    if (!this.contentEl || !this.contentEl.ownerDocument || this.isComposing) return;
    const win = this.contentEl.ownerDocument.defaultView;
    if (this.selectionFrame !== null) win.cancelAnimationFrame(this.selectionFrame);
    this.selectionFrame = win.requestAnimationFrame(() => {
      this.selectionFrame = null;
      this.updateFormatToolbar();
    });
  }

  updateFormatToolbar() {
    if (!this.page || this.activeTab !== 'document' || this.isComposing) {
      this.closeFormatToolbar();
      return;
    }
    const logical = getLogicalTextSelection(this.contentEl, this.page);
    if (!logical || !logical.ranges.length) {
      this.closeFormatToolbar();
      return;
    }
    const unsupported = logical.ranges.some((range) => {
      const block = Core.getBlock(this.page, range.blockId);
      return !block || block.type === 'code' || block.type === 'divider' || block.type === 'table-of-contents';
    });
    if (unsupported) {
      this.closeFormatToolbar();
      return;
    }
    const rect = logical.rect;
    if (!rect || (!rect.width && !rect.height)) {
      this.closeFormatToolbar();
      return;
    }
    this.logicalSelection = logical;
    this.formatToolbarState = {
      type: logical.type,
      ranges: logical.ranges.map((range) => ({ ...range })),
      blockId: logical.ranges[0].blockId,
      from: logical.ranges[0].from,
      to: logical.ranges[0].to,
      rect,
    };
    this.setInteractionState(logical.type === 'cross-block-text' ? 'cross-block-text-selecting' : 'text-selecting', { ranges: logical.ranges });
    this.renderFormatToolbar();
  }

  renderFormatToolbar() {
    const state = this.formatToolbarState;
    if (!state || !this.page || !this.contentEl || !this.contentEl.ownerDocument) return;
    if (this.formatToolbarEl) this.formatToolbarEl.remove();
    const document = this.contentEl.ownerDocument;
    const toolbar = document.createElement('div');
    toolbar.className = 'bs-format-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', t("text_formatting_83df46fc"));
    toolbar.addEventListener('mousedown', (event) => event.preventDefault());
    const ranges = Array.isArray(state.ranges) && state.ranges.length
      ? state.ranges
      : [{ blockId: state.blockId, from: state.from, to: state.to }];
    const block = Core.getBlock(this.page, ranges[0].blockId);
    if (!block) return;
    const active = activeMarksForRange(block, ranges[0].from, ranges[0].to);
    if (ranges.length > 1) {
      const count = document.createElement('span');
      count.className = 'bs-format-range-count';
      count.textContent = t("0_blocks_984091af", [ranges.length]);
      count.title = t("formatting_applies_to_the_text_selection_across__5ddd30e6");
      toolbar.appendChild(count);
    }
    const markState = (type) => {
      const states = ranges.map((range) => Core.inlineMarkRangeState(Core.getBlock(this.page, range.blockId), range.from, range.to, type));
      if (states.every((value) => value === 'active')) return 'active';
      if (states.every((value) => value === 'inactive')) return 'inactive';
      return 'mixed';
    };
    const button = (iconName, label, type, handler) => {
      const element = document.createElement('button');
      element.type = 'button';
      const formatState = type ? markState(type) : 'inactive';
      element.className = `bs-format-button${formatState === 'active' ? ' is-active' : formatState === 'mixed' ? ' is-mixed' : ''}`;
      if (formatState === 'mixed') element.setAttribute('aria-pressed', 'mixed');
      else if (type) element.setAttribute('aria-pressed', formatState === 'active' ? 'true' : 'false');
      element.setAttribute('aria-label', label);
      element.title = label;
      const icon = document.createElement('span');
      icon.className = 'bs-format-icon';
      setIcon(icon, iconName);
      element.appendChild(icon);
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handler(event, element);
      });
      toolbar.appendChild(element);
      return element;
    };
    button('bold', t("bold_ctrl_cmd_b_f08383b6"), 'bold', () => this.applyInlineFormat('bold'));
    button('italic', t("italic_ctrl_cmd_i_9eb54e4b"), 'italic', () => this.applyInlineFormat('italic'));
    button('underline', t("underline_ctrl_cmd_u_7751839f"), 'underline', () => this.applyInlineFormat('underline'));
    button('strikethrough', t("strikethrough_ctrl_cmd_shift_s_fcdc21da"), 'strike', () => this.applyInlineFormat('strike'));
    button('code-2', t("inline_code_6711d910"), 'code', () => this.applyInlineFormat('code'));
    toolbar.appendChild(document.createElement('span')).className = 'bs-format-separator';
    button('link', t("add_or_edit_link_ctrl_cmd_k_902f60cc"), 'link', () => this.openLinkForSelection());
    const textButton = button('palette', t("text_color_f21ef4ab"), null, (_event, element) => this.toggleInlineColorPalette(element, 'textColor'));
    const textMark = active.find((mark) => mark.type === 'textColor');
    if (textMark) textButton.dataset.activeColor = textMark.value;
    const highlightButton = button('highlighter', t("highlight_color_d1bbaa6f"), null, (_event, element) => this.toggleInlineColorPalette(element, 'highlight'));
    const highlightMark = active.find((mark) => mark.type === 'highlight');
    if (highlightMark) highlightButton.dataset.activeColor = highlightMark.value;
    toolbar.appendChild(document.createElement('span')).className = 'bs-format-separator';
    button('remove-formatting', t("clear_formatting_ctrl_cmd_a149c504"), null, () => this.clearInlineFormatting());
    document.body.appendChild(toolbar);
    this.formatToolbarEl = toolbar;
    const win = document.defaultView;
    win.requestAnimationFrame(() => {
      if (!this.formatToolbarEl || !this.formatToolbarState) return;
      const bounds = toolbar.getBoundingClientRect();
      const margin = 8;
      const center = state.rect.left + state.rect.width / 2;
      const left = Math.max(margin + bounds.width / 2, Math.min(win.innerWidth - margin - bounds.width / 2, center));
      let top = state.rect.top - 8;
      toolbar.style.left = `${left}px`;
      if (top - bounds.height < margin) {
        top = state.rect.bottom + 8;
        toolbar.classList.add('is-below');
        const maxTop = win.innerHeight - margin - bounds.height;
        if (top > maxTop) top = Math.max(margin, maxTop);
        toolbar.style.top = `${top}px`;
        toolbar.style.transform = 'translateX(-50%)';
      } else {
        toolbar.style.top = `${top}px`;
        toolbar.style.transform = 'translate(-50%, -100%)';
      }
    });
  }

  toggleInlineColorPalette(anchor, type) {
    if (!this.formatToolbarEl) return;
    const existing = this.formatToolbarEl.querySelector('.bs-format-palette');
    if (existing) {
      existing.remove();
      if (existing.dataset.type === type) return;
    }
    const palette = this.formatToolbarEl.ownerDocument.createElement('div');
    palette.className = 'bs-format-palette';
    palette.dataset.type = type;
    for (const color of STYLE_COLORS) {
      const swatch = palette.ownerDocument.createElement('button');
      swatch.type = 'button';
      swatch.className = `bs-format-swatch is-${type === 'textColor' ? 'text' : 'highlight'}-${color}`;
      swatch.setAttribute('aria-label', `${type === 'textColor' ? t("text_14b69bd6") : t("highlight_05f95456")}：${STYLE_COLOR_LABELS[color]}`);
      swatch.title = STYLE_COLOR_LABELS[color];
      if (color === 'default') setIcon(swatch, 'rotate-ccw');
      swatch.addEventListener('mousedown', (event) => event.preventDefault());
      swatch.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.applyInlineFormat(type, color);
      });
      palette.appendChild(swatch);
    }
    this.formatToolbarEl.appendChild(palette);
    const anchorRect = anchor.getBoundingClientRect();
    const toolbarRect = this.formatToolbarEl.getBoundingClientRect();
    palette.style.left = `${Math.max(8, anchorRect.left - toolbarRect.left - 80)}px`;
  }

  refreshEditorsForRanges(ranges) {
    for (const range of ranges || []) {
      const editor = this.contentEl.querySelector(`[data-block-id="${range.blockId}"] .bs-block-editor`);
      const block = Core.getBlock(this.page, range.blockId);
      if (editor && block) renderInlineContent(editor, block);
    }
  }

  applyInlineFormat(type, value) {
    const state = this.formatToolbarState;
    if (!state || !this.page) return;
    const ranges = Array.isArray(state.ranges) && state.ranges.length
      ? state.ranges.map((range) => ({ ...range }))
      : [{ blockId: state.blockId, from: state.from, to: state.to }];
    this.performMutation(type === 'textColor' ? t("change_text_color_b73dd7c9") : type === 'highlight' ? t("change_highlight_color_2a3c2d65") : t("change_text_formatting_cde49205"), (page) => {
      Core.applyInlineMarkToRanges(page, ranges, type, value);
    }, {
      render: false,
      selectionBefore: { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges },
      selectionAfter: { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges },
    });
    this.refreshEditorsForRanges(ranges);
    const logical = { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges };
    setLogicalTextSelection(this, logical);
    this.logicalSelection = logical;
    this.formatToolbarState = { ...state, type: logical.type, ranges };
    this.scheduleFormatToolbarUpdate();
  }

  clearInlineFormatting() {
    const state = this.formatToolbarState;
    if (!state || !this.page) return;
    const ranges = Array.isArray(state.ranges) && state.ranges.length
      ? state.ranges.map((range) => ({ ...range }))
      : [{ blockId: state.blockId, from: state.from, to: state.to }];
    this.performMutation(t("clear_text_formatting_fc399ff4"), (page) => {
      Core.clearInlineMarksFromRanges(page, ranges);
    }, {
      render: false,
      selectionBefore: { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges },
      selectionAfter: { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges },
    });
    this.refreshEditorsForRanges(ranges);
    const logical = { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges };
    setLogicalTextSelection(this, logical);
    this.logicalSelection = logical;
    this.formatToolbarState = { ...state, type: logical.type, ranges };
    this.scheduleFormatToolbarUpdate();
  }

  openLinkForSelection() {
    const state = this.formatToolbarState;
    if (!state || !this.page) return;
    const ranges = Array.isArray(state.ranges) && state.ranges.length ? state.ranges : [{ blockId: state.blockId, from: state.from, to: state.to }];
    const firstRange = ranges[0];
    const block = Core.getBlock(this.page, firstRange.blockId);
    const existing = block && block.marks.find((mark) => mark.type === 'link' && mark.from <= firstRange.from && mark.to >= firstRange.to);
    const saved = { ...state };
    new LinkInputModal(this.app, existing ? existing.value : '', (value) => {
      this.formatToolbarState = saved;
      this.applyInlineFormat('link', value);
    }).open();
  }

  isCompactLayout() {
    const win = this.contentEl && this.contentEl.ownerDocument ? this.contentEl.ownerDocument.defaultView : null;
    return !!win && win.matchMedia && win.matchMedia('(max-width: 1050px)').matches;
  }

  captureScrollAnchor(scroll) {
    if (!scroll) return null;
    const scrollRect = scroll.getBoundingClientRect();
    const anchor = Array.from(scroll.querySelectorAll('.bs-block[data-block-id]')).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > scrollRect.top + 1 && rect.top < scrollRect.bottom;
    });
    if (!anchor) return null;
    return {
      blockId: anchor.dataset.blockId,
      offset: anchor.getBoundingClientRect().top - scrollRect.top,
    };
  }

  restoreScrollAnchor(scroll, anchor) {
    if (!scroll || !anchor || !anchor.blockId) return false;
    const target = Array.from(scroll.querySelectorAll('.bs-block[data-block-id]'))
      .find((element) => element.dataset.blockId === anchor.blockId);
    if (!target) return false;
    const delta = target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (Number(anchor.offset) || 0);
    if (Math.abs(delta) > 0.5) scroll.scrollTop += delta;
    return true;
  }

  captureViewState() {
    if (!this.contentEl || !this.page) return null;
    const currentRoot = this.contentEl.querySelector('.blockspace-workspace');
    if (currentRoot && currentRoot.dataset.pageId && currentRoot.dataset.pageId !== this.page.id) return null;
    const scroll = this.contentEl.querySelector('.bs-document-scroll');
    if (scroll) this.scrollPositions.set(this.page.id, scroll.scrollTop);
    const baseState = {
      scrollTop: scroll ? scroll.scrollTop : 0,
      scrollAnchor: this.captureScrollAnchor(scroll),
      readingMode: this.readingMode,
    };
    const active = this.contentEl.ownerDocument.activeElement;
    if (!active || !this.contentEl.contains(active)) return baseState;
    if (active.matches('.bs-page-title')) return { ...baseState, target: 'title', offset: getCaretOffset(active) };
    if (active.matches('.bs-markdown-source-editor')) {
      const wrapper = active.closest('.bs-block');
      return { ...baseState, target: 'markdown', blockId: wrapper && wrapper.dataset.blockId, offset: active.selectionStart || 0, to: active.selectionEnd || active.selectionStart || 0 };
    }
    if (active.matches('.bs-block-editor')) {
      const wrapper = active.closest('.bs-block');
      const selection = getTextSelectionOffsets(active);
      return {
        ...baseState,
        target: 'block',
        blockId: wrapper && wrapper.dataset.blockId,
        offset: selection ? selection.from : getCaretOffset(active),
        to: selection ? selection.to : getCaretOffset(active),
      };
    }
    if (this.selectedBlockIds.size) return {
      ...baseState,
      target: 'blocks',
      blockIds: this.getOrderedSelectedBlockIds(),
      anchorId: this.blockSelectionAnchorId,
      focusId: this.blockSelectionFocusId,
    };
    return baseState;
  }

  restoreViewState(state) {
    if (!this.contentEl || !this.page) return;
    if (state && typeof state.readingMode === 'boolean' && state.readingMode !== this.readingMode) return;
    const scroll = this.contentEl.querySelector('.bs-document-scroll');
    const savedScroll = state && Number.isFinite(state.scrollTop) ? state.scrollTop : (this.scrollPositions.get(this.page.id) || 0);
    if (scroll) {
      scroll.scrollTop = savedScroll;
      const anchor = state && state.scrollAnchor;
      const generation = this.markdownRenderGeneration;
      const restoreAnchor = () => {
        if (generation !== this.markdownRenderGeneration || !this.contentEl.contains(scroll)) return;
        this.restoreScrollAnchor(scroll, anchor);
      };
      restoreAnchor();
      const win = scroll.ownerDocument.defaultView;
      if (anchor && win && typeof win.requestAnimationFrame === 'function') {
        win.requestAnimationFrame(() => {
          restoreAnchor();
          win.requestAnimationFrame(restoreAnchor);
        });
      }
    }
    if (!state || this.isComposing) return;
    let target = null;
    if (state.target === 'blocks' && Array.isArray(state.blockIds)) {
      this.setBlockSelection(state.blockIds, state.anchorId, state.focusId);
      return;
    }
    if (state.target === 'title') target = this.contentEl.querySelector('.bs-page-title');
    else if (state.target === 'block' && state.blockId) {
      this.activateTextBlockEditor(state.blockId);
      target = this.contentEl.querySelector(`[data-block-id="${state.blockId}"] .bs-block-editor`);
    } else if (state.target === 'markdown' && state.blockId) {
      this.activateMarkdownBlockEditor(state.blockId);
      target = this.contentEl.querySelector(`[data-block-id="${state.blockId}"] .bs-markdown-source-editor`);
    }
    if (target) {
      target.focus({ preventScroll: true });
      const from = Math.min(Number(state.offset) || 0, String(target.textContent || '').length);
      const to = Math.min(state.to == null ? from : Number(state.to) || from, String(target.textContent || '').length);
      if (state.target === 'block') setTextSelection(target, from, to);
      else if (state.target === 'markdown' && typeof target.setSelectionRange === 'function') target.setSelectionRange(from, to);
      else placeCaret(target, from);
      if (state.target === 'block') this.setInteractionState(to === from ? 'text-editing' : 'text-selecting', { blockId: state.blockId, from, to });
    }
  }

  clearDropTargets() {
    this.contentEl.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-target, .is-column-drop-target').forEach((element) => {
      element.removeClass('is-drop-before');
      element.removeClass('is-drop-after');
      element.removeClass('is-drop-target');
      element.removeClass('is-column-drop-target');
    });
    if (this.dropHintEl) this.dropHintEl.remove();
    this.dropHintEl = null;
    this.dropPosition = null;
  }

  showDropHint(wrapper, block, position, sourceIds = []) {
    if (this.dropHintEl) this.dropHintEl.remove();
    const hint = wrapper.ownerDocument.createElement('div');
    hint.className = `bs-drop-hint is-${position}`;
    const label = truncateBlockLabel(block);
    hint.textContent = position === 'inside'
      ? t("move_into_0_faf38ba0", [label])
      : position === 'before'
        ? t("place_before_0_901f33fd", [label])
        : t("place_after_0_00b77b15", [label]);
    if (sourceIds.length > 1) hint.dataset.count = String(sourceIds.length);
    wrapper.appendChild(hint);
    this.dropHintEl = hint;
  }

  createDragPreview(event, sourceIds) {
    if (!event.dataTransfer || !this.contentEl) return;
    if (this.dragPreviewEl) this.dragPreviewEl.remove();
    const document = this.contentEl.ownerDocument;
    const preview = document.createElement('div');
    preview.className = 'bs-drag-preview';
    const roots = Core.normalizeTopLevelSelection(this.page, sourceIds);
    const first = roots.length && Core.getBlock(this.page, roots[0]);
    preview.textContent = roots.length > 1
      ? t("0_blocks_dcde334a", [roots.length])
      : `☷ ${truncateBlockLabel(first)}`;
    document.body.appendChild(preview);
    this.dragPreviewEl = preview;
    event.dataTransfer.setDragImage(preview, 18, 18);
    document.defaultView.setTimeout(() => {
      if (this.dragPreviewEl === preview) this.dragPreviewEl = null;
      preview.remove();
    }, 0);
  }

  openQuickSwitcher() {
    new BlockspaceQuickSwitcherModal(this.app, this.plugin, this).open();
  }

  ensureFindTextIndex() {
    if (!this.page) return { pageId: '', entries: [] };
    if (!this.findTextIndex
      || this.findTextIndex.pageId !== this.page.id
      || this.findTextIndexGeneration !== this.changeGeneration) {
      this.findTextIndex = Core.createPageTextIndex(this.page);
      this.findTextIndexGeneration = this.changeGeneration;
    }
    return this.findTextIndex;
  }

  scheduleFindRefresh(options = {}, delay = FIND_INPUT_DEBOUNCE_MS) {
    if (!this.contentEl || !this.contentEl.ownerDocument) return;
    const win = this.contentEl.ownerDocument.defaultView;
    if (this.findSearchTimer !== null) win.clearTimeout(this.findSearchTimer);
    this.pendingFindRefreshOptions = { ...(this.pendingFindRefreshOptions || {}), ...options };
    this.findReplaceState.searching = true;
    this.updateFindControls();
    this.findSearchTimer = win.setTimeout(() => {
      this.findSearchTimer = null;
      const pending = this.pendingFindRefreshOptions || {};
      this.pendingFindRefreshOptions = null;
      this.refreshFindMatches(pending);
    }, Math.max(0, Number(delay) || 0));
  }

  flushScheduledFindRefresh() {
    if (this.findSearchTimer === null || !this.contentEl || !this.contentEl.ownerDocument) return;
    const win = this.contentEl.ownerDocument.defaultView;
    win.clearTimeout(this.findSearchTimer);
    this.findSearchTimer = null;
    const pending = this.pendingFindRefreshOptions || {};
    this.pendingFindRefreshOptions = null;
    this.refreshFindMatches(pending);
  }

  findOptions() {
    return {
      matchCase: this.findReplaceState.matchCase,
      wholeWord: this.findReplaceState.wholeWord,
    };
  }

  selectedTextForFind() {
    if (!this.page || !this.contentEl) return '';
    const logical = getLogicalTextSelection(this.contentEl, this.page);
    if (!logical || logical.ranges.length !== 1) return '';
    const range = logical.ranges[0];
    const block = Core.getBlock(this.page, range.blockId);
    if (!block || range.to <= range.from) return '';
    const text = block.text.slice(range.from, range.to);
    return text.length <= 160 && !/[\r\n]/.test(text) ? text : '';
  }

  openFindReplace(showReplace = false) {
    if (!this.page) return;
    const state = this.findReplaceState;
    const wasOpen = state.open;
    const selectedText = !wasOpen ? this.selectedTextForFind() : '';
    this.commitPendingEdit();
    this.activeTab = 'document';
    this.readingMode = false;
    state.open = true;
    state.showReplace = Boolean(showReplace);
    if (selectedText) state.query = selectedText;
    state.focusTarget = showReplace && wasOpen ? 'replacement' : 'query';
    this.refreshFindMatches({ resetActive: !wasOpen || Boolean(selectedText) });
    this.render();
  }

  closeFindReplace(options = {}) {
    const state = this.findReplaceState;
    if (!state) return;
    if (this.findSearchTimer !== null && this.contentEl && this.contentEl.ownerDocument) {
      this.contentEl.ownerDocument.defaultView.clearTimeout(this.findSearchTimer);
      this.findSearchTimer = null;
    }
    this.pendingFindRefreshOptions = null;
    const restoreFocus = options.restoreFocus !== false;
    const activeMatch = state.matches[state.activeIndex] || null;
    const target = restoreFocus && activeMatch ? this.findElementForMatch(activeMatch) : null;
    this.clearFindHighlights();
    if (this.findReplaceEl) this.findReplaceEl.remove();
    this.findReplaceEl = null;
    this.findCountEl = null;
    this.findPreviousButton = null;
    this.findNextButton = null;
    this.findReplaceButton = null;
    this.findReplaceAllButton = null;
    state.open = false;
    state.matches = [];
    state.activeIndex = -1;
    state.searching = false;
    state.truncated = false;
    if (target && target.isConnected && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
      if (target.matches('.bs-block-editor, .bs-page-title')) {
        setTextSelection(target, activeMatch.from, activeMatch.to);
      }
    }
  }

  findElementForMatch(match) {
    if (!match || !this.contentEl) return null;
    if (match.kind === 'title') return this.contentEl.querySelector('.bs-page-title');
    if (!match.blockId) return null;
    const wrapper = this.contentEl.querySelector(`.bs-block[data-block-id="${match.blockId}"]`);
    if (!wrapper) return null;
    return wrapper.querySelector('.bs-block-editor')
      || wrapper.querySelector('.bs-markdown-source-editor:not([hidden])')
      || wrapper;
  }

  clearFindHighlights() {
    if (!this.contentEl || !this.contentEl.ownerDocument) return;
    const win = this.contentEl.ownerDocument.defaultView;
    if (this.findHighlightFrame !== null) {
      win.cancelAnimationFrame(this.findHighlightFrame);
      this.findHighlightFrame = null;
    }
    const registry = win.CSS && win.CSS.highlights;
    if (registry) {
      registry.delete('blockspace-find-match');
      registry.delete('blockspace-find-active');
    }
    this.contentEl.querySelectorAll('.is-find-match-block, .is-find-active-block, .is-find-match-title, .is-find-active-title')
      .forEach((element) => element.removeClass('is-find-match-block', 'is-find-active-block', 'is-find-match-title', 'is-find-active-title'));
  }

  queueFindHighlights() {
    if (!this.contentEl || !this.contentEl.ownerDocument) return;
    const win = this.contentEl.ownerDocument.defaultView;
    if (this.findHighlightFrame !== null) win.cancelAnimationFrame(this.findHighlightFrame);
    this.findHighlightFrame = win.requestAnimationFrame(() => {
      this.findHighlightFrame = null;
      this.applyFindHighlights();
    });
  }

  applyFindHighlights() {
    this.clearFindHighlights();
    const state = this.findReplaceState;
    if (!state.open || !state.query || !state.matches.length || !this.contentEl) return;
    const win = this.contentEl.ownerDocument.defaultView;
    const inactiveRanges = [];
    const activeRanges = [];
    const highlightIndexes = [];
    const firstLimit = Math.min(state.matches.length, MAX_FIND_HIGHLIGHTS);
    for (let index = 0; index < firstLimit; index += 1) highlightIndexes.push(index);
    if (state.activeIndex >= firstLimit && state.activeIndex < state.matches.length) highlightIndexes.push(state.activeIndex);
    highlightIndexes.forEach((index) => {
      const match = state.matches[index];
      const target = this.findElementForMatch(match);
      if (!target) return;
      const active = index === state.activeIndex;
      if (match.kind === 'title') target.addClass(active ? 'is-find-active-title' : 'is-find-match-title');
      else target.closest('.bs-block')?.addClass(active ? 'is-find-active-block' : 'is-find-match-block');
      if (target.matches('textarea, input') || target === target.closest('.bs-block')) return;
      const range = createTextDomRange(target, match.from, match.to);
      if (range) (active ? activeRanges : inactiveRanges).push(range);
    });
    const registry = win.CSS && win.CSS.highlights;
    const HighlightCtor = win.Highlight;
    if (registry && typeof HighlightCtor === 'function') {
      if (inactiveRanges.length) registry.set('blockspace-find-match', new HighlightCtor(...inactiveRanges));
      if (activeRanges.length) registry.set('blockspace-find-active', new HighlightCtor(...activeRanges));
    }
  }

  updateFindControls() {
    const state = this.findReplaceState;
    const count = state.matches.length;
    const position = count && state.activeIndex >= 0 ? state.activeIndex + 1 : 0;
    if (this.findCountEl) {
      this.findCountEl.textContent = state.searching
        ? '…'
        : state.query ? `${position}/${count}${state.truncated ? '+' : ''}` : '0/0';
      this.findCountEl.title = state.truncated ? t("more_than_0_results_navigation_has_been_limited_93870376", [MAX_FIND_MATCHES]) : '';
    }
    for (const button of [this.findPreviousButton, this.findNextButton, this.findReplaceButton]) {
      if (button) button.disabled = count === 0;
    }
    if (this.findReplaceAllButton) this.findReplaceAllButton.disabled = count === 0;
  }

  refreshFindMatches(options = {}) {
    const state = this.findReplaceState;
    state.searching = false;
    state.matches = this.page && state.query
      ? Core.findPageTextIndex(this.ensureFindTextIndex(), state.query, {
        ...this.findOptions(),
        maxMatches: MAX_FIND_MATCHES,
      })
      : [];
    state.truncated = Boolean(state.matches.truncated);
    if (!state.matches.length) state.activeIndex = -1;
    else if (options.resetActive || state.activeIndex < 0) state.activeIndex = 0;
    else state.activeIndex = Math.min(state.activeIndex, state.matches.length - 1);
    this.updateFindControls();
    this.queueFindHighlights();
    if (options.scroll && state.activeIndex >= 0) this.scrollToActiveFindMatch();
  }

  scrollToActiveFindMatch() {
    const state = this.findReplaceState;
    const match = state.matches[state.activeIndex];
    const target = this.findElementForMatch(match);
    if (!target) return false;
    const scrollTarget = match.kind === 'title' ? target : (target.closest('.bs-block') || target);
    scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    return true;
  }

  navigateFindMatch(direction = 1) {
    this.flushScheduledFindRefresh();
    const state = this.findReplaceState;
    if (!state.matches.length) return;
    state.activeIndex = (state.activeIndex + direction + state.matches.length) % state.matches.length;
    this.updateFindControls();
    this.queueFindHighlights();
    this.scrollToActiveFindMatch();
  }

  replaceCurrentFindMatch() {
    this.flushScheduledFindRefresh();
    const state = this.findReplaceState;
    const match = state.matches[state.activeIndex];
    if (!match) return;
    let replaced = false;
    const changed = this.performMutation(t("replace_text_353d819b"), (page) => {
      replaced = Core.replacePageTextMatch(page, match, state.replacement);
    }, { render: false });
    if (!replaced || !changed) {
      this.refreshFindMatches({ resetActive: false });
      return;
    }
    state.focusTarget = 'replacement';
    this.refreshFindMatches({ resetActive: false });
    this.render();
    this.scrollToActiveFindMatch();
  }

  replaceAllFindMatches() {
    this.flushScheduledFindRefresh();
    const state = this.findReplaceState;
    if (!state.query || !state.matches.length) return;
    let replaced = 0;
    const changed = this.performMutation(t("replace_all_0_2a5238db", [state.query]), (page) => {
      replaced = Core.replaceAllPageText(page, state.query, state.replacement, this.findOptions());
    }, { render: false });
    if (!changed || !replaced) return;
    state.focusTarget = 'replacement';
    this.refreshFindMatches({ resetActive: true });
    this.render();
    new Notice(t("replaced_0_matches_ctrl_cmd_z_undoes_them_in_one_ccc22e64", [replaced]));
  }

  setFindReplacePosition(bar, x, y) {
    if (!bar || !bar.parentElement) return null;
    const root = bar.parentElement;
    const margin = 8;
    const maxX = Math.max(margin, root.clientWidth - bar.offsetWidth - margin);
    const maxY = Math.max(margin, root.clientHeight - bar.offsetHeight - margin);
    const position = {
      x: Math.max(margin, Math.min(maxX, Number(x) || margin)),
      y: Math.max(margin, Math.min(maxY, Number(y) || margin)),
    };
    this.findReplaceState.position = position;
    bar.style.left = `${Math.round(position.x)}px`;
    bar.style.top = `${Math.round(position.y)}px`;
    bar.style.right = 'auto';
    return position;
  }

  applyFindReplacePosition(bar) {
    const position = this.findReplaceState.position;
    if (!bar || !position || !bar.ownerDocument) return;
    bar.ownerDocument.defaultView.requestAnimationFrame(() => {
      if (bar.isConnected) this.setFindReplacePosition(bar, position.x, position.y);
    });
  }

  resetFindReplacePosition(bar = this.findReplaceEl) {
    this.findReplaceState.position = null;
    if (!bar) return;
    bar.style.removeProperty('left');
    bar.style.removeProperty('top');
    bar.style.removeProperty('right');
  }

  moveFindReplaceWithKeyboard(event, bar) {
    if (!bar || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') {
      this.resetFindReplacePosition(bar);
      return true;
    }
    const rootRect = bar.parentElement.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const currentX = barRect.left - rootRect.left;
    const currentY = barRect.top - rootRect.top;
    const step = event.shiftKey ? 40 : 12;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    this.setFindReplacePosition(bar, currentX + dx, currentY + dy);
    return true;
  }

  beginFindReplaceDrag(event, bar, handle) {
    if (!bar || !handle || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const root = bar.parentElement;
    const rootRect = root.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const startX = barRect.left - rootRect.left;
    const startY = barRect.top - rootRect.top;
    const pointerX = event.clientX;
    const pointerY = event.clientY;
    const ownerWindow = bar.ownerDocument && bar.ownerDocument.defaultView;
    if (!ownerWindow) return;
    bar.addClass('is-dragging');
    try {
      handle.setPointerCapture(event.pointerId);
    } catch (_error) {
      // Window-level listeners below keep dragging reliable even when the
      // embedded browser declines pointer capture.
    }
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      this.setFindReplacePosition(
        bar,
        startX + moveEvent.clientX - pointerX,
        startY + moveEvent.clientY - pointerY,
      );
    };
    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== event.pointerId) return;
      try {
        if (handle.hasPointerCapture(finishEvent.pointerId)) handle.releasePointerCapture(finishEvent.pointerId);
      } catch (_error) {
        // The pointer may already have been released by the host window.
      }
      ownerWindow.removeEventListener('pointermove', move);
      ownerWindow.removeEventListener('pointerup', finish);
      ownerWindow.removeEventListener('pointercancel', finish);
      bar.removeClass('is-dragging');
    };
    ownerWindow.addEventListener('pointermove', move);
    ownerWindow.addEventListener('pointerup', finish);
    ownerWindow.addEventListener('pointercancel', finish);
  }

  renderFindReplaceBar(root) {
    const state = this.findReplaceState;
    if (!state.open) return;
    const bar = root.createDiv({ cls: `bs-find-replace${state.showReplace ? ' is-replace-open' : ''}` });
    bar.setAttribute('role', 'search');
    bar.setAttribute('aria-label', t("find_and_replace_in_the_current_page_4110c3c0"));
    this.findReplaceEl = bar;

    const dragHandle = bar.createEl('button', {
      cls: 'bs-find-drag-handle',
      attr: {
        type: 'button',
        'aria-label': t("drag_the_find_panel_use_arrow_keys_to_adjust_hom_21891eb4"),
        title: t("drag_to_move_arrow_keys_to_adjust_double_click_o_c83b847b"),
      },
    });
    dragHandle.addEventListener('pointerdown', (event) => this.beginFindReplaceDrag(event, bar, dragHandle));
    dragHandle.addEventListener('keydown', (event) => this.moveFindReplaceWithKeyboard(event, bar));
    dragHandle.addEventListener('dblclick', () => this.resetFindReplacePosition(bar));

    const findRow = bar.createDiv({ cls: 'bs-find-row' });
    const expand = createButton(findRow, 'bs-find-icon-button bs-find-expand', state.showReplace ? t("collapse_replace_953a5204") : t("expand_replace_c03dbad7"), state.showReplace ? 'chevron-up' : 'chevron-down');
    expand.setAttribute('aria-expanded', state.showReplace ? 'true' : 'false');
    expand.addEventListener('click', () => {
      state.showReplace = !state.showReplace;
      state.focusTarget = state.showReplace ? 'replacement' : 'query';
      this.render();
    });
    const queryShell = findRow.createDiv({ cls: 'bs-find-input-shell' });
    const queryInput = queryShell.createEl('input', {
      cls: 'bs-find-input',
      attr: {
        type: 'text',
        value: state.query,
        placeholder: t("find_3003318e"),
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': t("find_text_cf80efcb"),
      },
    });
    queryInput.value = state.query;
    queryInput.addEventListener('input', () => {
      state.query = queryInput.value;
      this.scheduleFindRefresh({ resetActive: true, scroll: true });
    });
    queryInput.addEventListener('compositionend', () => this.scheduleFindRefresh({ resetActive: true, scroll: true }, 0));
    queryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.navigateFindMatch(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeFindReplace();
      }
    });
    const count = queryShell.createSpan({ cls: 'bs-find-count', attr: { 'aria-live': 'polite' } });
    this.findCountEl = count;
    const caseButton = createButton(findRow, 'bs-find-text-button', t("match_case_8c7e3447"), null, 'Aa');
    caseButton.toggleClass('is-active', state.matchCase);
    caseButton.setAttribute('aria-pressed', state.matchCase ? 'true' : 'false');
    caseButton.addEventListener('click', () => {
      state.matchCase = !state.matchCase;
      caseButton.toggleClass('is-active', state.matchCase);
      caseButton.setAttribute('aria-pressed', state.matchCase ? 'true' : 'false');
      this.scheduleFindRefresh({ resetActive: true, scroll: true }, 0);
    });
    const wholeWordButton = createButton(findRow, 'bs-find-text-button', t("whole_words_7fff7e76"), null, t("word_52ff1aed"));
    wholeWordButton.toggleClass('is-active', state.wholeWord);
    wholeWordButton.setAttribute('aria-pressed', state.wholeWord ? 'true' : 'false');
    wholeWordButton.addEventListener('click', () => {
      state.wholeWord = !state.wholeWord;
      wholeWordButton.toggleClass('is-active', state.wholeWord);
      wholeWordButton.setAttribute('aria-pressed', state.wholeWord ? 'true' : 'false');
      this.scheduleFindRefresh({ resetActive: true, scroll: true }, 0);
    });
    this.findPreviousButton = createButton(findRow, 'bs-find-icon-button', t("previous_result_shift_enter_543d0244"), 'chevron-up');
    this.findPreviousButton.addEventListener('click', () => this.navigateFindMatch(-1));
    this.findNextButton = createButton(findRow, 'bs-find-icon-button', t("next_result_enter_e7bd4382"), 'chevron-down');
    this.findNextButton.addEventListener('click', () => this.navigateFindMatch(1));
    const close = createButton(findRow, 'bs-find-icon-button', t("close_find_baeda7e7"), 'x');
    close.addEventListener('click', () => this.closeFindReplace());

    let replaceInput = null;
    if (state.showReplace) {
      const replaceRow = bar.createDiv({ cls: 'bs-replace-row' });
      replaceRow.createSpan({ cls: 'bs-replace-indent', attr: { 'aria-hidden': 'true' } });
      replaceInput = replaceRow.createEl('input', {
        cls: 'bs-find-input',
        attr: {
          type: 'text',
          value: state.replacement,
          placeholder: t("replace_with_7d37f059"),
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': t("replace_with_7d37f059"),
        },
      });
      replaceInput.value = state.replacement;
      replaceInput.addEventListener('input', () => { state.replacement = replaceInput.value; });
      replaceInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          this.replaceCurrentFindMatch();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.closeFindReplace();
        }
      });
      this.findReplaceButton = createButton(replaceRow, 'bs-find-action-button', t("replace_current_match_13d723a1"), null, t("replace_131b13aa"));
      this.findReplaceButton.addEventListener('click', () => this.replaceCurrentFindMatch());
      this.findReplaceAllButton = createButton(replaceRow, 'bs-find-action-button', t("replace_all_matches_in_the_current_page_8fb859e9"), null, t("all_5c55a679"));
      this.findReplaceAllButton.addEventListener('click', () => this.replaceAllFindMatches());
    }
    this.updateFindControls();
    this.queueFindHighlights();
    this.applyFindReplacePosition(bar);
    const focusTarget = state.focusTarget;
    state.focusTarget = '';
    root.ownerDocument.defaultView.requestAnimationFrame(() => {
      const target = focusTarget === 'replacement' && replaceInput ? replaceInput : queryInput;
      if (!target || !target.isConnected) return;
      target.focus({ preventScroll: true });
      target.select();
    });
  }

  focusBlock(blockId) {
    if (!this.page || !Core.getBlock(this.page, blockId)) return false;
    const collapsedAncestors = Core.getAncestorIds(this.page, blockId)
      .filter((id) => Core.getBlock(this.page, id)?.collapsed);
    const collapsedSections = Core.getCollapsedSectionHeadingIds(this.page, blockId);
    if (collapsedAncestors.length || collapsedSections.length) {
      this.performMutation(t("expand_path_to_target_block_341a62be"), (page) => {
        for (const id of collapsedAncestors) Core.toggleBlockCollapsed(page, id, false);
        for (const id of collapsedSections) Core.toggleHeadingSectionCollapsed(page, id, false);
      });
    }
    const editor = this.contentEl.querySelector(`[data-block-id="${blockId}"] .bs-block-editor`);
    if (!editor) return false;
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
    editor.focus({ preventScroll: true });
    placeCaret(editor, 0);
    editor.closest('.bs-block')?.addClass('is-target-highlight');
    editor.ownerDocument.defaultView.setTimeout(() => editor.closest('.bs-block')?.removeClass('is-target-highlight'), 1800);
    this.setInteractionState('text-editing', { blockId });
    return true;
  }

  toggleFocusMode() {
    this.focusMode = !this.focusMode;
    this.render();
  }

  performMutation(label, mutator, options = {}) {
    if (!this.page) return false;
    this.commitPendingEdit();
    const selectionBefore = options.selectionBefore || this.captureEditorSelection();
    const before = Core.clonePage(this.page);
    mutator(this.page);
    this.page = Core.normalizePage(this.page);
    const transaction = Core.createTransaction(label, before, this.page, {
      ...options,
      selectionBefore,
      selectionAfter: options.selectionAfter || null,
    });
    if (!Core.recordHistory(this.history, transaction)) return false;
    this.updateHistoryControls();
    this.dirty = true;
    this.changeGeneration += 1;
    this.scheduleSave();
    if (options.render !== false) this.render();
    return true;
  }

  refreshBlockAppearance(blockIds) {
    if (!this.page || !this.contentEl) return;
    const blocks = new Map(this.page.blocks.map((block) => [block.id, block]));
    const wrappers = new Map(Array.from(this.contentEl.querySelectorAll('.bs-block[data-block-id]'))
      .map((element) => [element.dataset.blockId, element]));
    for (const blockId of new Set(Array.isArray(blockIds) ? blockIds : [blockIds])) {
      if (!blockId) continue;
      const block = blocks.get(blockId);
      const wrapper = wrappers.get(blockId);
      if (!block || !wrapper) continue;
      const appearance = Core.normalizeBlockAppearance(block.appearance);
      wrapper.dataset.textColor = appearance.textColor;
      wrapper.dataset.background = appearance.background;
      wrapper.dataset.align = appearance.align;
    }
  }

  beginLiveEdit(label, groupKey = label) {
    if (!this.page) return;
    const now = Date.now();
    if (this.pendingEdit && (this.pendingEdit.groupKey !== groupKey || now - this.pendingEdit.lastAt > this.liveEditGroupDelay)) {
      this.commitPendingEdit();
    }
    if (!this.pendingEdit) {
      this.pendingEdit = {
        label,
        groupKey,
        before: Core.clonePage(this.page),
        selectionBefore: this.captureEditorSelection(),
        startedAt: now,
        lastAt: now,
      };
    } else this.pendingEdit.lastAt = now;
  }

  afterLiveEdit(options = {}) {
    this.dirty = true;
    this.changeGeneration += 1;
    this.scheduleSave();
    if (this.pendingEdit) this.pendingEdit.lastAt = Date.now();
    const win = this.contentEl.ownerDocument.defaultView;
    if (this.pendingEditTimer !== null) win.clearTimeout(this.pendingEditTimer);
    if (options.commitNow) {
      this.pendingEditTimer = null;
      this.commitPendingEdit();
      return;
    }
    this.pendingEditTimer = win.setTimeout(() => this.commitPendingEdit(), this.liveEditGroupDelay);
  }

  commitPendingEdit(record = true) {
    if (this.pendingEditTimer !== null && this.contentEl && this.contentEl.ownerDocument) {
      this.contentEl.ownerDocument.defaultView.clearTimeout(this.pendingEditTimer);
      this.pendingEditTimer = null;
    }
    if (!this.pendingEdit || !this.page) {
      this.pendingEdit = null;
      return false;
    }
    const pending = this.pendingEdit;
    this.pendingEdit = null;
    if (!record) return false;
    const transaction = Core.createTransaction(pending.label, pending.before, this.page, {
      selectionBefore: pending.selectionBefore || null,
      selectionAfter: this.captureEditorSelection(),
    });
    const recorded = Core.recordHistory(this.history, transaction);
    if (recorded) this.updateHistoryControls();
    return recorded;
  }

  undo() {
    if (!this.page) return;
    this.commitPendingEdit();
    const result = Core.undoHistory(this.history, this.page);
    if (!result) return;
    this.page = result.page;
    this.dirty = true;
    this.changeGeneration += 1;
    this.scheduleSave();
    if (this.findReplaceState.open) this.refreshFindMatches({ resetActive: true });
    this.render();
    if (result.selection) this.restoreEditorSelection(result.selection);
  }

  redo() {
    if (!this.page) return;
    this.commitPendingEdit();
    const result = Core.redoHistory(this.history, this.page);
    if (!result) return;
    this.page = result.page;
    this.dirty = true;
    this.changeGeneration += 1;
    this.scheduleSave();
    if (this.findReplaceState.open) this.refreshFindMatches({ resetActive: true });
    this.render();
    if (result.selection) this.restoreEditorSelection(result.selection);
  }

  async onOpen() {
    this.plugin.views.add(this);
    this.plugin.lastActiveView = this;
    await this.plugin.ensureStore();
    // init() seeds a default page, so the index is normally non-empty. Reading
    // pages[0].id unguarded turned any empty index into a TypeError that
    // rejected onOpen and left a blank leaf with no explanation.
    const { activePageId, pages } = this.plugin.store.workspace;
    const activeId = activePageId || (pages.length ? pages[0].id : null);
    this.setPage(activeId ? await this.plugin.store.loadPage(activeId) : null);
    this.installNativeHeaderActions();
    this.render();
    this.contentEl.addEventListener('keydown', this.boundKeydown);
    this.contentEl.addEventListener('contextmenu', this.boundContextMenu);
    this.contentEl.ownerDocument.addEventListener('selectionchange', this.boundSelectionChange);
    this.contentEl.ownerDocument.addEventListener('copy', this.boundCopy);
    this.contentEl.ownerDocument.addEventListener('cut', this.boundCut);
    this.contentEl.ownerDocument.addEventListener('pointerup', this.boundPointerUp);
  }

  async onClose() {
    this.contentEl.removeEventListener('keydown', this.boundKeydown);
    this.contentEl.removeEventListener('contextmenu', this.boundContextMenu);
    this.contentEl.ownerDocument.removeEventListener('selectionchange', this.boundSelectionChange);
    this.contentEl.ownerDocument.removeEventListener('copy', this.boundCopy);
    this.contentEl.ownerDocument.removeEventListener('cut', this.boundCut);
    this.contentEl.ownerDocument.removeEventListener('pointerup', this.boundPointerUp);
    this.closeFormatToolbar();
    this.closeBlockSelectionToolbar();
    this.closeFindReplace({ restoreFocus: false });
    this.unloadMarkdownRenderComponents();
    this.disconnectNativePreviewObserver();
    this.disconnectImageWrapObservers();
    this.closeReferencePreview();
    this.cancelDragAutoScroll();
    this.commitPendingEdit();
    await this.flushSave();
    this.plugin.views.delete(this);
    if (this.plugin.lastActiveView === this) this.plugin.lastActiveView = null;
    this.plugin.notifyContextChanged();
  }

  unloadMarkdownRenderComponents(key = null) {
    if (!this.markdownRenderComponents) return;
    const entries = key == null
      ? Array.from(this.markdownRenderComponents.entries())
      : this.markdownRenderComponents.has(key) ? [[key, this.markdownRenderComponents.get(key)]] : [];
    for (const [entryKey, component] of entries) {
      try { if (component && typeof component.unload === 'function') component.unload(); } catch (error) { console.error('Blockspace: Markdown component unload failed', error); }
      this.markdownRenderComponents.delete(entryKey);
    }
  }

  disconnectNativePreviewObserver() {
    if (this.nativePreviewObserver && typeof this.nativePreviewObserver.disconnect === 'function') {
      this.nativePreviewObserver.disconnect();
    }
    this.nativePreviewObserver = null;
  }

  disconnectImageWrapObservers() {
    for (const record of this.imageWrapObservers || []) {
      if (record.frame) record.ownerWindow.cancelAnimationFrame(record.frame);
      if (record.observer && typeof record.observer.disconnect === 'function') record.observer.disconnect();
    }
    this.imageWrapObservers = [];
  }

  observeImageWrapAlignment(flow, alignment = 'top') {
    const imageBlock = flow && flow.querySelector(':scope > .bs-block-image');
    const imageFrame = imageBlock && imageBlock.querySelector('.bs-image-frame');
    const paragraphs = flow
      ? Array.from(flow.querySelectorAll(':scope > .bs-block-paragraph'))
      : [];
    if (!flow || !imageBlock || !imageFrame || !paragraphs.length) return;
    const ownerWindow = flow.ownerDocument.defaultView;
    const record = { observer: null, frame: 0, ownerWindow };
    const sync = () => {
      if (record.frame) ownerWindow.cancelAnimationFrame(record.frame);
      record.frame = ownerWindow.requestAnimationFrame(() => {
        record.frame = 0;
        if (!flow.isConnected) return;
        flow.style.setProperty('--bs-image-wrap-text-offset', '0px');
        if (alignment === 'top' || ownerWindow.getComputedStyle(imageBlock).float === 'none') return;
        const imageHeight = imageFrame.getBoundingClientRect().height;
        const firstRect = paragraphs[0].getBoundingClientRect();
        const lastRect = paragraphs[paragraphs.length - 1].getBoundingClientRect();
        const textHeight = Math.max(0, lastRect.bottom - firstRect.top);
        if (!imageHeight || textHeight >= imageHeight) return;
        const remaining = imageHeight - textHeight;
        const offset = alignment === 'bottom' ? remaining : remaining / 2;
        flow.style.setProperty('--bs-image-wrap-text-offset', `${Math.max(0, Math.round(offset))}px`);
      });
    };
    if (typeof ownerWindow.ResizeObserver === 'function') {
      record.observer = new ownerWindow.ResizeObserver(sync);
      record.observer.observe(imageFrame);
      for (const paragraph of paragraphs) record.observer.observe(paragraph);
    }
    this.imageWrapObservers.push(record);
    sync();
  }

  scheduleNativePreviewRender(element, callback) {
    if (!element || typeof callback !== 'function') return;
    const win = element.ownerDocument && element.ownerDocument.defaultView;
    if (!win || typeof win.IntersectionObserver !== 'function') {
      callback();
      return;
    }
    if (!this.nativePreviewObserver) {
      const root = element.closest('.bs-document-scroll');
      this.nativePreviewObserver = new win.IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          const renderPreview = entry.target.__blockspaceRenderPreview;
          delete entry.target.__blockspaceRenderPreview;
          if (typeof renderPreview === 'function') renderPreview();
        }
      }, { root, rootMargin: '600px 0px' });
    }
    element.__blockspaceRenderPreview = callback;
    this.nativePreviewObserver.observe(element);
  }

  getMarkdownSourcePath() {
    if (!this.page) return '';
    if (this.page.sourcePath) return normalizePath(this.page.sourcePath);
    const folder = String(this.plugin.settings.exportFolder || DEFAULT_SETTINGS.exportFolder).replace(/^\/+|\/+$/g, '');
    return normalizePath(`${folder}/${Core.safeFileName(this.page.title || t('untitled'))}.md`);
  }

  async openPageAtBlock(pageId, blockId = null) {
    if (!pageId) return false;
    if (!this.page || this.page.id !== pageId) await this.openPage(pageId);
    if (!this.page || this.page.id !== pageId) return false;
    if (blockId) {
      const ownerWindow = this.contentEl.ownerDocument.defaultView;
      ownerWindow.requestAnimationFrame(() => this.focusBlock(blockId));
    }
    return true;
  }

  async openStoredLink(value, event = null) {
    const resolved = this.plugin.store.resolveStoredReference(value, this.page && this.page.id);
    if (resolved && resolved.kind === 'blockspace-page' && resolved.pageId) {
      await this.openPageAtBlock(resolved.pageId);
      return true;
    }
    if (resolved && resolved.kind === 'blockspace-block' && resolved.pageId && resolved.blockId) {
      await this.openPageAtBlock(resolved.pageId, resolved.blockId);
      return true;
    }
    const link = Core.classifyStoredLink(value);
    if (link.kind === 'empty') return false;
    const newLeaf = Boolean(event && (event.ctrlKey || event.metaKey));
    if (link.kind === 'internal') {
      await this.app.workspace.openLinkText(link.target, this.getMarkdownSourcePath(), newLeaf);
      return true;
    }
    if (link.kind === 'blocked') {
      new Notice(t("blockspace_blocked_an_unsafe_or_unsupported_link_010098c0", [link.protocol]));
      return false;
    }
    const win = this.contentEl && this.contentEl.ownerDocument ? this.contentEl.ownerDocument.defaultView : null;
    if (win && typeof win.open === 'function') {
      win.open(link.target, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  }

  closeReferencePreview() {
    if (this.referencePopoverTimer !== null && this.contentEl && this.contentEl.ownerDocument) {
      this.contentEl.ownerDocument.defaultView.clearTimeout(this.referencePopoverTimer);
    }
    this.referencePopoverTimer = null;
    if (this.referencePopoverEl) this.referencePopoverEl.remove();
    this.referencePopoverEl = null;
  }

  scheduleReferencePreviewClose(delay = 140) {
    if (!this.contentEl || !this.contentEl.ownerDocument) return;
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (this.referencePopoverTimer !== null) ownerWindow.clearTimeout(this.referencePopoverTimer);
    this.referencePopoverTimer = ownerWindow.setTimeout(() => this.closeReferencePreview(), delay);
  }

  handleStoredLinkHover(targetEl, value, event, requireModifier = true) {
    if (!targetEl || !value || (requireModifier && !(event.ctrlKey || event.metaKey))) return;
    const resolved = this.plugin.store.resolveStoredReference(value, this.page && this.page.id);
    if (!resolved) return;
    if (resolved.kind === 'obsidian') {
      this.closeReferencePreview();
      this.app.workspace.trigger('hover-link', {
        event,
        source: 'blockspace',
        hoverParent: this,
        targetEl,
        linktext: resolved.target,
        sourcePath: this.getMarkdownSourcePath(),
      });
      return;
    }
    if (resolved.kind !== 'blockspace-page' && resolved.kind !== 'blockspace-block') return;
    const preview = this.plugin.store.getReferencePreview(value, this.page && this.page.id);
    if (!preview) return;
    this.closeReferencePreview();
    const document = targetEl.ownerDocument;
    const ownerWindow = document.defaultView;
    const popover = document.body.createDiv({ cls: 'bs-reference-popover' });
    this.referencePopoverEl = popover;
    popover.dataset.referenceKind = preview.kind;
    const header = popover.createDiv({ cls: 'bs-reference-popover-header' });
    header.createSpan({ cls: 'bs-reference-popover-icon', text: preview.pageIcon || '📄' });
    const heading = header.createDiv({ cls: 'bs-reference-popover-heading' });
    heading.createDiv({ cls: 'bs-reference-popover-title', text: preview.pageTitle });
    heading.createDiv({
      cls: 'bs-reference-popover-meta',
      text: preview.blockId ? t("block_reference_0_backlinks_020424f9", [preview.backlinkCount]) : t("page_0_backlinks_b4c6b94f", [preview.backlinkCount]),
    });
    const body = popover.createDiv({ cls: 'bs-reference-popover-body' });
    if (preview.blockText) body.createDiv({ cls: 'bs-reference-popover-primary', text: preview.blockText });
    for (const child of preview.children) {
      if (!String(child.text || '').trim()) continue;
      body.createDiv({ cls: 'bs-reference-popover-child', text: child.text });
    }
    if (!body.childElementCount) body.createDiv({ cls: 'bs-reference-popover-empty', text: t("empty_page_68b5367d") });
    const footer = popover.createDiv({ cls: 'bs-reference-popover-footer' });
    const open = createButton(footer, 'bs-reference-popover-open', t("open_reference_target_a4aacea7"), 'arrow-up-right', t("open_c771248e"));
    open.addEventListener('click', () => {
      this.closeReferencePreview();
      void this.openPageAtBlock(preview.pageId, preview.blockId);
    });
    popover.addEventListener('mouseenter', () => {
      if (this.referencePopoverTimer !== null) ownerWindow.clearTimeout(this.referencePopoverTimer);
      this.referencePopoverTimer = null;
    });
    popover.addEventListener('mouseleave', () => this.scheduleReferencePreviewClose());
    const rect = targetEl.getBoundingClientRect();
    const width = Math.min(420, Math.max(280, ownerWindow.innerWidth - 24));
    popover.style.width = `${width}px`;
    const left = Math.max(12, Math.min(ownerWindow.innerWidth - width - 12, rect.left));
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.min(ownerWindow.innerHeight - 220, rect.bottom + 8)}px`;
    ownerWindow.requestAnimationFrame(() => {
      if (!this.referencePopoverEl) return;
      const popoverRect = popover.getBoundingClientRect();
      if (popoverRect.bottom > ownerWindow.innerHeight - 12) {
        popover.style.top = `${Math.max(12, rect.top - popoverRect.height - 8)}px`;
      }
    });
  }

  attachRenderedLinkInteractions(container) {
    if (!container || !container.querySelectorAll) return;
    container.querySelectorAll('a').forEach((anchor) => {
      const rawHref = anchor.getAttribute('data-href') || anchor.getAttribute('href') || '';
      const value = anchor.hasClass && anchor.hasClass('internal-link')
        ? `wikilink:${rawHref}`
        : rawHref;
      const resolved = this.plugin.store.resolveStoredReference(value, this.page && this.page.id);
      if (!resolved || (resolved.kind !== 'blockspace-page' && resolved.kind !== 'blockspace-block')) return;
      anchor.addClass && anchor.addClass('bs-rendered-reference-link');
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openStoredLink(value, event);
      });
      anchor.addEventListener('mouseover', (event) => this.handleStoredLinkHover(anchor, value, event, false));
      anchor.addEventListener('mouseout', () => this.scheduleReferencePreviewClose());
    });
  }

  decodeCamoImageUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.hostname !== 'camo.githubusercontent.com') return '';
      const encoded = url.pathname.split('/').filter(Boolean).pop() || '';
      if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) return '';
      const decoded = decodeURIComponent(encoded.match(/.{2}/g).map((pair) => `%${pair}`).join(''));
      const source = new URL(decoded);
      return source.protocol === 'https:' || source.protocol === 'http:' ? source.href : '';
    } catch (error) {
      return '';
    }
  }

  attachRenderedMediaInteractions(container) {
    if (!container || !container.querySelectorAll) return;
    container.querySelectorAll('img').forEach((image) => {
      const document = image.ownerDocument;
      const ownerWindow = document.defaultView;
      const outerLink = image.closest('a');
      if (outerLink) outerLink.classList.add('bs-image-link');
      image.classList.add('bs-rendered-image');

      const fallback = document.createElement('span');
      fallback.className = 'bs-image-fallback';
      fallback.hidden = true;
      const icon = document.createElement('span');
      icon.className = 'bs-image-fallback-icon';
      setIcon(icon, 'image-off');
      const copy = document.createElement('span');
      copy.className = 'bs-image-fallback-copy';
      const title = document.createElement('span');
      title.className = 'bs-image-fallback-title';
      title.textContent = String(image.getAttribute('alt') || '').trim() || t("image_cannot_be_displayed_d41b4607");
      const detail = document.createElement('span');
      detail.className = 'bs-image-fallback-detail';
      detail.textContent = t("image_unavailable_click_to_try_opening_the_origi_4eb32b58");
      copy.append(title, detail);
      fallback.append(icon, copy);
      image.insertAdjacentElement('afterend', fallback);

      const initialSource = image.getAttribute('src') || image.currentSrc || '';
      const decodedSource = this.decodeCamoImageUrl(initialSource);
      const showFallback = () => {
        image.hidden = true;
        fallback.hidden = false;
        if (outerLink) outerLink.classList.add('is-image-unavailable');
      };
      const handleError = () => {
        if (decodedSource && image.dataset.bsDecodedRetry !== 'true') {
          image.dataset.bsDecodedRetry = 'true';
          if (outerLink) {
            const outerHref = outerLink.getAttribute('href') || '';
            if (outerHref === initialSource) {
              outerLink.setAttribute('href', decodedSource);
              outerLink.setAttribute('aria-label', decodedSource);
            }
          }
          image.src = decodedSource;
          return;
        }
        showFallback();
      };
      image.addEventListener('error', handleError);
      image.addEventListener('load', () => {
        if (!image.naturalWidth) return;
        image.hidden = false;
        fallback.hidden = true;
        if (outerLink) outerLink.classList.remove('is-image-unavailable');
      });
      if (image.complete && image.naturalWidth === 0) ownerWindow.setTimeout(handleError, 0);
    });
  }

  async renderMarkdownInto(container, markdown, key) {
    if (!container || !MarkdownRenderer || this.plugin.settings.markdownRenderMode === 'off') return;
    this.unloadMarkdownRenderComponents(key);
    const component = new Component();
    if (typeof component.load === 'function') component.load();
    this.markdownRenderComponents.set(key, component);
    const generation = this.markdownRenderGeneration;
    clearElement(container);
    if (typeof container.addClass === 'function') container.addClass('markdown-rendered');
    else if (container.classList) container.classList.add('markdown-rendered');
    try {
      if (typeof MarkdownRenderer.render === 'function') {
        await MarkdownRenderer.render(this.app, String(markdown || ''), container, this.getMarkdownSourcePath(), component);
      } else if (typeof MarkdownRenderer.renderMarkdown === 'function') {
        await MarkdownRenderer.renderMarkdown(String(markdown || ''), container, this.getMarkdownSourcePath(), component);
      } else throw new Error(t("this_obsidian_version_does_not_provide_markdownr_308574f7"));
      if (generation !== this.markdownRenderGeneration || this.markdownRenderComponents.get(key) !== component) return;
      container.querySelectorAll('a.internal-link').forEach((link) => link.setAttribute('data-blockspace-native-link', 'true'));
      this.attachRenderedLinkInteractions(container);
      this.attachRenderedMediaInteractions(container);
    } catch (error) {
      if (this.markdownRenderComponents.get(key) !== component) return;
      clearElement(container);
      const message = container.createDiv({ cls: 'bs-markdown-render-error' });
      message.createDiv({ cls: 'bs-markdown-render-error-title', text: t("obsidian_markdown_rendering_failed_292d38dc") });
      message.createDiv({ cls: 'bs-markdown-render-error-detail', text: String(error && error.message ? error.message : error) });
    }
  }

  toggleReadingMode(force = null) {
    if (this.activeTab !== 'document' || this.plugin.settings.markdownRenderMode === 'off') {
      if (this.plugin.settings.markdownRenderMode === 'off') new Notice(t("enable_obsidian_native_markdown_rendering_in_blo_ba44485e"));
      return;
    }
    this.commitPendingEdit();
    this.readingMode = typeof force === 'boolean' ? force : !this.readingMode;
    this.clearBlockSelection({ updateDom: false });
    this.setInteractionState('idle');
    this.render();
    if (typeof this.app.workspace.requestSaveLayout === 'function') this.app.workspace.requestSaveLayout();
  }

  renderNativeReadingDocument(host) {
    if (!this.page) {
      host.createDiv({ cls: 'bs-empty-state', text: t("no_page_to_display_c976f7a7") });
      return;
    }
    const scroll = host.createDiv({ cls: 'bs-document-scroll bs-native-reading-scroll' });
    const pageShell = scroll.createDiv({ cls: 'bs-page-shell bs-native-reading-shell is-coverless' });
    const header = pageShell.createDiv({ cls: 'bs-page-header bs-native-reading-header' });
    header.createEl('h1', { cls: 'bs-page-title bs-native-reading-title', text: this.page.title || t('untitled') });
    const modeBar = pageShell.createDiv({ cls: 'bs-reading-mode-bar' });
    const label = modeBar.createDiv({ cls: 'bs-reading-mode-label' });
    const icon = label.createSpan({ cls: 'bs-reading-mode-icon' });
    setIcon(icon, 'book-open');
    label.createSpan({ text: t("obsidian_native_markdown_reading_mode_d95f3cd6") });
    const edit = createButton(modeBar, 'bs-reading-mode-edit', t("return_to_block_editing_7597bfac"), 'square-pen', t("edit_05183656"));
    edit.addEventListener('click', () => this.toggleReadingMode(false));
    const preview = pageShell.createDiv({ cls: 'bs-native-page-preview markdown-preview-view' });
    const markdown = Core.blocksToMarkdown(this.page);
    void this.renderMarkdownInto(preview, markdown, 'page-reading');
  }

  shouldUseNativeBlockPreview(block) {
    if (!block || this.readingMode || this.plugin.settings.markdownRenderMode !== 'native-blocks') return false;
    return !['divider', 'table-of-contents', 'markdown'].includes(block.type);
  }

  activateTextBlockEditor(blockId) {
    if (!this.contentEl || !blockId) return false;
    const wrapper = this.contentEl.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper || !wrapper.hasClass('has-native-preview')) return false;
    wrapper.addClass('is-native-editing');
    const editor = wrapper.querySelector('.bs-block-editor');
    const preview = wrapper.querySelector('.bs-native-block-preview');
    if (editor) editor.hidden = false;
    if (preview) preview.hidden = true;
    this.activeNativePreviewBlockId = blockId;
    return true;
  }

  deactivateTextBlockEditor(blockId) {
    if (!this.contentEl || !blockId) return;
    const wrapper = this.contentEl.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper || !wrapper.hasClass('has-native-preview')) return;
    wrapper.removeClass('is-native-editing');
    const editor = wrapper.querySelector('.bs-block-editor');
    const preview = wrapper.querySelector('.bs-native-block-preview');
    if (editor) editor.hidden = true;
    if (preview) {
      preview.hidden = false;
      const block = this.page && Core.getBlock(this.page, blockId);
      if (block) void this.renderMarkdownInto(preview, Core.blockToNativePreviewMarkdown(block), `inline:${blockId}`);
    }
    if (this.activeNativePreviewBlockId === blockId) this.activeNativePreviewBlockId = null;
  }

  activateMarkdownBlockEditor(blockId, offset = null) {
    if (!this.contentEl || !blockId) return false;
    const wrapper = this.contentEl.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper) return false;
    wrapper.addClass('is-markdown-editing');
    this.updateMarkdownBlockChrome(wrapper, true);
    const editor = wrapper.querySelector('.bs-markdown-source-editor');
    const preview = wrapper.querySelector('.bs-markdown-preview');
    if (preview) preview.hidden = true;
    if (!editor) return false;
    editor.hidden = false;
    editor.focus({ preventScroll: true });
    const caret = offset == null
      ? editor.value.length
      : Math.max(0, Math.min(Number(offset) || 0, editor.value.length));
    if (typeof editor.setSelectionRange === 'function') editor.setSelectionRange(caret, caret);
    this.setInteractionState('markdown-editing', { blockId });
    return true;
  }

  updateMarkdownBlockChrome(wrapper, editing) {
    if (!wrapper) return;
    const button = wrapper.querySelector('.bs-markdown-edit-button');
    if (!button) return;
    button.tabIndex = 0;
    button.setAttribute('aria-label', editing ? t("finish_editing_markdown_8ee633ad") : t("edit_markdown_source_a346d23b"));
    const label = button.querySelector('.bs-button-label');
    if (label) label.textContent = editing ? t("done_c0b3fbff") : t("edit_05183656");
    const icon = button.querySelector('.bs-icon');
    if (icon) {
      clearElement(icon);
      setIcon(icon, editing ? 'check' : 'square-pen');
    }
  }

  deactivateMarkdownBlockEditor(blockId) {
    if (!this.contentEl || !blockId) return;
    const wrapper = this.contentEl.querySelector(`[data-block-id="${blockId}"]`);
    if (!wrapper) return;
    wrapper.removeClass('is-markdown-editing');
    this.updateMarkdownBlockChrome(wrapper, false);
    const editor = wrapper.querySelector('.bs-markdown-source-editor');
    const preview = wrapper.querySelector('.bs-markdown-preview');
    if (editor) editor.hidden = true;
    if (preview) {
      preview.hidden = false;
      const block = this.page && Core.getBlock(this.page, blockId);
      if (block) void this.renderMarkdownInto(preview, block.text, `markdown:${blockId}`);
    }
    this.setInteractionState(this.selectedBlockIds.size ? 'block-selecting' : 'idle', { blockIds: this.getOrderedSelectedBlockIds() });
  }

  contextElement(target) {
    if (!target) return null;
    return target.nodeType === 1 ? target : target.parentElement || null;
  }

  hasNativeTextContext(target) {
    const element = this.contextElement(target);
    if (!element || !this.contentEl || !this.contentEl.contains(element)) return false;
    const ownerWindow = element.ownerDocument.defaultView;
    if (element instanceof ownerWindow.HTMLInputElement
      || element instanceof ownerWindow.HTMLTextAreaElement
      || element instanceof ownerWindow.HTMLSelectElement) return true;
    const selection = ownerWindow.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    const start = this.contextElement(range.startContainer);
    const end = this.contextElement(range.endContainer);
    return Boolean(start && end && this.contentEl.contains(start) && this.contentEl.contains(end));
  }

  storedLinkValue(element) {
    if (!element) return '';
    if (element.dataset && element.dataset.bsHref) return element.dataset.bsHref;
    const rawHref = element.getAttribute('data-href') || element.getAttribute('href') || '';
    return element.hasClass && element.hasClass('internal-link') ? `wikilink:${rawHref}` : rawHref;
  }

  resolveContextTarget(target) {
    const element = this.contextElement(target);
    if (!element || !this.contentEl || !this.contentEl.contains(element)) return null;

    const boardCard = element.closest('.bs-board-card[data-page-id]');
    if (boardCard) {
      const meta = this.plugin.store.workspace.pages.find((page) => page.id === boardCard.dataset.pageId);
      if (meta) return { kind: 'board-card', element: boardCard, meta };
    }

    const backlinkItem = element.closest('.bs-backlink-item');
    if (backlinkItem && backlinkItem.__blockspaceBacklink) {
      return { kind: 'backlink', element: backlinkItem, backlink: backlinkItem.__blockspaceBacklink };
    }

    const image = element.closest('img');
    if (image && this.contentEl.contains(image)) {
      const outerLink = image.closest('a, [data-bs-href]');
      return { kind: 'image', element: image, outerLink };
    }

    const link = element.closest('[data-bs-href], a');
    if (link && this.contentEl.contains(link)) {
      const value = this.storedLinkValue(link);
      if (value) return { kind: 'link', element: link, value };
    }

    const wrapper = element.closest('.bs-block[data-block-id]');
    if (wrapper && this.page) {
      const block = Core.getBlock(this.page, wrapper.dataset.blockId);
      if (block) return { kind: 'block', element: wrapper, block, index: this.getVisibleBlockIndex(block.id) };
    }

    const pageTitle = element.closest('.bs-page-title');
    if (pageTitle && this.page) {
      const meta = this.plugin.store.workspace.pages.find((page) => page.id === this.page.id) || Core.pageToMeta(this.page);
      return { kind: 'page', element: pageTitle, meta };
    }

    if (element.closest('.bs-page-shell, .bs-document-scroll, .bs-board, .bs-view-host')) {
      return { kind: this.activeTab === 'board' ? 'workspace' : 'document', element };
    }
    return null;
  }

  onContextMenu(event) {
    if (!event || event.defaultPrevented || event.shiftKey || this.hasNativeTextContext(event.target)) return;
    const context = this.resolveContextTarget(event.target);
    if (!context) return;
    event.preventDefault();
    event.stopPropagation();
    if (context.kind === 'block') {
      if (!this.selectedBlockIds.has(context.block.id)) this.selectBlock(context.block.id);
      this.showBlockMenu(event, context.block, context.index);
      return;
    }
    if (context.kind === 'link') {
      this.showLinkContextMenu(event, context.element, context.value);
      return;
    }
    if (context.kind === 'image') {
      this.showImageContextMenu(event, context.element, context.outerLink);
      return;
    }
    if (context.kind === 'page') {
      this.showPageMenu(event, context.meta);
      return;
    }
    if (context.kind === 'board-card') {
      this.showBoardCardMenu(event, context.meta);
      return;
    }
    if (context.kind === 'backlink') {
      this.showBacklinkContextMenu(event, context.backlink, context.element);
      return;
    }
    if (context.kind === 'document') {
      this.showDocumentContextMenu(event);
      return;
    }
    this.showWorkspaceMenu(event);
  }

  dispatchKeyboardContextMenu(target) {
    const element = this.contextElement(target);
    if (!element || !this.contentEl.contains(element)) return false;
    const rect = element.getBoundingClientRect();
    const ownerWindow = element.ownerDocument.defaultView;
    element.dispatchEvent(new ownerWindow.MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 0,
      clientX: Math.max(0, rect.left + Math.min(rect.width, 24)),
      clientY: Math.max(0, rect.top + Math.min(rect.height, 24)),
    }));
    return true;
  }

  onGlobalKeydown(event) {
    if (event.defaultPrevented || this.isComposing || event.isComposing) return;
    const contextMenuKey = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (contextMenuKey) {
      if (this.hasNativeTextContext(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      this.dispatchKeyboardContextMenu(event.target);
      return;
    }
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && key === 'f' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.openFindReplace(false);
      return;
    }
    if (modifier && key === 'h' && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.openFindReplace(true);
      return;
    }
    const hasBlockSelection = this.selectedBlockIds.size > 0;
    const logicalTextSelection = !hasBlockSelection && this.activeTab === 'document'
      ? getLogicalTextSelection(this.contentEl, this.page)
      : null;
    if (logicalTextSelection && logicalTextSelection.ranges.length > 1) {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        this.deleteCrossBlockSelection(logicalTextSelection);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeFormatToolbar();
        const first = logicalTextSelection.ranges[0];
        this.restoreEditorSelection({ type: 'caret', blockId: first.blockId, offset: first.from });
        return;
      }
    }
    if (hasBlockSelection && !isTextInputTarget(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.clearBlockSelection();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const firstId = this.getOrderedSelectedBlockIds()[0];
        this.clearBlockSelection();
        if (firstId) focusEditorAt(this, firstId, 0);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        this.deleteSelectedBlocks();
        return;
      }
      if (modifier && key === 'd') {
        event.preventDefault();
        this.duplicateSelectedBlocks();
        return;
      }
      if (modifier && (key === 'c' || key === 'x')) {
        event.preventDefault();
        const copied = this.contentEl.ownerDocument.execCommand(key === 'x' ? 'cut' : 'copy');
        if (!copied && key === 'c') void this.copySelectedBlocks();
        return;
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        this.moveSelectedBlocks(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        this.indentSelectedBlocks(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        this.extendBlockSelection(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
      if (!event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        this.navigateBlockSelection(event.key === 'ArrowUp' ? -1 : 1);
        return;
      }
    }
    if (modifier && key === 'a' && this.activeTab === 'document' && !isTextInputTarget(event.target) && this.page) {
      event.preventDefault();
      const ids = this.getVisibleBlockIds();
      this.setBlockSelection(ids, ids[0] || null, ids.length ? ids[ids.length - 1] : null);
      return;
    }
    if (modifier && key === 'k') {
      event.preventDefault();
      this.openQuickSwitcher();
      return;
    }
    if (modifier && key === 'n' && !event.shiftKey) {
      event.preventDefault();
      void this.createPage();
      return;
    }
    if (modifier && event.shiftKey && key === 'f') {
      event.preventDefault();
      this.toggleFocusMode();
      return;
    }
    if (modifier && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (modifier && key === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key === 'Escape' && this.handleEscape(event)) return;
    if (modifier && key === 'e') {
      event.preventDefault();
      this.toggleReadingMode();
      return;
    }
    if (modifier && key === 's') {
      event.preventDefault();
      void this.flushSave();
    }
  }


  render() {
    const viewState = this.captureViewState() || this.pendingRestoreState;
    this.pendingRestoreState = null;
    if (this.slashState) this.closeSlashMenu();
    this.closeFormatToolbar();
    this.closeBlockSelectionToolbar();
    this.markdownRenderGeneration += 1;
    this.activeNativePreviewBlockId = null;
    this.disconnectNativePreviewObserver();
    this.disconnectImageWrapObservers();
    this.unloadMarkdownRenderComponents();
    this.clearFindHighlights();
    clearElement(this.contentEl);
    this.contentEl.addClass('blockspace-view-content');
    const classes = [
      'blockspace-workspace',
      `bs-style-${VISUAL_STYLES[this.plugin.settings.visualStyle] ? this.plugin.settings.visualStyle : 'notion'}`,
      `bs-page-density-${PAGE_DENSITIES[this.plugin.settings.pageDensity] ? this.plugin.settings.pageDensity : 'standard'}`,
      this.focusMode ? 'bs-focus-mode' : '',
      this.plugin.settings.compactMode ? 'bs-density-compact' : 'bs-density-comfortable',
      this.activeTab === 'board' ? 'bs-mode-board' : 'bs-mode-document',
      this.readingMode ? 'bs-native-reading-mode' : 'bs-editing-mode',
    ].filter(Boolean).join(' ');
    const root = this.contentEl.createDiv({ cls: classes });
    if (this.page) root.dataset.pageId = this.page.id;
    root.style.setProperty('--bs-content-width', `${Math.max(580, Math.min(1100, Number(this.plugin.settings.contentWidth) || 760))}px`);
    root.style.setProperty('--bs-editor-font-size', `${Math.max(12, Math.min(24, Number(this.plugin.settings.fontSize) || 16))}px`);
    root.style.setProperty('--bs-editor-line-height', String(Math.max(1.2, Math.min(2.2, Number(this.plugin.settings.lineHeight) || 1.65))));
    root.dataset.fontFamily = FONT_FAMILIES[this.plugin.settings.fontFamily] ? this.plugin.settings.fontFamily : 'theme';
    root.dataset.visualStyle = VISUAL_STYLES[this.plugin.settings.visualStyle] ? this.plugin.settings.visualStyle : 'notion';
    this.rootEl = root;
    root.dataset.interactionState = this.getInteractionType();
    root.addEventListener('pointerdown', (event) => {
      if (!this.selectedBlockIds.size) return;
      const target = event.target && event.target.closest ? event.target : null;
      if (target && (target.closest('.bs-block') || target.closest('.bs-block-selection-toolbar'))) return;
      this.clearBlockSelection();
    });
    this.renderMain(root.createEl('main', { cls: 'bs-main' }));
    this.renderFindReplaceBar(root);
    this.refreshNativeHeader();
    this.restoreViewState(viewState);
    this.updateBlockSelectionDom();
    this.plugin.notifyContextChanged();
  }

  renderMain(main) {
    main.addClass('bs-main-native-header');
    this.renderStatusBanners(main);
    const viewHost = main.createDiv({ cls: 'bs-view-host' });
    if (this.activeTab === 'board') this.renderBoard(viewHost);
    else if (this.readingMode && this.plugin.settings.markdownRenderMode !== 'off') this.renderNativeReadingDocument(viewHost);
    else this.renderDocument(viewHost);
  }

  addExportMenuItems(menu, pageProvider = () => this.page) {
    const formats = [
      ['md', t("export_lossless_markdown_81a9210d"), 'file-output'],
      ['docx', t("export_word_document_e49b0e54"), 'file-type-2'],
      ['pdf', t("export_pdf_e42c8735"), 'file-text'],
    ];
    for (const [format, title, icon] of formats) {
      menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(async () => {
        const page = await pageProvider();
        if (page) await this.plugin.exportPage(page, format);
      }));
    }
  }

  showWorkspaceMenu(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const menu = new Menu();
    const boardActive = this.activeTab === 'board';
    menu.addItem((item) => item
      .setTitle(boardActive ? t("return_to_document_view_7a56afad") : t("open_project_board_d686cb7e"))
      .setIcon(boardActive ? 'file-text' : 'columns-3')
      .onClick(() => this.switchTab(boardActive ? 'document' : 'board')));
    menu.addItem((item) => item.setTitle(t("new_page_64451e31")).setIcon('square-plus').onClick(() => void this.createPage()));
    menu.addItem((item) => item.setTitle(t("find_text_in_current_page_cf55deac")).setIcon('search').onClick(() => this.openFindReplace(false)));
    menu.addItem((item) => item.setTitle(t("find_and_replace_74b04f33")).setIcon('replace').onClick(() => this.openFindReplace(true)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(this.focusMode ? t("exit_focus_mode_3f6477ba") : t("enter_focus_mode_b2c1df34")).setIcon(this.focusMode ? 'minimize-2' : 'maximize-2').onClick(() => this.toggleFocusMode()));
    menu.addItem((item) => item
      .setTitle(t("open_as_obsidian_native_markdown_f5976891"))
      .setIcon('file-text')
      .setDisabled(!this.page || !this.plugin.generatedMarkdownPathForPage(this.page.id))
      .onClick(() => void this.plugin.openPageAsNativeMarkdown(this.page.id, this.leaf)));
    menu.addSeparator();
    this.addExportMenuItems(menu);
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("diagnostics_and_recovery_18b77e4a")).setIcon('stethoscope').onClick(() => new BlockspaceDiagnosticsModal(this.app, this.plugin).open()));
    menu.showAtMouseEvent(event);
  }

  reparseInlineMarkdown() {
    if (!this.page) return;
    // Probe on a clone so a page with nothing to fix never lands a no-op undo step.
    const changed = Core.reparseInlineMarkdown(Core.clonePage(this.page));
    if (!changed) {
      new Notice(t("no_markdown_text_to_parse_in_the_current_page_0ca89aa1"));
      return;
    }
    this.performMutation(t("parse_markdown_inline_formatting_6978ce3d"), (page) => { Core.reparseInlineMarkdown(page); });
    new Notice(t("parsed_markdown_links_and_formatting_in_0_blocks_5d9853ad", [changed]));
  }

  showIconMenu(event) {
    if (!this.page) return;
    const menu = new Menu();
    for (const option of ICON_OPTIONS) {
      menu.addItem((item) => item
        .setTitle(t("0_use_this_icon_30a9dda3", [option]))
        .setChecked(this.page.icon === option)
        .onClick(() => this.performMutation(t("change_page_icon_bcefdd2c"), (page) => { page.icon = option; })));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("custom_icon_c834d6eb")).setIcon('smile-plus').onClick(() => {
      new PageIconModal(this.app, this.page.icon, (value) => {
        this.performMutation(t("change_page_icon_bcefdd2c"), (page) => { page.icon = value; });
      }).open();
    }));
    menu.addItem((item) => item
      .setTitle(t("remove_icon_ba73b35b"))
      .setIcon('circle-slash')
      .setDisabled(!this.page.icon)
      .onClick(() => this.performMutation(t("remove_page_icon_0ece4bfa"), (page) => { page.icon = ''; })));
    menu.showAtMouseEvent(event);
  }

  renderDocument(host) {
    if (!this.page) {
      host.createDiv({ cls: 'bs-empty-state', text: t("no_page_to_display_c976f7a7") });
      return;
    }
    const scroll = host.createDiv({ cls: 'bs-document-scroll' });
    const pageShell = scroll.createDiv({ cls: 'bs-page-shell is-coverless' });
    const header = pageShell.createDiv({ cls: 'bs-page-header' });
    const title = header.createDiv({ cls: 'bs-page-title', attr: { contenteditable: 'true', role: 'textbox', 'aria-label': t("page_title_5ce2d4cc"), 'aria-multiline': 'false' }, text: this.page.title });
    const syncTitleDensity = () => {
      const length = Array.from(String(title.textContent || '')).length;
      title.toggleClass('is-long-title', length > 34);
      title.toggleClass('is-very-long-title', length > 58);
    };
    syncTitleDensity();
    title.addEventListener('paste', (event) => this.pastePlainText(event));
    title.addEventListener('beforeinput', () => this.beginLiveEdit(t("edit_page_title_4079da44"), 'title'));
    title.addEventListener('focus', () => {
      if (this.selectedBlockIds.size) this.clearBlockSelection();
    });
    title.addEventListener('compositionstart', () => { this.isComposing = true; this.beginLiveEdit(t("edit_page_title_4079da44"), 'title'); });
    title.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.page.title = String(title.textContent || '').trimStart() || t('untitled');
      syncTitleDensity();
      this.refreshNativeHeader();
      this.afterLiveEdit({ commitNow: true });
    });
    title.addEventListener('input', () => {
      this.beginLiveEdit(t("edit_page_title_4079da44"), 'title');
      this.page.title = String(title.textContent || '').trimStart() || t('untitled');
      syncTitleDensity();
      this.refreshNativeHeader();
      this.afterLiveEdit();
    });
    title.addEventListener('blur', () => this.commitPendingEdit());
    title.addEventListener('keydown', (event) => {
      if (this.isComposing || event.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitPendingEdit();
        const first = pageShell.querySelector('.bs-block-editor');
        if (first) first.focus();
      }
    });

    this.renderProperties(pageShell.createDiv({ cls: 'bs-inline-properties' }));
    const blockList = pageShell.createDiv({ cls: 'bs-block-list' });
    const visibleEntries = this.getVisibleBlockEntries();
    this.renderBlockEntrySequence(blockList, visibleEntries);
    const hasMeaningfulContent = this.page.blocks.some((block) => block.type === 'divider' || block.type === 'columns' || String(block.text || '').trim());
    if (!hasMeaningfulContent) {
      const hint = pageShell.createDiv({ cls: 'bs-empty-document-hint' });
      const hintIcon = hint.createSpan({ cls: 'bs-empty-document-hint-icon' });
      setIcon(hintIcon, 'sparkles');
      hint.createSpan({ text: t("type_to_choose_a_block_type_or_paste_markdown_co_ba2bdb84") });
    }
    const addBottom = createButton(pageShell, 'bs-add-bottom', t("add_block_c83b027a"), 'plus', t("add_a_block_73e736a3"));
    addBottom.addEventListener('click', () => this.insertBlock(this.getVisibleBlocks().length));
  }

  renderBlockEntrySequence(container, entries, depthOffset = 0) {
    const sourceEntries = Array.isArray(entries) ? entries : [];
    const sourceIds = new Set(sourceEntries.map((entry) => entry.block.id));
    const hiddenByNestedLayout = new Set();
    for (const entry of sourceEntries) {
      if (entry.block.type !== 'columns') continue;
      for (const descendantId of Core.getSubtreeIds(this.page, entry.block.id).slice(1)) {
        if (sourceIds.has(descendantId)) hiddenByNestedLayout.add(descendantId);
      }
    }
    const visibleEntries = sourceEntries.filter((entry) => entry.block.type !== 'column' && !hiddenByNestedLayout.has(entry.block.id));
    const wrapTextTypes = new Set(['paragraph']);
    for (let cursor = 0; cursor < visibleEntries.length; cursor += 1) {
      const entry = visibleEntries[cursor];
      const index = this.getVisibleBlockIndex(entry.block.id);
      const depth = Math.max(0, entry.depth - depthOffset);
      const imageData = entry.block.type === 'image'
        ? Core.normalizeBlockData('image', entry.block.data)
        : null;
      if (!imageData || imageData.wrapMode === 'top-bottom') {
        this.renderBlock(container, entry.block, index, depth);
        continue;
      }
      const flow = container.createDiv({
        cls: `bs-image-wrap-flow is-${imageData.wrapMode} is-text-${imageData.wrapTextAlign}`,
        attr: {
          'data-wrap-mode': imageData.wrapMode,
          'data-wrap-text-align': imageData.wrapTextAlign,
          'aria-label': imageData.wrapMode === 'square-left' ? t("wrap_text_to_the_left_of_the_image_1dd70385") : t("wrap_text_to_the_right_of_the_image_7914a283"),
        },
      });
      flow.style.setProperty('--bs-image-wrap-width', `${imageData.width || 320}px`);
      flow.style.setProperty('--bs-image-wrap-gap', `${imageData.wrapGap}px`);
      this.renderBlock(flow, entry.block, index, depth);
      let nextCursor = cursor + 1;
      while (nextCursor < visibleEntries.length) {
        const next = visibleEntries[nextCursor];
        if (next.depth !== entry.depth || !wrapTextTypes.has(next.block.type)) break;
        this.renderBlock(flow, next.block, this.getVisibleBlockIndex(next.block.id), Math.max(0, next.depth - depthOffset));
        nextCursor += 1;
      }
      this.observeImageWrapAlignment(flow, imageData.wrapTextAlign);
      cursor = nextCursor - 1;
    }
  }

  renderProperties(container) {
    const extendedProperties = ['source', 'author', 'publishedAt', 'description']
      .filter((key) => String(this.page.properties[key] || '').trim());
    const customProperties = Core.normalizeCustomProperties(this.page.properties.custom);
    if (extendedProperties.length || customProperties.length) container.addClass('has-extended-properties');
    const header = container.createEl('button', {
      cls: 'bs-properties-header',
      attr: { type: 'button', 'aria-expanded': String(this.propertiesExpanded) },
    });
    const label = header.createSpan({ cls: 'bs-properties-title' });
    const propertyIcon = label.createSpan({ cls: 'bs-property-icon' });
    setIcon(propertyIcon, 'list-filter');
    label.createSpan({ text: t("properties_86de52d1") });
    const summary = header.createSpan({ cls: 'bs-properties-summary' });
    if (!this.propertiesExpanded) {
      const statusLabel = STATUS_LABELS[this.page.properties.status];
      const priorityLabel = PRIORITY_LABELS[this.page.properties.priority];
      summary.createSpan({
        cls: `bs-property-chip is-${this.page.properties.status}`,
        text: statusLabel,
        attr: { 'data-property': 'status', title: t("status_0_71766b08", [statusLabel]) },
      });
      summary.createSpan({
        cls: `bs-property-chip priority-${this.page.properties.priority}`,
        text: priorityLabel,
        attr: { 'data-property': 'priority', title: t("priority_0_953e82d9", [priorityLabel]) },
      });
      for (const tag of this.page.properties.tags.slice(0, 2)) {
        summary.createSpan({
          cls: 'bs-property-chip is-tag',
          text: `#${tag}`,
          attr: { 'data-property': 'tag', title: t("tags_0_66a02b22", [tag]) },
        });
      }
      if (this.page.properties.tags.length > 2) {
        summary.createSpan({
          cls: 'bs-property-chip is-more',
          text: `+${this.page.properties.tags.length - 2}`,
          attr: { 'data-property': 'more', title: t("0_more_tags_a01d0135", [this.page.properties.tags.length - 2]) },
        });
      }
    }
    const chevron = header.createSpan({ cls: 'bs-properties-chevron' });
    setIcon(chevron, this.propertiesExpanded ? 'chevron-up' : 'chevron-down');
    header.addEventListener('click', () => {
      this.propertiesExpanded = !this.propertiesExpanded;
      this.render();
    });
    if (!this.propertiesExpanded) {
      container.addClass('is-collapsed');
      return;
    }

    const body = container.createDiv({ cls: 'bs-properties-body' });
    const makeProperty = (labelText, iconName, propertyName, extraClass = '') => {
      const row = body.createDiv({
        cls: `bs-property-row${extraClass ? ` ${extraClass}` : ''}`,
        attr: { 'data-property': propertyName },
      });
      const labelEl = row.createDiv({ cls: 'bs-property-label' });
      const icon = labelEl.createSpan({ cls: 'bs-property-icon' });
      setIcon(icon, iconName);
      if (labelText) labelEl.createSpan({ text: labelText });
      const valueEl = row.createDiv({ cls: 'bs-property-value' });
      return { row, labelEl, valueEl };
    };

    const addDeleteMenu = (valueEl, labelText, onDelete) => {
      const button = createButton(valueEl, 'bs-property-row-menu', t("0_property_menu_753bbfc2", [labelText]), 'ellipsis');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem((item) => item
          .setTitle(t("delete_property_53379235"))
          .setIcon('trash-2')
          .onClick(onDelete));
        menu.showAtMouseEvent(event);
      });
      return button;
    };

    const statusValue = makeProperty(t("status_6320b4a8"), 'circle-dot', 'status').valueEl;
    const statusControl = statusValue.createDiv({
      cls: 'bs-property-control is-status',
      attr: { 'data-state': this.page.properties.status },
    });
    const statusSelect = statusControl.createEl('select', { cls: 'bs-select', attr: { 'aria-label': t("status_6320b4a8") } });
    for (const status of Core.PAGE_STATUSES) statusSelect.createEl('option', { value: status, text: STATUS_LABELS[status] });
    statusSelect.value = this.page.properties.status;
    statusSelect.addEventListener('change', () => {
      this.performMutation(t("change_page_status_2af8342f"), (page) => { page.properties.status = statusSelect.value; }, { render: false });
      statusControl.dataset.state = statusSelect.value;
    });

    const priorityValue = makeProperty(t("priority_565d6460"), 'signal', 'priority').valueEl;
    const priorityControl = priorityValue.createDiv({
      cls: 'bs-property-control is-priority',
      attr: { 'data-state': this.page.properties.priority },
    });
    const prioritySelect = priorityControl.createEl('select', { cls: 'bs-select', attr: { 'aria-label': t("priority_565d6460") } });
    for (const priority of Core.PAGE_PRIORITIES) prioritySelect.createEl('option', { value: priority, text: PRIORITY_LABELS[priority] });
    prioritySelect.value = this.page.properties.priority;
    prioritySelect.addEventListener('change', () => {
      this.performMutation(t("change_page_priority_6f1193d4"), (page) => { page.properties.priority = prioritySelect.value; }, { render: false });
      priorityControl.dataset.state = prioritySelect.value;
    });

    const tagValue = makeProperty(t("tags_1d0fd5f9"), 'tag', 'tags').valueEl;
    const tagControl = tagValue.createDiv({ cls: 'bs-property-control is-tags' });
    const tagInput = tagControl.createEl('input', { cls: 'bs-property-input', attr: { type: 'text', placeholder: t("enter_tags_separated_by_commas_0097233e"), 'aria-label': t("tags_1d0fd5f9") } });
    tagInput.value = this.page.properties.tags.join(', ');
    tagInput.addEventListener('change', () => {
      this.performMutation(t("change_page_tags_fd14c4f7"), (page) => {
        page.properties.tags = Array.from(new Set(tagInput.value.split(',').map((tag) => tag.trim()).filter(Boolean)));
      }, { render: false });
    });

    const makeTextProperty = (propertyName, labelText, iconName, options = {}) => {
      const value = String(this.page.properties[propertyName] || '').trim();
      if (!value && !options.always) return;
      const propertyRow = makeProperty(
        labelText,
        iconName,
        propertyName,
        options.multiline ? 'is-multiline' : '',
      );
      propertyRow.row.addClass('has-row-menu');
      const propertyValue = propertyRow.valueEl;
      const control = propertyValue.createDiv({ cls: `bs-property-control is-${propertyName}` });
      const input = options.multiline
        ? control.createEl('textarea', {
          cls: 'bs-property-input bs-property-textarea',
          attr: { rows: '2', 'aria-label': labelText, placeholder: options.placeholder || '' },
        })
        : control.createEl('input', {
          cls: 'bs-property-input',
          attr: { type: options.type || 'text', 'aria-label': labelText, placeholder: options.placeholder || '' },
        });
      input.value = value;
      if (options.multiline) {
        const resize = () => {
          input.style.height = 'auto';
          input.style.height = `${Math.min(132, Math.max(48, input.scrollHeight))}px`;
        };
        input.addEventListener('input', resize);
        this.contentEl.ownerDocument.defaultView.requestAnimationFrame(resize);
      }
      input.addEventListener('change', () => {
        this.performMutation(t("change_page_0_528faae2", [labelText]), (page) => {
          page.properties[propertyName] = String(input.value || '').trim();
        }, { render: false });
      });
      addDeleteMenu(propertyValue, labelText, () => {
        this.performMutation(t("delete_page_0_5ef6062c", [labelText]), (page) => {
          page.properties[propertyName] = '';
        });
      });
    };

    makeTextProperty('source', t("source_a488e93d"), 'link-2', { type: 'url', placeholder: 'https://…' });
    makeTextProperty('author', t("author_7d4146ca"), 'user-round');
    makeTextProperty('publishedAt', t("published_87d080e7"), 'calendar-days');
    makeTextProperty('description', t("summary_21c04b2e"), 'align-left', { multiline: true });

    const updateCustomProperty = (propertyId, labelText, updater, options = {}) => this.performMutation(
      labelText,
      (page) => {
        const property = (page.properties.custom || []).find((candidate) => candidate.id === propertyId);
        if (property) updater(property);
      },
      options,
    );

    for (const property of customProperties) {
      const details = CUSTOM_PROPERTY_TYPE_DETAILS[property.type] || CUSTOM_PROPERTY_TYPE_DETAILS.text;
      const propertyRow = makeProperty('', details.icon, property.id, 'is-custom-property');
      const nameInput = propertyRow.labelEl.createEl('input', {
        cls: 'bs-property-name-input',
        attr: { type: 'text', value: property.name, 'aria-label': t("property_name_0_8ffecc0d", [property.name]) },
      });
      nameInput.value = property.name;
      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          nameInput.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          nameInput.value = property.name;
          nameInput.blur();
        }
      });
      nameInput.addEventListener('change', () => {
        const name = String(nameInput.value || '').trim().slice(0, 100);
        const otherNames = customProperties
          .filter((candidate) => candidate.id !== property.id)
          .map((candidate) => candidate.name);
        if (!Core.isValidCustomPropertyName(name, otherNames)) {
          nameInput.value = property.name;
          new Notice(t("property_names_must_be_nonempty_unique_and_canno_8392ff80"));
          return;
        }
        updateCustomProperty(property.id, t("rename_property_0_eeed9f1f", [property.name]), (target) => { target.name = name; }, { render: false });
      });

      const control = propertyRow.valueEl.createDiv({ cls: `bs-property-control is-custom is-${property.type}` });
      const commitValue = (value) => updateCustomProperty(
        property.id,
        t("change_property_0_b607b0c3", [property.name]),
        (target) => { target.value = value; },
        { render: false },
      );

      if (property.type === 'checkbox') {
        const checkboxLabel = control.createEl('label', { cls: 'bs-property-checkbox' });
        const input = checkboxLabel.createEl('input', {
          attr: { type: 'checkbox', 'aria-label': property.name },
        });
        input.checked = Boolean(property.value);
        checkboxLabel.createSpan({ text: input.checked ? t("yes_b5141d3d") : t("no_0c70665b"), cls: 'bs-property-checkbox-label' });
        input.addEventListener('change', () => {
          const label = checkboxLabel.querySelector('.bs-property-checkbox-label');
          if (label) label.textContent = input.checked ? t("yes_b5141d3d") : t("no_0c70665b");
          commitValue(input.checked);
        });
      } else {
        const input = control.createEl('input', {
          cls: 'bs-property-input',
          attr: {
            type: property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'datetime' ? 'datetime-local' : 'text',
            'aria-label': property.name,
            placeholder: property.type === 'list' ? t("enter_values_separated_by_commas_0e3f3073") : '',
          },
        });
        input.value = property.type === 'list'
          ? (Array.isArray(property.value) ? property.value.join(', ') : '')
          : property.value == null ? '' : String(property.value);
        input.addEventListener('change', () => {
          if (property.type === 'list') commitValue(input.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean));
          else if (property.type === 'number') commitValue(input.value === '' ? null : Number(input.value));
          else commitValue(input.value);
        });
      }

      const menuButton = createButton(propertyRow.valueEl, 'bs-property-row-menu', t("0_property_menu_753bbfc2", [property.name]), 'ellipsis');
      menuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = new Menu();
        for (const type of Core.CUSTOM_PROPERTY_TYPES) {
          const typeDetails = CUSTOM_PROPERTY_TYPE_DETAILS[type];
          menu.addItem((item) => item
            .setTitle(typeDetails.label)
            .setIcon(typeDetails.icon)
            .setChecked(type === property.type)
            .onClick(() => {
              if (type === property.type) return;
              updateCustomProperty(property.id, t("change_property_type_0_343c48cf", [property.name]), (target) => {
                target.type = type;
                target.value = Core.normalizeCustomPropertyValue(type, target.value);
              });
            }));
        }
        menu.addSeparator();
        menu.addItem((item) => item
          .setTitle(t("delete_property_53379235"))
          .setIcon('trash-2')
          .onClick(() => {
            this.performMutation(t("delete_property_0_d908fcf4", [property.name]), (page) => {
              page.properties.custom = (page.properties.custom || [])
                .filter((candidate) => candidate.id !== property.id);
            });
          }));
        menu.showAtMouseEvent(event);
      });
    }

    const addProperty = createButton(body, 'bs-property-add', t("add_property_820ff79e"), 'plus', t("add_property_820ff79e"));
    addProperty.addEventListener('click', () => {
      const existingDraft = body.querySelector('.bs-property-row.is-new-property');
      if (existingDraft) {
        existingDraft.querySelector('.bs-property-name-input')?.focus();
        return;
      }
      const draft = body.createDiv({ cls: 'bs-property-row is-new-property' });
      body.insertBefore(draft, addProperty);
      const draftLabel = draft.createDiv({ cls: 'bs-property-label' });
      const icon = draftLabel.createSpan({ cls: 'bs-property-icon' });
      setIcon(icon, 'plus');
      const nameInput = draftLabel.createEl('input', {
        cls: 'bs-property-name-input',
        attr: { type: 'text', placeholder: t("property_name_aac14899"), 'aria-label': t("new_property_name_deb5e5e4") },
      });
      const draftValue = draft.createDiv({ cls: 'bs-property-value' });
      const typeSelect = draftValue.createEl('select', { cls: 'bs-select bs-property-type-select', attr: { 'aria-label': t("property_type_7be7ee5f") } });
      for (const type of Core.CUSTOM_PROPERTY_TYPES) {
        typeSelect.createEl('option', { value: type, text: CUSTOM_PROPERTY_TYPE_DETAILS[type].label });
      }
      const confirm = createButton(draftValue, 'bs-property-draft-action is-confirm', t("confirm_new_property_7fa5fff4"), 'check');
      const cancel = createButton(draftValue, 'bs-property-draft-action', t("cancel_new_property_6e01311c"), 'x');
      const removeDraft = () => draft.remove();
      const commitDraft = () => {
        const name = String(nameInput.value || '').trim().slice(0, 100);
        if (!Core.isValidCustomPropertyName(name, customProperties.map((property) => property.name))) {
          new Notice(t("property_names_must_be_nonempty_unique_and_canno_8392ff80"));
          nameInput.focus();
          return;
        }
        const type = Core.CUSTOM_PROPERTY_TYPES.includes(typeSelect.value) ? typeSelect.value : 'text';
        const value = type === 'list' ? [] : type === 'number' ? null : type === 'checkbox' ? false : '';
        this.performMutation(t("add_property_0_83c8e87e", [name]), (page) => {
          if (!Array.isArray(page.properties.custom)) page.properties.custom = [];
          page.properties.custom.push({ id: Core.randomId('property'), name, type, value });
        });
      };
      confirm.addEventListener('click', commitDraft);
      cancel.addEventListener('click', removeDraft);
      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitDraft();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          removeDraft();
          addProperty.focus();
        }
      });
      nameInput.focus();
    });
  }

  advancedResourceUrl(block) {
    const data = Core.normalizeBlockData(block.type, block.data);
    if (!data) return '';
    if (data.sourceType === 'remote') {
      const link = Core.classifyStoredLink(data.url);
      return link.kind === 'external' ? link.target : '';
    }
    if (!data.path) return '';
    const file = this.app.vault.getAbstractFileByPath(normalizePath(data.path));
    return file instanceof TFile && typeof this.app.vault.getResourcePath === 'function'
      ? this.app.vault.getResourcePath(file)
      : '';
  }

  async availableAttachmentPath(fileName) {
    const folder = normalizePath(this.plugin.settings.attachmentFolder || DEFAULT_SETTINGS.attachmentFolder);
    await this.plugin.store.ensureFolder(folder);
    const rawName = String(fileName || `attachment-${Date.now()}`)
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || `attachment-${Date.now()}`;
    const extension = fileExtension(rawName);
    const suffix = extension ? `.${extension}` : '';
    const base = (suffix ? rawName.slice(0, -suffix.length) : rawName).slice(0, 120) || 'attachment';
    let candidate = normalizePath(`${folder}/${base}${suffix}`);
    let serial = 2;
    while (await this.app.vault.adapter.exists(candidate)) {
      candidate = normalizePath(`${folder}/${base} ${serial}${suffix}`);
      serial += 1;
    }
    return candidate;
  }

  async writeAttachmentFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error(t("could_not_read_attachment_content_69c92a55"));
    const path = await this.availableAttachmentPath(file.name);
    const buffer = await file.arrayBuffer();
    if (typeof this.app.vault.createBinary === 'function') await this.app.vault.createBinary(path, buffer);
    else if (typeof this.app.vault.adapter.writeBinary === 'function') await this.app.vault.adapter.writeBinary(path, buffer);
    else throw new Error(t("this_obsidian_version_cannot_write_binary_attach_39170f65"));
    return {
      path,
      name: path.split('/').pop() || file.name || t("attachment_c7225dbf"),
      mime: String(file.type || ''),
      size: Math.max(0, Number(file.size) || buffer.byteLength || 0),
      type: advancedTypeForFile(file.name || path, file.type),
    };
  }

  uploadedFileBlock(record) {
    if (record.type === 'image') {
      return Core.createBlock('image', '', {
        data: { sourceType: 'vault', path: record.path, alt: record.name },
      });
    }
    if (record.type === 'video' || record.type === 'audio') {
      return Core.createBlock(record.type, '', {
        data: { sourceType: 'vault', path: record.path, title: record.name },
      });
    }
    return Core.createBlock('attachment', '', {
      data: {
        sourceType: 'vault',
        path: record.path,
        name: record.name,
        mime: record.mime,
        size: record.size,
        embed: fileExtension(record.name) === 'pdf',
      },
    });
  }

  remoteUrlBlock(value) {
    const url = String(value || '').trim();
    const inferred = advancedTypeForFile(url);
    if (inferred === 'image') {
      return Core.createBlock('image', '', { data: { sourceType: 'remote', url, alt: '' } });
    }
    if (inferred === 'video' || inferred === 'audio') {
      return Core.createBlock(inferred, '', { data: { sourceType: 'remote', url, title: url.split('/').pop() || url } });
    }
    if (fileExtension(url) === 'pdf') {
      return Core.createBlock('attachment', '', {
        data: { sourceType: 'remote', url, name: url.split('/').pop() || 'PDF', mime: 'application/pdf', embed: true },
      });
    }
    let title = url;
    let siteName = '';
    try {
      const parsed = new URL(url);
      siteName = parsed.hostname.replace(/^www\./, '');
      title = siteName || url;
    } catch (error) { /* normalized by the bookmark data model */ }
    return Core.createBlock('bookmark', '', { data: { url, title, siteName } });
  }

  insertRemoteUrl(value, anchorId) {
    const link = Core.classifyStoredLink(value);
    if (link.kind !== 'external' || !this.page) return null;
    const block = this.remoteUrlBlock(link.target);
    const current = Core.getBlock(this.page, anchorId);
    const replaceEmpty = current && current.type === 'paragraph' && !current.text && !current.children.length;
    this.performMutation(t("insert_web_content_90b4c55d"), (page) => {
      Core.insertBlockAfter(page, anchorId, block);
      if (replaceEmpty) Core.removeSubtrees(page, [anchorId]);
    });
    return block.id;
  }

  async insertUploadedFiles(files, anchorId) {
    const sourceFiles = Array.from(files || []).filter(Boolean);
    if (!sourceFiles.length || !this.page) return [];
    const records = [];
    try {
      for (const file of sourceFiles) records.push(await this.writeAttachmentFile(file));
    } catch (error) {
      console.error('Blockspace: attachment import failed', error);
      new Notice(t("attachment_import_failed_0_60f6acf8", [error && error.message ? error.message : error]));
      return [];
    }
    const blocks = records.map((record) => this.uploadedFileBlock(record));
    const current = Core.getBlock(this.page, anchorId);
    const replaceEmpty = current && current.type === 'paragraph' && !current.text && !current.children.length;
    let insertedIds = [];
    this.performMutation(records.length > 1 ? t("insert_multiple_attachments_9987d186") : t("insert_attachment_26172610"), (page) => {
      insertedIds = Core.insertBlocksAfter(page, anchorId, blocks).map((block) => block.id);
      if (replaceEmpty) Core.removeSubtrees(page, [anchorId]);
    });
    new Notice(records.length > 1 ? t("imported_0_attachments_917ce4e5", [records.length]) : t("imported_0_a8bb9a7a", [records[0].name]));
    return insertedIds;
  }

  async replaceAdvancedBlockFile(blockId, file) {
    if (!file || !this.page) return false;
    let record;
    try {
      record = await this.writeAttachmentFile(file);
    } catch (error) {
      console.error('Blockspace: attachment replacement failed', error);
      new Notice(t("could_not_write_attachment_0_1d42689a", [error && error.message ? error.message : error]));
      return false;
    }
    const replacement = this.uploadedFileBlock(record);
    this.performMutation(t("replace_block_file_36ae0e69"), (page) => {
      const target = Core.getBlock(page, blockId);
      if (!target) return;
      target.type = replacement.type;
      target.text = replacement.text;
      target.marks = [];
      target.data = replacement.data;
    });
    return true;
  }

  updateAdvancedBlock(blockId, label, updater, options = {}) {
    return this.performMutation(label, (page) => {
      const target = Core.getBlock(page, blockId);
      if (!target) return;
      updater(target);
      target.data = Core.normalizeBlockData(target.type, target.data);
    }, { render: options.render === true });
  }

  insertStructuredTableRow(blockId, rowId, position = 'after', focusColumnId = null) {
    const newRowId = Core.randomId('row');
    this.updateAdvancedBlock(blockId, t("add_table_row_bf23d102"), (target) => {
      const cells = {};
      for (const column of target.data.columns) cells[column.id] = '';
      const currentIndex = target.data.rows.findIndex((row) => row.id === rowId);
      const index = currentIndex < 0
        ? target.data.rows.length
        : currentIndex + (position === 'after' ? 1 : 0);
      target.data.rows.splice(index, 0, { id: newRowId, cells });
    }, { render: true });
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    ownerWindow.setTimeout(() => {
      const row = this.contentEl.querySelector(`[data-block-id="${blockId}"] [data-row-id="${newRowId}"]`);
      const field = focusColumnId
        ? row && row.querySelector(`[data-column-id="${focusColumnId}"]`)
        : row && row.querySelector('.bs-table-cell-input');
      if (field) field.focus({ preventScroll: true });
    }, 0);
    return newRowId;
  }

  showStructuredTableRowMenu(event, blockId, rowId) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const block = this.page && Core.getBlock(this.page, blockId);
    const data = block && Core.normalizeTableData(block.data);
    const row = data && data.rows.find((entry) => entry.id === rowId);
    if (!block || !row) return;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("insert_row_above_ccea8c05")).setIcon('arrow-up-to-line').onClick(() => {
      this.insertStructuredTableRow(blockId, rowId, 'before');
    }));
    menu.addItem((item) => item.setTitle(t("insert_row_below_7c131f17")).setIcon('arrow-down-to-line').onClick(() => {
      this.insertStructuredTableRow(blockId, rowId, 'after');
    }));
    menu.addItem((item) => item.setTitle(t("duplicate_this_row_457f9420")).setIcon('copy-plus').onClick(() => {
      const copyId = Core.randomId('row');
      this.updateAdvancedBlock(blockId, t("duplicate_table_row_d0ddf233"), (target) => {
        const index = target.data.rows.findIndex((entry) => entry.id === rowId);
        if (index < 0) return;
        target.data.rows.splice(index + 1, 0, { id: copyId, cells: { ...target.data.rows[index].cells } });
      }, { render: true });
    }));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("delete_this_row_9de7d82f"))
      .setIcon('trash-2')
      .setDisabled(data.rows.length <= 1)
      .onClick(() => {
        this.updateAdvancedBlock(blockId, t("delete_table_row_27707985"), (target) => {
          target.data.rows = target.data.rows.filter((entry) => entry.id !== rowId);
        }, { render: true });
      }));
    menu.showAtMouseEvent(event);
  }

  showStructuredTableColumnMenu(event, blockId, columnId) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const block = this.page && Core.getBlock(this.page, blockId);
    const data = block && Core.normalizeTableData(block.data);
    const column = data && data.columns.find((entry) => entry.id === columnId);
    if (!block || !column) return;
    const menu = new Menu();
    for (const [align, label, icon] of [
      ['left', t("align_left_2bd74486"), 'align-left'],
      ['center', t("center_4cc3885c"), 'align-center'],
      ['right', t("align_right_331c711e"), 'align-right'],
    ]) {
      menu.addItem((item) => {
        item.setTitle(label).setIcon(icon).onClick(() => {
          this.updateAdvancedBlock(blockId, t("change_table_column_alignment_2e8a3d84"), (target) => {
            const targetColumn = target.data.columns.find((entry) => entry.id === columnId);
            if (targetColumn) targetColumn.align = align;
          }, { render: true });
        });
        if (typeof item.setChecked === 'function') item.setChecked(column.align === align);
      });
    }
    menu.addSeparator();
    const insertColumn = (position) => {
      const newColumnId = Core.randomId('column');
      this.updateAdvancedBlock(blockId, t("add_table_column_7c812150"), (target) => {
        const currentIndex = target.data.columns.findIndex((entry) => entry.id === columnId);
        const index = currentIndex < 0
          ? target.data.columns.length
          : currentIndex + (position === 'right' ? 1 : 0);
        target.data.columns.splice(index, 0, {
          id: newColumnId,
          name: t("column_0_94ab35a6", [target.data.columns.length + 1]),
          align: 'left',
          width: 160,
        });
        for (const row of target.data.rows) row.cells[newColumnId] = '';
      }, { render: true });
    };
    menu.addItem((item) => item.setTitle(t("insert_column_to_the_left_927b7fa5")).setIcon('panel-left-open').onClick(() => insertColumn('left')));
    menu.addItem((item) => item.setTitle(t("insert_column_to_the_right_8ae98f3b")).setIcon('panel-right-open').onClick(() => insertColumn('right')));
    if (column.width) {
      menu.addItem((item) => item.setTitle(t("reset_column_width_to_automatic_c53b99ac")).setIcon('minimize-2').onClick(() => {
        this.updateAdvancedBlock(blockId, t("reset_table_column_widths_to_automatic_76fb367a"), (target) => {
          const targetColumn = target.data.columns.find((entry) => entry.id === columnId);
          if (targetColumn) targetColumn.width = 0;
        }, { render: true });
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("delete_this_column_31fe6ef5"))
      .setIcon('trash-2')
      .setDisabled(data.columns.length <= 1)
      .onClick(() => {
        this.updateAdvancedBlock(blockId, t("delete_table_column_bc989262"), (target) => {
          target.data.columns = target.data.columns.filter((entry) => entry.id !== columnId);
          for (const row of target.data.rows) delete row.cells[columnId];
        }, { render: true });
      }));
    menu.showAtMouseEvent(event);
  }

  renderStructuredTable(host, block) {
    const data = Core.normalizeTableData(block.data);
    const frame = host.createDiv({ cls: 'bs-structured-table-frame' });
    const scroll = frame.createDiv({ cls: 'bs-structured-table-scroll' });
    const table = scroll.createEl('table', { cls: 'bs-structured-table' });
    const naturalWidth = 32 + data.columns.reduce((sum, column) => sum + (column.width || 180), 0);
    table.style.setProperty('--bs-table-natural-width', `${naturalWidth}px`);
    const colgroup = table.createEl('colgroup');
    colgroup.createEl('col', { cls: 'bs-table-handle-column' });
    const columnElements = new Map();
    for (const column of data.columns) {
      const col = colgroup.createEl('col');
      col.dataset.columnId = column.id;
      col.style.width = `${column.width || 180}px`;
      columnElements.set(column.id, col);
    }
    const head = table.createEl('thead');
    const headerRow = head.createEl('tr');
    const corner = headerRow.createEl('th', { cls: 'bs-table-corner-cell', attr: { 'aria-hidden': 'true' } });
    const cornerIcon = corner.createSpan({ cls: 'bs-table-corner-icon' });
    setIcon(cornerIcon, 'table-2');
    for (const column of data.columns) {
      const cell = headerRow.createEl('th');
      cell.dataset.align = column.align;
      cell.dataset.columnId = column.id;
      const content = cell.createDiv({ cls: 'bs-table-heading-content' });
      const input = content.createEl('input', {
        cls: 'bs-table-cell-input bs-table-heading-input',
        attr: { type: 'text', 'aria-label': t("edit_column_heading_0_ab0c2ad7", [column.name || t("untitled_column_27f7c387")]) },
      });
      input.value = column.name;
      input.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_table_column_heading_b9dafc8f"), (target) => {
          const targetColumn = target.data.columns.find((entry) => entry.id === column.id);
          if (targetColumn) targetColumn.name = input.value;
        });
      });
      const menuButton = createButton(content, 'bs-table-column-menu', t("open_menu_for_column_0_3c8e86c3", [column.name || t("untitled_column_27f7c387")]), 'chevron-down');
      menuButton.addEventListener('click', (event) => this.showStructuredTableColumnMenu(event, block.id, column.id));
      cell.addEventListener('contextmenu', (event) => this.showStructuredTableColumnMenu(event, block.id, column.id));
      const resize = cell.createDiv({ cls: 'bs-table-column-resize', attr: { role: 'separator', 'aria-label': t("resize_column_0_a5108469", [column.name || t("untitled_column_27f7c387")]), tabindex: '0' } });
      resize.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const ownerWindow = cell.ownerDocument.defaultView;
        const startX = event.clientX;
        const startWidth = cell.getBoundingClientRect().width;
        const col = columnElements.get(column.id);
        const move = (moveEvent) => {
          const width = Math.max(96, Math.min(640, Math.round(startWidth + moveEvent.clientX - startX)));
          if (col) col.style.width = `${width}px`;
          table.style.setProperty('--bs-table-natural-width', `${Math.max(420, naturalWidth - (column.width || 180) + width)}px`);
          resize.dataset.pendingWidth = String(width);
        };
        const finish = () => {
          ownerWindow.removeEventListener('pointermove', move);
          ownerWindow.removeEventListener('pointerup', finish);
          const width = Number(resize.dataset.pendingWidth) || Math.round(startWidth);
          delete resize.dataset.pendingWidth;
          this.updateAdvancedBlock(block.id, t("resize_table_column_701bb2e7"), (target) => {
            const targetColumn = target.data.columns.find((entry) => entry.id === column.id);
            if (targetColumn) targetColumn.width = width;
          });
        };
        ownerWindow.addEventListener('pointermove', move);
        ownerWindow.addEventListener('pointerup', finish, { once: true });
      });
    }
    const body = table.createEl('tbody');
    data.rows.forEach((row, rowIndex) => {
      const rowEl = body.createEl('tr');
      rowEl.dataset.rowId = row.id;
      const rowHandle = rowEl.createEl('td', { cls: 'bs-table-row-handle-cell' });
      const rowMenu = createButton(rowHandle, 'bs-table-row-menu', t("open_menu_for_row_0_28d267b8", [rowIndex + 1]), 'grip-vertical');
      rowMenu.addEventListener('click', (event) => this.showStructuredTableRowMenu(event, block.id, row.id));
      rowHandle.addEventListener('contextmenu', (event) => this.showStructuredTableRowMenu(event, block.id, row.id));
      data.columns.forEach((column, columnIndex) => {
        const cell = rowEl.createEl('td');
        cell.dataset.align = column.align;
        cell.dataset.columnId = column.id;
        cell.addEventListener('contextmenu', (event) => this.showStructuredTableRowMenu(event, block.id, row.id));
        const input = cell.createEl('textarea', {
          cls: 'bs-table-cell-input',
          attr: {
            rows: '1',
            'data-column-id': column.id,
            'aria-label': t("row_0_1_0ea405f5", [rowIndex + 1, column.name || t("column_0_3b067d91", [columnIndex + 1])]),
            placeholder: t("empty_2f8267a8"),
          },
        });
        input.value = row.cells[column.id] || '';
        const resizeInput = () => {
          input.style.height = '0';
          input.style.height = `${Math.max(36, input.scrollHeight)}px`;
        };
        resizeInput();
        input.addEventListener('input', resizeInput);
        input.addEventListener('change', () => {
          this.updateAdvancedBlock(block.id, t("edit_table_cell_24d93261"), (target) => {
            const targetRow = target.data.rows.find((entry) => entry.id === row.id);
            if (targetRow) targetRow.cells[column.id] = input.value;
          });
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            input.dispatchEvent(new input.ownerDocument.defaultView.Event('change', { bubbles: true }));
            this.insertStructuredTableRow(block.id, row.id, 'after', column.id);
            return;
          }
          const isLastCell = rowIndex === data.rows.length - 1 && columnIndex === data.columns.length - 1;
          if (event.key === 'Tab' && !event.shiftKey && isLastCell) {
            event.preventDefault();
            input.dispatchEvent(new input.ownerDocument.defaultView.Event('change', { bubbles: true }));
            this.insertStructuredTableRow(block.id, row.id, 'after', data.columns[0].id);
          }
        });
      });
    });
    const actions = frame.createDiv({ cls: 'bs-advanced-actions bs-table-actions' });
    const addRow = createButton(actions, 'bs-table-add-row', t("add_table_row_bf23d102"), 'plus', t("new_row_c5a5421e"));
    addRow.addEventListener('click', () => {
      this.insertStructuredTableRow(block.id, data.rows[data.rows.length - 1]?.id || null, 'after');
    });
    const addColumn = createButton(actions, 'bs-table-add-column', t("add_table_column_7c812150"), 'columns-3', t("add_column_143eb0bf"));
    addColumn.addEventListener('click', () => {
      this.updateAdvancedBlock(block.id, t("add_table_column_7c812150"), (target) => {
        const id = Core.randomId('column');
        target.data.columns.push({ id, name: t("column_0_94ab35a6", [target.data.columns.length + 1]), align: 'left', width: 160 });
        for (const row of target.data.rows) row.cells[id] = '';
      }, { render: true });
    });
  }

  renderAdvancedFloatingToolbar(shell, block, options = {}) {
    const toolbar = shell.createDiv({ cls: 'bs-media-toolbar', attr: { role: 'toolbar', 'aria-label': t("0_actions_7cb40944", [ADVANCED_BLOCK_LABELS[block.type]?.label || t("media_fa33e100")]) } });
    const syncToolbar = () => syncMediaToolbarInteractive(toolbar);
    const queueToolbarSync = () => shell.ownerDocument.defaultView.setTimeout(syncToolbar, 0);
    shell.addEventListener('pointerenter', syncToolbar);
    shell.addEventListener('pointerleave', queueToolbarSync);
    shell.addEventListener('focusin', syncToolbar);
    shell.addEventListener('focusout', queueToolbarSync);
    let fileInput = null;
    if (options.upload !== false) {
      const replace = createButton(
        toolbar,
        `bs-media-toolbar-button${block.type === 'image' ? ' is-icon-only bs-media-toolbar-secondary' : ''}`,
        t("upload_or_replace_file_9fdd9517"),
        'replace',
        t("replace_131b13aa"),
      );
      fileInput = shell.createEl('input', {
        cls: 'bs-advanced-file-input',
        attr: { type: 'file', accept: options.accept || '*/*' },
      });
      replace.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (file) void this.replaceAdvancedBlockFile(block.id, file);
      });
    }
    if (options.openValue) {
      const open = createButton(
        toolbar,
        `bs-media-toolbar-button${block.type === 'image' ? ' is-icon-only bs-media-toolbar-secondary' : ''}`,
        t("open_original_content_a70e3a82"),
        'arrow-up-right',
        t("open_c771248e"),
      );
      open.addEventListener('click', (event) => void this.openStoredLink(options.openValue, event));
    }
    if (block.type === 'image') {
      const refocusImage = () => {
        const ownerWindow = this.contentEl.ownerDocument.defaultView;
        ownerWindow.setTimeout(() => {
          this.contentEl.querySelector(`[data-block-id="${block.id}"] .bs-image-frame`)?.focus({ preventScroll: true });
        }, 0);
      };
      const imageData = Core.normalizeBlockData('image', block.data);
      const wrapGroup = toolbar.createDiv({
        cls: 'bs-media-toolbar-group bs-image-wrap-group',
        attr: { role: 'group', 'aria-label': t("text_wrapping_12a0525c") },
      });
      for (const [wrapMode, icon, label, shortLabel] of [
        ['top-bottom', 'rows-3', t("full_row_text_appears_only_above_and_below_the_i_f898e8de"), t("full_row_5ee483f0")],
        ['square-left', 'panel-left', t("image_on_the_left_text_wraps_on_the_right_c70ff536"), t("left_6548f6b5")],
        ['square-right', 'panel-right', t("image_on_the_right_text_wraps_on_the_left_0647a9b5"), t("right_be92a99e")],
      ]) {
        const button = createButton(
          wrapGroup,
          `bs-media-toolbar-button bs-image-layout-button${imageData.wrapMode === wrapMode ? ' is-active' : ''}`,
          label,
          icon,
          shortLabel,
        );
        button.setAttribute('aria-pressed', imageData.wrapMode === wrapMode ? 'true' : 'false');
        button.addEventListener('click', () => {
          this.updateAdvancedBlock(block.id, t("change_text_wrapping_996850bf"), (target) => {
            target.data.wrapMode = wrapMode;
          }, { render: true });
          refocusImage();
        });
      }
    }
    const settings = createButton(
      toolbar,
      `bs-media-toolbar-button${block.type === 'image' ? ' is-icon-only bs-media-toolbar-secondary' : ''}`,
      t("edit_media_settings_38b9797c"),
      'sliders-horizontal',
      t("settings_df3d58c7"),
    );
    if (block.type === 'image') {
      const remove = createButton(
        toolbar,
        'bs-media-toolbar-button is-icon-only bs-media-toolbar-secondary is-destructive',
        t("delete_image_block_667ec545"),
        'trash-2',
        t("delete_2f9daa82"),
      );
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setBlockSelection([block.id], block.id, block.id);
        this.deleteSelectedBlocks();
      });
    }
    syncToolbar();
    return { toolbar, fileInput, settings };
  }

  renderBookmarkBlock(host, block) {
    const data = Core.normalizeBlockData('bookmark', block.data);
    const shell = host.createDiv({ cls: 'bs-media-shell bs-bookmark-shell' });
    const card = shell.createEl('button', {
      cls: `bs-bookmark-card${data.image ? ' has-cover' : ''}`,
      attr: { type: 'button', 'aria-label': data.title ? t("open_0_5f36cf1b", [data.title]) : t("open_bookmark_link_bf3dddd9") },
    });
    const body = card.createDiv({ cls: 'bs-bookmark-body' });
    const copy = body.createDiv({ cls: 'bs-bookmark-copy' });
    copy.createDiv({ cls: 'bs-bookmark-title', text: data.title || data.url || t("add_bookmark_link_031f9daa") });
    if (data.description) copy.createDiv({ cls: 'bs-bookmark-description', text: data.description });
    const meta = copy.createDiv({ cls: 'bs-bookmark-meta' });
    const icon = meta.createSpan({ cls: 'bs-bookmark-icon' });
    if (data.icon) {
      icon.createEl('img', { attr: { src: data.icon, alt: '', loading: 'lazy' } });
    } else setIcon(icon, 'globe-2');
    meta.createSpan({ cls: 'bs-bookmark-url', text: data.siteName || data.url || t("no_url_set_09e2395f") });
    const arrow = meta.createSpan({ cls: 'bs-bookmark-arrow' });
    setIcon(arrow, 'arrow-up-right');
    if (data.image) {
      const cover = card.createDiv({ cls: 'bs-bookmark-cover' });
      const coverImage = cover.createEl('img', {
        attr: { src: data.image, alt: '', loading: 'lazy' },
      });
      coverImage.addEventListener('error', () => {
        cover.hidden = true;
        card.removeClass('has-cover');
      });
    }
    card.disabled = !data.url;
    card.addEventListener('click', (event) => void this.openStoredLink(data.url, event));

    const tools = this.renderAdvancedFloatingToolbar(shell, block, { upload: false, openValue: data.url });
    const properties = host.createEl('details', { cls: 'bs-advanced-properties' });
    if (!data.url) properties.open = true;
    properties.createEl('summary', { text: t("bookmark_settings_c701aa01") });
    tools.settings.addEventListener('click', () => {
      properties.open = !properties.open;
      if (properties.open) properties.querySelector('input')?.focus();
    });
    const fields = properties.createDiv({ cls: 'bs-advanced-fields' });
    const addField = (label, key, multiline = false) => {
      const field = fields.createEl('label', { cls: 'bs-advanced-field' });
      field.createSpan({ text: label });
      const input = multiline
        ? field.createEl('textarea', { attr: { rows: '2' } })
        : field.createEl('input', { attr: { type: key === 'url' || key === 'image' || key === 'icon' ? 'url' : 'text' } });
      input.value = data[key] || '';
      input.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("edit_bookmark_2c1b74bf"), (target) => { target.data[key] = input.value.trim(); }, { render: true });
      });
    };
    addField(t("link_305378dd"), 'url');
    addField(t("title_c3405f8c"), 'title');
    addField(t("description_dc2ba467"), 'description', true);
    addField(t("site_a59fe627"), 'siteName');
    addField(t("preview_image_1b5939aa"), 'image');
    addField(t("site_icon_e220e37b"), 'icon');
  }

  renderAdvancedMediaBlock(host, block) {
    const data = Core.normalizeBlockData(block.type, block.data);
    const source = this.advancedResourceUrl(block);
    const sourceValue = data.sourceType === 'vault' && data.path ? `wikilink:${data.path}` : data.url;
    const shell = host.createDiv({ cls: `bs-media-shell is-${block.type}` });
    const preview = shell.createDiv({ cls: `bs-advanced-preview is-${block.type}` });
    const fileKind = fileExtension(data.path || data.name || data.url);
    const isEmbeddedPdf = block.type === 'attachment' && fileKind === 'pdf' && data.embed && source;
    let imageFrame = null;
    let imageCaption = null;

    if (block.type === 'image' && source) {
      imageFrame = preview.createDiv({
        cls: `bs-image-frame is-width-${data.widthMode || (data.width ? 'fixed' : 'auto')}`,
        attr: {
          role: 'button',
          tabindex: '0',
          'aria-label': t("select_an_image_then_adjust_its_size_and_alignme_964af20e"),
        },
      });
      const image = imageFrame.createEl('img', {
        cls: 'bs-advanced-image',
        attr: { src: source, alt: data.alt || data.caption || block.text || '', loading: 'lazy' },
      });
      if (data.widthMode === 'fixed' && data.width) imageFrame.style.width = `${data.width}px`;
      if (data.height) image.style.height = `${data.height}px`;
      this.attachRenderedMediaInteractions(preview);

      const syncCaptionWidth = () => {
        if (!imageCaption || !imageFrame) return;
        const renderedWidth = Math.round(imageFrame.getBoundingClientRect().width);
        imageCaption.style.width = renderedWidth ? `${Math.min(renderedWidth, 680)}px` : '';
      };
      const applyRenderedWidth = (width) => {
        const wrapFlow = imageFrame.closest('.bs-image-wrap-flow');
        const wrapBlock = imageFrame.closest('.bs-block-image');
        const containerWidth = wrapFlow
          ? wrapFlow.getBoundingClientRect().width
          : preview.getBoundingClientRect().width;
        const available = Math.max(
          80,
          Math.round(wrapFlow ? containerWidth * 0.65 : containerWidth || width || 80),
        );
        const minimum = Math.min(120, available);
        const nextWidth = Math.max(minimum, Math.min(available, Math.round(width || minimum)));
        imageFrame.removeClass('is-width-auto');
        imageFrame.removeClass('is-width-full');
        imageFrame.addClass('is-width-fixed');
        if (wrapBlock) wrapBlock.style.width = `${nextWidth}px`;
        imageFrame.style.width = wrapFlow ? '100%' : `${nextWidth}px`;
        image.style.width = '100%';
        image.style.height = 'auto';
        imageFrame.dataset.pendingWidth = String(nextWidth);
        syncCaptionWidth();
        return nextWidth;
      };
      const commitRenderedWidth = (width) => {
        this.updateAdvancedBlock(block.id, t("resize_image_width_91eef91a"), (target) => {
          target.data.width = width;
          target.data.height = 0;
          target.data.widthMode = 'fixed';
        }, { render: false });
      };
      const addResizeHandle = (corner) => {
        const isLeft = corner.endsWith('w');
        const isTop = corner.startsWith('n');
        const cornerLabel = {
          nw: t("top_left_4b715214"),
          ne: t("top_right_d8ed5dd7"),
          sw: t("bottom_left_cc728271"),
          se: t("bottom_right_6897632c"),
        }[corner];
        const handle = imageFrame.createEl('button', {
          cls: `bs-image-resize-handle is-${corner}`,
          attr: {
            type: 'button',
            'aria-label': t("resize_image_proportionally_from_the_0_f5fcc594", [cornerLabel]),
            title: t("drag_to_resize_proportionally_use_arrow_keys_to__af35e49c"),
          },
        });
        handle.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        handle.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          handle.focus({ preventScroll: true });
          const ownerWindow = handle.ownerDocument.defaultView;
          const startX = event.clientX;
          const startY = event.clientY;
          const startRect = imageFrame.getBoundingClientRect();
          const startWidth = startRect.width;
          const aspectRatio = startRect.width / Math.max(1, startRect.height);
          let nextWidth = startWidth;
          imageFrame.addClass('is-resizing');
          const move = (moveEvent) => {
            const horizontalDelta = (moveEvent.clientX - startX) * (isLeft ? -1 : 1);
            const verticalDelta = (moveEvent.clientY - startY) * (isTop ? -1 : 1) * aspectRatio;
            const delta = Math.abs(horizontalDelta) >= Math.abs(verticalDelta)
              ? horizontalDelta
              : verticalDelta;
            nextWidth = applyRenderedWidth(startWidth + delta);
          };
          const finish = () => {
            ownerWindow.removeEventListener('pointermove', move);
            ownerWindow.removeEventListener('pointerup', finish);
            ownerWindow.removeEventListener('pointercancel', finish);
            imageFrame.removeClass('is-resizing');
            delete imageFrame.dataset.pendingWidth;
            commitRenderedWidth(Math.round(nextWidth));
            handle.focus({ preventScroll: true });
          };
          ownerWindow.addEventListener('pointermove', move);
          ownerWindow.addEventListener('pointerup', finish, { once: true });
          ownerWindow.addEventListener('pointercancel', finish, { once: true });
        });
        handle.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.stopPropagation();
          const currentWidth = imageFrame.getBoundingClientRect().width;
          const step = event.shiftKey ? 48 : 12;
          const signedStep = event.key === 'ArrowRight' ? step : -step;
          const nextWidth = applyRenderedWidth(currentWidth + (isLeft ? -signedStep : signedStep));
          delete imageFrame.dataset.pendingWidth;
          commitRenderedWidth(nextWidth);
        });
      };
      addResizeHandle('nw');
      addResizeHandle('ne');
      addResizeHandle('sw');
      addResizeHandle('se');

      const selectImageBlock = () => {
        if (!this.page || !Core.getBlock(this.page, block.id)) return;
        this.setBlockSelection([block.id], block.id, block.id);
      };
      imageFrame.addEventListener('focusin', selectImageBlock);
      imageFrame.addEventListener('click', (event) => {
        if (event.target && event.target.closest && event.target.closest('button, input, select, a')) return;
        selectImageBlock();
        imageFrame.focus({ preventScroll: true });
      });
      imageFrame.addEventListener('keydown', (event) => {
        if (event.target !== imageFrame || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        imageFrame.focus({ preventScroll: true });
      });
      image.addEventListener('load', () => imageFrame.ownerDocument.defaultView.requestAnimationFrame(syncCaptionWidth));
    } else if (block.type === 'video' && source) {
      const video = preview.createEl('video', {
        cls: 'bs-advanced-video',
        attr: { src: source, preload: 'metadata', playsinline: 'true' },
      });
      video.controls = data.controls !== false;
      video.loop = !!data.loop;
      video.muted = !!data.muted;
      if (data.poster) video.poster = data.poster;
    } else if (block.type === 'audio' && source) {
      const audioCard = preview.createDiv({ cls: 'bs-audio-card' });
      const audioIcon = audioCard.createSpan({ cls: 'bs-audio-icon' });
      setIcon(audioIcon, 'audio-lines');
      const audioBody = audioCard.createDiv({ cls: 'bs-audio-body' });
      audioBody.createDiv({ cls: 'bs-audio-title', text: data.title || data.path || data.url || t("audio_296c632e") });
      const audio = audioBody.createEl('audio', {
        cls: 'bs-advanced-audio',
        attr: { src: source, preload: 'metadata' },
      });
      audio.controls = data.controls !== false;
      audio.loop = !!data.loop;
      audio.muted = !!data.muted;
    } else if (isEmbeddedPdf) {
      const embed = preview.createDiv({ cls: 'bs-attachment-embed' });
      const embedHeader = embed.createDiv({ cls: 'bs-attachment-embed-header' });
      const icon = embedHeader.createSpan({ cls: 'bs-attachment-icon' });
      setIcon(icon, 'file-text');
      embedHeader.createDiv({ cls: 'bs-attachment-name', text: data.name || data.path || t("pdf_document_52ab6bf6") });
      const frameSource = `${source}${data.page ? `#page=${data.page}` : ''}`;
      const frame = embed.createEl('iframe', {
        cls: 'bs-attachment-frame',
        attr: { src: frameSource, title: data.name || data.path || t("pdf_attachment_preview_c7aef6bc"), loading: 'lazy' },
      });
      frame.style.height = `${data.height || 520}px`;
    } else if (block.type === 'attachment' && (data.path || data.url)) {
      const card = preview.createEl('button', {
        cls: 'bs-attachment-card',
        attr: { type: 'button', 'aria-label': t("open_attachment_0_747a793f", [data.name || data.path || data.url]) },
      });
      const icon = card.createSpan({ cls: 'bs-attachment-icon' });
      setIcon(icon, fileKind === 'pdf' ? 'file-text' : 'paperclip');
      const copy = card.createDiv({ cls: 'bs-attachment-copy' });
      copy.createDiv({ cls: 'bs-attachment-name', text: data.name || data.path || data.url });
      const meta = [fileKind ? fileKind.toUpperCase() : '', data.mime, formatFileSize(data.size)].filter(Boolean).join(' · ');
      if (meta) copy.createDiv({ cls: 'bs-attachment-meta', text: meta });
      const arrow = card.createSpan({ cls: 'bs-attachment-arrow' });
      setIcon(arrow, 'arrow-up-right');
      card.addEventListener('click', (event) => void this.openStoredLink(sourceValue, event));
    } else {
      const empty = preview.createEl('button', {
        cls: 'bs-advanced-empty',
        attr: { type: 'button', 'aria-label': t("add_0_a9c48d9d", [ADVANCED_BLOCK_LABELS[block.type]?.label || t("content_7a688306")]) },
      });
      const icon = empty.createSpan();
      setIcon(icon, ADVANCED_BLOCK_LABELS[block.type]?.icon || 'paperclip');
      const copy = empty.createDiv();
      copy.createDiv({ cls: 'bs-advanced-empty-title', text: t("add_0_a9c48d9d", [ADVANCED_BLOCK_LABELS[block.type]?.label || t("content_7a688306")]) });
      copy.createDiv({ cls: 'bs-advanced-empty-hint', text: t("upload_a_file_or_paste_a_url_in_settings_23a1c54b") });
    }

    const accept = block.type === 'image' ? 'image/*'
      : block.type === 'video' ? 'video/*'
        : block.type === 'audio' ? 'audio/*' : '*/*';
    const tools = this.renderAdvancedFloatingToolbar(imageFrame || shell, block, { accept, openValue: sourceValue, preview });
    const emptyButton = preview.querySelector('.bs-advanced-empty');
    if (emptyButton && tools.fileInput) emptyButton.addEventListener('click', () => tools.fileInput.click());

    if (block.type === 'image') {
      imageCaption = shell.createEl('input', {
        cls: `bs-media-caption is-align-${data.captionAlign} is-size-${data.captionSize} is-style-${data.captionStyle}`,
        attr: { type: 'text', placeholder: t("add_an_image_caption_fb5edc08"), 'aria-label': t("image_caption_5e137136") },
      });
      imageCaption.value = data.caption || '';
      imageCaption.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_image_caption_edc5f9dd"), (target) => { target.data.caption = imageCaption.value.trim(); }, { render: true });
      });
      if (imageFrame) {
        imageFrame.ownerDocument.defaultView.requestAnimationFrame(() => {
          const renderedWidth = Math.round(imageFrame.getBoundingClientRect().width);
          imageCaption.style.width = renderedWidth ? `${Math.min(renderedWidth, 680)}px` : '';
        });
      }
    } else if (block.type === 'video' && data.title) {
      host.createDiv({ cls: 'bs-media-static-caption', text: data.title });
    }

    const properties = host.createEl('details', {
      cls: `bs-advanced-properties${block.type === 'image' ? ' bs-image-properties' : ''}`,
    });
    if (!data.path && !data.url) properties.open = true;
    properties.createEl('summary', { text: t("0_settings_e223bcc4", [ADVANCED_BLOCK_LABELS[block.type]?.label || t("media_fa33e100")]) });
    tools.settings.addEventListener('click', () => {
      properties.open = !properties.open;
      if (properties.open) properties.querySelector('input, select')?.focus();
    });
    const fields = properties.createDiv({ cls: 'bs-advanced-fields' });
    const sourceTypeField = fields.createEl('label', { cls: 'bs-advanced-field' });
    sourceTypeField.createSpan({ text: t("source_a488e93d") });
    const sourceType = sourceTypeField.createEl('select');
    sourceType.createEl('option', { value: 'vault', text: t("vault_file_09d41c0d") });
    sourceType.createEl('option', { value: 'remote', text: t("web_url_074939b7") });
    sourceType.value = data.sourceType;
    sourceType.addEventListener('change', () => {
      this.updateAdvancedBlock(block.id, t("change_resource_source_ee335074"), (target) => { target.data.sourceType = sourceType.value; }, { render: true });
    });
    const sourceField = fields.createEl('label', { cls: 'bs-advanced-field' });
    sourceField.createSpan({ text: data.sourceType === 'vault' ? t("vault_path_c8b1cac5") : t("web_url_074939b7") });
    const sourceInput = sourceField.createEl('input', {
      attr: { type: data.sourceType === 'remote' ? 'url' : 'text', placeholder: data.sourceType === 'remote' ? 'https://…' : 'Assets/file.ext' },
    });
    sourceInput.value = data.sourceType === 'remote' ? data.url : data.path;
    sourceInput.addEventListener('change', () => {
      this.updateAdvancedBlock(block.id, t("change_resource_url_0a237a72"), (target) => {
        if (target.data.sourceType === 'remote') target.data.url = sourceInput.value.trim();
        else target.data.path = normalizePath(sourceInput.value.trim());
      }, { render: true });
    });
    if (block.type === 'image') {
      const altField = fields.createEl('label', { cls: 'bs-advanced-field' });
      altField.createSpan({ text: t("alt_text_44f78ce6") });
      const alt = altField.createEl('input', { attr: { type: 'text' } });
      alt.value = data.alt || '';
      alt.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_image_alt_text_14682685"), (target) => { target.data.alt = alt.value; }, { render: true });
      });
      const alignField = fields.createEl('label', { cls: 'bs-advanced-field' });
      alignField.createSpan({ text: t("image_alignment_1b01af64") });
      const align = alignField.createEl('select');
      for (const [value, text] of [
        ['left', t("align_left_2bd74486")],
        ['center', t("center_4cc3885c")],
        ['right', t("align_right_331c711e")],
      ]) align.createEl('option', { value, text });
      align.value = Core.normalizeBlockAppearance(block.appearance).align;
      align.addEventListener('change', () => {
        this.performMutation(t("change_image_alignment_018e793a"), (page) => {
          const target = Core.getBlock(page, block.id);
          if (!target) return;
          target.appearance = { ...Core.normalizeBlockAppearance(target.appearance), align: align.value };
        }, { render: true });
      });
      const sizeModeField = fields.createEl('label', { cls: 'bs-advanced-field' });
      sizeModeField.createSpan({ text: t("image_size_c08c3589") });
      const sizeMode = sizeModeField.createEl('select');
      for (const [value, text] of [
        ['auto', t("natural_size_e1fa86b0")],
        ['fixed', t("fixed_width_4513e64a")],
        ['full', t("fit_content_width_4bccfe47")],
      ]) sizeMode.createEl('option', { value, text });
      sizeMode.value = data.widthMode;
      sizeMode.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_image_sizing_mode_89b000a5"), (target) => {
          target.data.widthMode = sizeMode.value;
          target.data.height = 0;
          if (sizeMode.value === 'fixed') target.data.width = target.data.width || 320;
          else target.data.width = 0;
        }, { render: true });
      });
      const widthField = fields.createEl('label', { cls: 'bs-advanced-field' });
      widthField.createSpan({ text: t("display_width_6ed10f4b") });
      const width = widthField.createEl('input', { attr: { type: 'number', min: '0', max: '4000', placeholder: t("automatic_7eb336e4") } });
      width.value = data.width ? String(data.width) : '';
      width.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_image_width_07c3858b"), (target) => {
          target.data.width = Number(width.value) || 0;
          target.data.height = 0;
          target.data.widthMode = target.data.width ? 'fixed' : 'auto';
        }, { render: true });
      });
      const addImageSelect = (label, key, options, mutationLabel) => {
        const field = fields.createEl('label', { cls: 'bs-advanced-field' });
        field.createSpan({ text: label });
        const select = field.createEl('select');
        for (const [value, text] of options) select.createEl('option', { value, text });
        select.value = data[key];
        select.addEventListener('change', () => {
          this.updateAdvancedBlock(block.id, mutationLabel, (target) => {
            target.data[key] = select.value;
          }, { render: true });
        });
      };
      addImageSelect(t("text_wrapping_12a0525c"), 'wrapMode', [
        ['top-bottom', t("full_row_78d9ec04")],
        ['square-left', t("image_on_the_left_202ac48a")],
        ['square-right', t("image_on_the_right_df20282d")],
      ], t("change_text_wrapping_996850bf"));
      addImageSelect(t("vertical_text_alignment_50e15011"), 'wrapTextAlign', [
        ['top', t("align_top_a6648b5b")],
        ['center', t("center_vertically_f8e151e9")],
        ['bottom', t("align_bottom_f809ff81")],
      ], t("change_vertical_text_alignment_7041b91b"));
      addImageSelect(t("image_and_text_spacing_a10abb3d"), 'wrapGap', [
        [12, t("compact_12px_5c8bb169")],
        [20, t("standard_20px_4fb9cc21")],
        [28, t("relaxed_28px_85e7d6c1")],
        [36, t("loose_36px_3e070243")],
      ], t("change_image_and_text_spacing_699f34b5"));
      addImageSelect(t("caption_alignment_e146e592"), 'captionAlign', [
        ['left', t("align_left_2bd74486")],
        ['center', t("center_4cc3885c")],
        ['right', t("align_right_331c711e")],
      ], t("change_caption_alignment_23e23a9a"));
      addImageSelect(t("caption_font_size_770b72b7"), 'captionSize', [
        ['small', t("small_511f41e7")],
        ['normal', t("body_d661c3d9")],
      ], t("change_caption_font_size_273937ba"));
      addImageSelect(t("caption_style_1056884c"), 'captionStyle', [
        ['regular', t("regular_40fae00b")],
        ['italic', t("italic_217901c5")],
        ['bold', t("bold_f6da93ed")],
      ], t("change_caption_style_5f5bca75"));
      fields.createDiv({
        cls: 'bs-image-caption-guidance',
        text: t("captions_are_for_short_descriptions_with_alignme_8247cf2b"),
      });
    } else {
      const titleField = fields.createEl('label', { cls: 'bs-advanced-field' });
      titleField.createSpan({ text: block.type === 'attachment' ? t("file_name_a6e48adc") : t("title_c3405f8c") });
      const title = titleField.createEl('input', { attr: { type: 'text' } });
      title.value = block.type === 'attachment' ? data.name || '' : data.title || '';
      title.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_media_title_d42b6ff9"), (target) => {
          if (target.type === 'attachment') target.data.name = title.value;
          else target.data.title = title.value;
        }, { render: true });
      });
    }
    if (block.type === 'attachment') {
      const embedField = fields.createEl('label', { cls: 'bs-advanced-field is-toggle' });
      const embed = embedField.createEl('input', { attr: { type: 'checkbox' } });
      embed.checked = !!data.embed;
      embedField.createSpan({ text: t("embed_pdf_preview_602fa7f9") });
      embed.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("toggle_embedded_attachment_8949dc5e"), (target) => { target.data.embed = embed.checked; }, { render: true });
      });
      const pageField = fields.createEl('label', { cls: 'bs-advanced-field' });
      pageField.createSpan({ text: t("starting_page_051a06e3") });
      const page = pageField.createEl('input', { attr: { type: 'number', min: '0', placeholder: t("default_844b8cc8") } });
      page.value = data.page ? String(data.page) : '';
      page.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_attachment_page_ed0588ee"), (target) => { target.data.page = Number(page.value) || 0; }, { render: true });
      });
      const heightField = fields.createEl('label', { cls: 'bs-advanced-field' });
      heightField.createSpan({ text: t("preview_height_6f8f9b2e") });
      const height = heightField.createEl('input', { attr: { type: 'number', min: '240', max: '4000', placeholder: '520' } });
      height.value = data.height ? String(data.height) : '';
      height.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, t("change_attachment_height_b73effa5"), (target) => { target.data.height = Number(height.value) || 0; }, { render: true });
      });
    }
  }

  renderAdvancedBlock(content, wrapper, block) {
    if (!Core.ADVANCED_BLOCK_TYPES.has(block.type)) return false;
    wrapper.addClass('is-atomic-block');
    const advanced = content.createDiv({ cls: `bs-advanced-block bs-advanced-${block.type}` });
    if (block.type === 'table') {
      this.renderStructuredTable(advanced, block);
      return true;
    }
    if (block.type === 'bookmark') this.renderBookmarkBlock(advanced, block);
    else this.renderAdvancedMediaBlock(advanced, block);
    return true;
  }

  renderColumnsBlock(content, wrapper, block) {
    const config = Core.normalizeColumnsConfig(block.columns);
    wrapper.addClass('is-layout-block');
    wrapper.setAttribute('aria-label', t("0_column_layout_b5b83b72", [config.count]));
    const layout = content.createDiv({ cls: 'bs-columns-layout' });
    const grid = layout.createDiv({ cls: 'bs-columns-grid' });
    const fallbackRatio = config.count === 3 ? '1:1:1' : '1:1';
    grid.style.setProperty('--bs-columns-template', COLUMN_RATIO_TEMPLATES[config.ratio] || COLUMN_RATIO_TEMPLATES[fallbackRatio]);
    const columnBlocks = block.children.map((id) => Core.getBlock(this.page, id)).filter((child) => child && child.type === 'column');
    const allEntries = this.getVisibleBlockEntries();
    columnBlocks.forEach((column, columnIndex) => {
      const columnEl = grid.createDiv({
        cls: 'bs-column',
        attr: {
          role: 'group',
          'aria-label': t("column_0_a15edce9", [columnIndex + 1]),
          'data-column-id': column.id,
        },
      });
      const addBlock = () => {
        let createdId = null;
        this.performMutation(t("add_block_to_column_1cdb61d5"), (page) => {
          const targetColumn = Core.getBlock(page, column.id);
          if (!targetColumn) return;
          const created = Core.insertBlock(page, Core.createBlock(), { parentId: targetColumn.id, index: targetColumn.children.length });
          createdId = created.id;
        });
        if (createdId) focusEditorAt(this, createdId, 0);
      };

      const blocksHost = columnEl.createDiv({ cls: 'bs-column-blocks' });
      const columnEntries = allEntries.filter((entry) => Core.getAncestorIds(this.page, entry.block.id).includes(column.id));
      if (columnEntries.length) this.renderBlockEntrySequence(blocksHost, columnEntries, Core.getBlockDepth(this.page, column.id) + 1);
      else {
        const empty = blocksHost.createEl('button', {
          cls: 'bs-column-empty',
          text: t("drop_blocks_here_or_click_to_add_aaea3326"),
          attr: { type: 'button' },
        });
        empty.addEventListener('click', addBlock);
      }

      columnEl.addEventListener('dragover', (event) => {
        if (!this.dragBlockIds.length || (event.target.closest && event.target.closest('.bs-block'))) return;
        const moving = new Set(this.dragBlockIds.flatMap((id) => Core.getSubtreeIds(this.page, id)));
        if (moving.has(column.id)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        this.clearDropTargets();
        this.dropPosition = { blockId: column.id, position: 'inside' };
        columnEl.addClass('is-column-drop-target');
      });
      columnEl.addEventListener('dragleave', (event) => {
        if (columnEl.contains(event.relatedTarget)) return;
        columnEl.removeClass('is-column-drop-target');
      });
      columnEl.addEventListener('drop', (event) => {
        if (!this.dragBlockIds.length || (event.target.closest && event.target.closest('.bs-block'))) return;
        event.preventDefault();
        event.stopPropagation();
        let sourceIds = this.dragBlockIds;
        try {
          const transferred = JSON.parse(event.dataTransfer.getData('application/x-blockspace-blocks') || '[]');
          if (Array.isArray(transferred) && transferred.length) sourceIds = transferred;
        } catch (error) { /* use current drag session */ }
        this.cancelDragAutoScroll();
        this.clearDropTargets();
        this.dragBlockId = null;
        this.dragBlockIds = [];
        this.contentEl.querySelectorAll('.bs-block.is-dragging').forEach((element) => element.removeClass('is-dragging'));
        if (!sourceIds.length) return;
        this.performMutation(sourceIds.length > 1 ? t("move_blocks_into_column_e9bfbcbb") : t("move_block_into_column_10fe8668"), (page) => {
          Core.moveSubtrees(page, sourceIds, column.id, 'inside');
        });
      });
    });
  }

  renderBlock(container, block, index, depth = 0) {
    const wrapper = container.createDiv({ cls: `bs-block bs-block-${block.type}` });
    wrapper.dataset.blockId = block.id;
    wrapper.dataset.depth = String(depth);
    const blockAppearance = Core.normalizeBlockAppearance(block.appearance);
    wrapper.dataset.textColor = blockAppearance.textColor;
    wrapper.dataset.background = blockAppearance.background;
    wrapper.dataset.align = blockAppearance.align;
    wrapper.draggable = false;
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute('aria-level', String(depth + 1));
    wrapper.setAttribute('aria-selected', this.selectedBlockIds.has(block.id) ? 'true' : 'false');
    wrapper.toggleClass('is-block-selected', this.selectedBlockIds.has(block.id));
    wrapper.toggleClass('has-children', block.children.length > 0);
    wrapper.toggleClass('is-collapsed', !!block.collapsed);

    const controls = wrapper.createDiv({ cls: 'bs-block-controls' });
    const selectRail = controls.createDiv({
      cls: 'bs-gutter-select-zone',
      attr: {
        role: 'button',
        tabindex: '0',
        'aria-label': t("select_this_block_then_use_shift_arrow_keys_to_e_217e3e13"),
        'aria-pressed': this.selectedBlockIds.has(block.id) ? 'true' : 'false',
        title: t("drag_to_select_consecutive_blocks_or_press_enter_275cc5f1"),
      },
    });
    selectRail.addEventListener('pointerdown', (event) => this.beginGutterSelection(block.id, event));
    selectRail.addEventListener('pointerenter', (event) => {
      if (this.gutterSelectionSession && event.buttons === 1) this.extendGutterSelection(block.id);
    });
    selectRail.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.selectBlock(block.id, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
    });
    const addButton = createButton(controls, 'bs-block-control', t("add_sibling_block_after_this_block_ff273230"), 'plus');
    addButton.addEventListener('click', () => this.insertBlock(block.id));
    const handle = createButton(controls, 'bs-block-control bs-drag-handle', t("select_drag_or_open_block_menu_ac7a34d9"), 'grip-vertical');
    handle.draggable = true;
    handle.title = t("click_or_right_click_for_menu_shift_for_range_ct_f521c102");
    handle.setAttribute('aria-pressed', this.selectedBlockIds.has(block.id) ? 'true' : 'false');
    handle.addEventListener('click', (event) => {
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        event.preventDefault();
        this.selectBlock(block.id, { range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });
        return;
      }
      this.selectBlock(block.id);
      this.showBlockMenu(event, block, index);
    });
    handle.addEventListener('dragstart', (event) => {
      this.commitPendingEdit();
      if (!this.selectedBlockIds.has(block.id)) this.selectBlock(block.id);
      this.dragBlockIds = Core.normalizeTopLevelSelection(this.page, this.getOrderedSelectedBlockIds());
      this.dragBlockId = this.dragBlockIds[0] || block.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.dragBlockId);
      event.dataTransfer.setData('application/x-blockspace-blocks', JSON.stringify(this.dragBlockIds));
      const allDragging = new Set(this.dragBlockIds.flatMap((id) => Core.getSubtreeIds(this.page, id)));
      for (const id of allDragging) {
        const element = this.contentEl.querySelector(`[data-block-id="${id}"]`);
        if (element) element.addClass('is-dragging');
      }
      this.createDragPreview(event, this.dragBlockIds);
      this.setInteractionState('dragging', { blockIds: this.dragBlockIds });
    });
    handle.addEventListener('dragend', () => {
      this.dragBlockId = null;
      this.dragBlockIds = [];
      this.contentEl.querySelectorAll('.bs-block.is-dragging').forEach((element) => element.removeClass('is-dragging'));
      this.cancelDragAutoScroll();
      this.clearDropTargets();
      this.setInteractionState(this.selectedBlockIds.size ? 'block-selecting' : 'idle', { blockIds: this.getOrderedSelectedBlockIds() });
    });
    wrapper.addEventListener('dragover', (event) => {
      const externalFiles = event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
      if (externalFiles) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        this.clearDropTargets();
        this.dropPosition = { blockId: block.id, position: 'after' };
        wrapper.addClass('is-drop-after');
        return;
      }
      if (!this.dragBlockIds.length) return;
      const moving = new Set(this.dragBlockIds.flatMap((id) => Core.getSubtreeIds(this.page, id)));
      if (moving.has(block.id)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      this.scheduleDragAutoScroll(event.clientY);
      const rect = wrapper.getBoundingClientRect();
      const relativeY = (event.clientY - rect.top) / Math.max(1, rect.height);
      let position;
      if (Core.canBlockHaveChildren(block) && block.type !== 'columns' && relativeY >= 0.32 && relativeY <= 0.68) position = 'inside';
      else position = relativeY < 0.5 ? 'before' : 'after';
      if (this.dropPosition && this.dropPosition.blockId === block.id && this.dropPosition.position === position) return;
      this.clearDropTargets();
      this.dropPosition = { blockId: block.id, position };
      wrapper.addClass(position === 'before' ? 'is-drop-before' : position === 'inside' ? 'is-drop-target' : 'is-drop-after');
      this.showDropHint(wrapper, block, position, this.dragBlockIds);
    });
    wrapper.addEventListener('dragleave', (event) => {
      if (wrapper.contains(event.relatedTarget)) return;
      wrapper.removeClass('is-drop-before');
      wrapper.removeClass('is-drop-after');
      wrapper.removeClass('is-drop-target');
    });
    wrapper.addEventListener('drop', (event) => {
      event.preventDefault();
      const files = event.dataTransfer ? Array.from(event.dataTransfer.files || []) : [];
      if (files.length) {
        this.cancelDragAutoScroll();
        this.clearDropTargets();
        void this.insertUploadedFiles(files, block.id);
        return;
      }
      const uri = event.dataTransfer && String(event.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).find((line) => line && !line.startsWith('#'));
      if (uri && Core.classifyStoredLink(uri).kind === 'external') {
        this.cancelDragAutoScroll();
        this.clearDropTargets();
        this.insertRemoteUrl(uri, block.id);
        return;
      }
      let sourceIds = this.dragBlockIds;
      try {
        const transferred = JSON.parse(event.dataTransfer.getData('application/x-blockspace-blocks') || '[]');
        if (Array.isArray(transferred) && transferred.length) sourceIds = transferred;
      } catch (error) { /* use current drag session */ }
      const position = this.dropPosition && this.dropPosition.blockId === block.id ? this.dropPosition.position : 'after';
      this.cancelDragAutoScroll();
      this.clearDropTargets();
      this.dragBlockId = null;
      this.dragBlockIds = [];
      this.contentEl.querySelectorAll('.bs-block.is-dragging').forEach((element) => element.removeClass('is-dragging'));
      if (!sourceIds.length) return;
      this.performMutation(sourceIds.length > 1 ? t("drag_block_subtrees_90451e86") : t("drag_block_subtree_e2c61558"), (page) => {
        Core.moveSubtrees(page, sourceIds, block.id, position);
      });
    });

    const content = wrapper.createDiv({ cls: 'bs-block-content' });
    if (block.type === 'columns') {
      this.renderColumnsBlock(content, wrapper, block);
      return;
    }
    const headingSectionIds = Core.isHeadingBlock(block) ? Core.getHeadingSectionRootIds(this.page, block.id) : [];
    const hasHeadingSection = headingSectionIds.length > 1;
    const canCollapse = block.type === 'toggle' || block.children.length > 0 || hasHeadingSection;
    const isCollapsed = Core.isHeadingBlock(block) ? !!block.sectionCollapsed : !!block.collapsed;
    wrapper.toggleClass('is-section-collapsed', Core.isHeadingBlock(block) && !!block.sectionCollapsed);
    if (canCollapse) {
      const disclosure = createButton(content, 'bs-collapse-toggle', isCollapsed ? t("expand_content_6ad8768c") : t("collapse_content_1d37f580"), isCollapsed ? 'chevron-right' : 'chevron-down');
      disclosure.setAttribute('aria-expanded', String(!isCollapsed));
      disclosure.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.performMutation(isCollapsed ? t("expand_content_6ad8768c") : t("collapse_content_1d37f580"), (page) => {
          if (Core.isHeadingBlock(block)) Core.toggleHeadingSectionCollapsed(page, block.id);
          else Core.toggleBlockCollapsed(page, block.id);
        });
      });
    } else {
      content.createSpan({ cls: 'bs-collapse-spacer' });
    }

    if (block.type === 'todo') {
      const checkbox = content.createEl('input', { cls: 'bs-todo-checkbox', attr: { type: 'checkbox', 'aria-label': t("complete_task_56be0930") } });
      checkbox.checked = block.checked;
      checkbox.addEventListener('change', () => {
        this.performMutation(t("toggle_to_do_status_2128b67b"), (page) => {
          const current = Core.getBlock(page, block.id);
          if (current) current.checked = checkbox.checked;
        }, { render: false });
        wrapper.toggleClass('is-checked', checkbox.checked);
      });
      wrapper.toggleClass('is-checked', block.checked);
    } else if (block.type === 'bulleted-list') {
      content.createSpan({ cls: 'bs-list-marker', text: '•' });
    } else if (block.type === 'numbered-list') {
      content.createSpan({ cls: 'bs-list-marker', text: `${Core.numberedOrdinal(this.page, block.id)}.` });
    } else if (block.type === 'quote') {
      content.createSpan({ cls: 'bs-quote-line' });
    } else if (block.type === 'callout') {
      const calloutIcon = content.createSpan({ cls: 'bs-callout-icon' });
      setIcon(calloutIcon, 'lightbulb');
    } else if (block.type === 'divider') {
      content.createEl('hr', { cls: 'bs-divider' });
      return;
    }

    if (block.type === 'table-of-contents') {
      const toc = content.createEl('nav', { cls: 'bs-toc', attr: { 'aria-label': t("page_table_of_contents_af0ae335") } });
      const tocHeader = toc.createDiv({ cls: 'bs-toc-header' });
      const tocIcon = tocHeader.createSpan({ cls: 'bs-toc-header-icon' });
      setIcon(tocIcon, 'list-tree');
      tocHeader.createSpan({ text: t("table_of_contents_52daa71e") });
      const items = Core.deriveOutline(this.page, block.toc);
      if (!items.length) {
        const empty = toc.createDiv({ cls: 'bs-toc-empty' });
        empty.createDiv({ cls: 'bs-toc-empty-title', text: t("this_page_has_no_headings_yet_658a7e8b") });
        empty.createDiv({ cls: 'bs-toc-empty-hint', text: t("type_heading_or_use_the_button_below_to_create_y_74588f66") });
        const createHeading = createButton(empty, 'bs-toc-create-heading', t("create_heading_1_928d3c72"), 'heading-1', t("create_heading_454eae39"));
        createHeading.addEventListener('click', () => {
          let headingId = null;
          this.performMutation(t("create_table_of_contents_heading_ceda7375"), (page) => {
            const heading = Core.createBlock('heading-1', t("new_section_f8cae3f2"));
            headingId = Core.insertBlocksAfter(page, block.id, [heading])[0].id;
          });
          if (headingId) focusEditorAt(this, headingId, t("new_section_f8cae3f2").length);
        });
      }
      for (const item of items) {
        const link = toc.createEl('button', {
          cls: `bs-toc-item level-${item.level}${item.sectionCollapsed ? ' is-collapsed' : ''}`,
          attr: { type: 'button', 'data-heading-id': item.blockId },
        });
        link.style.setProperty('--bs-toc-level', String(Math.max(0, item.level - block.toc.minLevel)));
        if (block.toc.showNumbers && item.numberPath) link.createSpan({ cls: 'bs-toc-number', text: item.numberPath });
        link.createSpan({ cls: 'bs-toc-label', text: item.title, attr: { 'data-collapsed-label': t('collapsed_suffix') } });
        link.addEventListener('click', () => this.focusBlock(item.blockId));
      }
      return;
    }

    if (this.renderAdvancedBlock(content, wrapper, block)) return;

    if (block.type === 'markdown') {
      wrapper.addClass('is-atomic-block');
      wrapper.toggleClass('is-markdown-heading', /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(String(block.text || '')));
      const markdownBlock = content.createDiv({ cls: 'bs-markdown-block' });
      const markdownHeader = markdownBlock.createDiv({ cls: 'bs-markdown-block-header' });
      const markdownLabel = markdownHeader.createDiv({ cls: 'bs-markdown-block-label' });
      const markdownIcon = markdownLabel.createSpan({ cls: 'bs-markdown-block-icon' });
      setIcon(markdownIcon, 'file-code-2');
      markdownLabel.createSpan({ text: 'Markdown' });
      const editButton = createButton(markdownHeader, 'bs-markdown-edit-button', t("edit_markdown_source_a346d23b"), 'square-pen', t("edit_05183656"));
      editButton.tabIndex = 0;
      const preview = markdownBlock.createDiv({
        cls: 'bs-markdown-preview markdown-preview-view',
        attr: {
          tabindex: '0',
          'aria-label': t("markdown_preview_click_the_body_or_press_enter_t_b17779bd"),
        },
      });
      const editor = markdownBlock.createEl('textarea', {
        cls: 'bs-markdown-source-editor',
        attr: {
          'aria-label': t("edit_markdown_e86517e0"),
          placeholder: t("enter_markdown_such_as_page_image_png_math_merma_806fec9a"),
          spellcheck: 'false',
        },
      });
      editor.value = block.text || '';
      editor.hidden = true;
      if (block.text) void this.renderMarkdownInto(preview, block.text, `markdown:${block.id}`);
      else preview.createDiv({ cls: 'bs-markdown-empty', text: t("empty_markdown_block_29abc39c") });
      editButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (wrapper.hasClass('is-markdown-editing')) {
          this.deactivateMarkdownBlockEditor(block.id);
        } else {
          this.activateMarkdownBlockEditor(block.id);
        }
      });
      const activateFromPreview = (target) => {
        const ownerWindow = preview.ownerDocument.defaultView;
        const element = target instanceof ownerWindow.Element ? target : null;
        const semanticTarget = element && element.closest('td, th, h1, h2, h3, h4, h5, h6, p, li, blockquote, figcaption');
        const renderedText = String(semanticTarget && semanticTarget.textContent || '').replace(/\s+/g, ' ').trim();
        const sourceText = String(block.text || '');
        const sourceIndex = renderedText ? sourceText.indexOf(renderedText) : -1;
        const offset = sourceIndex >= 0 ? sourceIndex + renderedText.length : sourceText.length;
        this.activateMarkdownBlockEditor(block.id, offset);
      };
      preview.addEventListener('click', (event) => {
        if (event.defaultPrevented) return;
        const ownerWindow = preview.ownerDocument.defaultView;
        const element = event.target instanceof ownerWindow.Element ? event.target : null;
        if (element && element.closest('a, button, input, textarea, select, option, summary, audio, video, iframe')) return;
        const selection = ownerWindow.getSelection();
        if (selection && !selection.isCollapsed
          && ((selection.anchorNode && preview.contains(selection.anchorNode))
            || (selection.focusNode && preview.contains(selection.focusNode)))) return;
        activateFromPreview(event.target);
      });
      preview.addEventListener('keydown', (event) => {
        if (event.target !== preview || (event.key !== 'Enter' && event.key !== 'F2')) return;
        event.preventDefault();
        event.stopPropagation();
        activateFromPreview(preview);
      });
      editor.addEventListener('beforeinput', () => this.beginLiveEdit(t("edit_native_markdown_b89a272c"), `markdown:${block.id}`));
      editor.addEventListener('compositionstart', () => { this.isComposing = true; this.beginLiveEdit(t("edit_native_markdown_b89a272c"), `markdown:${block.id}`); });
      editor.addEventListener('compositionend', () => {
        this.isComposing = false;
        const current = Core.getBlock(this.page, block.id);
        if (current) { current.text = editor.value; current.marks = []; }
        this.afterLiveEdit({ commitNow: true });
      });
      editor.addEventListener('input', () => {
        this.beginLiveEdit(t("edit_native_markdown_b89a272c"), `markdown:${block.id}`);
        const current = Core.getBlock(this.page, block.id);
        if (current) { current.text = editor.value; current.marks = []; }
        this.afterLiveEdit();
      });
      editor.addEventListener('keydown', (event) => {
        if (this.isComposing || event.isComposing) return;
        if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) {
          event.preventDefault();
          editor.blur();
          return;
        }
        if (event.key === 'Tab') {
          event.preventDefault();
          const start = editor.selectionStart;
          const end = editor.selectionEnd;
          editor.setRangeText('  ', start, end, 'end');
          editor.dispatchEvent(new editor.ownerDocument.defaultView.Event('input', { bubbles: true }));
        }
      });
      editor.addEventListener('focus', () => {
        if (this.selectedBlockIds.size) this.clearBlockSelection();
        wrapper.addClass('is-markdown-editing');
        this.updateMarkdownBlockChrome(wrapper, true);
        preview.hidden = true;
        editor.hidden = false;
        this.setInteractionState('markdown-editing', { blockId: block.id });
      });
      editor.addEventListener('blur', () => {
        this.commitPendingEdit();
        editor.ownerDocument.defaultView.setTimeout(() => this.deactivateMarkdownBlockEditor(block.id), 80);
      });
      return;
    }

    const useNativePreview = this.shouldUseNativeBlockPreview(block);
    let nativePreview = null;
    if (useNativePreview) {
      wrapper.addClass('has-native-preview');
      nativePreview = content.createDiv({ cls: 'bs-native-block-preview markdown-preview-view' });
      const markdown = Core.blockToNativePreviewMarkdown(block);
      if (markdown) {
        this.scheduleNativePreviewRender(nativePreview, () => void this.renderMarkdownInto(nativePreview, markdown, `inline:${block.id}`));
      }
      else nativePreview.createSpan({ cls: 'bs-native-block-empty', text: index === 0 ? t("click_to_type_or_type_dd580f20") : t("click_to_type_b540042a") });
      nativePreview.addEventListener('click', (event) => {
        if (event.target && event.target.closest && event.target.closest('a, button, input')) return;
        this.activateTextBlockEditor(block.id);
        focusEditorAt(this, block.id, block.text.length);
      });
    }

    const editor = content.createDiv({
      cls: 'bs-block-editor',
      attr: {
        contenteditable: 'true',
        role: 'textbox',
        'aria-label': t("edit_0_block_14c9eb72", [SLASH_COMMANDS.find((command) => command.type === block.type)?.label || t("text_dd818618")]),
        'data-placeholder': depth > 0 && block.type === 'todo'
          ? t("enter_a_subtask_8c816407")
          : depth > 0 && (block.type === 'bulleted-list' || block.type === 'numbered-list')
            ? t("enter_a_child_item_b05a71c0")
            : index === 0 ? t("type_to_open_the_command_menu_1f62499d") : t("enter_content_or_type_0102dc44"),
        spellcheck: 'true',
      },
    });
    renderInlineContent(editor, block);
    if (useNativePreview) editor.hidden = true;
    editor.addEventListener('paste', (event) => this.handleBlockPaste(event, block.id, editor));
    editor.addEventListener('beforeinput', () => this.beginLiveEdit(t("edit_block_content_15ae2c32"), `block:${block.id}`));
    editor.addEventListener('compositionstart', () => {
      this.isComposing = true;
      this.setInteractionState('composing', { blockId: block.id });
      this.beginLiveEdit(t("edit_block_content_15ae2c32"), `block:${block.id}`);
    });
    editor.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.setInteractionState('text-editing', { blockId: block.id });
      const current = Core.getBlock(this.page, block.id);
      if (current) {
        const contentState = readInlineContent(editor);
        current.text = contentState.text;
        current.marks = contentState.marks;
      }
      this.afterLiveEdit({ commitNow: true });
      this.updateSlashMenu(wrapper, editor, current || block, this.getVisibleBlockIndex(block.id));
    });
    editor.addEventListener('input', () => {
      this.beginLiveEdit(t("edit_block_content_15ae2c32"), `block:${block.id}`);
      const current = Core.getBlock(this.page, block.id);
      if (current) {
        const contentState = readInlineContent(editor);
        current.text = contentState.text;
        current.marks = contentState.marks;
      }
      this.afterLiveEdit();
      if (this.isComposing) return;
      if (this.applyInlineMarkdownAutoFormat(block.id, editor)) return;
      this.updateSlashMenu(wrapper, editor, current || block, this.getVisibleBlockIndex(block.id));
    });
    editor.addEventListener('keydown', (event) => this.handleBlockKeydown(event, wrapper, editor, block, index));
    editor.addEventListener('mouseup', () => this.scheduleFormatToolbarUpdate());
    editor.addEventListener('keyup', () => this.scheduleFormatToolbarUpdate());
    editor.addEventListener('click', (event) => {
      const linkRun = event.target && event.target.closest ? event.target.closest('[data-bs-href]') : null;
      if (!linkRun || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      void this.openStoredLink(linkRun.dataset.bsHref, event);
    });
    editor.addEventListener('mouseover', (event) => {
      const linkRun = event.target && event.target.closest ? event.target.closest('[data-bs-href]') : null;
      if (!linkRun || !editor.contains(linkRun)) return;
      this.handleStoredLinkHover(linkRun, linkRun.dataset.bsHref, event, true);
    });
    editor.addEventListener('mouseout', (event) => {
      const linkRun = event.target && event.target.closest ? event.target.closest('[data-bs-href]') : null;
      if (!linkRun || (event.relatedTarget && linkRun.contains(event.relatedTarget))) return;
      this.scheduleReferencePreviewClose();
    });
    editor.addEventListener('focus', () => {
      if (useNativePreview) this.activateTextBlockEditor(block.id);
      if (this.selectedBlockIds.size) this.clearBlockSelection();
      this.setInteractionState('text-editing', { blockId: block.id });
      this.scheduleFormatToolbarUpdate();
    });
    editor.addEventListener('blur', () => {
      this.commitPendingEdit();
      editor.ownerDocument.defaultView.setTimeout(() => {
        if (this.slashState && !this.slashState.menu.contains(this.contentEl.ownerDocument.activeElement)) this.closeSlashMenu();
        if (useNativePreview && (!this.slashState || this.slashState.blockId !== block.id) && !this.formatToolbarEl) this.deactivateTextBlockEditor(block.id);
      }, 80);
    });
  }

  pastePlainText(event) {
    const text = event.clipboardData && event.clipboardData.getData('text/plain');
    if (typeof text !== 'string') return;
    event.preventDefault();
    event.target.ownerDocument.execCommand('insertText', false, text);
  }

  handleBlockPaste(event, blockId, editor) {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const currentBlock = this.page && Core.getBlock(this.page, blockId);
    if (currentBlock && currentBlock.type === 'code') {
      this.pastePlainText(event);
      return;
    }
    const files = Array.from(clipboard.files || []);
    if (files.length) {
      event.preventDefault();
      void this.insertUploadedFiles(files, blockId);
      return;
    }

    const structured = clipboard.getData('application/x-blockspace-blocks');
    if (structured) {
      try {
        const payload = JSON.parse(structured);
        if (payload && Array.isArray(payload.blocks) && Array.isArray(payload.roots) && payload.roots.length) {
          event.preventDefault();
          let insertedRoots = [];
          const replaceEmpty = currentBlock && currentBlock.type === 'paragraph' && !currentBlock.text && !currentBlock.children.length;
          this.performMutation(t("paste_blockspace_blocks_aa7af3b0"), (page) => {
            insertedRoots = Core.insertSerializedSubtrees(page, payload, blockId);
            if (replaceEmpty && insertedRoots.length) Core.removeSubtrees(page, [blockId]);
          });
          if (insertedRoots.length) this.restoreEditorSelection({ type: 'caret', blockId: insertedRoots[0], offset: 0 });
          return;
        }
      } catch (error) { /* fall through to Markdown/plain text */ }
    }

    const text = clipboard.getData('text/plain');
    if (typeof text !== 'string') return;
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const currentIsEmptyText = currentBlock && currentBlock.type === 'paragraph' && !currentBlock.text && !currentBlock.children.length;
    if (currentIsEmptyText && /^https?:\/\/\S+$/i.test(normalized.trim())) {
      event.preventDefault();
      this.insertRemoteUrl(normalized.trim(), blockId);
      return;
    }
    if (looksLikeStructuredMarkdown(normalized) && (normalized.includes('\n') || currentIsEmptyText)) {
      const imported = Core.markdownToBlocks(normalized);
      const tempPage = Core.normalizePage({ blocks: imported });
      const payload = Core.serializeSubtrees(tempPage, tempPage.rootBlockIds);
      if (payload.roots.length) {
        event.preventDefault();
        let insertedRoots = [];
        const replaceEmpty = currentBlock && currentBlock.type === 'paragraph' && !currentBlock.text && !currentBlock.children.length;
        this.performMutation(t("paste_markdown_structure_88b358ab"), (page) => {
          insertedRoots = Core.insertSerializedSubtrees(page, payload, blockId);
          if (replaceEmpty && insertedRoots.length) Core.removeSubtrees(page, [blockId]);
        });
        if (insertedRoots.length) this.restoreEditorSelection({ type: 'caret', blockId: insertedRoots[0], offset: 0 });
        return;
      }
    }

    if (
      !normalized.includes('\n')
      && currentBlock
      && Core.INLINE_TEXT_BLOCK_TYPES.has(currentBlock.type)
      && !Core.shouldPreserveRawMarkdown(normalized)
    ) {
      const selection = getTextSelectionOffsets(editor);
      const from = selection ? selection.from : getCaretOffset(editor);
      const to = selection ? selection.to : from;
      const replacement = Core.replaceInlineRangeWithMarkdown(currentBlock, from, to, normalized);
      if (replacement) {
        event.preventDefault();
        this.performMutation(t("paste_markdown_inline_formatting_b5d604d8"), (page) => {
          const target = Core.getBlock(page, blockId);
          if (!target) return;
          target.text = replacement.text;
          target.marks = replacement.marks;
        }, { render: false });
        const updated = Core.getBlock(this.page, blockId);
        if (updated) renderInlineContent(editor, updated);
        focusEditorAt(this, blockId, replacement.caret);
        return;
      }
    }

    if (!normalized.includes('\n')) {
      this.pastePlainText(event);
      return;
    }
    event.preventDefault();
    const offset = getCaretOffset(editor);
    const currentState = readInlineContent(editor);
    const currentText = currentState.text;
    const lines = normalized.split('\n');
    const prefix = currentText.slice(0, offset);
    const suffix = currentText.slice(offset);
    const markParts = Core.splitInlineMarks(currentState.marks, offset, currentText.length);
    const inserted = lines.slice(1).map((line, lineIndex) => {
      const isLast = lineIndex === lines.length - 2;
      const textValue = isLast ? `${line}${suffix}` : line;
      const extras = isLast
        ? { marks: Core.mergeInlineMarks([], markParts.right, line.length, suffix.length), appearance: currentBlock ? currentBlock.appearance : undefined }
        : { appearance: currentBlock ? currentBlock.appearance : undefined };
      return Core.createBlock('paragraph', textValue, extras);
    });
    let insertedIds = [];
    this.performMutation(t("paste_multiple_blocks_be7e0b94"), (page) => {
      const target = Core.getBlock(page, blockId);
      if (!target) return;
      target.text = `${prefix}${lines[0]}`;
      target.marks = Core.normalizeInlineMarks(markParts.left, target.text.length);
      insertedIds = Core.insertBlocksAfter(page, blockId, inserted).map((block) => block.id);
    });
    const targetId = insertedIds.length ? insertedIds[insertedIds.length - 1] : blockId;
    focusEditorAt(this, targetId, lines[lines.length - 1].length);
  }

  // Typing a Markdown span should behave like pasting one. Without this, `[a](b)` typed
  // by hand stayed literal while the same text pasted became a real link.
  applyInlineMarkdownAutoFormat(blockId, editor) {
    if (!this.page || this.isComposing || !editor || !isSelectionCollapsed(editor)) return false;
    const current = Core.getBlock(this.page, blockId);
    if (!current || !Core.INLINE_TEXT_BLOCK_TYPES.has(current.type)) return false;
    const converted = Core.convertTrailingInlineMarkdown(current, getCaretOffset(editor));
    if (!converted) return false;
    // performMutation commits the pending typing first, so Ctrl/Cmd + Z peels off the
    // formatting and hands back the literal Markdown rather than deleting the text.
    this.performMutation(t("markdown_inline_formatting_f8ee78e2"), (page) => {
      const target = Core.getBlock(page, blockId);
      if (!target) return;
      target.text = converted.text;
      target.marks = converted.marks;
    }, { render: false });
    const updated = Core.getBlock(this.page, blockId);
    if (updated) renderInlineContent(editor, updated);
    focusEditorAt(this, blockId, converted.caret);
    this.closeSlashMenu();
    return true;
  }

  getMarkdownShortcut(marker) {
    const value = String(marker || '');
    const shortcuts = {
      '#': 'heading-1',
      '##': 'heading-2',
      '###': 'heading-3',
      '-': 'bulleted-list',
      '*': 'bulleted-list',
      '1.': 'numbered-list',
      '[]': 'todo',
      '[ ]': 'todo',
      '- []': 'todo',
      '- [ ]': 'todo',
      '>': 'quote',
      '```': 'code',
      '---': 'divider',
    };
    return shortcuts[value] || null;
  }

  applyMarkdownShortcut(blockId, targetType) {
    if (!this.page || !targetType) return false;
    if (targetType === 'divider') {
      let nextId = null;
      this.performMutation(t("markdown_shortcut_divider_5dc9f6bd"), (page) => {
        Core.convertBlockType(page, [blockId], 'divider');
        const target = Core.getBlock(page, blockId);
        if (target) { target.text = ''; target.marks = []; }
        const next = Core.createBlock('paragraph', '');
        nextId = Core.insertBlocksAfter(page, blockId, [next])[0].id;
      });
      if (nextId) focusEditorAt(this, nextId, 0);
      return true;
    }
    this.performMutation(t("markdown_shortcut_e0df112b"), (page) => {
      Core.convertBlockType(page, [blockId], targetType);
      const target = Core.getBlock(page, blockId);
      if (target) {
        target.text = '';
        target.marks = [];
        if (targetType === 'todo') target.checked = false;
      }
    });
    focusEditorAt(this, blockId, 0);
    return true;
  }

  handleBlockKeydown(event, wrapper, editor, block, index) {
    if (this.isComposing || event.isComposing || event.keyCode === 229) return;
    const blockId = block.id;
    const visible = this.getEditableVisibleBlocks();
    const currentIndex = visible.findIndex((item) => item.id === blockId);
    const currentBlock = Core.getBlock(this.page, blockId);
    if (!currentBlock) return;

    if (this.slashState && this.slashState.blockId === blockId) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const count = this.slashState.commands.length;
        if (count > 0) this.slashState.selected = (this.slashState.selected + direction + count) % count;
        this.renderSlashItems();
        return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        this.slashState.selected = event.key === 'Home' ? 0 : Math.max(0, this.slashState.commands.length - 1);
        this.renderSlashItems();
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const command = this.slashState.commands[this.slashState.selected];
        if (command) this.applySlashCommand(currentBlock, command.type);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeSlashMenu();
        return;
      }
    }

    if (event.key === 'Escape' && this.handleEscape(event, { editor, blockId, wrapper })) return;

    const modifier = event.ctrlKey || event.metaKey;
    const lowerKey = event.key.toLowerCase();

    if (event.key === ' ' && !modifier && !event.altKey && currentBlock.type === 'paragraph'
      && isSelectionCollapsed(editor) && getCaretOffset(editor) === String(editor.textContent || '').length
      && (!currentBlock.marks || currentBlock.marks.length === 0)) {
      const targetType = this.getMarkdownShortcut(editor.textContent);
      if (targetType) {
        event.preventDefault();
        event.stopPropagation();
        this.closeSlashMenu();
        this.applyMarkdownShortcut(blockId, targetType);
        return;
      }
    }
    const inlineShortcut = modifier && (
      lowerKey === 'b' || lowerKey === 'i' || lowerKey === 'u'
      || lowerKey === 'k' || lowerKey === '\\'
      || (event.shiftKey && lowerKey === 's')
    );
    if (inlineShortcut) {
      const logical = getLogicalTextSelection(this.contentEl, this.page);
      const selection = logical && logical.ranges.length === 1 && logical.ranges[0].blockId === blockId
        ? { from: logical.ranges[0].from, to: logical.ranges[0].to, collapsed: false, range: this.contentEl.ownerDocument.defaultView.getSelection().getRangeAt(0) }
        : getTextSelectionOffsets(editor);
      if (!logical && (!selection || selection.collapsed)) {
        if (lowerKey === 'k') return;
        event.preventDefault();
        event.stopPropagation();
        new Notice(t("select_text_to_format_first_809224c0"));
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const ranges = logical ? logical.ranges.map((range) => ({ ...range })) : [{ blockId, from: selection.from, to: selection.to }];
      const rect = logical ? logical.rect : selection.range.getBoundingClientRect();
      this.formatToolbarState = { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges, blockId: ranges[0].blockId, from: ranges[0].from, to: ranges[0].to, rect };
      this.logicalSelection = { type: ranges.length > 1 ? 'cross-block-text' : 'text', ranges };
      if (lowerKey === 'b') this.applyInlineFormat('bold');
      else if (lowerKey === 'i') this.applyInlineFormat('italic');
      else if (lowerKey === 'u') this.applyInlineFormat('underline');
      else if (lowerKey === 'k') this.openLinkForSelection();
      else if (lowerKey === '\\') this.clearInlineFormatting();
      else this.applyInlineFormat('strike');
      return;
    }

    if (modifier && event.shiftKey && lowerKey === 'd') {
      event.preventDefault();
      const caretOffset = getCaretOffset(editor);
      this.runCommand(t("duplicate_block_and_its_children_959f4542"), (page) => {
        const ids = Core.duplicateSubtrees(page, [blockId]);
        return { duplicateId: ids[0] || null };
      }, { focus: (result, page) => result.duplicateId ? {
        type: 'block', blockId: result.duplicateId,
        offset: Math.min(caretOffset, Core.getBlock(page, result.duplicateId).text.length),
      } : null });
      return;
    }

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const caretOffset = getCaretOffset(editor);
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      let moved = false;
      this.performMutation(direction < 0 ? t("move_block_subtree_up_79479d13") : t("move_block_subtree_down_3c73fea3"), (page) => {
        moved = Core.moveSiblingGroup(page, [blockId], direction);
      });
      if (moved) focusEditorAt(this, blockId, caretOffset);
      return;
    }

    if (modifier && event.key === 'Enter') {
      if (currentBlock.type === 'todo') {
        event.preventDefault();
        this.performMutation(t("toggle_to_do_status_2128b67b"), (page) => {
          const target = Core.getBlock(page, blockId);
          if (target) target.checked = !target.checked;
        }, { render: false });
        const checkbox = wrapper.querySelector('.bs-todo-checkbox');
        if (checkbox) checkbox.checked = !checkbox.checked;
        wrapper.toggleClass('is-checked', !!Core.getBlock(this.page, blockId)?.checked);
        return;
      }
      if (Core.isHeadingBlock(currentBlock) && Core.getHeadingSectionRootIds(this.page, blockId).length > 1) {
        event.preventDefault();
        this.performMutation(currentBlock.sectionCollapsed ? t("expand_section_f3d88072") : t("collapse_section_d3c1e2b1"), (page) => Core.toggleHeadingSectionCollapsed(page, blockId));
        return;
      }
      if (currentBlock.type === 'toggle' || currentBlock.children.length) {
        event.preventDefault();
        this.performMutation(currentBlock.collapsed ? t("expand_child_blocks_7961fc08") : t("collapse_child_blocks_6b4e7c7b"), (page) => Core.toggleBlockCollapsed(page, blockId));
        return;
      }
    }

    if (event.key === 'Enter' && (event.shiftKey || (currentBlock.type === 'code' && !modifier))) {
      event.preventDefault();
      event.stopPropagation();
      insertTextAtSelection(editor, '\n', 'insertLineBreak');
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const offset = getCaretOffset(editor);
      const editorState = readInlineContent(editor);
      const text = editorState.text;
      currentBlock.text = text;
      currentBlock.marks = editorState.marks;

      if (!text && currentBlock.parentId) {
        const parent = Core.getBlock(this.page, currentBlock.parentId);
        const siblings = Core.getSiblingIds(this.page, currentBlock.parentId);
        const isLastChild = siblings[siblings.length - 1] === blockId;
        if (parent && isLastChild && ['toggle', 'callout', 'quote'].includes(parent.type)) {
          this.runCommand(t("exit_container_3cce6776"), (page) => ({ changed: Core.outdentBlocks(page, [blockId]) }), {
            focus: { type: 'block', blockId, offset: 0 },
          });
          return;
        }
      }

      if (!text && ['todo', 'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle'].includes(currentBlock.type)) {
        if (currentBlock.parentId) {
          this.performMutation(t("outdent_one_level_ebcd2d8c"), (page) => Core.outdentBlocks(page, [blockId]));
        } else {
          this.performMutation(t("exit_current_block_type_8fc8d7d3"), (page) => Core.convertBlockType(page, [blockId], 'paragraph'));
        }
        focusEditorAt(this, blockId, 0);
        return;
      }

      if (currentBlock.type === 'toggle') {
        let childId = null;
        this.performMutation(t("insert_content_into_toggle_e906f6f0"), (page) => {
          const target = Core.getBlock(page, blockId);
          if (!target) return;
          const markParts = Core.splitInlineMarks(target.marks, offset, target.text.length);
          const child = Core.createBlock('paragraph', target.text.slice(offset), { marks: markParts.right, appearance: target.appearance });
          target.text = target.text.slice(0, offset);
          target.marks = markParts.left;
          childId = Core.insertBlock(page, child, { parentId: target.id, index: 0 }).id;
          target.collapsed = false;
        });
        if (childId) focusEditorAt(this, childId, 0);
        return;
      }

      this.runCommand(t("split_block_8c929f86"), (page) => {
        const next = Core.splitBlock(page, blockId, offset);
        return { nextId: next && next.id };
      }, { focus: (result) => result.nextId ? { type: 'block', blockId: result.nextId, offset: 0 } : null });
      return;
    }

    if (event.key === 'Backspace' && isSelectionCollapsed(editor)) {
      const text = String(editor.textContent || '');
      const offset = getCaretOffset(editor);
      if (!text) {
        event.preventDefault();
        if (currentBlock.parentId) {
            const parent = Core.getBlock(this.page, currentBlock.parentId);
            if (parent && parent.type === 'column') {
              const siblings = Core.getSiblingIds(this.page, parent.id);
              if (siblings.length <= 1) return;
              const currentPosition = siblings.indexOf(blockId);
              const focusIndex = currentPosition > 0 ? currentPosition - 1 : 1;
              const focusTarget = Core.getBlock(this.page, siblings[focusIndex]);
            this.runCommand(t("delete_empty_block_in_column_a63a00ed"), (page) => Core.removeSubtrees(page, [blockId]), {
              focus: focusTarget ? { type: 'block', blockId: focusTarget.id, offset: focusTarget.text.length } : null,
            });
            return;
          }
          this.performMutation(t("outdent_one_level_ebcd2d8c"), (page) => Core.outdentBlocks(page, [blockId]));
          focusEditorAt(this, blockId, 0);
          return;
        }
        if (currentBlock.children.length && ['quote', 'callout', 'toggle'].includes(currentBlock.type)) {
          let focusId = null;
          this.performMutation(t("remove_container_wrapper_374b13dd"), (page) => {
            const result = Core.unwrapBlock(page, blockId);
            focusId = result && result.focusId;
          });
          if (focusId) focusEditorAt(this, focusId, 0);
          return;
        }
        if (['todo', 'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle'].includes(currentBlock.type)) {
          this.performMutation(t("convert_to_plain_text_93da8c70"), (page) => Core.convertBlockType(page, [blockId], 'paragraph'));
          focusEditorAt(this, blockId, 0);
          return;
        }
        if (currentBlock.children.length) return;
        const previous = visible[currentIndex - 1];
        if (previous) {
          const previousLength = previous.text.length;
          this.runCommand(t("delete_empty_block_7b796083"), (page) => Core.removeSubtrees(page, [blockId]), {
            focus: { type: 'block', blockId: previous.id, offset: previousLength },
          });
        }
        return;
      }
      if (offset === 0) {
        event.preventDefault();
        if (currentBlock.parentId) {
          const parent = Core.getBlock(this.page, currentBlock.parentId);
          if (parent && parent.type === 'column') {
            const siblings = Core.getSiblingIds(this.page, parent.id);
            const currentPosition = siblings.indexOf(blockId);
            const previous = currentPosition > 0 ? Core.getBlock(this.page, siblings[currentPosition - 1]) : null;
            if (!previous) return;
            this.runCommand(t("merge_blocks_within_column_964ea7bf"), (page) => {
              const result = Core.mergeBlockWithPrevious(page, blockId);
              return result ? { blockId: result.block.id, offset: result.offset } : {};
            }, { focus: (result) => result.blockId ? { type: 'block', blockId: result.blockId, offset: result.offset } : null });
            return;
          }
          this.performMutation(t("outdent_block_e85cea35"), (page) => Core.outdentBlocks(page, [blockId]));
          focusEditorAt(this, blockId, 0);
          return;
        }
        this.runCommand(t("merge_blocks_24bc71ff"), (page) => {
          const result = Core.mergeBlockWithPrevious(page, blockId);
          return result ? { blockId: result.block.id, offset: result.offset } : {};
        }, { focus: (result) => result.blockId ? { type: 'block', blockId: result.blockId, offset: result.offset } : null });
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      const caret = getCaretOffset(editor);
      const directParent = currentBlock.parentId ? Core.getBlock(this.page, currentBlock.parentId) : null;
      if (event.shiftKey && directParent && directParent.type === 'column') {
        new Notice(t("this_block_is_already_at_the_outermost_level_of__51d4a8a1"));
        return;
      }
      let changed = false;
      this.runCommand(event.shiftKey ? t("outdent_block_e85cea35") : t("move_block_into_previous_container_fe4b28f5"), (page) => {
        changed = event.shiftKey ? Core.outdentBlocks(page, [blockId]) : Core.indentBlocks(page, [blockId]);
        return { changed };
      }, { focus: (_result, page) => changed ? {
        type: 'block', blockId,
        offset: Math.min(caret, Core.getBlock(page, blockId).text.length),
      } : null });
      if (!changed) new Notice(event.shiftKey ? t("this_block_is_already_at_the_outermost_level_54b53bf2") : t("the_previous_sibling_cannot_contain_child_blocks_41f2ce02"));
      return;
    }

    if (event.key === 'ArrowLeft' && isSelectionCollapsed(editor) && getCaretOffset(editor) === 0 && Core.isHeadingBlock(currentBlock) && Core.getHeadingSectionRootIds(this.page, blockId).length > 1 && !currentBlock.sectionCollapsed) {
      event.preventDefault();
      this.performMutation(t("collapse_section_d3c1e2b1"), (page) => Core.toggleHeadingSectionCollapsed(page, blockId, true));
      return;
    }
    if (event.key === 'ArrowRight' && isSelectionCollapsed(editor) && getCaretOffset(editor) === currentBlock.text.length && Core.isHeadingBlock(currentBlock) && currentBlock.sectionCollapsed) {
      event.preventDefault();
      this.performMutation(t("expand_section_f3d88072"), (page) => Core.toggleHeadingSectionCollapsed(page, blockId, false));
      return;
    }
    if (event.key === 'ArrowLeft' && isSelectionCollapsed(editor) && getCaretOffset(editor) === 0 && currentBlock.children.length && !currentBlock.collapsed) {
      event.preventDefault();
      this.performMutation(t("collapse_child_blocks_6b4e7c7b"), (page) => Core.toggleBlockCollapsed(page, blockId, true));
      return;
    }
    if (event.key === 'ArrowRight' && isSelectionCollapsed(editor) && getCaretOffset(editor) === currentBlock.text.length && currentBlock.children.length && currentBlock.collapsed) {
      event.preventDefault();
      this.performMutation(t("expand_child_blocks_7961fc08"), (page) => Core.toggleBlockCollapsed(page, blockId, false));
      return;
    }
    if (event.key === 'ArrowUp' && isSelectionCollapsed(editor) && getCaretOffset(editor) === 0 && currentIndex > 0) {
      event.preventDefault();
      const previous = visible[currentIndex - 1];
      focusEditorAt(this, previous.id, previous.text.length);
      return;
    }
    if (event.key === 'ArrowDown' && isSelectionCollapsed(editor) && getCaretOffset(editor) === String(editor.textContent || '').length && currentIndex < visible.length - 1) {
      event.preventDefault();
      const next = visible[currentIndex + 1];
      focusEditorAt(this, next.id, 0);
    }
  }

  updateSlashMenu(wrapper, editor, block, index) {
    const text = String(editor.textContent || '');
    if (!text.startsWith('/')) {
      if (this.slashState && this.slashState.blockId === block.id) this.closeSlashMenu();
      return;
    }
    const query = normalizeSearchText(text.slice(1));
    const parent = block.parentId ? Core.getBlock(this.page, block.parentId) : null;
    const preferred = new Set();
    if (parent && ['bulleted-list', 'numbered-list', 'todo'].includes(parent.type)) preferred.add(parent.type);
    if (block.parentId) {
      preferred.add('paragraph');
      preferred.add('todo');
      preferred.add('bulleted-list');
    }
    const recent = new Map(this.recentSlashTypes.map((type, recentIndex) => [type, Math.max(0, 18 - recentIndex * 3)]));
    const commands = SLASH_COMMANDS
      .map((command) => {
        let score = scoreSlashCommand(command, query);
        if (score < 0) return { command, score };
        if (preferred.has(command.type)) score += 16;
        if (command.type === block.type) score += 6;
        score += recent.get(command.type) || 0;
        return { command, score };
      })
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || SLASH_COMMANDS.indexOf(a.command) - SLASH_COMMANDS.indexOf(b.command))
      .map((entry) => entry.command);
    if (!commands.length) {
      this.closeSlashMenu();
      return;
    }
    if (!this.slashState || this.slashState.blockId !== block.id) {
      this.closeSlashMenu();
      const menuId = `bs-slash-menu-${block.id}`;
      const menu = wrapper.createDiv({
        cls: 'bs-slash-menu',
        attr: { id: menuId, role: 'listbox', 'aria-label': t("block_type_06dc071a") },
      });
      const previousEditorRole = editor.getAttribute('role');
      editor.setAttribute('role', 'combobox');
      editor.setAttribute('aria-autocomplete', 'list');
      editor.setAttribute('aria-expanded', 'true');
      editor.setAttribute('aria-haspopup', 'listbox');
      editor.setAttribute('aria-controls', menuId);
      this.slashState = { menu, menuId, editor, previousEditorRole, blockId: block.id, index, commands, selected: 0, query };
      this.setInteractionState('slash-open', { blockId: block.id, query });
    } else {
      this.slashState.commands = commands;
      this.slashState.query = query;
      this.slashState.selected = Math.min(this.slashState.selected, commands.length - 1);
    }
    this.renderSlashItems();
  }

  renderSlashItems() {
    if (!this.slashState) return;
    clearElement(this.slashState.menu);
    const title = this.slashState.menu.createDiv({ cls: 'bs-slash-title' });
    const slashBlock = this.page && Core.getBlock(this.page, this.slashState.blockId);
    title.createSpan({ text: this.slashState.query ? t("search_0_b525fa11", [this.slashState.query]) : (slashBlock && slashBlock.parentId ? t("insert_into_the_current_structure_5bd80c80") : t("insert_or_convert_block_f3f8e66e")) });
    title.createSpan({ cls: 'bs-slash-hint', text: t("to_select_enter_to_insert_esc_to_close_1d44e085") });
    let previousCategory = null;
    this.slashState.commands.forEach((command, index) => {
      if (!this.slashState.query && command.category !== previousCategory) {
        this.slashState.menu.createDiv({ cls: 'bs-slash-category', text: command.category });
        previousCategory = command.category;
      }
      const item = this.slashState.menu.createEl('button', {
        cls: `bs-slash-item${index === this.slashState.selected ? ' is-selected' : ''}`,
        attr: {
          id: `${this.slashState.menuId}-option-${index}`,
          type: 'button',
          role: 'option',
          'aria-selected': index === this.slashState.selected ? 'true' : 'false',
        },
      });
      const icon = item.createSpan({ cls: 'bs-slash-icon' });
      setIcon(icon, command.icon);
      const text = item.createSpan({ cls: 'bs-slash-text' });
      text.createSpan({ cls: 'bs-slash-label', text: command.label });
      text.createSpan({ cls: 'bs-slash-description', text: command.description });
      if (command.aliases && command.aliases.length) item.createSpan({ cls: 'bs-slash-alias', text: `/${command.aliases[0]}` });
      item.addEventListener('mouseenter', () => {
        this.slashState.selected = index;
        this.slashState.editor.setAttribute('aria-activedescendant', `${this.slashState.menuId}-option-${index}`);
        this.slashState.menu.querySelectorAll('.bs-slash-item').forEach((element, itemIndex) => {
          element.toggleClass('is-selected', itemIndex === index);
          element.setAttribute('aria-selected', itemIndex === index ? 'true' : 'false');
        });
      });
      item.addEventListener('mousedown', (event) => event.preventDefault());
      item.addEventListener('click', () => {
        const block = this.page.blocks.find((candidate) => candidate.id === this.slashState.blockId);
        if (block) this.applySlashCommand(block, command.type);
      });
    });
    const selected = this.slashState.menu.querySelector('.bs-slash-item.is-selected');
    if (selected) {
      this.slashState.editor.setAttribute('aria-activedescendant', selected.id);
      selected.scrollIntoView({ block: 'nearest' });
    }
  }


  applySlashCommand(block, type) {
    const blockId = block.id;
    this.closeSlashMenu();
    this.recentSlashTypes = [type, ...this.recentSlashTypes.filter((item) => item !== type)].slice(0, 6);
    if (type === 'columns') {
      let firstBlockId = null;
      this.runCommand(t("insert_columns_f68150c2"), (page) => {
        const result = Core.convertBlockToColumns(page, blockId, 2, { preserveText: false });
        firstBlockId = result && result.firstBlockId;
        return { firstBlockId };
      }, { focus: (result) => result.firstBlockId ? { type: 'block', blockId: result.firstBlockId, offset: 0 } : null });
      return;
    }
    this.runCommand(t("change_block_type_ea166358"), (page) => {
      const target = Core.getBlock(page, blockId);
      if (!target) return;
      Core.convertBlockType(page, [blockId], type);
      target.text = '';
      target.marks = [];
      target.checked = false;
      if (type === 'toggle') target.collapsed = false;
      if (type === 'table-of-contents') target.toc = Core.normalizeTocConfig(target.toc);
    }, { focus: (type === 'table-of-contents' || type === 'markdown' || Core.ADVANCED_BLOCK_TYPES.has(type))
      ? { type: 'select-blocks', blockIds: [blockId] }
      : { type: 'block', blockId, offset: 0 } });
    if (type === 'markdown') {
      const ownerWindow = this.contentEl.ownerDocument.defaultView;
      ownerWindow.setTimeout(() => this.activateMarkdownBlockEditor(blockId), 0);
    } else if (Core.ADVANCED_BLOCK_TYPES.has(type)) {
      const ownerWindow = this.contentEl.ownerDocument.defaultView;
      ownerWindow.setTimeout(() => {
        const field = this.contentEl.querySelector(`[data-block-id="${blockId}"] .bs-advanced-properties input:not([type="file"]), [data-block-id="${blockId}"] .bs-table-cell-input`);
        if (field) field.focus({ preventScroll: true });
      }, 0);
    }
  }

  closeSlashMenu() {
    if (!this.slashState) return;
    const editor = this.slashState.editor;
    if (editor) {
      if (this.slashState.previousEditorRole) editor.setAttribute('role', this.slashState.previousEditorRole);
      else editor.removeAttribute('role');
      editor.removeAttribute('aria-autocomplete');
      editor.removeAttribute('aria-expanded');
      editor.removeAttribute('aria-haspopup');
      editor.removeAttribute('aria-controls');
      editor.removeAttribute('aria-activedescendant');
    }
    this.slashState.menu.remove();
    this.slashState = null;
    const active = this.contentEl && this.contentEl.ownerDocument && this.contentEl.ownerDocument.activeElement;
    const wrapper = active && active.closest ? active.closest('.bs-block') : null;
    this.setInteractionState(active && active.matches && active.matches('.bs-block-editor') ? 'text-editing' : 'idle', { blockId: wrapper && wrapper.dataset.blockId });
  }

  showAdvancedBlockContextMenu(event, block) {
    if (!block || !Core.ADVANCED_BLOCK_TYPES.has(block.type)) return;
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(block.type === 'table' ? t("edit_table_ba2b908e") : block.type === 'bookmark' ? t("edit_bookmark_2c1b74bf") : t("edit_content_and_url_d90313fe"))
      .setIcon('square-pen')
      .onClick(() => {
        if (block.type === 'table') {
          const field = this.contentEl.querySelector(`[data-block-id="${block.id}"] tbody .bs-table-cell-input`);
          if (field) field.focus({ preventScroll: true });
          return;
        }
        const details = this.contentEl.querySelector(`[data-block-id="${block.id}"] .bs-advanced-properties`);
        if (details) {
          details.open = true;
          const field = details.querySelector('input:not([type="file"]), textarea, select');
          if (field) field.focus({ preventScroll: true });
        }
      }));
    if (block.type === 'table') {
      menu.addItem((item) => item.setTitle(t("add_row_371b80ce")).setIcon('rows-3').onClick(() => {
        this.updateAdvancedBlock(block.id, t("add_table_row_bf23d102"), (target) => {
          const cells = {};
          for (const column of target.data.columns) cells[column.id] = '';
          target.data.rows.push({ id: Core.randomId('row'), cells });
        }, { render: true });
      }));
      menu.addItem((item) => item.setTitle(t("add_column_143eb0bf")).setIcon('columns-3').onClick(() => {
        this.updateAdvancedBlock(block.id, t("add_table_column_7c812150"), (target) => {
          const id = Core.randomId('column');
          target.data.columns.push({ id, name: t("column_0_94ab35a6", [target.data.columns.length + 1]), align: 'left', width: 160 });
          for (const row of target.data.rows) row.cells[id] = '';
        }, { render: true });
      }));
    } else if (!['bookmark'].includes(block.type)) {
      menu.addItem((item) => item
        .setTitle(t("upload_or_replace_file_9fdd9517"))
        .setIcon('upload')
        .onClick(() => {
          const input = this.contentEl.querySelector(`[data-block-id="${block.id}"] .bs-advanced-file-input`);
          if (input) input.click();
        }));
    }
    const data = block.data || {};
    const source = data.sourceType === 'remote' ? data.url : data.path;
    if (source) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(block.type === 'bookmark' ? t("open_link_a2639495") : t("open_source_file_1c4beed1"))
        .setIcon('arrow-up-right')
        .onClick((clickEvent) => void this.openStoredLink(data.sourceType === 'vault' ? `wikilink:${source}` : source, clickEvent || event)));
      menu.addItem((item) => item
        .setTitle(t("copy_resource_url_c25f2026"))
        .setIcon('link')
        .onClick(() => void this.writeClipboardText(source, t("copied_resource_url_0ac0228b"))));
    } else if (block.type === 'bookmark' && data.url) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle(t("open_link_a2639495")).setIcon('arrow-up-right').onClick((clickEvent) => void this.openStoredLink(data.url, clickEvent || event)));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("copy_native_markdown_80246ebd"))
      .setIcon('clipboard-copy')
      .onClick(() => void this.writeClipboardText(Core.advancedBlockToMarkdown(block), t("copied_native_markdown_ac93d012"))));
    menu.showAtMouseEvent(event);
  }

  showBlockMenu(event, block, index) {
    const blockId = block.id;
    const blockIds = this.selectedBlockIds.has(blockId) ? this.getOrderedSelectedBlockIds() : [blockId];
    const menu = new Menu();
    const current = Core.getBlock(this.page, blockId);
    const headingSection = current && Core.isHeadingBlock(current) ? Core.getHeadingSectionRootIds(this.page, blockId) : [];
    if (blockIds.length > 1) {
      menu.addItem((item) => item
        .setTitle(t("selected_0_blocks_ca2974fb", [blockIds.length]))
        .setIcon('layers-3')
        .setDisabled(true));
    }
    if (!blockIds.some((selectedId) => Core.getBlock(this.page, selectedId)?.type === 'columns')) {
      menu.addItem((item) => item
        .setTitle(blockIds.length > 1 ? t("change_selected_block_types_c7801679") : t("change_block_type_cf0a7c9e"))
        .setIcon('replace')
        .onClick((clickEvent) => this.showBlockTypeMenu(clickEvent || event, blockIds)));
    }
    menu.addItem((item) => item
      .setTitle(blockIds.length > 1 ? t("style_0_blocks_4fd8aca1", [blockIds.length]) : t("block_style_8f22d39d"))
      .setIcon('palette')
      .onClick(() => new BlockAppearanceModal(this.app, this, blockIds).open()));

    if (current && blockIds.length === 1 && Core.isHeadingBlock(current)) {
      menu.addItem((item) => item
        .setTitle(t("section_actions_c7df1aae"))
        .setIcon('list-collapse')
        .onClick((clickEvent) => this.showHeadingContextMenu(clickEvent || event, current)));
    } else if (current && current.type !== 'columns' && blockIds.length === 1 && (current.type === 'toggle' || current.children.length || headingSection.length > 1)) {
      const collapsed = !!current.collapsed;
      menu.addItem((item) => item
        .setTitle(collapsed ? t("expand_content_6ad8768c") : t("collapse_content_1d37f580"))
        .setIcon(collapsed ? 'chevrons-down' : 'chevrons-up')
        .onClick(() => this.performMutation(collapsed ? t("expand_content_6ad8768c") : t("collapse_content_1d37f580"), (page) => {
          Core.toggleBlockCollapsed(page, blockId);
        })));
    }

    if (current && blockIds.length === 1 && current.type === 'table-of-contents') {
      menu.addItem((item) => item
        .setTitle(t("table_of_contents_settings_5a0c5804"))
        .setIcon('list-tree')
        .onClick((clickEvent) => this.showTocContextMenu(clickEvent || event, current)));
    }

    if (current && blockIds.length === 1 && current.type === 'columns') {
      menu.addItem((item) => item
        .setTitle(t("column_settings_b2af9055"))
        .setIcon('columns-3')
        .onClick((clickEvent) => this.showColumnsContextMenu(clickEvent || event, current)));
    }

    if (current && current.type === 'markdown' && blockIds.length === 1) {
      menu.addItem((item) => item
        .setTitle(t("advanced_edit_markdown_source_c81f60cc"))
        .setIcon('file-code-2')
        .onClick(() => {
          const ownerWindow = this.contentEl.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.activateMarkdownBlockEditor(blockId), 0);
        }));
    }
    if (current && Core.ADVANCED_BLOCK_TYPES.has(current.type) && blockIds.length === 1) {
      menu.addItem((item) => item
        .setTitle(t("0_actions_a45671b1", [ADVANCED_BLOCK_LABELS[current.type]?.label || t("advanced_block_b1b1c2c5")]))
        .setIcon(ADVANCED_BLOCK_LABELS[current.type]?.icon || 'blocks')
        .onClick((clickEvent) => this.showAdvancedBlockContextMenu(clickEvent || event, current)));
    }

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("copy_and_reference_a753f002"))
      .setIcon('copy')
      .onClick((clickEvent) => this.showBlockCopyContextMenu(clickEvent || event, current, blockIds)));
    menu.addItem((item) => item
      .setTitle(t("move_and_nest_a430082c"))
      .setIcon('move')
      .onClick((clickEvent) => this.showBlockMoveContextMenu(clickEvent || event, blockIds)));
    if (current && blockIds.length === 1) {
      menu.addItem((item) => item.setTitle(t("view_block_backlinks_d1db5b92")).setIcon('link-2').onClick(() => this.showBacklinksForBlock(blockId)));
    }

    menu.addItem((item) => item.setTitle(t("select_all_blocks_in_the_visible_page_74dfe144")).setIcon('list-checks').onClick(() => {
      const visibleIds = this.getVisibleBlockIds();
      this.setBlockSelection(visibleIds, visibleIds[0] || null, visibleIds[visibleIds.length - 1] || null);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(blockIds.length > 1 ? t("delete_0_block_subtrees_f7506ac5", [blockIds.length]) : t("delete_block_and_its_children_eb336aa1")).setIcon('trash-2').onClick(() => this.deleteSelectedBlocks()));
    menu.showAtMouseEvent(event);
  }

  showBlockCopyContextMenu(event, current, blockIds) {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(blockIds.length > 1 ? t("duplicate_0_blocks_fb297597", [blockIds.length]) : t("duplicate_block_028b7510"))
      .setIcon('copy-plus')
      .onClick(() => this.duplicateSelectedBlocks()));
    menu.addItem((item) => item
      .setTitle(t("copy_as_markdown_cd90cc3e"))
      .setIcon('clipboard-copy')
      .onClick(() => void this.copySelectedBlocks()));
    if (current && blockIds.length === 1) {
      menu.addItem((item) => item
        .setTitle(t("copy_plain_text_b21e5594"))
        .setIcon('text')
        .onClick(() => void this.writeClipboardText(current.text || '', t("copied_block_text_9cb955ba"))));
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(t("copy_block_reference_14717340"))
        .setIcon('quote')
        .onClick(() => void this.copyBlockReference(current, 'reference')));
      menu.addItem((item) => item
        .setTitle(t("copy_block_link_e7623ee1"))
        .setIcon('link')
        .onClick(() => void this.copyBlockReference(current, 'link')));
    }
    menu.showAtMouseEvent(event);
  }

  showBlockMoveContextMenu(event, blockIds) {
    const menu = new Menu();
    const canOutdent = blockIds.some((id) => !!Core.getBlock(this.page, id)?.parentId);
    menu.addItem((item) => item.setTitle(t("move_up_among_siblings_7adef9d9")).setIcon('arrow-up').onClick(() => this.moveSelectedBlocks(-1)));
    menu.addItem((item) => item.setTitle(t("move_down_among_siblings_db326306")).setIcon('arrow-down').onClick(() => this.moveSelectedBlocks(1)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("outdent_16e60cf6")).setIcon('outdent').setDisabled(!canOutdent).onClick(() => this.indentSelectedBlocks(-1)));
    menu.addItem((item) => item.setTitle(t("move_into_previous_container_14cdf4fc")).setIcon('indent').onClick(() => this.indentSelectedBlocks(1)));
    menu.showAtMouseEvent(event);
  }

  showHeadingContextMenu(event, block) {
    if (!block || !Core.isHeadingBlock(block)) return;
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(block.sectionCollapsed ? t("expand_section_f3d88072") : t("collapse_section_d3c1e2b1"))
      .setIcon(block.sectionCollapsed ? 'chevrons-down' : 'chevrons-up')
      .onClick(() => this.performMutation(block.sectionCollapsed ? t("expand_section_f3d88072") : t("collapse_section_d3c1e2b1"), (page) => {
        Core.toggleHeadingSectionCollapsed(page, block.id);
      })));
    menu.addItem((item) => item.setTitle(t("select_entire_section_81d95fc2")).setIcon('list-collapse').onClick(() => {
      const sectionIds = Core.getHeadingSectionRootIds(this.page, block.id);
      this.setBlockSelection(sectionIds, sectionIds[0] || null, sectionIds[sectionIds.length - 1] || null);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("move_entire_section_up_902c0887")).setIcon('arrow-up-to-line').onClick(() => {
      this.performMutation(t("move_entire_section_up_902c0887"), (page) => Core.moveHeadingSection(page, block.id, -1));
    }));
    menu.addItem((item) => item.setTitle(t("move_entire_section_down_88c0a927")).setIcon('arrow-down-to-line').onClick(() => {
      this.performMutation(t("move_entire_section_down_88c0a927"), (page) => Core.moveHeadingSection(page, block.id, 1));
    }));
    menu.showAtMouseEvent(event);
  }

  showTocContextMenu(event, block) {
    if (!block || block.type !== 'table-of-contents') return;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(block.toc.showNumbers ? t("hide_table_of_contents_numbering_d7f8f4c5") : t("show_table_of_contents_numbering_e591003d")).setIcon('list-ordered').onClick(() => {
      this.performMutation(block.toc.showNumbers ? t("hide_table_of_contents_numbering_d7f8f4c5") : t("show_table_of_contents_numbering_e591003d"), (page) => {
        const target = Core.getBlock(page, block.id);
        if (target) target.toc.showNumbers = !target.toc.showNumbers;
      });
    }));
    menu.addItem((item) => item.setTitle(block.toc.maxLevel === 3 ? t("show_heading_levels_1_2_only_c248c826") : t("show_heading_levels_1_3_586270ed")).setIcon('list-tree').onClick(() => {
      this.performMutation(t("change_table_of_contents_depth_7081a65f"), (page) => {
        const target = Core.getBlock(page, block.id);
        if (target) target.toc.maxLevel = target.toc.maxLevel === 3 ? 2 : 3;
      });
    }));
    menu.showAtMouseEvent(event);
  }

  showColumnsContextMenu(event, block) {
    if (!block || block.type !== 'columns') return;
    const config = Core.normalizeColumnsConfig(block.columns);
    const menu = new Menu();
    for (const count of [2, 3]) {
      menu.addItem((item) => item
        .setTitle(t("0_columns_1253c4f3", [count]))
        .setIcon(count === 2 ? 'columns-2' : 'columns-3')
        .setChecked(config.count === count)
        .onClick(() => {
          if (config.count === count) return;
          this.performMutation(t("switch_to_0_columns_8e849a81", [count]), (page) => Core.setColumnsCount(page, block.id, count));
        }));
    }
    menu.addSeparator();
    const ratios = config.count === 3 ? ['1:1:1', '1:2:1', '2:1:1', '1:1:2'] : ['1:1', '1:2', '2:1'];
    for (const ratio of ratios) {
      menu.addItem((item) => item
        .setTitle(t("ratio_0_73990d22", [ratio]))
        .setIcon('panel-left-dashed')
        .setChecked(config.ratio === ratio)
        .onClick(() => {
          if (config.ratio === ratio) return;
          this.performMutation(t("change_column_ratio_497d4115"), (page) => Core.setColumnsRatio(page, block.id, ratio));
        }));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("stack_vertically_e6e662ab"))
      .setIcon('rows-3')
      .onClick(() => {
        let focusId = null;
        this.performMutation(t("remove_column_layout_ebace429"), (page) => {
          const result = Core.unwrapColumns(page, block.id);
          focusId = result && result.focusId;
        });
        if (focusId) focusEditorAt(this, focusId, 0);
      }));
    menu.showAtMouseEvent(event);
  }

  storedLinkClipboardTarget(value) {
    const reference = Core.parseStoredReference(value);
    if (reference.kind === 'blockspace-page') return `blockspace://page/${encodeURIComponent(reference.pageId)}`;
    if (reference.kind === 'blockspace-block') return `blockspace://block/${encodeURIComponent(reference.blockId)}`;
    return reference.target || String(value || '');
  }

  storedLinkMarkdown(value, label) {
    const reference = Core.parseStoredReference(value);
    const text = String(label || reference.target || t("link_305378dd")).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
    if (reference.kind === 'obsidian') {
      const target = String(reference.target || '').replace(/\|/g, '\\|');
      return reference.mode === 'embed' ? `![[${target}]]` : `[[${target}|${text}]]`;
    }
    if (reference.kind === 'blockspace-page') {
      return `[${text}](blockspace://page/${encodeURIComponent(reference.pageId)})`;
    }
    if (reference.kind === 'blockspace-block') {
      if (reference.mode === 'reference') {
        const quoted = String(label || reference.blockId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `((${reference.blockId} "${quoted}"))`;
      }
      return `[${text}](blockspace://block/${encodeURIComponent(reference.blockId)})`;
    }
    return `[${text}](${reference.target || String(value || '')})`;
  }

  showLinkContextMenu(event, element, value) {
    if (!element || !value) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    const label = String(element.textContent || element.getAttribute('aria-label') || t("link_305378dd")).replace(/\s+/g, ' ').trim() || t("link_305378dd");
    const resolved = this.plugin.store.resolveStoredReference(value, this.page && this.page.id);
    if (resolved && ['obsidian', 'blockspace-page', 'blockspace-block'].includes(resolved.kind)) {
      menu.addItem((item) => item
        .setTitle(t("preview_link_5e6921cd"))
        .setIcon('scan-eye')
        .onClick((clickEvent) => {
          const ownerWindow = element.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.handleStoredLinkHover(element, value, clickEvent || event, false), 0);
        }));
    }
    menu.addItem((item) => item
      .setTitle(t("open_link_a2639495"))
      .setIcon('arrow-up-right')
      .onClick((clickEvent) => void this.openStoredLink(value, clickEvent || event)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("copy_display_text_9ca43238"))
      .setIcon('text')
      .onClick(() => void this.writeClipboardText(label, t("copied_display_text_27190faa"))));
    menu.addItem((item) => item
      .setTitle(t("copy_link_target_1eb7fdee"))
      .setIcon('link')
      .onClick(() => void this.writeClipboardText(this.storedLinkClipboardTarget(value), t("copied_link_target_0ce9484b"))));
    menu.addItem((item) => item
      .setTitle(t("copy_as_markdown_cd90cc3e"))
      .setIcon('clipboard-copy')
      .onClick(() => void this.writeClipboardText(this.storedLinkMarkdown(value, label), t("copied_markdown_link_c5edfcc0"))));
    if (resolved && resolved.kind === 'blockspace-block' && resolved.blockId) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(t("view_target_block_backlinks_85e894ce"))
        .setIcon('link-2')
        .onClick(() => this.showBacklinksForBlock(resolved.blockId)));
    }
    menu.showAtMouseEvent(event);
  }

  showImageContextMenu(event, image, outerLink = null) {
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    const source = image.getAttribute('data-path') || image.getAttribute('src') || image.currentSrc || '';
    const outerValue = this.storedLinkValue(outerLink);
    if (outerValue) {
      menu.addItem((item) => item
        .setTitle(t("open_image_link_target_9f78c753"))
        .setIcon('external-link')
        .onClick((clickEvent) => void this.openStoredLink(outerValue, clickEvent || event)));
      menu.addSeparator();
    }
    menu.addItem((item) => item
      .setTitle(t("open_original_image_f75e08cc"))
      .setIcon('image')
      .setDisabled(!source)
      .onClick((clickEvent) => void this.openStoredLink(source, clickEvent || event)));
    menu.addItem((item) => item
      .setTitle(t("reload_image_0ad285f1"))
      .setIcon('refresh-cw')
      .setDisabled(!source)
      .onClick(() => {
        const original = image.getAttribute('src') || image.currentSrc || source;
        image.removeAttribute('src');
        image.ownerDocument.defaultView.requestAnimationFrame(() => image.setAttribute('src', original));
      }));
    menu.addItem((item) => item
      .setTitle(t("copy_image_url_81d0d0bf"))
      .setIcon('link')
      .setDisabled(!source)
      .onClick(() => void this.writeClipboardText(source, t("copied_image_url_a9ef4437"))));
    const alt = String(image.getAttribute('alt') || '').trim();
    menu.addItem((item) => item
      .setTitle(t("copy_alt_text_a84a9be1"))
      .setIcon('text')
      .setDisabled(!alt)
      .onClick(() => void this.writeClipboardText(alt, t("copied_image_alt_text_41ee11be"))));
    const wrapper = image.closest('.bs-block[data-block-id]');
    const block = wrapper && this.page ? Core.getBlock(this.page, wrapper.dataset.blockId) : null;
    if (block && block.type === 'markdown') {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(t("edit_containing_markdown_source_b334f730"))
        .setIcon('file-code-2')
        .onClick(() => {
          const ownerWindow = image.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.activateMarkdownBlockEditor(block.id), 0);
        }));
    }
    menu.showAtMouseEvent(event);
  }

  showOutlineContextMenu(event, block) {
    if (!block) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("go_to_heading_fce65b89")).setIcon('locate-fixed').onClick(() => this.focusBlock(block.id)));
    if (Core.isHeadingBlock(block)) {
      menu.addItem((item) => item
        .setTitle(block.sectionCollapsed ? t("expand_section_f3d88072") : t("collapse_section_d3c1e2b1"))
        .setIcon(block.sectionCollapsed ? 'chevrons-down' : 'chevrons-up')
        .onClick(() => this.performMutation(block.sectionCollapsed ? t("expand_section_f3d88072") : t("collapse_section_d3c1e2b1"), (page) => {
          Core.toggleHeadingSectionCollapsed(page, block.id);
        })));
      menu.addItem((item) => item.setTitle(t("select_entire_section_81d95fc2")).setIcon('list-collapse').onClick(() => {
        const sectionIds = Core.getHeadingSectionRootIds(this.page, block.id);
        this.setBlockSelection(sectionIds, sectionIds[0] || null, sectionIds[sectionIds.length - 1] || null);
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("copy_heading_block_link_fb082285")).setIcon('link').onClick(() => void this.copyBlockReference(block, 'link')));
    menu.addItem((item) => item.setTitle(t("view_heading_block_backlinks_afb23bb7")).setIcon('link-2').onClick(() => this.showBacklinksForBlock(block.id)));
    menu.showAtMouseEvent(event);
  }

  showBacklinkContextMenu(event, backlink, element = null) {
    if (!backlink) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    const sourceValue = `blockspace://block/${encodeURIComponent(backlink.sourceBlockId)}`;
    menu.addItem((item) => item
      .setTitle(t("open_reference_source_b5033216"))
      .setIcon('arrow-up-right')
      .onClick(() => void this.openPageAtBlock(backlink.sourcePageId, backlink.sourceBlockId)));
    if (element) {
      menu.addItem((item) => item
        .setTitle(t("preview_reference_source_6bc47b27"))
        .setIcon('scan-eye')
        .onClick((clickEvent) => {
          const ownerWindow = element.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.handleStoredLinkHover(element, sourceValue, clickEvent || event, false), 0);
        }));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(t("copy_source_block_link_095896c9"))
      .setIcon('link')
      .onClick(() => void this.writeClipboardText(
        `[${String(backlink.sourcePageTitle || t("reference_source_bde238d2")).replace(/\]/g, '\\]')}](blockspace://block/${encodeURIComponent(backlink.sourceBlockId)})`,
        t("copied_source_block_link_376534dc"),
      )));
    const snippet = String(backlink.sourceText || backlink.label || '').replace(/\s+/g, ' ').trim();
    menu.addItem((item) => item
      .setTitle(t("copy_referenced_content_92f53b1f"))
      .setIcon('text')
      .setDisabled(!snippet)
      .onClick(() => void this.writeClipboardText(snippet, t("copied_referenced_content_94db7b53"))));
    menu.showAtMouseEvent(event);
  }

  showDocumentContextMenu(event) {
    if (!this.page) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("add_block_at_end_of_page_e38e6a84")).setIcon('plus').onClick(() => this.insertBlock(this.getVisibleBlocks().length)));
    menu.addItem((item) => item.setTitle(t("select_all_visible_blocks_0ab483c3")).setIcon('list-checks').setDisabled(!this.getVisibleBlocks().length).onClick(() => {
      const ids = this.getVisibleBlockIds();
      this.setBlockSelection(ids, ids[0] || null, ids[ids.length - 1] || null);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("new_page_64451e31")).setIcon('square-plus').onClick(() => void this.createPage()));
    menu.addItem((item) => item.setTitle(t("import_current_markdown_6e41aaf3")).setIcon('file-input').onClick(() => void this.plugin.importActiveMarkdown()));
    this.addExportMenuItems(menu);
    menu.addItem((item) => item.setTitle(this.focusMode ? t("exit_focus_mode_3f6477ba") : t("enter_focus_mode_b2c1df34")).setIcon(this.focusMode ? 'minimize-2' : 'maximize-2').onClick(() => this.toggleFocusMode()));
    menu.showAtMouseEvent(event);
  }


  showPageMenu(event, meta) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("open_c771248e")).setIcon('arrow-up-right').onClick(() => void this.openPage(meta.id)));
    menu.addItem((item) => item.setTitle(t("copy_page_link_95119ea5")).setIcon('link').onClick(() => {
      const label = String(meta.title || t('untitled')).replace(/\]/g, '\\]');
      void this.writeClipboardText(`[${label}](blockspace://page/${encodeURIComponent(meta.id)})`, t("copied_page_link_5db49983"));
    }));
    this.addExportMenuItems(menu, () => this.plugin.store.loadPage(meta.id));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("delete_page_24a6ab1e")).setIcon('trash-2').onClick(() => void this.removePage(meta)));
    menu.showAtMouseEvent(event);
  }

  async removePage(meta) {
    if (!(await this.flushSave())) return;
    const deletingActivePage = this.page && this.page.id === meta.id;
    this.pendingDeletion = {
      ...(await this.plugin.store.deletePage(meta.id)),
      wasActive: !!deletingActivePage,
    };
    const activeId = this.plugin.store.workspace.activePageId;
    if (deletingActivePage) this.setPage(activeId ? await this.plugin.store.loadPage(activeId) : null);
    this.render();
    new Notice(t("page_deleted_3e296067"));
  }

  insertBlock(indexOrAnchor) {
    const block = Core.createBlock();
    this.performMutation(t("insert_block_c2672f80"), (page) => {
      if (typeof indexOrAnchor === 'string') Core.insertBlockAfter(page, indexOrAnchor, block);
      else {
        const visible = Core.flattenBlocks(page).filter((candidate) => candidate.type !== 'column');
        const index = Math.max(0, Math.min(visible.length, Number(indexOrAnchor) || 0));
        if (index <= 0) Core.insertBlock(page, block, { parentId: null, index: 0 });
        else if (index >= visible.length) Core.appendRootBlock(page, block);
        else Core.insertBlockAfter(page, visible[index - 1].id, block);
      }
    });
    const editor = this.contentEl.querySelector(`[data-block-id="${block.id}"] .bs-block-editor`);
    if (editor) editor.focus();
  }

  async movePageToStatus(pageId, status) {
    if (!pageId || !Core.PAGE_STATUSES.includes(status)) return false;
    if (this.page && this.page.id === pageId) {
      if (this.page.properties.status === status) return false;
      this.performMutation(t("move_page_status_7fea0f64"), (page) => { page.properties.status = status; }, { render: false });
      if (!(await this.flushSave())) return false;
      this.render();
      return true;
    }
    const page = await this.plugin.store.loadPage(pageId);
    if (!page || page.properties.status === status) return false;
    page.properties.status = status;
    const saved = Core.touchPage(page);
    try {
      await this.plugin.store.savePage(saved, { expectedRevision: page.revision });
      this.render();
      return true;
    } catch (error) {
      console.error('Blockspace: board update failed', error);
      new Notice(error instanceof ConflictError ? t("page_was_modified_elsewhere_existing_content_was_12a155d7") : t("could_not_update_page_status_55996113"));
      return false;
    }
  }

  showBoardCardMenu(event, meta) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(t("open_c771248e")).setIcon('arrow-up-right').onClick(() => void this.openPage(meta.id)));
    menu.addItem((item) => item.setTitle(t("copy_page_link_95119ea5")).setIcon('link').onClick(() => {
      const label = String(meta.title || t('untitled')).replace(/\]/g, '\\]');
      void this.writeClipboardText(`[${label}](blockspace://page/${encodeURIComponent(meta.id)})`, t("copied_page_link_5db49983"));
    }));
    this.addExportMenuItems(menu, () => this.plugin.store.loadPage(meta.id));
    menu.addSeparator();
    for (const status of Core.PAGE_STATUSES) {
      menu.addItem((item) => item
        .setTitle(t("move_to_0_2e72932a", [STATUS_LABELS[status]]))
        .setIcon(status === 'done' ? 'circle-check-big' : status === 'doing' ? 'loader-circle' : 'circle-dashed')
        .setChecked(meta.status === status)
        .setDisabled(meta.status === status)
        .onClick(() => void this.movePageToStatus(meta.id, status)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(t("delete_page_24a6ab1e")).setIcon('trash-2').onClick(() => void this.removePage(meta)));
    menu.showAtMouseEvent(event);
  }

  renderBoard(host) {
    const board = host.createDiv({ cls: 'bs-board' });
    const pages = Core.sortPageMetas(this.plugin.store.workspace.pages);
    for (const status of Core.PAGE_STATUSES) {
      const column = board.createDiv({ cls: `bs-board-column is-${status}` });
      column.dataset.status = status;
      const heading = column.createDiv({ cls: 'bs-board-heading' });
      heading.createSpan({ cls: `bs-status-dot is-${status}` });
      heading.createSpan({ text: STATUS_LABELS[status] });
      heading.createSpan({ cls: 'bs-count', text: String(pages.filter((page) => page.status === status).length) });
      const cards = column.createDiv({ cls: 'bs-board-cards' });
      column.addEventListener('dragover', (event) => {
        event.preventDefault();
        column.addClass('is-board-target');
      });
      column.addEventListener('dragleave', () => column.removeClass('is-board-target'));
      column.addEventListener('drop', async (event) => {
        event.preventDefault();
        column.removeClass('is-board-target');
        const pageId = event.dataTransfer.getData('application/x-blockspace-page');
        await this.movePageToStatus(pageId, status);
      });
      for (const meta of pages.filter((page) => page.status === status)) {
        const card = cards.createDiv({
          cls: 'bs-board-card',
          attr: { role: 'group', 'aria-label': t("page_0_96add9f7", [meta.title]), 'data-page-id': meta.id },
        });
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-blockspace-page', meta.id);
        });
        const openButton = card.createEl('button', {
          cls: 'bs-card-open',
          attr: { type: 'button', 'aria-label': t("open_page_0_e5ee4307", [meta.title]) },
        });
        openButton.addEventListener('click', () => void this.openPage(meta.id));
        // All card layout lives on this div, never on the button itself:
        // Chromium wraps button children in an anonymous content box, so a
        // <button> is not a dependable flex/grid container — the rows collapse
        // into one band and the title, excerpt and meta line overlap.
        const cardBody = openButton.createDiv({ cls: 'bs-card-body' });
        const cardTitle = cardBody.createDiv({ cls: 'bs-card-title' });
        cardTitle.createSpan({ cls: 'bs-card-icon', text: meta.icon || '📄' });
        cardTitle.createSpan({ cls: 'bs-card-title-text', text: meta.title });
        if (meta.excerpt) cardBody.createDiv({ cls: 'bs-card-excerpt', text: meta.excerpt });
        const cardMeta = cardBody.createDiv({ cls: 'bs-card-meta' });
        // The default priority is on every page, so rendering it says nothing
        // and turns the whole column into one repeated colour.
        if (meta.priority !== 'medium') {
          cardMeta.createSpan({ cls: `bs-priority is-${meta.priority}`, text: PRIORITY_LABELS[meta.priority] });
        }
        const firstTag = Array.isArray(meta.tags) ? meta.tags[0] : null;
        if (firstTag) cardMeta.createSpan({ cls: 'bs-card-tag', text: `#${firstTag}` });
        cardMeta.createSpan({ cls: 'bs-card-date', text: new Date(meta.updatedAt).toLocaleDateString() });
        const moveButton = createButton(card, 'bs-card-move', t("more_actions_for_page_0_4c0edcbb", [meta.title]), 'ellipsis');
        moveButton.addEventListener('click', (event) => this.showBoardCardMenu(event, meta));
      }
      const addCard = createButton(column, 'bs-board-add', t("new_page_51a821f2"), 'plus', t("new_page_51a821f2"));
      addCard.addEventListener('click', () => void this.createPage(status));
    }
  }

  renderBacklinksPanel(container, options = {}) {
    if (!this.page || !container) return;
    const targetBlockId = options.targetBlockId === undefined ? this.backlinkTargetBlockId : options.targetBlockId;
    const backlinks = targetBlockId
      ? this.plugin.store.getBacklinksForBlock(targetBlockId)
      : this.plugin.store.getBacklinksForPage(this.page.id);
    const section = container.createDiv({ cls: `bs-right-section bs-backlinks-section${targetBlockId ? ' is-block-filtered' : ''}` });
    // The inspector already draws a section heading; drawing a second one here
    // is what put "反向链接" on screen twice.
    if (options.heading !== false) {
      const heading = section.createDiv({ cls: 'bs-backlinks-heading' });
      const headingText = heading.createDiv({ cls: 'bs-right-title' });
      headingText.createSpan({ text: targetBlockId ? t("block_backlinks_9d076af6") : t("backlinks_639a9e8a") });
      headingText.createSpan({ cls: 'bs-backlinks-count', text: String(backlinks.length) });
      if (targetBlockId) {
        const clear = createButton(heading, 'bs-backlinks-clear', t("return_to_page_backlinks_21bae81c"), 'x');
        clear.addEventListener('click', () => {
          this.backlinkTargetBlockId = null;
          if (options.inspector) this.plugin.notifyContextChanged();
          else this.render();
        });
      }
    }
    if (targetBlockId) {
      const target = Core.getBlock(this.page, targetBlockId);
      section.createDiv({
        cls: 'bs-backlinks-target',
        text: target && target.text ? target.text.replace(/\s+/g, ' ').slice(0, 120) : t("current_block_a02ff874"),
      });
    }
    if (!backlinks.length) {
      section.createDiv({
        cls: 'bs-empty-small',
        text: targetBlockId ? t("no_other_blocks_reference_this_block_yet_9c0676a5") : t("no_pages_or_blocks_reference_this_page_yet_b69b6178"),
      });
      return;
    }
    const list = section.createDiv({ cls: 'bs-backlinks-list' });
    for (const backlink of backlinks) {
      const item = list.createEl('button', {
        cls: 'bs-backlink-item',
        attr: { type: 'button', 'aria-label': t("open_reference_in_0_cec9fbfe", [backlink.sourcePageTitle]) },
      });
      item.__blockspaceBacklink = backlink;
      const itemHeader = item.createDiv({ cls: 'bs-backlink-item-header' });
      itemHeader.createSpan({ cls: 'bs-backlink-page', text: backlink.sourcePageTitle || t('untitled') });
      itemHeader.createSpan({
        cls: `bs-backlink-mode is-${backlink.mode || 'link'}`,
        text: ({ link: t("link_305378dd"), reference: t("quote_e0ec651f"), embed: t("embed_00a0cf27") })[backlink.mode] || t("link_305378dd"),
      });
      const snippet = String(backlink.sourceText || backlink.label || '').replace(/\s+/g, ' ').trim();
      item.createDiv({ cls: 'bs-backlink-snippet', text: snippet || t("empty_block_fb8e593d") });
      item.addEventListener('click', () => void this.openPageAtBlock(backlink.sourcePageId, backlink.sourceBlockId));
      item.addEventListener('contextmenu', (event) => this.showBacklinkContextMenu(event, backlink, item));
    }
  }

  switchTab(tab) {
    this.commitPendingEdit();
    this.clearBlockSelection({ updateDom: false });
    this.activeTab = tab;
    if (tab !== 'document') this.readingMode = false;
    this.render();
    if (typeof this.app.workspace.requestSaveLayout === 'function') this.app.workspace.requestSaveLayout();
  }

  async openPage(id) {
    if (this.page && this.page.id === id) return;
    if (!(await this.flushSave())) return;
    const page = await this.plugin.store.loadPage(id);
    if (!page) {
      new Notice(t("could_not_open_page_cc646807"));
      return;
    }
    this.setPage(page);
    this.plugin.store.workspace.activePageId = id;
    await this.plugin.store.saveWorkspace();
    this.activeTab = 'document';
    this.render();
    if (typeof this.app.workspace.requestSaveLayout === 'function') this.app.workspace.requestSaveLayout();
  }

  async createPage(status = 'todo') {
    if (!(await this.flushSave())) return;
    this.setPage(await this.plugin.store.createPage(t('untitled'), { status }));
    this.activeTab = 'document';
    this.render();
    const title = this.contentEl.querySelector('.bs-page-title');
    if (title) {
      title.focus();
      const selection = title.ownerDocument.defaultView.getSelection();
      const range = title.ownerDocument.createRange();
      range.selectNodeContents(title);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  scheduleSave() {
    if (!this.page) return;
    this.dirty = true;
    this.setSaveState('dirty');
    const ownerWindow = this.contentEl.ownerDocument.defaultView;
    if (this.saveTimer !== null) ownerWindow.clearTimeout(this.saveTimer);
    this.saveTimer = ownerWindow.setTimeout(() => {
      this.saveTimer = null;
      void this.saveCurrentPage();
    }, Math.max(100, Number(this.plugin.settings.autosaveDelay) || 350));
  }

  async saveCurrentPage() {
    if (!this.page || !this.dirty) return this.page;
    if (this.savePromise) {
      await this.savePromise.catch(() => undefined);
      return this.dirty ? this.saveCurrentPage() : this.page;
    }
    this.commitPendingEdit();
    const generation = this.changeGeneration;
    const candidate = Core.clonePage(this.page);
    candidate.updatedAt = Core.nowIso();
    candidate.revision = Math.max(this.persistedRevision, Number(candidate.revision) || 0) + 1;
    this.setSaveState('saving');
    this.savePromise = (async () => {
      try {
        const saved = await this.plugin.store.savePage(candidate, { expectedRevision: this.persistedRevision });
        this.persistedRevision = saved.revision;
        this.plugin.notifyContextChanged();
        if (this.changeGeneration === generation) {
          this.page = saved;
          this.dirty = false;
          this.setSaveState('saved');
        } else {
          // Preserve edits made while I/O was in progress, only advance the
          // revision baseline and schedule the newer state for another save.
          this.page.revision = saved.revision;
          this.dirty = true;
          this.setSaveState('dirty');
          this.scheduleSave();
        }
        return saved;
      } catch (error) {
        console.error('Blockspace: save failed', error);
        if (error instanceof ConflictError) {
          this.saveIssue = {
            type: 'conflict',
            conflictPath: error.details.conflictPath || '',
            message: error.message || t("save_conflict_8c2c84c9"),
          };
          this.setSaveState('conflict');
          new Notice(t("blockspace_detected_a_save_conflict_recovery_cop_9f782c52", [error.details.conflictPath || '']));
        } else {
          this.saveIssue = {
            type: 'error',
            message: error && (error.message || String(error)) || t("save_failed_6309a3bb"),
          };
          this.setSaveState('error');
          new Notice(t("blockspace_save_failed_the_recovery_journal_is_p_87775656"));
        }
        this.renderStatusBanners();
        throw error;
      } finally {
        this.savePromise = null;
      }
    })();
    return this.savePromise;
  }

  async flushSave() {
    this.commitPendingEdit();
    if (this.saveTimer !== null) {
      this.contentEl.ownerDocument.defaultView.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    let success = true;
    if (this.dirty) {
      try { await this.saveCurrentPage(); } catch (error) { success = false; }
    }
    await this.plugin.store.flush();
    return success;
  }

  async exportCurrentPage(format = 'md') {
    await this.flushSave();
    if (this.page) await this.plugin.exportPage(this.page, format);
  }
}

class BlockspaceInspectorView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return INSPECTOR_VIEW_TYPE; }
  getDisplayText() { return t("blockspace_inspector_4731cfed"); }
  getIcon() { return 'panel-right'; }

  async onOpen() {
    this.plugin.inspectorViews.add(this);
    this.render();
  }

  async onClose() {
    this.plugin.inspectorViews.delete(this);
  }

  render() {
    clearElement(this.contentEl);
    this.contentEl.addClass('blockspace-inspector-view');
    const view = this.plugin.getActiveView();
    const page = view && view.page;
    const header = this.contentEl.createDiv({ cls: 'bs-inspector-header' });
    const titleWrap = header.createDiv({ cls: 'bs-inspector-title-wrap' });
    titleWrap.createDiv({ cls: 'bs-inspector-title', text: page ? page.title : t("page_inspector_83d09bf7") });
    const refresh = createButton(header, 'bs-icon-button', t("refresh_inspector_247b0570"), 'refresh-cw');
    refresh.addEventListener('click', () => this.render());
    if (!view || !page) {
      const empty = this.contentEl.createDiv({ cls: 'bs-inspector-empty' });
      const icon = empty.createDiv({ cls: 'bs-inspector-empty-icon' });
      setIcon(icon, 'panel-right');
      empty.createDiv({ cls: 'bs-inspector-empty-title', text: t("no_active_blockspace_page_7f255c41") });
      empty.createDiv({ cls: 'bs-inspector-empty-hint', text: t("open_a_blockspace_workspace_to_see_properties_ou_96d7df15") });
      return;
    }

    const properties = this.createSection(t("page_properties_08c11548"), 'sliders-horizontal');
    const statusRow = properties.createDiv({ cls: 'bs-inspector-property' });
    statusRow.createSpan({ cls: 'bs-inspector-property-label', text: t("status_6320b4a8") });
    const statusSelect = statusRow.createEl('select', { cls: 'dropdown' });
    for (const [value, label] of Object.entries(STATUS_LABELS)) statusSelect.createEl('option', { value, text: label });
    statusSelect.value = page.properties.status;
    statusSelect.addEventListener('change', () => view.performMutation(t("change_page_status_2af8342f"), (target) => { target.properties.status = statusSelect.value; }));

    const priorityRow = properties.createDiv({ cls: 'bs-inspector-property' });
    priorityRow.createSpan({ cls: 'bs-inspector-property-label', text: t("priority_565d6460") });
    const prioritySelect = priorityRow.createEl('select', { cls: 'dropdown' });
    for (const [value, label] of Object.entries(PRIORITY_LABELS)) prioritySelect.createEl('option', { value, text: label });
    prioritySelect.value = page.properties.priority;
    prioritySelect.addEventListener('change', () => view.performMutation(t("change_page_priority_6f1193d4"), (target) => { target.properties.priority = prioritySelect.value; }));

    const tagsRow = properties.createDiv({ cls: 'bs-inspector-property is-column' });
    tagsRow.createSpan({ cls: 'bs-inspector-property-label', text: t("tags_1d0fd5f9") });
    const tags = tagsRow.createEl('input', { cls: 'bs-inspector-tags-input', attr: { type: 'text', placeholder: t("separate_tags_with_commas_7738d332") } });
    tags.value = Array.isArray(page.properties.tags) ? page.properties.tags.join(', ') : '';
    tags.addEventListener('change', () => view.performMutation(t("change_page_tags_fd14c4f7"), (target) => {
      target.properties.tags = tags.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    }));

    const outline = this.createSection(t("outline_79fadbc2"), 'list-tree');
    const headings = Core.deriveOutline(page);
    outline.addClass('bs-inspector-outline-tree');
    outline.setAttribute('role', 'tree');
    if (!headings.length) outline.createDiv({ cls: 'bs-inspector-muted', text: t("no_heading_blocks_yet_9b79bee2") });
    const outlineBaseLevel = headings.length ? Math.min(...headings.map((heading) => heading.level)) : 1;
    for (const heading of headings) {
      const relativeLevel = Math.max(0, heading.level - outlineBaseLevel);
      const item = outline.createEl('button', {
        cls: `bs-inspector-outline level-${heading.level}${heading.sectionCollapsed ? ' is-collapsed' : ''}`,
        attr: {
          type: 'button',
          role: 'treeitem',
          'aria-level': String(relativeLevel + 1),
          'data-block-id': heading.blockId,
        },
      });
      item.style.setProperty('--bs-outline-level', String(relativeLevel));
      if (heading.sectionCollapsed) {
        const icon = item.createSpan({ cls: 'bs-inspector-outline-icon' });
        setIcon(icon, 'chevron-right');
      }
      item.createSpan({ cls: 'bs-inspector-outline-label', text: heading.title });
      item.addEventListener('click', () => view.focusBlock(heading.blockId));
      item.addEventListener('contextmenu', (event) => view.showOutlineContextMenu(event, Core.getBlock(page, heading.blockId)));
    }

    const backlinkTargetId = view.backlinkTargetBlockId;
    const backlinkCount = (backlinkTargetId
      ? this.plugin.store.getBacklinksForBlock(backlinkTargetId)
      : this.plugin.store.getBacklinksForPage(page.id)).length;
    const backlinks = this.createSection(backlinkTargetId ? t("block_backlinks_9d076af6") : t("backlinks_639a9e8a"), 'link-2', {
      count: backlinkCount,
      action: backlinkTargetId
        ? {
          icon: 'x',
          label: t("return_to_page_backlinks_21bae81c"),
          onClick: () => {
            view.backlinkTargetBlockId = null;
            this.plugin.notifyContextChanged();
          },
        }
        : null,
    });
    view.renderBacklinksPanel(backlinks, { inspector: true, heading: false });

    const stats = this.createSection(t("page_statistics_7eb184db"), 'chart-no-axes-column-increasing');
    const todos = page.blocks.filter((block) => block.type === 'todo');
    for (const [label, value] of [
      [t("block_count_838fcc7b"), page.blocks.length],
      [t("to_do_completion_f1dd34d8"), `${todos.filter((block) => block.checked).length}/${todos.length}`],
      [t("revision_f3d6cf15"), page.revision],
    ]) {
      const row = stats.createDiv({ cls: 'bs-inspector-stat' });
      row.createSpan({ text: label });
      row.createSpan({ cls: 'bs-inspector-stat-value', text: String(value) });
    }

    const storage = this.createSection(t("advanced_d6e61888"), 'database');
    storage.createDiv({ cls: 'bs-inspector-storage-path', text: `${this.plugin.store.pagesFolder}/${page.id}.json` });
    const diagnostics = createButton(storage, 'bs-inspector-action', t("open_diagnostics_and_recovery_7acf8511"), 'stethoscope', t("diagnostics_and_recovery_18b77e4a"));
    diagnostics.addEventListener('click', () => new BlockspaceDiagnosticsModal(this.app, this.plugin).open());
  }

  createSection(title, iconName, options = {}) {
    const section = this.contentEl.createDiv({ cls: 'bs-inspector-section' });
    const heading = section.createDiv({ cls: 'bs-inspector-section-heading' });
    const icon = heading.createSpan({ cls: 'bs-inspector-section-icon' });
    setIcon(icon, iconName);
    heading.createSpan({ text: title });
    if (Number.isFinite(options.count)) {
      heading.createSpan({ cls: 'bs-inspector-section-count', text: String(options.count) });
    }
    if (options.action) {
      const action = createButton(heading, 'bs-inspector-section-action', options.action.label, options.action.icon);
      action.addEventListener('click', options.action.onClick);
    }
    return section.createDiv({ cls: 'bs-inspector-section-body' });
  }
}

class BlockspaceDiagnosticsModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    void this.renderReport();
  }

  async renderReport() {
    const { contentEl } = this;
    clearElement(contentEl);
    contentEl.addClass('bs-diagnostics');
    contentEl.createEl('h2', { text: t("blockspace_diagnostics_and_recovery_bf9774f3") });
    const loading = contentEl.createDiv({ cls: 'bs-diagnostics-loading', text: t("checking_structured_data_c03a5037") });
    let report;
    try {
      report = await this.plugin.store.diagnose();
    } catch (error) {
      loading.setText(t("diagnostics_failed_0_6ab7a79f", [error.message || error]));
      return;
    }
    loading.remove();
    const summary = contentEl.createDiv({ cls: 'bs-diagnostics-summary' });
    const items = [
      [t("page_files_3a2f2732"), report.pages],
      [t("recovery_journals_5e92640e"), report.pendingJournals],
      [t("history_snapshots_fc9f1fda"), report.snapshots],
      [t("recovery_copies_8890c176"), report.recoveryFiles],
      [t("trashed_pages_6b453fe8"), report.trashFiles],
      [t("errors_0bc1fb72"), report.errors.length],
      [t("warnings_a8b7a448"), report.warnings.length],
    ];
    for (const [label, value] of items) {
      const card = summary.createDiv({ cls: 'bs-diagnostic-card' });
      card.createDiv({ cls: 'bs-diagnostic-value', text: String(value) });
      card.createDiv({ cls: 'bs-diagnostic-label', text: label });
    }
    const renderIssues = (title, issues, type) => {
      const section = contentEl.createDiv({ cls: `bs-diagnostic-section is-${type}` });
      section.createEl('h3', { text: title });
      if (!issues.length) section.createDiv({ cls: 'bs-diagnostic-ok', text: t("no_issues_found_e5e8b8f3") });
      else for (const issue of issues) section.createDiv({ cls: 'bs-diagnostic-issue', text: issue });
    };
    renderIssues(t("errors_0bc1fb72"), report.errors, 'error');
    renderIssues(t("warnings_a8b7a448"), report.warnings, 'warning');
    const actions = contentEl.createDiv({ cls: 'bs-diagnostic-actions' });
    const rerun = createButton(actions, 'mod-cta', t("check_again_c25fb86b"), 'refresh-cw', t("check_again_c25fb86b"));
    rerun.addEventListener('click', () => void this.renderReport());
    const rebuild = createButton(actions, '', t("rebuild_page_index_e75bff58"), 'list-restart', t("rebuild_index_9b178a29"));
    rebuild.addEventListener('click', async () => {
      rebuild.disabled = true;
      try {
        const count = await this.plugin.store.rebuildWorkspaceIndex();
        new Notice(t("blockspace_rebuilt_0_page_index_entries_546e35a4", [count]));
        for (const view of this.plugin.views) view.render();
        await this.renderReport();
      } finally {
        rebuild.disabled = false;
      }
    });
    const recover = createButton(actions, '', t("recover_unfinished_saves_8c450723"), 'life-buoy', t("recover_journals_cac1821f"));
    recover.addEventListener('click', async () => {
      recover.disabled = true;
      try {
        const count = await this.plugin.store.recoverPendingJournals();
        if (count > 0) await this.plugin.store.rebuildWorkspaceIndex();
        new Notice(count ? t("recovered_0_pages_8d1b3e64", [count]) : t("no_pages_need_recovery_8c2cca1a"));
        await this.renderReport();
      } finally {
        recover.disabled = false;
      }
    });
    const openRestoredPage = async (page, emptyMessage) => {
      if (!page) {
        new Notice(emptyMessage);
        return;
      }
      const view = await this.plugin.activateView();
      if (view) await view.openPage(page.id);
      new Notice(t("restored_as_a_new_page_0_e7c0dab2", [page.title]));
      await this.renderReport();
    };
    const activeView = this.plugin.getActiveView();
    const restoreSnapshot = createButton(actions, '', t("restore_the_current_page_s_latest_snapshot_as_a__fdbc641b"), 'history', t("restore_current_page_snapshot_994afcb1"));
    restoreSnapshot.disabled = !(activeView && activeView.page);
    restoreSnapshot.addEventListener('click', async () => {
      restoreSnapshot.disabled = true;
      try {
        const pageId = this.plugin.getActiveView()?.page?.id;
        const restored = await this.plugin.store.restoreLatestSnapshot(pageId);
        await openRestoredPage(restored, t("no_recoverable_snapshot_for_the_current_page_5f70e150"));
      } finally {
        restoreSnapshot.disabled = !(this.plugin.getActiveView()?.page);
      }
    });
    const restoreConflict = createButton(actions, '', t("restore_the_local_version_from_the_latest_confli_233b4365"), 'copy-plus', t("restore_latest_conflict_d75c3db0"));
    restoreConflict.addEventListener('click', async () => {
      restoreConflict.disabled = true;
      try {
        await openRestoredPage(await this.plugin.store.restoreLatestConflict(), t("no_recoverable_conflict_copy_e2c6a786"));
      } finally {
        restoreConflict.disabled = false;
      }
    });
    const restoreTrash = createButton(actions, '', t("restore_the_most_recently_deleted_page_as_a_new__9ff12c7f"), 'archive-restore', t("restore_last_deletion_b00dda17"));
    restoreTrash.addEventListener('click', async () => {
      restoreTrash.disabled = true;
      try {
        await openRestoredPage(await this.plugin.store.restoreLatestTrash(), t("no_recoverable_pages_in_trash_cec22518"));
      } finally {
        restoreTrash.disabled = false;
      }
    });
  }
}

class BlockspaceSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    clearElement(containerEl);
    // The field only stages a value: migrating on every keystroke would copy the
    // whole data directory once per character.
    new Setting(containerEl)
      .setName(t('language_name'))
      .setDesc(t('language_description'))
      .addDropdown((dropdown) => dropdown
        .addOption('en', 'English')
        .addOption('zh-CN', '简体中文')
        .setValue(normalizeLanguage(this.plugin.settings.language))
        .onChange(async (value) => {
          this.plugin.settings.language = normalizeLanguage(value);
          await this.plugin.saveSettings();
          new Notice(t('language_reload'));
        }));
    let pendingDataFolder = this.plugin.settings.dataFolder;
    new Setting(containerEl)
      .setName(t("data_folder_95ad5bf3"))
      .setDesc(t("folder_for_blockspace_structured_pages_ios_ipado_1b7b78d5"))
      .addText((text) => text
        .setValue(this.plugin.settings.dataFolder)
        .onChange((value) => { pendingDataFolder = value; }))
      .addButton((button) => button
        .setButtonText(t("migrate_and_apply_4c74148d"))
        .onClick(async () => {
          const nextFolder = String(pendingDataFolder || '').trim() || DEFAULT_SETTINGS.dataFolder;
          if (!this.plugin.store || normalizePath(nextFolder) === this.plugin.store.folder) {
            new Notice(t("data_folder_is_unchanged_da90a1d9"));
            return;
          }
          button.setDisabled(true);
          try {
            const result = await this.plugin.store.migrateDataFolder(nextFolder);
            this.plugin.settings.dataFolder = result.target;
            await this.plugin.saveSettings();
            new Notice(
              t("copied_0_files_to_1_original_folder_2_remains_as_3421dba3", [result.moved, result.target, result.source]),
              15000,
            );
          } catch (error) {
            console.error('Blockspace: data folder migration failed', error);
            new Notice(t("data_folder_migration_failed_0_0377cfd9", [error && error.message ? error.message : error]), 15000);
          } finally {
            button.setDisabled(false);
          }
        }));
    new Setting(containerEl)
      .setName(t("markdown_export_folder_6c66d223"))
      .setDesc(t("where_exported_markdown_page_files_are_saved_f65e1c39"))
      .addText((text) => text.setValue(this.plugin.settings.exportFolder).onChange(async (value) => {
        this.plugin.settings.exportFolder = value.trim() || DEFAULT_SETTINGS.exportFolder;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("attachment_folder_d77c5bbe"))
      .setDesc(t("images_video_audio_and_files_pasted_dropped_or_u_382831c0"))
      .addText((text) => text.setValue(this.plugin.settings.attachmentFolder || DEFAULT_SETTINGS.attachmentFolder).onChange(async (value) => {
        this.plugin.settings.attachmentFolder = value.trim() || DEFAULT_SETTINGS.attachmentFolder;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("automatically_generate_native_markdown_f42b319c"))
      .setDesc(t("sync_corresponding_obsidian_native_markdown_when_a04cc0ab"))
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.nativeMarkdownSyncEnabled).onChange(async (value) => {
        this.plugin.settings.nativeMarkdownSyncEnabled = value;
        await this.plugin.saveSettings();
        if (value) {
          await this.plugin.ensureStore();
          const count = await this.plugin.store.syncNativeMarkdown();
          new Notice(t("generated_0_native_markdown_pages_2dd9b2b9", [count]));
        }
      }));
    new Setting(containerEl)
      .setName(t("native_markdown_folder_c34c165c"))
      .setDesc(t("vault_relative_folder_for_generated_files_files__1e8f113c"))
      .addText((text) => text.setValue(this.plugin.settings.nativeMarkdownFolder || DEFAULT_SETTINGS.nativeMarkdownFolder).onChange(async (value) => {
        this.plugin.settings.nativeMarkdownFolder = value.trim() || DEFAULT_SETTINGS.nativeMarkdownFolder;
        await this.plugin.saveSettings();
        if (this.plugin.settings.nativeMarkdownSyncEnabled) {
          await this.plugin.ensureStore();
          await this.plugin.store.syncNativeMarkdown();
        }
      }));
    new Setting(containerEl)
      .setName(t("open_blockspace_directly_from_the_file_explorer_336ee7a7"))
      .setDesc(t("clicking_a_generated_file_in_blockspace_notes_or_b9df6182"))
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.openGeneratedMarkdownInBlockspace !== false)
        .onChange(async (value) => {
          this.plugin.settings.openGeneratedMarkdownInBlockspace = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName(t("markdown_block_id_output_9f32f6e6"))
      .setDesc(t("control_bs_anchors_in_manual_exports_native_mark_63f71da7"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(MARKDOWN_BLOCK_ID_MODES)) dropdown.addOption(value, label);
        dropdown.setValue(MARKDOWN_BLOCK_ID_MODES[this.plugin.settings.markdownBlockIdMode]
          ? this.plugin.settings.markdownBlockIdMode
          : DEFAULT_SETTINGS.markdownBlockIdMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings.markdownBlockIdMode = MARKDOWN_BLOCK_ID_MODES[value]
            ? value
            : DEFAULT_SETTINGS.markdownBlockIdMode;
          await this.plugin.saveSettings();
          await this.plugin.ensureStore();
          if (this.plugin.settings.markdownBridgeEnabled) await this.plugin.store.syncMarkdownBridge();
          if (this.plugin.settings.nativeMarkdownSyncEnabled) await this.plugin.store.syncNativeMarkdown();
        });
      });
    new Setting(containerEl)
      .setName(t("sync_lossless_markdown_bridge_ed49c4a1"))
      .setDesc(t("lossless_round_trip_format_for_existing_workflow_3bc79d47"))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.markdownBridgeEnabled !== false).onChange(async (value) => {
        this.plugin.settings.markdownBridgeEnabled = value;
        await this.plugin.saveSettings();
        if (value) {
          const count = await this.plugin.store.syncMarkdownBridge();
          new Notice(t("synced_0_blockspace_pages_to_obsidian_9efa6b05", [count]));
        }
      }));
    new Setting(containerEl)
      .setName(t("wikilink_bridge_folder_ab86933e"))
      .setDesc(t("folder_for_lossless_bridge_files_obsidian_can_in_a167850a"))
      .addText((text) => text.setValue(this.plugin.settings.markdownBridgeFolder || DEFAULT_SETTINGS.markdownBridgeFolder).onChange(async (value) => {
        this.plugin.settings.markdownBridgeFolder = value.trim() || DEFAULT_SETTINGS.markdownBridgeFolder;
        await this.plugin.saveSettings();
        if (this.plugin.settings.markdownBridgeEnabled) await this.plugin.store.syncMarkdownBridge();
      }));
    new Setting(containerEl)
      .setName(t("obsidian_native_markdown_rendering_70efe342"))
      .setDesc(t("control_whether_full_page_reading_mode_and_unfoc_89ac6760"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(MARKDOWN_RENDER_MODES)) dropdown.addOption(value, label);
        dropdown.setValue(MARKDOWN_RENDER_MODES[this.plugin.settings.markdownRenderMode] ? this.plugin.settings.markdownRenderMode : 'reading-only');
        dropdown.onChange(async (value) => {
          this.plugin.settings.markdownRenderMode = MARKDOWN_RENDER_MODES[value] ? value : 'reading-only';
          await this.plugin.saveSettings();
          for (const view of this.plugin.views) {
            if (this.plugin.settings.markdownRenderMode === 'off') view.readingMode = false;
            view.render();
          }
        });
      });
    new Setting(containerEl)
      .setName(t("autosave_delay_1ce5e73c"))
      .setDesc(t("milliseconds_to_wait_after_typing_stops_before_w_0bb88bc9"))
      .addText((text) => text.setValue(String(this.plugin.settings.autosaveDelay)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.autosaveDelay = Number.isFinite(parsed) ? Math.max(100, Math.min(3000, parsed)) : 350;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("undo_history_limit_25cf1e2a"))
      .setDesc(t("transactions_kept_in_memory_for_each_open_page_f_75ddb3be"))
      .addText((text) => text.setValue(String(this.plugin.settings.historyLimit)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.historyLimit = Number.isFinite(parsed) ? Math.max(20, Math.min(1000, parsed)) : 150;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("recovery_snapshots_per_page_494572c9"))
      .setDesc(t("keep_old_page_snapshots_before_saving_new_revisi_27c8183f"))
      .addText((text) => text.setValue(String(this.plugin.settings.snapshotLimit)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.snapshotLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 12;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("minimum_recovery_snapshot_interval_a4fc4052"))
      .setDesc(t("minimum_minutes_between_full_snapshots_during_co_f9983bbf"))
      .addText((text) => text.setValue(String(this.plugin.settings.snapshotIntervalMinutes)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.snapshotIntervalMinutes = Number.isFinite(parsed) ? Math.max(1, Math.min(240, parsed)) : 5;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("expand_page_properties_by_default_cd725c20"))
      .setDesc(t("when_off_status_priority_and_tags_appear_in_a_co_88059ce3"))
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showProperties !== false).onChange(async (value) => {
        this.plugin.settings.showProperties = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("interface_style_8d3b8dce"))
      .setDesc(t("notion_style_uses_more_whitespace_siyuan_style_i_e1ecc390"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(VISUAL_STYLES)) dropdown.addOption(value, label);
        dropdown.setValue(VISUAL_STYLES[this.plugin.settings.visualStyle] ? this.plugin.settings.visualStyle : 'notion');
        dropdown.onChange(async (value) => {
          this.plugin.settings.visualStyle = VISUAL_STYLES[value] ? value : 'notion';
          await this.plugin.saveSettings();
          for (const view of this.plugin.views) view.render();
        });
      });
    new Setting(containerEl)
      .setName(t("page_density_7eec6aab"))
      .setDesc(t("compact_suits_continuous_writing_standard_balanc_7e929ca5"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(PAGE_DENSITIES)) dropdown.addOption(value, label);
        dropdown.setValue(PAGE_DENSITIES[this.plugin.settings.pageDensity] ? this.plugin.settings.pageDensity : 'standard');
        dropdown.onChange(async (value) => {
          this.plugin.settings.pageDensity = PAGE_DENSITIES[value] ? value : 'standard';
          await this.plugin.saveSettings();
          for (const view of this.plugin.views) view.render();
        });
      });
    new Setting(containerEl)
      .setName(t("content_width_e92272f9"))
      .setDesc(t("body_content_width_from_580_to_1100_pixels_96a14c42"))
      .addText((text) => text.setValue(String(this.plugin.settings.contentWidth)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.contentWidth = Number.isFinite(parsed) ? Math.max(580, Math.min(1100, parsed)) : 760;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName(t("body_font_34f1a695"))
      .setDesc(t("choose_the_font_family_for_blockspace_content_fo_3793fcbf"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(FONT_FAMILIES)) dropdown.addOption(value, label);
        dropdown.setValue(FONT_FAMILIES[this.plugin.settings.fontFamily] ? this.plugin.settings.fontFamily : 'theme');
        dropdown.onChange(async (value) => {
          this.plugin.settings.fontFamily = FONT_FAMILIES[value] ? value : 'theme';
          await this.plugin.saveSettings();
          for (const view of this.plugin.views) view.render();
        });
      });
    new Setting(containerEl)
      .setName(t("body_font_size_7be4c74a"))
      .setDesc(t("base_font_size_for_blockspace_content_from_12_to_33221234"))
      .addSlider((slider) => slider
        .setLimits(12, 24, 1)
        .setDynamicTooltip()
        .setValue(Math.max(12, Math.min(24, Number(this.plugin.settings.fontSize) || 16)))
        .onChange(async (value) => {
          this.plugin.settings.fontSize = value;
          await this.plugin.saveSettings();
          for (const view of this.plugin.views) view.render();
        }));
    new Setting(containerEl)
      .setName(t("body_line_height_088ef4fd"))
      .setDesc(t("body_line_height_from_1_2_to_2_2_a0cf6cc0"))
      .addSlider((slider) => slider
        .setLimits(1.2, 2.2, 0.05)
        .setDynamicTooltip()
        .setValue(Math.max(1.2, Math.min(2.2, Number(this.plugin.settings.lineHeight) || 1.65)))
        .onChange(async (value) => {
          this.plugin.settings.lineHeight = Number(value.toFixed(2));
          await this.plugin.saveSettings();
          for (const view of this.plugin.views) view.render();
        }));
    new Setting(containerEl)
      .setName(t("compact_interface_density_16eb85dc"))
      .setDesc(t("reduce_navigation_property_and_board_spacing_for_f5576e16"))
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.compactMode).onChange(async (value) => {
        this.plugin.settings.compactMode = value;
        await this.plugin.saveSettings();
        for (const view of this.plugin.views) view.render();
      }));
    new Setting(containerEl)
      .setName(t("show_page_inspector_when_opening_workspace_8112d3ce"))
      .setDesc(t("show_properties_outline_statistics_and_storage_s_c753be90"))
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.showInspectorOnOpen).onChange(async (value) => {
        this.plugin.settings.showInspectorOnOpen = value;
        await this.plugin.saveSettings();
      }));
  }
}

class BlockspaceWorkspacePlugin extends Plugin {
  async onload() {
    const storedSettings = (await this.loadData()) || {};
    const visualVersion = Number(storedSettings.visualRefinementVersion) || 0;
    const interactionVersion = Number(storedSettings.interactionRefinementVersion) || 0;
    const needsVisualMigration = visualVersion < 5;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storedSettings);
    this.settings.language = setLanguage(this.settings.language);
    initializeLocalizedDefinitions();
    this.settings.markdownRenderMode = MARKDOWN_RENDER_MODES[this.settings.markdownRenderMode] ? this.settings.markdownRenderMode : 'reading-only';
    if (needsVisualMigration) {
      // 0.12.2 finalizes the editorial rhythm and removes duplicated chrome.
      // Keep metadata collapsed by default so content remains the visual focus.
      this.settings.showProperties = false;
      this.settings.visualStyle = VISUAL_STYLES[this.settings.visualStyle] ? this.settings.visualStyle : 'notion';
      this.settings.pageDensity = PAGE_DENSITIES[this.settings.pageDensity] ? this.settings.pageDensity : 'standard';
      this.settings.visualRefinementVersion = 5;
      await this.saveData(this.settings);
    }
    if (interactionVersion < 1) {
      this.settings.interactionRefinementVersion = 1;
      await this.saveData(this.settings);
    }
    this.store = new BlockspaceStore(this.app, this.settings);
    this.storePromise = null;
    this.views = new Set();
    this.lastActiveView = null;
    this.inspectorViews = new Set();
    this.contextRefreshTimer = null;
    this.folderLocks = new Map();
    this.generatedMarkdownRedirects = new Set();
    this.generatedMarkdownNativeBypass = new Map();
    this.saveStatusBarItem = typeof this.addStatusBarItem === 'function' ? this.addStatusBarItem() : null;
    if (this.saveStatusBarItem) {
      this.saveStatusBarItem.classList.add('bs-statusbar-save-state', 'is-saved');
      this.saveStatusBarItem.setAttribute('aria-live', 'polite');
      this.saveStatusBarItem.hidden = true;
    }

    this.registerView(VIEW_TYPE, (leaf) => new BlockspaceView(leaf, this));
    this.registerView(INSPECTOR_VIEW_TYPE, (leaf) => new BlockspaceInspectorView(leaf, this));
    this.addRibbonIcon('layout-dashboard', t("open_blockspace_d81584c7"), () => void this.activateView());
    this.addCommand({ id: 'open-workspace', name: t("open_workspace_209ab794"), callback: () => void this.activateView() });
    this.addCommand({ id: 'new-page', name: t("new_page_64451e31"), callback: async () => {
      const view = await this.activateView();
      if (view) await view.createPage();
    } });
    this.addCommand({ id: 'quick-switcher', name: t("quick_switch_pages_and_actions_a60cb71d"), callback: async () => {
      const view = await this.activateView();
      if (view) view.openQuickSwitcher();
    } });
    this.addCommand({ id: 'find-in-page', name: t("find_text_in_current_page_cf55deac"), callback: async () => {
      const view = await this.activateView();
      if (view) view.openFindReplace(false);
    } });
    this.addCommand({ id: 'replace-in-page', name: t("find_and_replace_text_in_current_page_7c544e3c"), callback: async () => {
      const view = await this.activateView();
      if (view) view.openFindReplace(true);
    } });
    this.addCommand({ id: 'open-inspector', name: t("open_page_inspector_50425586"), callback: () => void this.activateInspector() });
    this.addCommand({ id: 'toggle-focus-mode', name: t("toggle_focus_mode_fcf200c4"), checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view) return false;
      if (!checking) view.toggleFocusMode();
      return true;
    } });
    this.addCommand({ id: 'toggle-native-markdown-reading', name: t("toggle_obsidian_native_markdown_reading_mode_d78a92fb"), checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view || view.activeTab !== 'document' || this.settings.markdownRenderMode === 'off') return false;
      if (!checking) view.toggleReadingMode();
      return true;
    } });
    this.addCommand({ id: 'import-active-markdown', name: t("import_active_markdown_file_5a82a6e9"), callback: () => {
      void this.importActiveMarkdown().catch((error) => this.reportOpenFailure(t("import_markdown_fb4d8201"), error));
    } });
    this.addCommand({ id: 'export-current-page', name: t("export_current_page_as_lossless_markdown_6bffbf62"), callback: async () => {
      const view = this.getActiveView();
      if (view) await view.exportCurrentPage('md');
      else new Notice(t("open_the_blockspace_workspace_first_d1b223e3"));
    } });
    this.addCommand({ id: 'export-current-page-word', name: t("export_current_page_as_word_c93cdc63"), callback: async () => {
      const view = this.getActiveView();
      if (view) await view.exportCurrentPage('docx');
      else new Notice(t("open_the_blockspace_workspace_first_d1b223e3"));
    } });
    this.addCommand({ id: 'export-current-page-pdf', name: t("export_current_page_as_pdf_d112efda"), callback: async () => {
      const view = this.getActiveView();
      if (view) await view.exportCurrentPage('pdf');
      else new Notice(t("open_the_blockspace_workspace_first_d1b223e3"));
    } });
    this.addCommand({ id: 'undo', name: t("undo_current_page_action_2d2f607f"), checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view || view.history.undo.length === 0) return false;
      if (!checking) view.undo();
      return true;
    } });
    this.addCommand({ id: 'redo', name: t("redo_current_page_action_419b4476"), checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view || view.history.redo.length === 0) return false;
      if (!checking) view.redo();
      return true;
    } });
    this.addCommand({ id: 'diagnostics', name: t("open_diagnostics_and_recovery_7acf8511"), callback: async () => {
      try {
        await this.ensureStore();
      } catch (error) {
        this.reportOpenFailure(t("open_diagnostics_and_recovery_7acf8511"), error);
        return;
      }
      new BlockspaceDiagnosticsModal(this.app, this).open();
    } });
    this.addSettingTab(new BlockspaceSettingTab(this.app, this));
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
      if (leaf && leaf.view instanceof BlockspaceView) this.lastActiveView = leaf.view;
      this.notifyContextChanged();
    }));
    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!this.settings.openGeneratedMarkdownInBlockspace || !(file instanceof TFile)) return;
      // Obsidian emits file-open before MarkdownView has fully completed its
      // own state transition. Capture the originating leaf now, then wait a
      // couple of frames so our custom view is not overwritten by the tail of
      // openFile().
      const leaf = this.app.workspace.activeLeaf || null;
      setTimeout(() => {
        void this.handleGeneratedMarkdownFileOpen(file, leaf).catch((error) => {
          console.error('Blockspace: unable to open generated Markdown projection', error);
        });
      }, 48);
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      const generatedPageId = this.pageIdForGeneratedMarkdownFile(file);
      menu.addItem((item) => item
        .setTitle(t("open_in_blockspace_73813a07"))
        .setIcon('blocks')
        .onClick(() => void this.openMarkdownFileInBlockspace(file, leaf)));
      if (generatedPageId) {
        menu.addItem((item) => item
          .setTitle(t("open_as_native_markdown_405193d1"))
          .setIcon('file-text')
          .onClick(() => void this.openGeneratedMarkdownAsNative(file, leaf)));
      }
    }));
    if (this.app.vault && typeof this.app.vault.on === 'function') {
      this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
        if (!(file instanceof TFile) || !oldPath || file.path === oldPath) return;
        void this.updateAdvancedResourcePaths(oldPath, file.path).catch((error) => {
          console.error('Blockspace: unable to follow renamed attachment', error);
        });
      }));
    }

    this.app.workspace.onLayoutReady(() => void this.ensureStore());
  }

  async onunload() {
    if (this.contextRefreshTimer) clearTimeout(this.contextRefreshTimer);
    this.contextRefreshTimer = null;
    for (const view of Array.from(this.views)) await view.flushSave();
    await this.store.flush();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(INSPECTOR_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.language = setLanguage(this.settings.language);
    initializeLocalizedDefinitions();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  ensureStore() {
    if (!this.storePromise) {
      this.storePromise = this.store.init().catch((error) => {
        this.storePromise = null;
        throw error;
      });
    }
    return this.storePromise;
  }

  async updateAdvancedResourcePaths(oldPath, nextPath) {
    await this.ensureStore();
    const source = normalizePath(oldPath);
    const destination = normalizePath(nextPath);
    const openPageIds = new Set();
    for (const view of this.views) {
      if (!view.page) continue;
      openPageIds.add(view.page.id);
      const followsSource = normalizePath(view.page.sourcePath || '') === source;
      const affectedResource = view.page.blocks.some((block) => (
        Core.ADVANCED_BLOCK_TYPES.has(block.type)
        && block.data
        && block.data.sourceType === 'vault'
        && normalizePath(block.data.path || '') === source
      ));
      if (!followsSource && !affectedResource) continue;
      view.performMutation(followsSource ? t("follow_source_note_rename_721f6e23") : t("follow_attachment_rename_af6acf5e"), (page) => {
        if (normalizePath(page.sourcePath || '') === source) page.sourcePath = destination;
        for (const block of page.blocks) {
          if (!Core.ADVANCED_BLOCK_TYPES.has(block.type) || !block.data || block.data.sourceType !== 'vault') continue;
          if (normalizePath(block.data.path || '') === source) block.data.path = destination;
        }
      });
    }
    for (const meta of this.store.workspace.pages) {
      if (openPageIds.has(meta.id)) continue;
      const page = await this.store.loadPage(meta.id);
      if (!page) continue;
      let changed = normalizePath(page.sourcePath || '') === source;
      if (changed) page.sourcePath = destination;
      for (const block of page.blocks) {
        if (!Core.ADVANCED_BLOCK_TYPES.has(block.type) || !block.data || block.data.sourceType !== 'vault') continue;
        if (normalizePath(block.data.path || '') !== source) continue;
        block.data.path = destination;
        changed = true;
      }
      if (!changed) continue;
      page.revision += 1;
      page.updatedAt = Core.nowIso();
      await this.store.savePage(page, { expectedRevision: page.revision - 1 });
    }
  }

  pageForSourceMarkdownFile(file) {
    if (!(file instanceof TFile) || file.extension !== 'md' || !this.store) return null;
    const path = normalizePath(file.path);
    for (const page of this.store.referencePages.values()) {
      if (normalizePath(page.sourcePath || '') === path) return page;
    }
    return null;
  }

  async openMarkdownFileInBlockspace(file, leaf = null) {
    if (!(file instanceof TFile) || file.extension !== 'md') return false;
    await this.ensureStore();
    if (this.pageIdForGeneratedMarkdownFile(file)) {
      return this.openGeneratedMarkdownInBlockspace(file, leaf);
    }
    const existing = this.pageForSourceMarkdownFile(file);
    if (existing) {
      const view = await this.activateView();
      if (!view) return false;
      await view.openPage(existing.id);
      return true;
    }
    return Boolean(await this.importMarkdownFile(file));
  }

  pageIdForGeneratedMarkdownPath(path) {
    if (!this.store || !this.store.workspace) return null;
    const target = normalizePath(String(path || ''));
    if (!target) return null;
    const maps = [
      this.store.workspace.nativeMarkdownPaths,
      this.store.workspace.bridgePaths,
    ];
    for (const paths of maps) {
      if (!paths || typeof paths !== 'object') continue;
      for (const [pageId, candidate] of Object.entries(paths)) {
        if (normalizePath(String(candidate || '')) === target) return pageId;
      }
    }
    return null;
  }

  pageIdForGeneratedMarkdownFile(file) {
    if (!(file instanceof TFile)) return null;
    const mapped = this.pageIdForGeneratedMarkdownPath(file.path);
    if (mapped) return mapped;
    const frontmatter = this.app.metadataCache
      && typeof this.app.metadataCache.getFileCache === 'function'
      ? this.app.metadataCache.getFileCache(file)?.frontmatter
      : null;
    const projection = String(frontmatter && frontmatter['blockspace-projection'] || '').trim();
    if (projection !== 'native' && projection !== 'bridge') return null;
    const pageId = String(frontmatter && frontmatter['blockspace-id'] || '').trim();
    if (!pageId || !this.store || !this.store.workspace) return null;
    return this.store.workspace.pages.some((page) => page.id === pageId) ? pageId : null;
  }

  generatedMarkdownPathForPage(pageId) {
    if (!pageId || !this.store || !this.store.workspace) return '';
    const nativePath = this.store.workspace.nativeMarkdownPaths
      && this.store.workspace.nativeMarkdownPaths[pageId];
    const bridgePath = this.store.workspace.bridgePaths
      && this.store.workspace.bridgePaths[pageId];
    return normalizePath(String(nativePath || bridgePath || ''));
  }

  findLeafForGeneratedMarkdownFile(file) {
    if (!(file instanceof TFile)) return null;
    const path = normalizePath(file.path);
    const matches = (leaf) => leaf
      && leaf.view
      && leaf.view.file instanceof TFile
      && normalizePath(leaf.view.file.path) === path;
    const activeLeaf = this.app.workspace.activeLeaf;
    if (matches(activeLeaf)) return activeLeaf;
    const markdownLeaves = typeof this.app.workspace.getLeavesOfType === 'function'
      ? this.app.workspace.getLeavesOfType('markdown')
      : [];
    return markdownLeaves.find(matches) || null;
  }

  async openGeneratedMarkdownInBlockspace(file, leaf = null) {
    if (!(file instanceof TFile)) return false;
    await this.ensureStore();
    const pageId = this.pageIdForGeneratedMarkdownFile(file);
    if (!pageId) return false;
    const path = normalizePath(file.path);
    if (this.generatedMarkdownRedirects.has(path)) return false;
    const targetLeaf = leaf
      || this.findLeafForGeneratedMarkdownFile(file)
      || (typeof this.app.workspace.getLeaf === 'function' ? this.app.workspace.getLeaf('tab') : null);
    if (!targetLeaf) return false;
    this.generatedMarkdownRedirects.add(path);
    try {
      if (targetLeaf.view instanceof BlockspaceView) {
        targetLeaf.view.entryPath = path;
        await targetLeaf.view.openPage(pageId);
      } else {
        await targetLeaf.setViewState({
          type: VIEW_TYPE,
          state: {
            pageId,
            activeTab: 'document',
            readingMode: false,
            entryPath: path,
          },
          active: true,
        });
      }
      if (typeof this.app.workspace.revealLeaf === 'function') await this.app.workspace.revealLeaf(targetLeaf);
      return true;
    } finally {
      this.generatedMarkdownRedirects.delete(path);
    }
  }

  async handleGeneratedMarkdownFileOpen(file, leaf = null) {
    if (!(file instanceof TFile)) return false;
    await this.ensureStore();
    const path = normalizePath(file.path);
    const bypassUntil = Number(this.generatedMarkdownNativeBypass.get(path)) || 0;
    if (bypassUntil > Date.now()) {
      this.generatedMarkdownNativeBypass.delete(path);
      return false;
    }
    this.generatedMarkdownNativeBypass.delete(path);
    if (!this.pageIdForGeneratedMarkdownFile(file)) return false;
    const targetLeaf = leaf || this.findLeafForGeneratedMarkdownFile(file);
    if (!targetLeaf) return false;
    const leafFile = targetLeaf.view && targetLeaf.view.file;
    if (leafFile instanceof TFile && normalizePath(leafFile.path) !== path) return false;
    return this.openGeneratedMarkdownInBlockspace(file, targetLeaf);
  }

  async openGeneratedMarkdownAsNative(file, leaf = null) {
    if (!(file instanceof TFile)) return false;
    const path = normalizePath(file.path);
    const targetLeaf = leaf
      || (typeof this.app.workspace.getLeaf === 'function' ? this.app.workspace.getLeaf('tab') : null);
    if (!targetLeaf || typeof targetLeaf.openFile !== 'function') return false;
    const expiresAt = Date.now() + 2000;
    this.generatedMarkdownNativeBypass.set(path, expiresAt);
    setTimeout(() => {
      if (this.generatedMarkdownNativeBypass.get(path) === expiresAt) {
        this.generatedMarkdownNativeBypass.delete(path);
      }
    }, 2100);
    await targetLeaf.openFile(file);
    return true;
  }

  async openPageAsNativeMarkdown(pageId, leaf = null) {
    await this.ensureStore();
    const path = this.generatedMarkdownPathForPage(pageId);
    if (!path) {
      new Notice(t("enable_automatically_generate_native_markdown_or_c36a67ae"));
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(t("no_corresponding_generated_markdown_file_found_47de7af1"));
      return false;
    }
    return this.openGeneratedMarkdownAsNative(file, leaf);
  }

  getActiveView() {
    const active = this.app.workspace.getActiveViewOfType(BlockspaceView);
    if (active) {
      this.lastActiveView = active;
      return active;
    }
    if (this.lastActiveView && this.views.has(this.lastActiveView)) return this.lastActiveView;
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    const fallback = leaves.length && leaves[0].view instanceof BlockspaceView ? leaves[0].view : null;
    if (fallback) this.lastActiveView = fallback;
    return fallback;
  }

  getFocusedBlockspaceView() {
    const active = this.app.workspace.getActiveViewOfType(BlockspaceView);
    if (active instanceof BlockspaceView) return active;
    const inspector = this.app.workspace.getActiveViewOfType(BlockspaceInspectorView);
    if (inspector instanceof BlockspaceInspectorView && this.lastActiveView && this.views.has(this.lastActiveView)) {
      return this.lastActiveView;
    }
    return null;
  }

  updateSaveStatusBar() {
    const item = this.saveStatusBarItem;
    if (!item) return;
    const view = this.getFocusedBlockspaceView();
    if (!view || !view.page) {
      item.hidden = true;
      item.textContent = '';
      return;
    }
    const state = SAVE_STATE_LABELS[view.saveState] ? view.saveState : 'saved';
    const label = SAVE_STATE_LABELS[state];
    item.hidden = false;
    item.textContent = `Blockspace · ${label}`;
    item.setAttribute('aria-label', t("blockspace_save_status_0_40bd8eb9", [label]));
    item.setAttribute('title', state === 'error' || state === 'conflict'
      ? t("0_open_blockspace_diagnostics_and_recovery_07e3e669", [label])
      : label);
    for (const candidate of Object.keys(SAVE_STATE_LABELS)) {
      item.classList.toggle(`is-${candidate}`, candidate === state);
    }
  }

  notifyContextChanged() {
    if (this.contextRefreshTimer) return;
    this.contextRefreshTimer = setTimeout(() => {
      this.contextRefreshTimer = null;
      this.updateSaveStatusBar();
      for (const inspector of Array.from(this.inspectorViews || [])) {
        try { inspector.render(); } catch (error) { console.error('Blockspace: inspector refresh failed', error); }
      }
    }, 48);
  }

  // Opening the workspace is reached from a ribbon icon and several commands,
  // all of which discard the returned promise. Without this the whole startup
  // path — folder creation, index rebuild, every page read — fails as an
  // unhandled rejection and the user simply sees nothing happen. That is much
  // more likely on mobile, where the file layer is slower and more fragile.
  reportOpenFailure(action, error) {
    console.error(t("blockspace_0_failed_75427abd", [action]), error);
    const detail = error && error.message ? error.message : String(error);
    new Notice(t("blockspace_0_failed_1_cb0821de", [action, detail]), 10000);
  }

  async activateInspector() {
    try {
      await this.ensureStore();
      let leaf = this.app.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)[0];
      if (!leaf) {
        if (typeof this.app.workspace.getRightLeaf === 'function') leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) leaf = this.app.workspace.getLeaf('tab');
        if (!leaf) throw new Error(t("no_pane_available_in_the_current_layout_d01e51e1"));
        await leaf.setViewState({ type: INSPECTOR_VIEW_TYPE, active: true });
      }
      await this.app.workspace.revealLeaf(leaf);
      this.notifyContextChanged();
      return leaf.view instanceof BlockspaceInspectorView ? leaf.view : null;
    } catch (error) {
      this.reportOpenFailure(t("open_page_inspector_50425586"), error);
      return null;
    }
  }

  async activateView() {
    try {
      await this.ensureStore();
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) {
        leaf = this.app.workspace.getLeaf(true);
        if (!leaf) throw new Error(t("no_tab_available_in_the_current_layout_feac5529"));
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
      await this.app.workspace.revealLeaf(leaf);
      const view = leaf.view instanceof BlockspaceView ? leaf.view : null;
      if (view && this.settings.showInspectorOnOpen) void this.activateInspector();
      return view;
    } catch (error) {
      this.reportOpenFailure(t("open_workspace_209ab794"), error);
      return null;
    }
  }

  async ensureFolder(path) {
    await ensureAdapterFolder(this.app.vault, path, this.folderLocks);
  }

  async nextExportPath(page, extension) {
    const folder = normalizePath(this.settings.exportFolder || DEFAULT_SETTINGS.exportFolder);
    await this.ensureFolder(folder);
    const base = Core.safeFileName(Core.normalizePage(page).title);
    let path = normalizePath(`${folder}/${base}.${extension}`);
    let counter = 2;
    while (await this.app.vault.adapter.exists(path)) {
      path = normalizePath(`${folder}/${base} ${counter}.${extension}`);
      counter += 1;
    }
    return path;
  }

  markdownExportSidecarPath(page, reference = null) {
    const normalized = Core.normalizePage(page);
    const id = Core.safeFileName(reference && reference.id ? reference.id : normalized.id);
    const revision = Number.isInteger(reference && reference.revision) ? reference.revision : normalized.revision;
    return normalizePath(`${this.store.folder}/exports/${id}-r${Math.max(0, revision)}.json`);
  }

  async writeMarkdownExportSidecar(page, markdownPath) {
    const path = this.markdownExportSidecarPath(page);
    await this.store.atomicWrite(path, Exporters.losslessSidecarForPage(page, markdownPath));
    return path;
  }

  async losslessPageFromMarkdown(text, frontmatter = {}) {
    const legacy = Exporters.extractLosslessPage(text);
    if (legacy) return legacy;
    const parsed = Exporters.markdownLosslessReference(text);
    const id = String(frontmatter['blockspace-id'] || (parsed && parsed.id) || '').trim();
    const revision = Number(frontmatter['blockspace-revision'] ?? (parsed && parsed.revision));
    if (!id || !Number.isInteger(revision) || revision < 0) return null;
    const path = this.markdownExportSidecarPath({ id, revision }, { id, revision });
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      const page = Exporters.extractLosslessSidecar(await this.app.vault.adapter.read(path));
      if (!page || page.id !== id || page.revision !== revision) return null;
      return page;
    } catch (error) {
      console.warn('Blockspace: unable to read Markdown export sidecar', path, error);
      return null;
    }
  }

  async writeBinaryExport(path, bytes) {
    const buffer = exactArrayBuffer(bytes);
    if (typeof this.app.vault.createBinary === 'function') return this.app.vault.createBinary(path, buffer);
    if (this.app.vault.adapter && typeof this.app.vault.adapter.writeBinary === 'function') {
      await this.app.vault.adapter.writeBinary(path, buffer);
      return this.app.vault.getAbstractFileByPath(path);
    }
    throw new Error(t("this_obsidian_version_cannot_write_binary_export_5189b19a"));
  }

  async collectExportAssets(page) {
    const normalized = Core.normalizePage(page);
    const assets = new Map();
    const ownerWindow = this.getActiveView()?.contentEl?.ownerDocument?.defaultView
      || this.app.workspace.containerEl?.ownerDocument?.defaultView
      || (typeof window !== 'undefined' ? window : null);
    for (const block of normalized.blocks) {
      if (block.type !== 'image') continue;
      const data = Core.normalizeBlockData('image', block.data);
      let bytes = null;
      let mime = exportImageMime(data.path || data.url);
      try {
        if (data.sourceType === 'vault' && data.path) {
          const file = this.app.vault.getAbstractFileByPath(normalizePath(data.path));
          if (file instanceof TFile && typeof this.app.vault.readBinary === 'function') {
            bytes = new Uint8Array(await this.app.vault.readBinary(file));
          } else if (this.app.vault.adapter && typeof this.app.vault.adapter.readBinary === 'function') {
            bytes = new Uint8Array(await this.app.vault.adapter.readBinary(normalizePath(data.path)));
          }
          mime = exportImageMime(data.path, file && file.type);
        } else if (data.sourceType === 'remote' && /^https?:\/\//i.test(data.url || '')) {
          const response = await requestUrl({ url: data.url, method: 'GET' });
          bytes = new Uint8Array(response.arrayBuffer);
          const responseMime = response.headers && (response.headers['content-type'] || response.headers['Content-Type']);
          mime = exportImageMime(data.url, responseMime);
        }
        if (!bytes || !bytes.length) continue;
        const dimensions = await exportedImageDimensions(bytes, mime, ownerWindow);
        assets.set(block.id, { bytes, mime, ...dimensions, name: data.path || data.url || `${block.id}.${fileExtension(data.path || data.url)}` });
      } catch (error) {
        console.warn('Blockspace: export could not embed image', data.path || data.url, error);
      }
    }
    return assets;
  }

  async openExportedFile(file, format) {
    if (!(file instanceof TFile) || !['md', 'pdf'].includes(format)) return;
    const leaf = this.app.workspace.getLeaf('tab');
    if (leaf && typeof leaf.openFile === 'function') await leaf.openFile(file);
  }

  async exportPage(page, format = 'md') {
    await this.ensureStore();
    const normalized = Core.normalizePage(page);
    const targetFormat = ['md', 'docx', 'pdf'].includes(format) ? format : 'md';
    const label = targetFormat === 'docx' ? 'Word' : targetFormat.toUpperCase();
    const workingNotice = targetFormat === 'md' ? null : new Notice(t("generating_0_0a499094", [label]), 0);
    try {
      let file = null;
      let sidecarPath = null;
      const path = await this.nextExportPath(normalized, targetFormat);
      if (targetFormat === 'md') {
        sidecarPath = await this.writeMarkdownExportSidecar(normalized, path);
        file = await this.app.vault.create(path, Exporters.losslessMarkdownForPage(normalized));
      } else {
        const assets = await this.collectExportAssets(normalized);
        let bytes;
        if (targetFormat === 'docx') {
          bytes = Exporters.docxForPage(normalized, { assets });
        } else {
          const ownerDocument = this.getActiveView()?.contentEl?.ownerDocument
            || this.app.workspace.containerEl?.ownerDocument
            || (typeof document !== 'undefined' ? document : null);
          const pages = await Exporters.renderPageToJpegPages(normalized, ownerDocument, { assets, scale: 2, quality: 0.93 });
          bytes = Exporters.pdfFromJpegPages(pages, normalized);
        }
        file = await this.writeBinaryExport(path, bytes);
      }
      if (workingNotice && typeof workingNotice.hide === 'function') workingNotice.hide();
      new Notice(targetFormat === 'md'
        ? t("exported_lossless_markdown_0_body_contains_no_re_84dbf0a3", [path])
        : t("exported_lossless_0_1_f16d1d9e", [label, path]));
      await this.openExportedFile(file, targetFormat);
      return { path, file, format: targetFormat, sidecarPath };
    } catch (error) {
      if (workingNotice && typeof workingNotice.hide === 'function') workingNotice.hide();
      console.error(`Blockspace: ${targetFormat} export failed`, error);
      new Notice(t("0_export_failed_1_9260d094", [label, error && error.message ? error.message : t("unknown_error_13a46616")]));
      return null;
    }
  }

  async importActiveMarkdown() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile && activeFile.extension === 'md') {
      await this.importMarkdownFile(activeFile);
      return;
    }
    new MarkdownImportModal(this.app, this).open();
  }

  async importMarkdownFile(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') {
      new Notice(t("select_a_markdown_file_ad70ca49"));
      return null;
    }
    const text = await this.app.vault.cachedRead(file);
    await this.ensureStore();
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const losslessPage = await this.losslessPageFromMarkdown(text, frontmatter);
    if (losslessPage) {
      const existing = this.store.workspace.pages.some((page) => page.id === losslessPage.id);
      const imported = existing
        ? await this.store.restorePageAsCopy(losslessPage, t("lossless_import_63ebb735"))
        : await this.store.savePage(losslessPage, { expectedRevision: null, createSnapshot: false });
      const view = await this.activateView();
      if (view) await view.openPage(imported.id);
      new Notice(t("losslessly_imported_0_d0b8ccd7", [file.basename]));
      return imported;
    }
    const markdownBody = Exporters.stripLosslessPayload(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const loose = Core.extractLooseMarkdownMetadata(markdownBody);
    const metadata = importedPageMetadata(frontmatter, loose.metadata);
    await this.ensureStore();
    const page = await this.store.createPage(metadata.title || file.basename, {
      icon: '📝',
      cover: 'none',
      status: Core.PAGE_STATUSES.includes(metadata.status) ? metadata.status : 'todo',
    });
    page.sourcePath = file.path;
    page.properties.status = Core.PAGE_STATUSES.includes(metadata.status) ? metadata.status : 'todo';
    page.properties.priority = Core.PAGE_PRIORITIES.includes(metadata.priority) ? metadata.priority : 'medium';
    page.properties.tags = metadata.tags;
    page.properties.source = metadata.source;
    page.properties.author = metadata.author;
    page.properties.publishedAt = metadata.publishedAt;
    page.properties.description = metadata.description;
    page.properties.custom = metadata.custom;
    page.blocks = Core.markdownToBlocks(loose.body);
    page.rootBlockIds = page.blocks.filter((block) => !block.parentId).map((block) => block.id);
    page.updatedAt = Core.nowIso();
    page.revision += 1;
    await this.store.savePage(page, { expectedRevision: page.revision - 1 });
    const view = await this.activateView();
    if (view) await view.openPage(page.id);
    new Notice(t("imported_0_a8bb9a7a", [file.basename]));
    return page;
  }
}

function initializeLocalizedDefinitions() {
SLASH_COMMANDS = [
  { type: 'paragraph', label: t("text_dd818618"), description: t("plain_text_block_87bd1ba9"), icon: 'pilcrow', category: t("basic_89e5e14c"), aliases: ['text', 'p', '正文'] },
  { type: 'heading-1', label: t("heading_1_a75d25cd"), description: t("page_heading_c69654f8"), icon: 'heading-1', category: t("basic_89e5e14c"), aliases: ['h1', '标题1'] },
  { type: 'heading-2', label: t("heading_2_d69947f3"), description: t("section_heading_b2604398"), icon: 'heading-2', category: t("basic_89e5e14c"), aliases: ['h2', '标题2'] },
  { type: 'heading-3', label: t("heading_3_7d96cb13"), description: t("subsection_heading_16b283f7"), icon: 'heading-3', category: t("basic_89e5e14c"), aliases: ['h3', '标题3'] },
  { type: 'todo', label: t("to_do_5e415ae2"), description: t("checkable_task_37462bd6"), icon: 'square-check-big', category: t("lists_aedd6814"), aliases: ['todo', 'task', '待办'] },
  { type: 'bulleted-list', label: t("bulleted_list_9ee5773e"), description: t("list_with_bullet_points_8eefc2d9"), icon: 'list', category: t("lists_aedd6814"), aliases: ['ul', 'bullet', '列表'] },
  { type: 'numbered-list', label: t("numbered_list_5d0bb271"), description: t("list_with_numbers_9f63b8f1"), icon: 'list-ordered', category: t("lists_aedd6814"), aliases: ['ol', 'number', '编号'] },
  { type: 'quote', label: t("quote_e0ec651f"), description: t("quoted_content_dad60ee6"), icon: 'quote', category: t("emphasis_d5ae79ed"), aliases: ['quote', '引用'] },
  { type: 'callout', label: t("callout_acc61f75"), description: t("highlighted_container_that_can_hold_child_blocks_122f581e"), icon: 'message-square-text', category: t("emphasis_d5ae79ed"), aliases: ['callout', 'note', '提示'] },
  { type: 'toggle', label: t("toggle_b649ae5a"), description: t("expand_or_collapse_nested_content_9a8da16f"), icon: 'chevron-right-square', category: t("advanced_d6e61888"), aliases: ['toggle', '折叠', '展开'] },
  { type: 'table-of-contents', label: t("table_of_contents_52daa71e"), description: t("generate_a_table_of_contents_from_page_headings_3a34a4e8"), icon: 'list-tree', category: t("advanced_d6e61888"), aliases: ['toc', '目录', '大纲'] },
  { type: 'image', label: t("image_d24c10d3"), description: t("paste_upload_or_reference_an_image_in_your_vault_481f6e0a"), icon: 'image', category: t("media_fa33e100"), aliases: ['image', 'img', '图片', '照片'] },
  { type: 'video', label: t("video_c20f7618"), description: t("upload_or_reference_a_video_file_68e91107"), icon: 'video', category: t("media_fa33e100"), aliases: ['video', '视频'] },
  { type: 'audio', label: t("audio_296c632e"), description: t("upload_or_reference_an_audio_file_8f9b5fbc"), icon: 'audio-lines', category: t("media_fa33e100"), aliases: ['audio', '音频'] },
  { type: 'attachment', label: t("attachment_c7225dbf"), description: t("upload_a_pdf_or_another_vault_file_59493600"), icon: 'paperclip', category: t("media_fa33e100"), aliases: ['file', 'attachment', '附件', '文件', 'pdf'] },
  { type: 'bookmark', label: t("bookmark_94b8975c"), description: t("create_an_editable_link_preview_card_725a0203"), icon: 'bookmark', category: t("media_fa33e100"), aliases: ['bookmark', 'url', 'link', '书签', '链接卡片'] },
  { type: 'table', label: t("table_22d9e7c5"), description: t("edit_a_table_and_export_it_as_a_native_markdown__df3fee6e"), icon: 'table-2', category: t("advanced_d6e61888"), aliases: ['table', '表格'] },
  { type: 'columns', label: t("columns_e02531a7"), description: t("edit_in_two_or_three_columns_that_stack_in_narro_ffdcb7d6"), icon: 'columns-3', category: t("advanced_d6e61888"), aliases: ['columns', 'column', '分栏', '双栏', '三栏'] },
  { type: 'markdown', label: t("native_markdown_5e2ab2e7"), description: t("display_raw_markdown_with_the_obsidian_renderer_b491eff5"), icon: 'file-code-2', category: t("advanced_d6e61888"), aliases: ['markdown', 'md', '原生 markdown'] },
  { type: 'code', label: t("code_block_ddb4a628"), description: t("monospaced_code_5071da45"), icon: 'code-2', category: t("advanced_d6e61888"), aliases: ['code', '代码'] },
  { type: 'divider', label: t("divider_c64dd5eb"), description: t("separate_content_ccd83f62"), icon: 'minus', category: t("advanced_d6e61888"), aliases: ['divider', 'hr', '分割线'] },
];
STATUS_LABELS = { todo: t("not_started_5b715411"), doing: t("in_progress_dc9591e5"), done: t("done_f28461bb") };
PRIORITY_LABELS = { low: t("low_aa9e366f"), medium: t("medium_a567bdaa"), high: t("high_b1c27820") };
STYLE_COLOR_LABELS = {
  default: t("default_844b8cc8"), gray: t("gray_051e67d9"), brown: t("brown_d4969ce9"), orange: t("orange_aa1e899d"), yellow: t("yellow_d451c07d"),
  green: t("green_30c83dc2"), blue: t("blue_67035e6b"), purple: t("purple_2ed9c6fa"), pink: t("pink_dbd379b3"), red: t("red_789f61db"),
};
FONT_FAMILIES = {
  theme: t("follow_obsidian_d6707bdd"), sans: t("sans_serif_26ae4ba2"), serif: t("serif_8059e059"), monospace: t("monospace_117fef96"),
};
VISUAL_STYLES = {
  notion: t("notion_style_a28c0b0d"),
  siyuan: t("siyuan_style_cb31b1ca"),
  native: t("obsidian_native_01a34603"),
};
PAGE_DENSITIES = {
  compact: t("compact_5d63d587"),
  standard: t("standard_6bea77ac"),
  immersive: t("immersive_566c0536"),
};
CUSTOM_PROPERTY_TYPE_DETAILS = {
  text: { label: t("text_dd818618"), icon: 'text' },
  list: { label: t("lists_aedd6814"), icon: 'list' },
  number: { label: t("number_c16ec927"), icon: 'hash' },
  checkbox: { label: t("checkbox_48b50759"), icon: 'square-check' },
  date: { label: t("date_70d0c1b3"), icon: 'calendar-days' },
  datetime: { label: t("date_and_time_917e4afc"), icon: 'calendar-clock' },
};
MARKDOWN_RENDER_MODES = {
  'reading-only': t("native_reading_mode_only_c1a933b4"),
  'native-blocks': t("render_unfocused_blocks_natively_a0e79509"),
  off: t("disable_native_markdown_rendering_0b3ecfb7"),
};
MARKDOWN_BLOCK_ID_MODES = {
  none: t("none_reading_first_762ef3da"),
  referenced: t("referenced_blocks_only_recommended_7b61d210"),
  all: t("all_addressable_blocks_compatibility_82557a0b"),
};
SAVE_STATE_LABELS = {
  saved: t("saved_1bd91a7d"),
  dirty: t("waiting_to_save_58b2e85e"),
  saving: t("saving_6bdb4435"),
  conflict: t("save_conflict_1c9adce4"),
  error: t("save_failed_6309a3bb"),
};
ADVANCED_BLOCK_LABELS = {
  image: { label: t("image_d24c10d3"), icon: 'image' },
  video: { label: t("video_c20f7618"), icon: 'video' },
  audio: { label: t("audio_296c632e"), icon: 'audio-lines' },
  attachment: { label: t("attachment_c7225dbf"), icon: 'paperclip' },
  bookmark: { label: t("bookmark_94b8975c"), icon: 'bookmark' },
  table: { label: t("table_22d9e7c5"), icon: 'table-2' },
};
  const searchTerms = {
  "paragraph": [
    "文本",
    "普通文本块",
    "Text",
    "Plain text block"
  ],
  "heading-1": [
    "一级标题",
    "页面大标题",
    "Heading 1",
    "Page heading"
  ],
  "heading-2": [
    "二级标题",
    "章节标题",
    "Heading 2",
    "Section heading"
  ],
  "heading-3": [
    "三级标题",
    "小节标题",
    "Heading 3",
    "Subsection heading"
  ],
  "todo": [
    "待办事项",
    "可勾选任务",
    "To-do",
    "Checkable task"
  ],
  "bulleted-list": [
    "无序列表",
    "项目符号列表",
    "Bulleted list",
    "List with bullet points"
  ],
  "numbered-list": [
    "有序列表",
    "编号列表",
    "Numbered list",
    "List with numbers"
  ],
  "quote": [
    "引用",
    "引用内容",
    "Quote",
    "Quoted content"
  ],
  "callout": [
    "提示块",
    "可容纳子块的强调容器",
    "Callout",
    "Highlighted container that can hold child blocks"
  ],
  "toggle": [
    "折叠块",
    "可展开和收起子内容",
    "Toggle",
    "Expand or collapse nested content"
  ],
  "table-of-contents": [
    "目录",
    "根据标题块自动生成页面目录",
    "Table of contents",
    "Generate a table of contents from page headings"
  ],
  "image": [
    "图片",
    "粘贴、上传或引用 Vault 图片",
    "Image",
    "Paste, upload, or reference an image in your vault"
  ],
  "video": [
    "视频",
    "上传或引用视频文件",
    "Video",
    "Upload or reference a video file"
  ],
  "audio": [
    "音频",
    "上传或引用音频文件",
    "Audio",
    "Upload or reference an audio file"
  ],
  "attachment": [
    "附件",
    "上传 PDF 或其他 Vault 文件",
    "Attachment",
    "Upload a PDF or another vault file"
  ],
  "bookmark": [
    "书签",
    "创建可编辑的链接预览卡片",
    "Bookmark",
    "Create an editable link preview card"
  ],
  "table": [
    "表格",
    "可直接编辑并导出为原生 Markdown 表格",
    "Table",
    "Edit a table and export it as a native Markdown table"
  ],
  "columns": [
    "分栏",
    "两栏或三栏并排编辑，窄窗口自动上下排列",
    "Columns",
    "Edit in two or three columns that stack in narrow windows"
  ],
  "markdown": [
    "原生 Markdown",
    "使用 Obsidian 渲染器显示原始 Markdown",
    "Native Markdown",
    "Display raw Markdown with the Obsidian renderer"
  ],
  "code": [
    "代码块",
    "等宽代码内容",
    "Code block",
    "Monospaced code"
  ],
  "divider": [
    "分隔线",
    "分隔内容",
    "Divider",
    "Separate content"
  ]
};
  for (const command of SLASH_COMMANDS) command.searchTerms = searchTerms[command.type];
}
initializeLocalizedDefinitions();

module.exports = BlockspaceWorkspacePlugin;
