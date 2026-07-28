/* Blockspace Workspace 0.17.1 */
'use strict';

const DATA_VERSION = 8;
const PAGE_STATUSES = ['todo', 'doing', 'done'];
const PAGE_PRIORITIES = ['low', 'medium', 'high'];
const CUSTOM_PROPERTY_TYPES = ['text', 'list', 'number', 'checkbox', 'date', 'datetime'];
const RESERVED_PAGE_PROPERTY_NAMES = new Set([
  'title', 'status', 'priority', 'tags', 'tag', 'source', 'url', 'original', 'link',
  'author', 'authors', 'creator', 'published', 'publishedat', 'published_at', 'date',
  'created', 'createdat', 'created_at', 'description', 'summary', 'excerpt', 'aliases',
  'cssclasses', 'cssclass', 'position', 'blockspace-id', 'blockspace-revision',
  'blockspace-projection',
]);
const BLOCK_TYPES = new Set([
  'paragraph', 'heading-1', 'heading-2', 'heading-3', 'todo',
  'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle',
  'code', 'divider', 'table-of-contents', 'markdown',
  'image', 'video', 'audio', 'attachment', 'bookmark', 'table',
  'columns', 'column'
]);
const INLINE_MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textColor', 'highlight']);
const SEMANTIC_COLORS = new Set(['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red']);
const BLOCK_ALIGNS = new Set(['left', 'center', 'right']);
const CONTAINER_BLOCK_TYPES = new Set(['todo', 'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle', 'columns', 'column']);
const INLINE_TEXT_BLOCK_TYPES = new Set([
  'paragraph', 'heading-1', 'heading-2', 'heading-3', 'todo',
  'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle',
]);
const ADVANCED_BLOCK_TYPES = new Set(['image', 'video', 'audio', 'attachment', 'bookmark', 'table']);
const TABLE_ALIGNS = new Set(['left', 'center', 'right']);
const MEDIA_SOURCE_TYPES = new Set(['vault', 'remote']);
const COLUMN_RATIO_PRESETS = Object.freeze({
  2: Object.freeze(['1:1', '1:2', '2:1']),
  3: Object.freeze(['1:1:1', '1:2:1', '2:1:1', '1:1:2']),
});

function randomId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 50);
}

function normalizePropertyText(value, limit = 2000) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ').slice(0, limit);
  if (value && typeof value === 'object') return '';
  return String(value ?? '').trim().slice(0, limit);
}

function normalizeCustomPropertyValue(type, value) {
  if (type === 'list') {
    const items = Array.isArray(value)
      ? value
      : String(value ?? '').split(/[,，]/);
    return Array.from(new Set(items
      .map((item) => String(item).trim())
      .filter(Boolean)))
      .slice(0, 100);
  }
  if (type === 'number') {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (type === 'checkbox') {
    if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    return value === true || value === 1;
  }
  if (type === 'date' || type === 'datetime') return normalizePropertyText(value, 100);
  return normalizePropertyText(value, 4000);
}

function isValidCustomPropertyName(value, existingNames = []) {
  const name = String(value ?? '').trim().slice(0, 100);
  if (!name || RESERVED_PAGE_PROPERTY_NAMES.has(name.toLocaleLowerCase())) return false;
  const key = name.toLocaleLowerCase();
  return !(Array.isArray(existingNames) ? existingNames : [])
    .some((candidate) => String(candidate ?? '').trim().toLocaleLowerCase() === key);
}

function normalizeCustomProperties(value) {
  const entries = Array.isArray(value) ? value : [];
  const result = [];
  const names = [];
  const ids = new Set();
  for (const entry of entries.slice(0, 100)) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const name = String(source.name ?? '').trim().slice(0, 100);
    if (!isValidCustomPropertyName(name, names)) continue;
    const type = CUSTOM_PROPERTY_TYPES.includes(source.type) ? source.type : 'text';
    let id = typeof source.id === 'string' && source.id.trim()
      ? source.id.trim().slice(0, 200)
      : randomId('property');
    while (ids.has(id)) id = randomId('property');
    ids.add(id);
    names.push(name);
    result.push({
      id,
      name,
      type,
      value: normalizeCustomPropertyValue(type, source.value),
    });
  }
  return result;
}

function normalizeIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 100000);
}


function normalizeTocConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const minLevel = Math.max(1, Math.min(3, Math.floor(Number(source.minLevel) || 1)));
  const maxLevel = Math.max(minLevel, Math.min(3, Math.floor(Number(source.maxLevel) || 3)));
  return {
    minLevel,
    maxLevel,
    showNumbers: Boolean(source.showNumbers),
    collapsible: source.collapsible !== false,
  };
}

function normalizeColumnsConfig(value, requestedCount = null) {
  const source = value && typeof value === 'object' ? value : {};
  const count = Number(requestedCount) === 3 || (requestedCount == null && Number(source.count) === 3) ? 3 : 2;
  const presets = COLUMN_RATIO_PRESETS[count];
  const ratio = presets.includes(source.ratio) ? source.ratio : presets[0];
  return { count, ratio };
}

function isHeadingBlock(blockOrType) {
  const type = typeof blockOrType === 'string' ? blockOrType : blockOrType && blockOrType.type;
  return type === 'heading-1' || type === 'heading-2' || type === 'heading-3';
}

function getHeadingLevel(blockOrType) {
  const type = typeof blockOrType === 'string' ? blockOrType : blockOrType && blockOrType.type;
  return isHeadingBlock(type) ? Number(type.slice(-1)) : 0;
}

function normalizeBlockAppearance(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    textColor: SEMANTIC_COLORS.has(source.textColor) ? source.textColor : 'default',
    background: SEMANTIC_COLORS.has(source.background) ? source.background : 'default',
    align: BLOCK_ALIGNS.has(source.align) ? source.align : 'left',
  };
}

function normalizeAdvancedSource(value) {
  const source = value && typeof value === 'object' ? value : {};
  const path = String(source.path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 4096);
  const url = String(source.url || '').trim().slice(0, 8192);
  const sourceType = MEDIA_SOURCE_TYPES.has(source.sourceType)
    ? source.sourceType
    : path ? 'vault' : 'remote';
  return { sourceType, path, url };
}

function normalizeTableData(value) {
  const source = value && typeof value === 'object' ? value : {};
  const rawColumns = Array.isArray(source.columns) ? source.columns : [];
  const columns = rawColumns.slice(0, 100).map((entry, index) => {
    const column = entry && typeof entry === 'object' ? entry : {};
    return {
      id: typeof column.id === 'string' && column.id ? column.id : randomId('column'),
      name: String(column.name ?? column.text ?? `列 ${index + 1}`).slice(0, 500),
      align: TABLE_ALIGNS.has(column.align) ? column.align : 'left',
      width: Math.max(0, Math.min(1600, Math.floor(Number(column.width) || 0))),
    };
  });
  if (!columns.length) {
    columns.push(
      { id: randomId('column'), name: '列 1', align: 'left', width: 0 },
      { id: randomId('column'), name: '列 2', align: 'left', width: 0 },
    );
  }
  const columnIds = new Set(columns.map((column) => column.id));
  const rows = (Array.isArray(source.rows) ? source.rows : []).slice(0, 5000).map((entry) => {
    const row = entry && typeof entry === 'object' ? entry : {};
    const rawCells = row.cells && typeof row.cells === 'object' ? row.cells : {};
    const cells = {};
    for (const column of columns) {
      cells[column.id] = String(rawCells[column.id] ?? '').slice(0, 100000);
    }
    return {
      id: typeof row.id === 'string' && row.id ? row.id : randomId('row'),
      cells,
    };
  });
  // Ignore stale cell keys when a column was removed.
  for (const row of rows) {
    for (const key of Object.keys(row.cells)) if (!columnIds.has(key)) delete row.cells[key];
  }
  if (!rows.length) {
    const cells = {};
    for (const column of columns) cells[column.id] = '';
    rows.push({ id: randomId('row'), cells });
  }
  return { header: source.header !== false, columns, rows };
}

function normalizeBlockData(type, value) {
  if (!ADVANCED_BLOCK_TYPES.has(type)) return null;
  const source = value && typeof value === 'object' ? value : {};
  if (type === 'table') return normalizeTableData(source);
  if (type === 'bookmark') {
    return {
      url: String(source.url || '').trim().slice(0, 8192),
      title: String(source.title || '').trim().slice(0, 1000),
      description: String(source.description || '').trim().slice(0, 4000),
      siteName: String(source.siteName || '').trim().slice(0, 500),
      icon: String(source.icon || '').trim().slice(0, 8192),
      image: String(source.image || '').trim().slice(0, 8192),
      fetchedAt: typeof source.fetchedAt === 'string' ? source.fetchedAt : '',
    };
  }
  const common = normalizeAdvancedSource(source);
  if (type === 'image') {
    const width = Math.max(0, Math.min(4000, Math.floor(Number(source.width) || 0)));
    const widthMode = ['auto', 'fixed', 'full'].includes(source.widthMode)
      ? source.widthMode
      : width ? 'fixed' : 'auto';
    const captionAlign = ['left', 'center', 'right'].includes(source.captionAlign)
      ? source.captionAlign
      : 'center';
    const captionSize = ['small', 'normal'].includes(source.captionSize)
      ? source.captionSize
      : 'small';
    const captionStyle = ['regular', 'italic', 'bold'].includes(source.captionStyle)
      ? source.captionStyle
      : 'regular';
    const wrapMode = ['top-bottom', 'square-left', 'square-right'].includes(source.wrapMode)
      ? source.wrapMode
      : 'top-bottom';
    const wrapTextAlign = ['top', 'center', 'bottom'].includes(source.wrapTextAlign)
      ? source.wrapTextAlign
      : 'top';
    const requestedWrapGap = Math.round(Number(source.wrapGap) || 0);
    const wrapGap = [12, 20, 28, 36].includes(requestedWrapGap)
      ? requestedWrapGap
      : 20;
    return {
      ...common,
      alt: String(source.alt || '').slice(0, 2000),
      caption: String(source.caption || '').slice(0, 2000),
      captionAlign,
      captionSize,
      captionStyle,
      width,
      widthMode,
      height: Math.max(0, Math.min(4000, Math.floor(Number(source.height) || 0))),
      link: String(source.link || '').trim().slice(0, 8192),
      wrapMode,
      wrapTextAlign,
      wrapGap,
    };
  }
  if (type === 'video' || type === 'audio') {
    return {
      ...common,
      title: String(source.title || '').trim().slice(0, 1000),
      poster: type === 'video' ? String(source.poster || '').trim().slice(0, 8192) : '',
      controls: source.controls !== false,
      loop: Boolean(source.loop),
      muted: Boolean(source.muted),
      autoplay: false,
    };
  }
  return {
    ...common,
    name: String(source.name || '').trim().slice(0, 1000),
    mime: String(source.mime || '').trim().slice(0, 500),
    size: Math.max(0, Math.floor(Number(source.size) || 0)),
    embed: Boolean(source.embed),
    page: Math.max(0, Math.floor(Number(source.page) || 0)),
    height: Math.max(0, Math.min(4000, Math.floor(Number(source.height) || 0))),
  };
}

function normalizeInlineMark(input, textLength = Number.MAX_SAFE_INTEGER) {
  const source = input && typeof input === 'object' ? input : {};
  if (!INLINE_MARK_TYPES.has(source.type)) return null;
  const limit = Math.max(0, Number(textLength) || 0);
  const from = Math.max(0, Math.min(limit, Math.floor(Number(source.from) || 0)));
  const to = Math.max(from, Math.min(limit, Math.floor(Number(source.to) || 0)));
  if (to <= from) return null;
  const mark = { type: source.type, from, to };
  if (source.type === 'link') {
    const href = String(source.value || '').trim().slice(0, 2048);
    if (!href) return null;
    mark.value = href;
  } else if (source.type === 'textColor' || source.type === 'highlight') {
    if (!SEMANTIC_COLORS.has(source.value) || source.value === 'default') return null;
    mark.value = source.value;
  }
  return mark;
}

function markKey(mark) {
  return `${mark.type}:${mark.value || ''}`;
}

function normalizeInlineMarks(input, textLength = Number.MAX_SAFE_INTEGER) {
  const raw = Array.isArray(input) ? input : [];
  const groups = new Map();
  for (const mark of raw.map((entry) => normalizeInlineMark(entry, textLength)).filter(Boolean)) {
    const key = markKey(mark);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(mark);
  }
  const merged = [];
  for (const marks of groups.values()) {
    marks.sort((a, b) => a.from - b.from || a.to - b.to);
    let previous = null;
    for (const mark of marks) {
      if (previous && mark.from <= previous.to) previous.to = Math.max(previous.to, mark.to);
      else {
        previous = { ...mark };
        merged.push(previous);
      }
    }
  }
  return merged.sort((a, b) => a.from - b.from || a.to - b.to || markKey(a).localeCompare(markKey(b)));
}

function subtractRange(mark, from, to) {
  if (mark.to <= from || mark.from >= to) return [{ ...mark }];
  const pieces = [];
  if (mark.from < from) pieces.push({ ...mark, to: from });
  if (mark.to > to) pieces.push({ ...mark, from: to });
  return pieces;
}

function applyInlineMark(block, from, to, type, value) {
  const normalized = normalizeBlock(block);
  const start = Math.max(0, Math.min(normalized.text.length, Math.min(Number(from) || 0, Number(to) || 0)));
  const end = Math.max(start, Math.min(normalized.text.length, Math.max(Number(from) || 0, Number(to) || 0)));
  if (end <= start || !INLINE_MARK_TYPES.has(type)) return normalized;
  const sameType = normalized.marks.filter((mark) => mark.type === type);
  const other = normalized.marks.filter((mark) => mark.type !== type);
  if (type === 'textColor' || type === 'highlight' || type === 'link') {
    const cleaned = sameType.flatMap((mark) => subtractRange(mark, start, end));
    let candidate = null;
    if (type === 'link') candidate = normalizeInlineMark({ type, from: start, to: end, value }, normalized.text.length);
    else if (SEMANTIC_COLORS.has(value) && value !== 'default') candidate = normalizeInlineMark({ type, from: start, to: end, value }, normalized.text.length);
    normalized.marks = normalizeInlineMarks([...other, ...cleaned, ...(candidate ? [candidate] : [])], normalized.text.length);
    return normalized;
  }
  const fullyCovered = sameType.some((mark) => mark.from <= start && mark.to >= end);
  normalized.marks = fullyCovered
    ? normalizeInlineMarks([...other, ...sameType.flatMap((mark) => subtractRange(mark, start, end))], normalized.text.length)
    : normalizeInlineMarks([...normalized.marks, { type, from: start, to: end }], normalized.text.length);
  return normalized;
}


function setInlineMark(block, from, to, type, value, enabled = true) {
  const normalized = normalizeBlock(block);
  const start = Math.max(0, Math.min(normalized.text.length, Math.min(Number(from) || 0, Number(to) || 0)));
  const end = Math.max(start, Math.min(normalized.text.length, Math.max(Number(from) || 0, Number(to) || 0)));
  if (end <= start || !INLINE_MARK_TYPES.has(type)) return normalized;
  const sameType = normalized.marks.filter((mark) => mark.type === type);
  const other = normalized.marks.filter((mark) => mark.type !== type);
  const cleaned = sameType.flatMap((mark) => subtractRange(mark, start, end));
  let candidate = null;
  if (enabled) {
    if (type === 'link') candidate = normalizeInlineMark({ type, from: start, to: end, value }, normalized.text.length);
    else if (type === 'textColor' || type === 'highlight') {
      if (SEMANTIC_COLORS.has(value) && value !== 'default') candidate = normalizeInlineMark({ type, from: start, to: end, value }, normalized.text.length);
    } else candidate = normalizeInlineMark({ type, from: start, to: end }, normalized.text.length);
  }
  normalized.marks = normalizeInlineMarks([...other, ...cleaned, ...(candidate ? [candidate] : [])], normalized.text.length);
  return normalized;
}

function normalizeTextRanges(page, ranges) {
  if (!page || !Array.isArray(ranges)) return [];
  const order = new Map(flattenBlocks(page, { includeCollapsed: true }).map((block, index) => [block.id, index]));
  return ranges.map((range) => {
    const block = getBlock(page, range && range.blockId);
    if (!block || block.type === 'divider' || block.type === 'table-of-contents') return null;
    const from = Math.max(0, Math.min(block.text.length, Math.min(Number(range.from) || 0, Number(range.to) || 0)));
    const to = Math.max(from, Math.min(block.text.length, Math.max(Number(range.from) || 0, Number(range.to) || 0)));
    if (to <= from) return null;
    return { blockId: block.id, from, to, order: order.get(block.id) ?? Number.MAX_SAFE_INTEGER };
  }).filter(Boolean).sort((a, b) => a.order - b.order || a.from - b.from).map(({ order: _order, ...range }) => range);
}

function inlineMarkRangeState(block, from, to, type, value) {
  const normalized = normalizeBlock(block);
  const start = Math.max(0, Math.min(normalized.text.length, Math.min(Number(from) || 0, Number(to) || 0)));
  const end = Math.max(start, Math.min(normalized.text.length, Math.max(Number(from) || 0, Number(to) || 0)));
  if (end <= start) return 'inactive';
  const relevant = normalized.marks.filter((mark) => mark.type === type && mark.to > start && mark.from < end && (value == null || mark.value === value));
  if (!relevant.length) return 'inactive';
  const covered = [];
  for (const mark of relevant) covered.push([Math.max(start, mark.from), Math.min(end, mark.to)]);
  covered.sort((a, b) => a[0] - b[0]);
  let cursor = start;
  for (const [rangeStart, rangeEnd] of covered) {
    if (rangeStart > cursor) return 'mixed';
    cursor = Math.max(cursor, rangeEnd);
  }
  return cursor >= end ? 'active' : 'mixed';
}

function applyInlineMarkToRanges(page, ranges, type, value) {
  const normalizedRanges = normalizeTextRanges(page, ranges);
  if (!normalizedRanges.length || !INLINE_MARK_TYPES.has(type)) return false;
  const toggleType = !['textColor', 'highlight', 'link'].includes(type);
  const removeAll = toggleType && normalizedRanges.every((range) => inlineMarkRangeState(getBlock(page, range.blockId), range.from, range.to, type) === 'active');
  for (const range of normalizedRanges) {
    const index = page.blocks.findIndex((block) => block.id === range.blockId);
    if (index < 0) continue;
    page.blocks[index] = setInlineMark(page.blocks[index], range.from, range.to, type, value, !removeAll);
  }
  return true;
}

function clearInlineMarksFromRanges(page, ranges) {
  const normalizedRanges = normalizeTextRanges(page, ranges);
  if (!normalizedRanges.length) return false;
  for (const range of normalizedRanges) {
    const index = page.blocks.findIndex((block) => block.id === range.blockId);
    if (index >= 0) page.blocks[index] = clearInlineMarks(page.blocks[index], range.from, range.to);
  }
  return true;
}

function textFromRanges(page, ranges, separator = '\n') {
  return normalizeTextRanges(page, ranges).map((range) => {
    const block = getBlock(page, range.blockId);
    return block ? block.text.slice(range.from, range.to) : '';
  }).join(separator);
}

function clearInlineMarks(block, from, to) {
  const normalized = normalizeBlock(block);
  const start = Math.max(0, Math.min(normalized.text.length, Math.min(Number(from) || 0, Number(to) || 0)));
  const end = Math.max(start, Math.min(normalized.text.length, Math.max(Number(from) || 0, Number(to) || 0)));
  if (end <= start) return normalized;
  normalized.marks = normalizeInlineMarks(normalized.marks.flatMap((mark) => subtractRange(mark, start, end)), normalized.text.length);
  return normalized;
}

function splitInlineMarks(marks, offset, textLength) {
  const split = Math.max(0, Math.min(Number(textLength) || 0, Number(offset) || 0));
  const left = [];
  const right = [];
  for (const mark of normalizeInlineMarks(marks, textLength)) {
    if (mark.from < split) left.push({ ...mark, to: Math.min(mark.to, split) });
    if (mark.to > split) right.push({ ...mark, from: Math.max(mark.from, split) - split, to: mark.to - split });
  }
  return {
    left: normalizeInlineMarks(left, split),
    right: normalizeInlineMarks(right, Math.max(0, textLength - split)),
  };
}

function mergeInlineMarks(firstMarks, secondMarks, firstLength, secondLength) {
  const shifted = normalizeInlineMarks(secondMarks, secondLength).map((mark) => ({ ...mark, from: mark.from + firstLength, to: mark.to + firstLength }));
  return normalizeInlineMarks([...normalizeInlineMarks(firstMarks, firstLength), ...shifted], firstLength + secondLength);
}

function createBlock(type = 'paragraph', text = '', extras = {}) {
  const safeType = BLOCK_TYPES.has(type) ? type : 'paragraph';
  const safeText = String(text ?? '');
  const block = {
    id: typeof extras.id === 'string' && extras.id ? extras.id : randomId('block'),
    type: safeType,
    text: safeText,
    marks: normalizeInlineMarks(extras.marks, safeText.length),
    appearance: normalizeBlockAppearance(extras.appearance),
    checked: Boolean(extras.checked),
    parentId: typeof extras.parentId === 'string' && extras.parentId ? extras.parentId : null,
    children: normalizeIdArray(extras.children),
    collapsed: Boolean(extras.collapsed),
    sectionCollapsed: Boolean(extras.sectionCollapsed),
    toc: normalizeTocConfig(extras.toc),
    // depth is derived from parent/child relationships and retained only for old integrations.
    depth: Math.max(0, Math.min(12, Number(extras.depth) || 0)),
  };
  if (safeType === 'columns') block.columns = normalizeColumnsConfig(extras.columns);
  const data = normalizeBlockData(safeType, extras.data);
  if (data) block.data = data;
  return block;
}

function normalizeBlock(input) {
  const source = input && typeof input === 'object' ? input : {};
  return createBlock(BLOCK_TYPES.has(source.type) ? source.type : 'paragraph', String(source.text ?? ''), {
    id: source.id,
    marks: source.marks,
    appearance: source.appearance,
    checked: source.checked,
    parentId: source.parentId,
    children: source.children,
    collapsed: source.collapsed,
    sectionCollapsed: source.sectionCollapsed,
    toc: source.toc,
    columns: source.columns,
    depth: source.depth,
    data: source.data,
  });
}

function canBlockHaveChildren(blockOrType) {
  const type = typeof blockOrType === 'string' ? blockOrType : blockOrType && blockOrType.type;
  return CONTAINER_BLOCK_TYPES.has(type);
}

function buildTreeFromLegacyDepth(blocks) {
  const roots = [];
  const stack = [];
  const map = new Map(blocks.map((block) => [block.id, block]));
  for (const block of blocks) {
    block.children = [];
    const requestedDepth = Math.max(0, Math.min(12, Number(block.depth) || 0));
    let depth = Math.min(requestedDepth, stack.length);
    while (depth > 0 && !stack[depth - 1]) depth -= 1;
    const parentId = depth > 0 ? stack[depth - 1] : null;
    block.parentId = parentId;
    if (parentId) {
      const parent = map.get(parentId);
      if (parent) parent.children.push(block.id);
      else roots.push(block.id);
    } else roots.push(block.id);
    stack[depth] = block.id;
    stack.length = depth + 1;
  }
  return roots;
}

function normalizeBlockTree(input, rootInput, sourceVersion = 0) {
  const raw = Array.isArray(input) ? input : [];
  const seen = new Set();
  const blocks = raw.map((entry) => {
    let block = normalizeBlock(entry);
    if (Number(sourceVersion) < 6 && block.type === 'markdown') {
      const advanced = parseAdvancedMarkdownBlock(block.text);
      if (advanced) {
        block = createBlock(advanced.type, advanced.text, {
          ...block,
          data: advanced.data,
        });
      }
    }
    if (seen.has(block.id)) block.id = randomId('block');
    seen.add(block.id);
    return block;
  });
  if (!blocks.length) blocks.push(createBlock());
  const map = new Map(blocks.map((block) => [block.id, block]));
  const hasTreeData = Number(sourceVersion) >= 4
    || Array.isArray(rootInput)
    || blocks.some((block) => block.parentId || (Array.isArray(block.children) && block.children.length));

  let roots = [];
  if (!hasTreeData) {
    roots = buildTreeFromLegacyDepth(blocks);
  } else {
    for (const block of blocks) {
      block.children = Array.from(new Set(block.children.filter((id) => id !== block.id && map.has(id))));
      if (!block.parentId || !map.has(block.parentId) || block.parentId === block.id) block.parentId = null;
    }

    // Child order is authoritative when present; parentId fills omissions.
    const claimed = new Map();
    for (const parent of blocks) {
      const nextChildren = [];
      for (const childId of parent.children) {
        if (claimed.has(childId)) continue;
        claimed.set(childId, parent.id);
        nextChildren.push(childId);
      }
      parent.children = nextChildren;
    }
    for (const block of blocks) {
      if (!block.parentId) continue;
      if (claimed.has(block.id)) block.parentId = claimed.get(block.id);
      else {
        const parent = map.get(block.parentId);
        if (parent) {
          parent.children.push(block.id);
          claimed.set(block.id, parent.id);
        } else block.parentId = null;
      }
    }
    for (const [childId, parentId] of claimed.entries()) {
      const child = map.get(childId);
      if (child) child.parentId = parentId;
    }

    const requestedRoots = Array.isArray(rootInput) ? rootInput.filter((id) => map.has(id)) : [];
    roots = Array.from(new Set(requestedRoots.filter((id) => !map.get(id).parentId)));
    for (const block of blocks) if (!block.parentId && !roots.includes(block.id)) roots.push(block.id);
  }

  // Break cycles and recover orphaned blocks without losing content.
  const safeRoots = [];
  const visiting = new Set();
  const visited = new Set();
  const walk = (id, depth) => {
    const block = map.get(id);
    if (!block || visited.has(id)) return;
    if (visiting.has(id)) {
      block.parentId = null;
      if (!safeRoots.includes(id)) safeRoots.push(id);
      return;
    }
    visiting.add(id);
    block.depth = depth;
    const children = [];
    for (const childId of block.children) {
      if (!map.has(childId) || childId === id || visiting.has(childId)) {
        const child = map.get(childId);
        if (child) child.parentId = null;
        if (child && !safeRoots.includes(childId)) safeRoots.push(childId);
        continue;
      }
      children.push(childId);
      walk(childId, depth + 1);
    }
    block.children = children;
    visiting.delete(id);
    visited.add(id);
  };
  for (const rootId of roots) {
    const root = map.get(rootId);
    if (!root) continue;
    root.parentId = null;
    if (!safeRoots.includes(rootId)) safeRoots.push(rootId);
    walk(rootId, 0);
  }
  for (const block of blocks) {
    if (visited.has(block.id)) continue;
    block.parentId = null;
    if (!safeRoots.includes(block.id)) safeRoots.push(block.id);
    walk(block.id, 0);
  }

  const ordered = [];
  const orderedIds = new Set();
  const orderWalk = (id) => {
    const block = map.get(id);
    if (!block || orderedIds.has(id)) return;
    orderedIds.add(id);
    ordered.push(block);
    for (const childId of block.children) orderWalk(childId);
  };
  for (const rootId of safeRoots) orderWalk(rootId);
  return { blocks: ordered, rootBlockIds: safeRoots };
}

function normalizePage(input) {
  const source = input && typeof input === 'object' ? input : {};
  const timestamp = nowIso();
  const properties = source.properties && typeof source.properties === 'object' ? source.properties : {};
  const tree = normalizeBlockTree(source.blocks, source.rootBlockIds, source.formatVersion || source.version || 0);
  return {
    version: DATA_VERSION,
    formatVersion: DATA_VERSION,
    id: typeof source.id === 'string' && source.id ? source.id : randomId('page'),
    title: typeof source.title === 'string' && source.title.trim() ? source.title.trim() : 'Untitled',
    // An empty icon is a real choice ("no icon"), so it must survive normalization.
    icon: typeof source.icon === 'string' ? source.icon.slice(0, 8) : '📄',
    // Decoration is opt-in: a page never gains a cover it did not ask for.
    cover: ['aurora', 'sunset', 'forest', 'ocean', 'none'].includes(source.cover) ? source.cover : 'none',
    parentId: typeof source.parentId === 'string' && source.parentId ? source.parentId : null,
    sourcePath: typeof source.sourcePath === 'string' && source.sourcePath.trim() ? source.sourcePath.trim() : null,
    properties: {
      status: PAGE_STATUSES.includes(properties.status) ? properties.status : 'todo',
      priority: PAGE_PRIORITIES.includes(properties.priority) ? properties.priority : 'medium',
      tags: normalizeStringArray(properties.tags),
      source: normalizePropertyText(properties.source, 8192),
      author: normalizePropertyText(properties.author, 1000),
      publishedAt: normalizePropertyText(properties.publishedAt, 500),
      description: normalizePropertyText(properties.description, 4000),
      custom: normalizeCustomProperties(properties.custom),
    },
    blocks: tree.blocks,
    rootBlockIds: tree.rootBlockIds,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : timestamp,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : timestamp,
    revision: Math.max(1, Number(source.revision) || 1),
  };
}

function createDefaultPage(title = '欢迎使用 Blockspace') {
  const timestamp = nowIso();
  const heading = createBlock('heading-1', '独立的块编辑工作台');
  const paragraph = createBlock('paragraph', '这里的内容保存为结构化块数据，而不是 Markdown 文件。');
  const callout = createBlock('callout', '输入 / 可以切换块类型；拖动左侧手柄可以调整顺序。');
  const todo = createBlock('todo', '创建你的第一个 Blockspace 页面');
  return normalizePage({
    version: DATA_VERSION,
    formatVersion: DATA_VERSION,
    id: randomId('page'),
    title,
    icon: '✨',
    cover: 'none',
    parentId: null,
    properties: {
      status: 'doing',
      priority: 'medium',
      tags: ['blockspace'],
      source: '',
      author: '',
      publishedAt: '',
      description: '',
      custom: [],
    },
    blocks: [heading, paragraph, callout, todo],
    rootBlockIds: [heading.id, paragraph.id, callout.id, todo.id],
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  });
}

function clonePage(page) {
  return normalizePage(deepClone(page));
}

function blockMap(page) {
  return new Map((page && Array.isArray(page.blocks) ? page.blocks : []).map((block) => [block.id, block]));
}

function getBlock(page, blockId) {
  return page && Array.isArray(page.blocks) ? page.blocks.find((block) => block.id === blockId) || null : null;
}

function getSiblingIds(page, parentId) {
  if (!page) return [];
  if (!parentId) return Array.isArray(page.rootBlockIds) ? page.rootBlockIds : [];
  const parent = getBlock(page, parentId);
  return parent ? parent.children : [];
}

function flattenBlockEntries(page, options = {}) {
  const source = page && Array.isArray(page.blocks) && Array.isArray(page.rootBlockIds) ? page : normalizePage(page);
  const map = blockMap(source);
  const entries = [];
  const includeCollapsed = options.includeCollapsed === true;
  const seen = new Set();

  const walkSiblings = (ids, depth) => {
    let hiddenSectionLevel = 0;
    for (const id of ids) {
      const block = map.get(id);
      if (!block || seen.has(id)) continue;
      const headingLevel = getHeadingLevel(block);
      if (!includeCollapsed && hiddenSectionLevel) {
        if (headingLevel && headingLevel <= hiddenSectionLevel) hiddenSectionLevel = 0;
        else continue;
      }
      seen.add(id);
      block.depth = depth;
      entries.push({ block, depth, parentId: block.parentId });
      const hideOwnChildren = !includeCollapsed && (block.collapsed || (headingLevel && block.sectionCollapsed));
      if (!hideOwnChildren) walkSiblings(block.children, depth + 1);
      if (!includeCollapsed && headingLevel && block.sectionCollapsed) hiddenSectionLevel = headingLevel;
    }
  };

  walkSiblings(source.rootBlockIds, 0);
  return entries;
}

function flattenBlocks(page, options = {}) {
  return flattenBlockEntries(page, options).map((entry) => entry.block);
}

function deriveOutline(page, options = {}) {
  const source = page && Array.isArray(page.blocks) ? page : normalizePage(page);
  const minLevel = Math.max(1, Math.min(3, Number(options.minLevel) || 1));
  const maxLevel = Math.max(minLevel, Math.min(3, Number(options.maxLevel) || 3));
  const entries = flattenBlockEntries(source, { includeCollapsed: true });
  const stack = [];
  const counters = [0, 0, 0];
  const result = [];
  for (const entry of entries) {
    const block = entry.block;
    const level = getHeadingLevel(block);
    if (!level || level < minLevel || level > maxLevel || !block.text.trim()) continue;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    counters[level - 1] += 1;
    for (let index = level; index < counters.length; index += 1) counters[index] = 0;
    const numberPath = counters.slice(0, level).filter((value) => value > 0).join('.');
    const ancestors = getAncestorIds(source, block.id);
    result.push({
      id: block.id,
      blockId: block.id,
      level,
      title: block.text.trim(),
      parentHeadingId: stack.length ? stack[stack.length - 1].blockId : null,
      ancestorBlockIds: ancestors,
      hiddenByContainer: ancestors.some((id) => getBlock(source, id)?.collapsed),
      sectionCollapsed: Boolean(block.sectionCollapsed),
      numberPath,
    });
    stack.push({ level, blockId: block.id });
  }
  return result;
}

function getHeadingSectionRootIds(page, headingId) {
  const heading = getBlock(page, headingId);
  const level = getHeadingLevel(heading);
  if (!heading || !level) return [];
  const siblings = getSiblingIds(page, heading.parentId);
  const start = siblings.indexOf(headingId);
  if (start < 0) return [];
  let end = siblings.length;
  for (let index = start + 1; index < siblings.length; index += 1) {
    const candidate = getBlock(page, siblings[index]);
    const candidateLevel = getHeadingLevel(candidate);
    if (candidateLevel && candidateLevel <= level) {
      end = index;
      break;
    }
  }
  return siblings.slice(start, end);
}

function getCollapsedSectionHeadingIds(page, blockId) {
  const result = [];
  for (const block of page && Array.isArray(page.blocks) ? page.blocks : []) {
    if (!isHeadingBlock(block) || !block.sectionCollapsed) continue;
    const roots = getHeadingSectionRootIds(page, block.id).slice(1);
    const contains = roots.some((rootId) => getSubtreeIds(page, rootId).includes(blockId));
    if (contains) result.push(block.id);
  }
  return result;
}

function toggleHeadingSectionCollapsed(page, headingId, value) {
  const heading = getBlock(page, headingId);
  if (!heading || !isHeadingBlock(heading)) return false;
  const section = getHeadingSectionRootIds(page, headingId);
  if (section.length <= 1) return false;
  heading.sectionCollapsed = typeof value === 'boolean' ? value : !heading.sectionCollapsed;
  return true;
}

function moveHeadingSection(page, headingId, direction) {
  const heading = getBlock(page, headingId);
  const level = getHeadingLevel(heading);
  if (!heading || !level || (direction !== -1 && direction !== 1)) return false;
  const siblings = getSiblingIds(page, heading.parentId);
  const section = getHeadingSectionRootIds(page, headingId);
  if (!section.length) return false;
  const start = siblings.indexOf(section[0]);
  const end = start + section.length;

  if (direction < 0) {
    let previousStart = -1;
    for (let index = start - 1; index >= 0; index -= 1) {
      const candidateLevel = getHeadingLevel(getBlock(page, siblings[index]));
      if (!candidateLevel) continue;
      if (candidateLevel < level) break;
      if (candidateLevel === level) {
        previousStart = index;
        break;
      }
    }
    if (previousStart < 0) return false;
    const previous = siblings.slice(previousStart, start);
    siblings.splice(previousStart, section.length + previous.length, ...section, ...previous);
  } else {
    if (end >= siblings.length) return false;
    const nextHeading = getBlock(page, siblings[end]);
    if (getHeadingLevel(nextHeading) !== level) return false;
    let nextEnd = siblings.length;
    for (let index = end + 1; index < siblings.length; index += 1) {
      const candidateLevel = getHeadingLevel(getBlock(page, siblings[index]));
      if (candidateLevel && candidateLevel <= level) {
        nextEnd = index;
        break;
      }
    }
    const next = siblings.slice(end, nextEnd);
    siblings.splice(start, section.length + next.length, ...next, ...section);
  }
  rebuildBlockOrder(page);
  return true;
}

function getBlockDepth(page, blockId) {
  const block = getBlock(page, blockId);
  if (!block) return -1;
  let depth = 0;
  let current = block;
  const visited = new Set([block.id]);
  while (current.parentId) {
    if (visited.has(current.parentId)) return depth;
    visited.add(current.parentId);
    current = getBlock(page, current.parentId);
    if (!current) break;
    depth += 1;
  }
  return depth;
}

function getAncestorIds(page, blockId) {
  const result = [];
  let current = getBlock(page, blockId);
  const seen = new Set();
  while (current && current.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    result.push(current.parentId);
    current = getBlock(page, current.parentId);
  }
  return result;
}

function getSubtreeIds(page, blockId) {
  const map = blockMap(page);
  const result = [];
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id) || !map.has(id)) return;
    seen.add(id);
    result.push(id);
    for (const childId of map.get(id).children) walk(childId);
  };
  walk(blockId);
  return result;
}

function normalizeTopLevelSelection(page, ids) {
  const selected = new Set(Array.isArray(ids) ? ids : []);
  const visibleOrder = flattenBlocks(page, { includeCollapsed: true }).map((block) => block.id);
  return visibleOrder.filter((id) => {
    if (!selected.has(id)) return false;
    return !getAncestorIds(page, id).some((ancestorId) => selected.has(ancestorId));
  });
}

function rebuildBlockOrder(page) {
  const map = blockMap(page);
  const ordered = [];
  const seen = new Set();
  const walk = (id, depth) => {
    const block = map.get(id);
    if (!block || seen.has(id)) return;
    seen.add(id);
    block.depth = depth;
    ordered.push(block);
    for (const childId of block.children) walk(childId, depth + 1);
  };
  for (const rootId of page.rootBlockIds) walk(rootId, 0);
  for (const block of page.blocks) {
    if (!seen.has(block.id)) {
      block.parentId = null;
      page.rootBlockIds.push(block.id);
      walk(block.id, 0);
    }
  }
  page.rootBlockIds = Array.from(new Set(page.rootBlockIds.filter((id) => map.has(id) && !map.get(id).parentId)));
  page.blocks = ordered;
  return page;
}

function detachBlock(page, blockId) {
  const block = getBlock(page, blockId);
  if (!block) return false;
  const siblings = getSiblingIds(page, block.parentId);
  const index = siblings.indexOf(blockId);
  if (index >= 0) siblings.splice(index, 1);
  block.parentId = null;
  return true;
}

function attachBlock(page, blockId, parentId, index) {
  const block = getBlock(page, blockId);
  if (!block) return false;
  if (parentId && !getBlock(page, parentId)) return false;
  if (parentId && getSubtreeIds(page, blockId).includes(parentId)) return false;
  detachBlock(page, blockId);
  block.parentId = parentId || null;
  const siblings = getSiblingIds(page, block.parentId);
  const target = Math.max(0, Math.min(siblings.length, Number.isInteger(index) ? index : siblings.length));
  siblings.splice(target, 0, blockId);
  rebuildBlockOrder(page);
  return true;
}

function ensureUniqueBlockId(page, block) {
  const ids = new Set(page.blocks.map((candidate) => candidate.id));
  if (!block.id || ids.has(block.id)) block.id = randomId('block');
  return block;
}

function insertBlock(pageInput, blockInput, location = {}) {
  const page = pageInput;
  const block = ensureUniqueBlockId(page, normalizeBlock(blockInput));
  block.parentId = null;
  block.children = [];
  page.blocks.push(block);
  attachBlock(page, block.id, location.parentId || null, Number.isInteger(location.index) ? location.index : getSiblingIds(page, location.parentId || null).length);
  return block;
}

function appendRootBlock(page, blockInput = createBlock()) {
  return insertBlock(page, blockInput, { parentId: null, index: page.rootBlockIds.length });
}

function insertBlockAfter(page, anchorId, blockInput = createBlock()) {
  const anchor = getBlock(page, anchorId);
  if (!anchor) return appendRootBlock(page, blockInput);
  const siblings = getSiblingIds(page, anchor.parentId);
  return insertBlock(page, blockInput, { parentId: anchor.parentId, index: siblings.indexOf(anchorId) + 1 });
}

function insertBlocksAfter(page, anchorId, blockInputs) {
  const anchor = getBlock(page, anchorId);
  const parentId = anchor ? anchor.parentId : null;
  const siblings = getSiblingIds(page, parentId);
  let index = anchor ? siblings.indexOf(anchorId) + 1 : siblings.length;
  const inserted = [];
  for (const input of Array.isArray(blockInputs) ? blockInputs : []) {
    const block = insertBlock(page, input, { parentId, index });
    inserted.push(block);
    index += 1;
  }
  return inserted;
}

function createColumnWithParagraph(page, columnsBlock, text = '', marks = []) {
  const column = createBlock('column', '', { parentId: columnsBlock.id });
  const paragraph = createBlock('paragraph', text, { parentId: column.id, marks });
  column.children = [paragraph.id];
  columnsBlock.children.push(column.id);
  page.blocks.push(column, paragraph);
  return { column, paragraph };
}

function setColumnsCount(page, blockId, requestedCount) {
  const columnsBlock = getBlock(page, blockId);
  if (!columnsBlock || columnsBlock.type !== 'columns') return null;
  const config = normalizeColumnsConfig(columnsBlock.columns, requestedCount);
  const directChildren = columnsBlock.children.map((id) => getBlock(page, id)).filter(Boolean);
  let columns = directChildren.filter((child) => child.type === 'column');
  const looseChildren = directChildren.filter((child) => child.type !== 'column');

  if (!columns.length) columns.push(createColumnWithParagraph(page, columnsBlock).column);
  const firstColumn = columns[0];
  for (const child of looseChildren) {
    columnsBlock.children = columnsBlock.children.filter((id) => id !== child.id);
    child.parentId = firstColumn.id;
    firstColumn.children.push(child.id);
  }

  while (columns.length < config.count) {
    columns.push(createColumnWithParagraph(page, columnsBlock).column);
  }
  if (columns.length > config.count) {
    const kept = columns.slice(0, config.count);
    const destination = kept[kept.length - 1];
    const removed = columns.slice(config.count);
    for (const column of removed) {
      for (const childId of column.children) {
        const child = getBlock(page, childId);
        if (child) child.parentId = destination.id;
        destination.children.push(childId);
      }
      column.children = [];
    }
    const removedIds = new Set(removed.map((column) => column.id));
    page.blocks = page.blocks.filter((candidate) => !removedIds.has(candidate.id));
    columns = kept;
  }

  columnsBlock.children = columns.map((column) => column.id);
  for (const column of columns) {
    column.parentId = columnsBlock.id;
    if (!column.children.length) {
      const paragraph = createBlock('paragraph', '', { parentId: column.id });
      column.children.push(paragraph.id);
      page.blocks.push(paragraph);
    }
  }
  columnsBlock.columns = normalizeColumnsConfig(config, config.count);
  rebuildBlockOrder(page);
  return {
    blockId: columnsBlock.id,
    columnIds: columns.map((column) => column.id),
    firstBlockId: columns.length ? columns[0].children[0] || null : null,
    config: columnsBlock.columns,
  };
}

function convertBlockToColumns(page, blockId, requestedCount = 2, options = {}) {
  const target = getBlock(page, blockId);
  if (!target) return null;
  if (target.type === 'columns') return setColumnsCount(page, blockId, requestedCount);

  const preserveText = options.preserveText !== false;
  const originalBlock = normalizeBlock(deepClone(target));
  const originalText = preserveText ? target.text : '';
  const originalMarks = preserveText ? target.marks : [];
  const existingChildren = target.children.slice();
  target.type = 'columns';
  target.text = '';
  target.marks = [];
  target.checked = false;
  target.collapsed = false;
  target.sectionCollapsed = false;
  target.children = [];
  target.columns = normalizeColumnsConfig(options.columns, requestedCount);
  delete target.data;

  const first = createColumnWithParagraph(page, target, originalText, originalMarks);
  if (preserveText && originalBlock.type !== 'paragraph') {
    const preserved = createBlock(originalBlock.type, originalBlock.text, {
      ...originalBlock,
      id: first.paragraph.id,
      parentId: first.column.id,
      children: existingChildren,
    });
    const paragraphIndex = page.blocks.findIndex((candidate) => candidate.id === first.paragraph.id);
    if (paragraphIndex >= 0) page.blocks.splice(paragraphIndex, 1, preserved);
    first.paragraph = preserved;
    for (const childId of existingChildren) {
      const child = getBlock(page, childId);
      if (child) child.parentId = preserved.id;
    }
  } else {
    for (const childId of existingChildren) {
      const child = getBlock(page, childId);
      if (!child) continue;
      child.parentId = first.column.id;
      first.column.children.push(childId);
    }
  }
  while (target.children.length < target.columns.count) createColumnWithParagraph(page, target);
  rebuildBlockOrder(page);
  return {
    blockId: target.id,
    columnIds: target.children.slice(),
    firstBlockId: first.paragraph.id,
    config: target.columns,
  };
}

function setColumnsRatio(page, blockId, ratio) {
  const block = getBlock(page, blockId);
  if (!block || block.type !== 'columns') return false;
  const next = normalizeColumnsConfig({ ...block.columns, ratio });
  if (next.ratio === block.columns.ratio && next.count === block.columns.count) return false;
  block.columns = next;
  return true;
}

function unwrapColumns(page, blockId) {
  const block = getBlock(page, blockId);
  if (!block || block.type !== 'columns') return null;
  const parentId = block.parentId;
  const siblings = getSiblingIds(page, parentId);
  const index = siblings.indexOf(block.id);
  if (index < 0) return null;

  const columnIds = new Set();
  const promoted = [];
  for (const childId of block.children) {
    const child = getBlock(page, childId);
    if (!child) continue;
    if (child.type !== 'column') {
      promoted.push(child.id);
      continue;
    }
    columnIds.add(child.id);
    promoted.push(...child.children);
    child.children = [];
  }
  if (!promoted.length) {
    const paragraph = createBlock('paragraph', '', { parentId });
    page.blocks.push(paragraph);
    promoted.push(paragraph.id);
  }
  siblings.splice(index, 1, ...promoted);
  for (const childId of promoted) {
    const child = getBlock(page, childId);
    if (child) child.parentId = parentId;
  }
  block.children = [];
  page.blocks = page.blocks.filter((candidate) => candidate.id !== block.id && !columnIds.has(candidate.id));
  rebuildBlockOrder(page);
  return { childIds: promoted, focusId: promoted[0] || null, parentId };
}

function removeSubtrees(page, blockIds) {
  const roots = normalizeTopLevelSelection(page, blockIds);
  if (!roots.length) return [];
  const removed = [];
  const all = new Set();
  for (const rootId of roots) for (const id of getSubtreeIds(page, rootId)) all.add(id);
  for (const rootId of roots) detachBlock(page, rootId);
  page.blocks = page.blocks.filter((block) => {
    if (!all.has(block.id)) return true;
    removed.push(block);
    return false;
  });
  if (!page.blocks.length) appendRootBlock(page, createBlock());
  rebuildBlockOrder(page);
  return removed;
}

function unwrapBlock(page, blockId) {
  const block = getBlock(page, blockId);
  if (!block) return null;
  const parentId = block.parentId;
  const siblings = getSiblingIds(page, parentId);
  const index = siblings.indexOf(blockId);
  if (index < 0) return null;
  const children = block.children.slice();
  siblings.splice(index, 1, ...children);
  for (const childId of children) {
    const child = getBlock(page, childId);
    if (child) child.parentId = parentId;
  }
  block.children = [];
  page.blocks = page.blocks.filter((candidate) => candidate.id !== blockId);
  if (!page.blocks.length) appendRootBlock(page, createBlock());
  rebuildBlockOrder(page);
  return { childIds: children, focusId: children[0] || null, parentId };
}

function cloneSubtree(page, blockId, idMap = new Map()) {
  const source = getBlock(page, blockId);
  if (!source) return [];
  const clone = normalizeBlock(deepClone(source));
  clone.id = randomId('block');
  clone.parentId = null;
  clone.children = [];
  idMap.set(source.id, clone.id);
  const result = [clone];
  for (const childId of source.children) {
    const descendants = cloneSubtree(page, childId, idMap);
    if (!descendants.length) continue;
    descendants[0].parentId = clone.id;
    clone.children.push(descendants[0].id);
    result.push(...descendants);
  }
  return result;
}

function duplicateSubtrees(page, blockIds) {
  const roots = normalizeTopLevelSelection(page, blockIds);
  const insertedRoots = [];
  for (const rootId of roots) {
    const source = getBlock(page, rootId);
    if (!source) continue;
    const clones = cloneSubtree(page, rootId);
    if (!clones.length) continue;
    for (const clone of clones) page.blocks.push(clone);
    const siblings = getSiblingIds(page, source.parentId);
    const sourceIndex = siblings.indexOf(source.id);
    const rootClone = clones[0];
    rootClone.parentId = source.parentId;
    siblings.splice(sourceIndex + 1, 0, rootClone.id);
    insertedRoots.push(rootClone.id);
  }
  rebuildBlockOrder(page);
  return insertedRoots;
}

function moveSubtrees(page, blockIds, targetId, position = 'after') {
  const roots = normalizeTopLevelSelection(page, blockIds);
  const target = getBlock(page, targetId);
  if (!roots.length || !target || roots.includes(targetId)) return false;
  const movingAll = new Set(roots.flatMap((id) => getSubtreeIds(page, id)));
  if (movingAll.has(targetId)) return false;
  let parentId = target.parentId;
  let index;
  if (position === 'inside') {
    if (!canBlockHaveChildren(target)) return false;
    parentId = target.id;
    index = target.children.length;
    target.collapsed = false;
  } else {
    const targetSiblings = getSiblingIds(page, target.parentId);
    index = targetSiblings.indexOf(targetId) + (position === 'after' ? 1 : 0);
  }

  const sourceMeta = roots.map((id) => {
    const block = getBlock(page, id);
    const siblings = getSiblingIds(page, block.parentId);
    return { id, parentId: block.parentId, index: siblings.indexOf(id) };
  });
  for (const id of roots) detachBlock(page, id);
  const destination = getSiblingIds(page, parentId);
  if (position !== 'inside' && parentId === target.parentId) {
    const removedBefore = sourceMeta.filter((meta) => meta.parentId === parentId && meta.index < index).length;
    index -= removedBefore;
  }
  index = Math.max(0, Math.min(destination.length, index));
  for (const id of roots) {
    const block = getBlock(page, id);
    block.parentId = parentId;
  }
  destination.splice(index, 0, ...roots);
  rebuildBlockOrder(page);
  return true;
}

function moveSiblingGroup(page, blockIds, direction) {
  const roots = normalizeTopLevelSelection(page, blockIds);
  if (!roots.length) return false;
  const first = getBlock(page, roots[0]);
  if (!first || roots.some((id) => getBlock(page, id).parentId !== first.parentId)) return false;
  const siblings = getSiblingIds(page, first.parentId);
  const selected = new Set(roots);
  const firstIndex = siblings.findIndex((id) => selected.has(id));
  let lastIndex = -1;
  for (let index = siblings.length - 1; index >= 0; index -= 1) if (selected.has(siblings[index])) { lastIndex = index; break; }
  if (direction < 0) {
    if (firstIndex <= 0) return false;
    const previous = siblings[firstIndex - 1];
    const remaining = siblings.filter((id) => !selected.has(id));
    const insertion = remaining.indexOf(previous);
    remaining.splice(insertion, 0, ...roots);
    siblings.splice(0, siblings.length, ...remaining);
  } else {
    if (lastIndex < 0 || lastIndex >= siblings.length - 1) return false;
    const next = siblings[lastIndex + 1];
    const remaining = siblings.filter((id) => !selected.has(id));
    const insertion = remaining.indexOf(next) + 1;
    remaining.splice(insertion, 0, ...roots);
    siblings.splice(0, siblings.length, ...remaining);
  }
  rebuildBlockOrder(page);
  return true;
}

function indentBlocks(page, blockIds) {
  const roots = normalizeTopLevelSelection(page, blockIds);
  if (!roots.length) return false;
  const first = getBlock(page, roots[0]);
  if (!first || roots.some((id) => getBlock(page, id).parentId !== first.parentId)) return false;
  const siblings = getSiblingIds(page, first.parentId);
  const firstIndex = siblings.indexOf(first.id);
  if (firstIndex <= 0) return false;
  const selected = new Set(roots);
  let previousIndex = firstIndex - 1;
  while (previousIndex >= 0 && selected.has(siblings[previousIndex])) previousIndex -= 1;
  const parent = getBlock(page, siblings[previousIndex]);
  if (!parent || !canBlockHaveChildren(parent)) return false;
  for (const id of roots) detachBlock(page, id);
  for (const id of roots) {
    const block = getBlock(page, id);
    block.parentId = parent.id;
  }
  parent.children.push(...roots);
  parent.collapsed = false;
  rebuildBlockOrder(page);
  return true;
}

function outdentBlocks(page, blockIds) {
  const roots = normalizeTopLevelSelection(page, blockIds);
  if (!roots.length) return false;
  const first = getBlock(page, roots[0]);
  if (!first || !first.parentId || roots.some((id) => getBlock(page, id).parentId !== first.parentId)) return false;
  const parent = getBlock(page, first.parentId);
  if (!parent) return false;
  const grandParentId = parent.parentId;
  const destination = getSiblingIds(page, grandParentId);
  let index = destination.indexOf(parent.id) + 1;
  for (const id of roots) detachBlock(page, id);
  for (const id of roots) getBlock(page, id).parentId = grandParentId;
  destination.splice(index, 0, ...roots);
  rebuildBlockOrder(page);
  return true;
}

function splitBlock(page, blockId, offset) {
  const block = getBlock(page, blockId);
  if (!block) return null;
  const split = Math.max(0, Math.min(block.text.length, Number(offset) || 0));
  const marks = splitInlineMarks(block.marks, split, block.text.length);
  const nextType = block.type.startsWith('heading') ? 'paragraph' : block.type;
  const next = createBlock(nextType, block.text.slice(split), {
    marks: marks.right,
    appearance: block.appearance,
    checked: false,
  });
  block.text = block.text.slice(0, split);
  block.marks = marks.left;
  return insertBlockAfter(page, block.id, next);
}

function mergeBlockWithPrevious(page, blockId) {
  const block = getBlock(page, blockId);
  if (!block) return null;
  const siblings = getSiblingIds(page, block.parentId);
  const index = siblings.indexOf(block.id);
  if (index <= 0) return null;
  const previous = getBlock(page, siblings[index - 1]);
  if (!previous || previous.type === 'divider' || block.type === 'divider') return null;
  const offset = previous.text.length;
  previous.marks = mergeInlineMarks(previous.marks, block.marks, previous.text.length, block.text.length);
  previous.text += block.text;
  for (const childId of block.children) {
    const child = getBlock(page, childId);
    if (child) child.parentId = previous.id;
    previous.children.push(childId);
  }
  block.children = [];
  removeSubtrees(page, [block.id]);
  return { block: previous, offset };
}

function numberedOrdinal(page, blockId) {
  const block = getBlock(page, blockId);
  if (!block || block.type !== 'numbered-list') return 0;
  const siblings = getSiblingIds(page, block.parentId);
  const index = siblings.indexOf(blockId);
  let ordinal = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = getBlock(page, siblings[cursor]);
    if (!previous || previous.type !== 'numbered-list') break;
    ordinal += 1;
  }
  return ordinal;
}

function toggleBlockCollapsed(page, blockId, value) {
  const block = getBlock(page, blockId);
  if (!block || (!block.children.length && block.type !== 'toggle')) return false;
  block.collapsed = typeof value === 'boolean' ? value : !block.collapsed;
  return true;
}

function convertBlockType(page, blockIds, targetType) {
  if (!BLOCK_TYPES.has(targetType)) return false;
  let changed = false;
  for (const id of Array.isArray(blockIds) ? blockIds : [blockIds]) {
    const block = getBlock(page, id);
    if (!block || block.type === targetType) continue;
    block.type = targetType;
    const data = normalizeBlockData(targetType, ADVANCED_BLOCK_TYPES.has(block.type) ? block.data : null);
    if (data) block.data = data;
    else delete block.data;
    if (targetType !== 'todo') block.checked = false;
    if (!canBlockHaveChildren(targetType) && block.children.length) {
      // Keep children to make conversion lossless. The renderer still displays the tree.
    }
    changed = true;
  }
  return changed;
}


function serializeSubtrees(page, blockIds) {
  const roots = normalizeTopLevelSelection(page, blockIds);
  const selected = new Set(roots.flatMap((id) => getSubtreeIds(page, id)));
  return {
    version: 1,
    roots: roots.slice(),
    blocks: page.blocks.filter((block) => selected.has(block.id)).map((block) => deepClone(block)),
  };
}

function insertSerializedSubtrees(page, payload, anchorId = null) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks : [];
  const rawRoots = Array.isArray(source.roots) ? source.roots : [];
  if (!rawBlocks.length || !rawRoots.length) return [];
  const rawMap = new Map(rawBlocks.filter((block) => block && typeof block.id === 'string').map((block) => [block.id, normalizeBlock(block)]));
  const idMap = new Map();
  for (const id of rawMap.keys()) idMap.set(id, randomId('block'));
  const clones = [];
  for (const [oldId, raw] of rawMap.entries()) {
    const clone = normalizeBlock(deepClone(raw));
    clone.id = idMap.get(oldId);
    clone.parentId = raw.parentId && idMap.has(raw.parentId) ? idMap.get(raw.parentId) : null;
    clone.children = raw.children.filter((id) => idMap.has(id)).map((id) => idMap.get(id));
    clones.push(clone);
  }
  for (const clone of clones) page.blocks.push(clone);
  const anchor = anchorId ? getBlock(page, anchorId) : null;
  const parentId = anchor ? anchor.parentId : null;
  const siblings = getSiblingIds(page, parentId);
  let index = anchor ? siblings.indexOf(anchor.id) + 1 : siblings.length;
  const insertedRoots = [];
  for (const oldRootId of rawRoots) {
    const newRootId = idMap.get(oldRootId);
    const root = newRootId && getBlock(page, newRootId);
    if (!root) continue;
    root.parentId = parentId;
    siblings.splice(index, 0, root.id);
    insertedRoots.push(root.id);
    index += 1;
  }
  rebuildBlockOrder(page);
  return insertedRoots;
}

function deleteSiblingTextRange(page, selection) {
  const source = selection && typeof selection === 'object' ? selection : {};
  const startBlock = getBlock(page, source.startBlockId);
  const endBlock = getBlock(page, source.endBlockId);
  if (!startBlock || !endBlock || startBlock.id === endBlock.id || startBlock.parentId !== endBlock.parentId) return null;
  if (startBlock.children.length || endBlock.children.length) return null;
  const siblings = getSiblingIds(page, startBlock.parentId);
  const startIndex = siblings.indexOf(startBlock.id);
  const endIndex = siblings.indexOf(endBlock.id);
  if (startIndex < 0 || endIndex <= startIndex) return null;
  const rangeIds = siblings.slice(startIndex, endIndex + 1);
  if (rangeIds.some((id) => {
    const block = getBlock(page, id);
    return !block || block.children.length || block.type === 'divider' || block.type === 'table-of-contents' || block.type === 'code';
  })) return null;
  const startOffset = Math.max(0, Math.min(startBlock.text.length, Number(source.startOffset) || 0));
  const endOffset = Math.max(0, Math.min(endBlock.text.length, Number(source.endOffset) || 0));
  const prefix = startBlock.text.slice(0, startOffset);
  const suffix = endBlock.text.slice(endOffset);
  const startMarks = splitInlineMarks(startBlock.marks, startOffset, startBlock.text.length).left;
  const endMarks = splitInlineMarks(endBlock.marks, endOffset, endBlock.text.length).right;
  startBlock.text = prefix + suffix;
  startBlock.marks = mergeInlineMarks(startMarks, endMarks, prefix.length, suffix.length);
  const removeIds = rangeIds.slice(1);
  for (const id of removeIds) detachBlock(page, id);
  const removeSet = new Set(removeIds.flatMap((id) => getSubtreeIds(page, id)));
  page.blocks = page.blocks.filter((block) => !removeSet.has(block.id));
  rebuildBlockOrder(page);
  return { blockId: startBlock.id, offset: prefix.length, removedBlockIds: removeIds };
}

// A board card with nothing but a title reads as an empty placeholder, and the
// index is the only thing the board can see without loading every page file.
function pageExcerpt(page, limit = 140) {
  const blocks = page && Array.isArray(page.blocks) ? page.blocks : [];
  const parts = [];
  for (const block of blocks) {
    const text = String((block && block.text) || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    parts.push(text);
    if (parts.join(' · ').length >= limit) break;
  }
  return parts.join(' · ').slice(0, limit);
}

function pageSearchText(page, limit = 50000) {
  const source = page && typeof page === 'object' ? page : {};
  const parts = [];
  let length = 0;
  const append = (value) => {
    if (length >= limit || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) append(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) append(item);
      return;
    }
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (!text) return;
    const remaining = Math.max(0, limit - length);
    const clipped = text.slice(0, remaining);
    parts.push(clipped);
    length += clipped.length + 1;
  };
  append(source.title);
  append(source.excerpt);
  append(source.tags);
  append(source.status);
  append(source.priority);
  append(source.properties);
  for (const block of Array.isArray(source.blocks) ? source.blocks : []) {
    append(block && block.text);
    append(block && block.data);
  }
  return parts.join(' ').slice(0, limit);
}

function isFindWordCharacter(character) {
  return Boolean(character && /[\p{L}\p{N}_]/u.test(character));
}

function scanPreparedTextRanges(source, haystack, normalizedNeedle, options = {}) {
  if (!source || !normalizedNeedle) return { ranges: [], truncated: false };
  const wholeWord = options.wholeWord === true;
  const maxMatches = Number.isFinite(options.maxMatches)
    ? Math.max(0, Number(options.maxMatches) || 0)
    : Number.POSITIVE_INFINITY;
  const ranges = [];
  let truncated = false;
  let cursor = 0;
  while (cursor <= haystack.length - normalizedNeedle.length) {
    const from = haystack.indexOf(normalizedNeedle, cursor);
    if (from < 0) break;
    const to = from + normalizedNeedle.length;
    const hasWordBoundary = !wholeWord
      || (!isFindWordCharacter(source[from - 1]) && !isFindWordCharacter(source[to]));
    if (hasWordBoundary) {
      if (ranges.length >= maxMatches) {
        truncated = true;
        break;
      }
      ranges.push({ from, to, text: source.slice(from, to) });
    }
    cursor = Math.max(to, from + 1);
  }
  return { ranges, truncated };
}

function findTextRanges(text, query, options = {}) {
  const source = String(text || '');
  const needle = String(query || '');
  if (!source || !needle) return [];
  const matchCase = options.matchCase === true;
  const haystack = matchCase ? source : source.toLocaleLowerCase();
  const normalizedNeedle = matchCase ? needle : needle.toLocaleLowerCase();
  return scanPreparedTextRanges(source, haystack, normalizedNeedle, options).ranges;
}

function createPageTextIndex(page) {
  const source = page && typeof page === 'object' ? page : {};
  const entries = [];
  const append = (metadata, value) => {
    const text = String(value || '');
    if (!text) return;
    entries.push({ ...metadata, text, foldedText: text.toLocaleLowerCase() });
  };
  append({ kind: 'title', field: 'title' }, source.title);
  const blocks = Array.isArray(source.blocks) ? flattenBlocks(source) : [];
  for (const block of blocks) {
    append({
      kind: 'block',
      field: 'text',
      blockId: block.id,
      blockType: block.type,
    }, block && block.text);
  }
  return {
    pageId: String(source.id || ''),
    entries,
  };
}

function findPageTextIndex(index, query, options = {}) {
  const needle = String(query || '');
  const matches = [];
  matches.truncated = false;
  if (!needle) return matches;
  const matchCase = options.matchCase === true;
  const normalizedNeedle = matchCase ? needle : needle.toLocaleLowerCase();
  if (!normalizedNeedle) return matches;
  const maxMatches = Number.isFinite(options.maxMatches)
    ? Math.max(1, Number(options.maxMatches) || 1)
    : Number.POSITIVE_INFINITY;
  const entries = index && Array.isArray(index.entries) ? index.entries : [];
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    const remaining = Math.max(0, maxMatches - matches.length);
    const scan = scanPreparedTextRanges(
      entry.text,
      matchCase ? entry.text : entry.foldedText,
      normalizedNeedle,
      { ...options, maxMatches: remaining },
    );
    for (const range of scan.ranges) {
      matches.push({
        kind: entry.kind,
        field: entry.field,
        ...(entry.blockId ? { blockId: entry.blockId, blockType: entry.blockType } : {}),
        ...range,
      });
    }
    if (scan.truncated) {
      matches.truncated = true;
      break;
    }
    if (matches.length >= maxMatches) {
      for (let restIndex = entryIndex + 1; restIndex < entries.length; restIndex += 1) {
        const rest = entries[restIndex];
        const probe = scanPreparedTextRanges(
          rest.text,
          matchCase ? rest.text : rest.foldedText,
          normalizedNeedle,
          { ...options, maxMatches: 0 },
        );
        if (probe.truncated) {
          matches.truncated = true;
          break;
        }
      }
      break;
    }
  }
  return matches;
}

function findPageTextMatches(page, query, options = {}) {
  return findPageTextIndex(createPageTextIndex(page), query, options);
}

function replaceInlineMarksRange(sourceMarks, textLength, from, to, insertedLength) {
  const start = Math.max(0, Math.min(Number(from) || 0, textLength));
  const end = Math.max(start, Math.min(Number(to) || start, textLength));
  const safeInsertedLength = Math.max(0, Number(insertedLength) || 0);
  const delta = safeInsertedLength - (end - start);
  const insertionEnd = start + safeInsertedLength;
  const marks = [];
  for (const mark of normalizeInlineMarks(sourceMarks, textLength)) {
    if (mark.to <= start) {
      marks.push({ ...mark });
      continue;
    }
    if (mark.from >= end) {
      marks.push({ ...mark, from: mark.from + delta, to: mark.to + delta });
      continue;
    }
    if (mark.from < start) marks.push({ ...mark, to: start });
    if (safeInsertedLength && mark.from <= start && mark.to > start) {
      marks.push({ ...mark, from: start, to: insertionEnd });
    }
    if (mark.to > end) marks.push({ ...mark, from: insertionEnd, to: mark.to + delta });
  }
  return normalizeInlineMarks(marks, textLength + delta);
}

function replaceInlineTextRange(block, from, to, replacement) {
  const normalized = normalizeBlock(block);
  const start = Math.max(0, Math.min(Number(from) || 0, normalized.text.length));
  const end = Math.max(start, Math.min(Number(to) || start, normalized.text.length));
  const inserted = String(replacement ?? '');
  const nextText = normalized.text.slice(0, start) + inserted + normalized.text.slice(end);
  return {
    text: nextText,
    marks: replaceInlineMarksRange(normalized.marks, normalized.text.length, start, end, inserted.length),
    caret: start + inserted.length,
  };
}

function replaceInlineTextRanges(block, ranges, replacement) {
  const normalized = normalizeBlock(block);
  const inserted = String(replacement ?? '');
  const sorted = Array.from(ranges || [])
    .filter((range) => range && Number.isFinite(range.from) && Number.isFinite(range.to))
    .map((range) => ({
      ...range,
      from: Math.max(0, Math.min(Number(range.from), normalized.text.length)),
      to: Math.max(0, Math.min(Number(range.to), normalized.text.length)),
    }))
    .filter((range) => range.to >= range.from && (typeof range.text !== 'string' || normalized.text.slice(range.from, range.to) === range.text))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const valid = [];
  let lastTo = -1;
  for (const range of sorted) {
    if (range.from < lastTo) continue;
    valid.push(range);
    lastTo = range.to;
  }
  if (!valid.length) return { text: normalized.text, marks: normalized.marks, replaced: 0 };
  const chunks = [];
  let cursor = 0;
  for (const range of valid) {
    chunks.push(normalized.text.slice(cursor, range.from), inserted);
    cursor = range.to;
  }
  chunks.push(normalized.text.slice(cursor));
  const nextText = chunks.join('');
  let marks = normalized.marks;
  let textLength = normalized.text.length;
  for (let index = valid.length - 1; index >= 0; index -= 1) {
    const range = valid[index];
    marks = replaceInlineMarksRange(marks, textLength, range.from, range.to, inserted.length);
    textLength += inserted.length - (range.to - range.from);
  }
  return { text: nextText, marks: normalizeInlineMarks(marks, nextText.length), replaced: valid.length };
}

function replacePageTextMatch(page, match, replacement) {
  if (!page || !match || !Number.isFinite(match.from) || !Number.isFinite(match.to)) return false;
  if (match.kind === 'title') {
    const title = String(page.title || '');
    if (match.from < 0 || match.to > title.length || title.slice(match.from, match.to) !== match.text) return false;
    page.title = title.slice(0, match.from) + String(replacement ?? '') + title.slice(match.to);
    return true;
  }
  if (match.kind !== 'block' || !match.blockId) return false;
  const block = getBlock(page, match.blockId);
  if (!block || match.from < 0 || match.to > block.text.length || block.text.slice(match.from, match.to) !== match.text) return false;
  const next = replaceInlineTextRange(block, match.from, match.to, replacement);
  block.text = next.text;
  block.marks = next.marks;
  return true;
}

function replaceAllPageText(page, query, replacement, options = {}) {
  const matches = findPageTextMatches(page, query, options);
  const titleMatches = [];
  const blockMatches = new Map();
  for (const match of matches) {
    if (match.kind === 'title') titleMatches.push(match);
    else if (match.kind === 'block' && match.blockId) {
      const ranges = blockMatches.get(match.blockId) || [];
      ranges.push(match);
      blockMatches.set(match.blockId, ranges);
    }
  }
  let replaced = 0;
  if (titleMatches.length) {
    const titleResult = replaceInlineTextRanges({ type: 'paragraph', text: page.title, marks: [] }, titleMatches, replacement);
    page.title = titleResult.text;
    replaced += titleResult.replaced;
  }
  const blocks = blockMap(page);
  for (const [blockId, ranges] of blockMatches) {
    const block = blocks.get(blockId);
    if (!block) continue;
    const result = replaceInlineTextRanges(block, ranges, replacement);
    block.text = result.text;
    block.marks = result.marks;
    replaced += result.replaced;
  }
  return replaced;
}

function pageToMeta(page) {
  const normalized = normalizePage(page);
  return {
    id: normalized.id,
    title: normalized.title,
    icon: normalized.icon,
    parentId: normalized.parentId,
    status: normalized.properties.status,
    priority: normalized.properties.priority,
    tags: normalized.properties.tags,
    excerpt: pageExcerpt(normalized),
    updatedAt: normalized.updatedAt,
    revision: normalized.revision,
  };
}

function normalizeWorkspace(input) {
  const source = input && typeof input === 'object' ? input : {};
  const pages = Array.isArray(source.pages)
    ? source.pages.filter((page) => page && typeof page.id === 'string').map((page) => ({
      id: page.id,
      title: typeof page.title === 'string' && page.title ? page.title : 'Untitled',
      icon: typeof page.icon === 'string' && page.icon ? page.icon : '📄',
      parentId: typeof page.parentId === 'string' && page.parentId ? page.parentId : null,
      status: PAGE_STATUSES.includes(page.status) ? page.status : 'todo',
      priority: PAGE_PRIORITIES.includes(page.priority) ? page.priority : 'medium',
      // Optional since 0.17.2: an older index simply has no excerpt/tags until
      // the page is saved again or the index is rebuilt.
      tags: normalizeStringArray(page.tags),
      excerpt: typeof page.excerpt === 'string' ? page.excerpt.slice(0, 140) : '',
      updatedAt: typeof page.updatedAt === 'string' ? page.updatedAt : nowIso(),
      revision: Math.max(1, Number(page.revision) || 1),
    }))
    : [];
  const bridgePaths = {};
  if (source.bridgePaths && typeof source.bridgePaths === 'object') {
    for (const [pageId, path] of Object.entries(source.bridgePaths)) {
      if (typeof pageId === 'string' && pageId && typeof path === 'string' && path.trim()) bridgePaths[pageId] = path.trim();
    }
  }
  const nativeMarkdownPaths = {};
  if (source.nativeMarkdownPaths && typeof source.nativeMarkdownPaths === 'object') {
    for (const [pageId, path] of Object.entries(source.nativeMarkdownPaths)) {
      if (typeof pageId === 'string' && pageId && typeof path === 'string' && path.trim()) nativeMarkdownPaths[pageId] = path.trim();
    }
  }
  return {
    version: DATA_VERSION,
    formatVersion: DATA_VERSION,
    pages,
    activePageId: typeof source.activePageId === 'string' ? source.activePageId : (pages[0] ? pages[0].id : null),
    bridgePaths,
    nativeMarkdownPaths,
  };
}

function touchPage(page) {
  const normalized = normalizePage(page);
  normalized.updatedAt = nowIso();
  normalized.revision += 1;
  return normalized;
}

function duplicateBlock(block) {
  const normalized = normalizeBlock(block);
  return { ...normalized, id: randomId('block'), parentId: null, children: [] };
}

function moveArrayItem(items, fromIndex, toIndex) {
  const copy = Array.from(items);
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return copy;
  if (fromIndex < 0 || fromIndex >= copy.length) return copy;
  const clamped = Math.max(0, Math.min(copy.length - 1, toIndex));
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(clamped, 0, item);
  return copy;
}

function moveArrayItemByInsertion(items, fromIndex, targetIndex, position = 'after') {
  const copy = Array.from(items);
  if (!Number.isInteger(fromIndex) || !Number.isInteger(targetIndex)) return copy;
  if (fromIndex < 0 || fromIndex >= copy.length || targetIndex < 0 || targetIndex >= copy.length || fromIndex === targetIndex) return copy;
  let insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
  if (fromIndex < insertionIndex) insertionIndex -= 1;
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(Math.max(0, Math.min(copy.length, insertionIndex)), 0, item);
  return copy;
}

function moveArrayItemsByInsertion(items, sourceIndices, targetIndex, position = 'after') {
  const copy = Array.from(items || []);
  const target = Number(targetIndex);
  const indices = Array.from(new Set(Array.isArray(sourceIndices) ? sourceIndices : []))
    .map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value < copy.length).sort((a, b) => a - b);
  if (!indices.length || !Number.isInteger(target) || target < 0 || target >= copy.length || indices.includes(target)) return copy;
  const selected = new Set(indices);
  const moved = indices.map((index) => copy[index]);
  const targetItem = copy[target];
  const remaining = copy.filter((_item, index) => !selected.has(index));
  const targetRemainingIndex = remaining.indexOf(targetItem);
  if (targetRemainingIndex < 0) return copy;
  remaining.splice(targetRemainingIndex + (position === 'after' ? 1 : 0), 0, ...moved);
  return remaining;
}

function comparablePage(page) {
  const normalized = normalizePage(page);
  return {
    id: normalized.id,
    title: normalized.title,
    icon: normalized.icon,
    cover: normalized.cover,
    parentId: normalized.parentId,
    sourcePath: normalized.sourcePath,
    properties: normalized.properties,
    blocks: normalized.blocks.map(({ depth, ...block }) => block),
    rootBlockIds: normalized.rootBlockIds,
  };
}

function pageContentEquals(a, b) {
  return JSON.stringify(comparablePage(a)) === JSON.stringify(comparablePage(b));
}

function createHistory(limit = 150) {
  return { undo: [], redo: [], limit: Math.max(10, Math.min(1000, Number(limit) || 150)) };
}

function createTransaction(label, before, after, metadata = {}) {
  return {
    id: randomId('tx'),
    label: String(label || '编辑'),
    before: clonePage(before),
    after: clonePage(after),
    selectionBefore: metadata.selectionBefore || null,
    selectionAfter: metadata.selectionAfter || null,
    createdAt: nowIso(),
  };
}

function recordHistory(history, transaction) {
  if (!history || !transaction || pageContentEquals(transaction.before, transaction.after)) return false;
  history.undo.push(transaction);
  if (history.undo.length > history.limit) history.undo.splice(0, history.undo.length - history.limit);
  history.redo.length = 0;
  return true;
}

function undoHistory(history) {
  if (!history || !history.undo.length) return null;
  const transaction = history.undo.pop();
  history.redo.push(transaction);
  return { page: clonePage(transaction.before), selection: transaction.selectionBefore, transaction };
}

function redoHistory(history) {
  if (!history || !history.redo.length) return null;
  const transaction = history.redo.pop();
  history.undo.push(transaction);
  return { page: clonePage(transaction.after), selection: transaction.selectionAfter, transaction };
}

function validatePage(input) {
  const issues = [];
  if (!input || typeof input !== 'object') return ['页面不是有效对象'];
  if (typeof input.id !== 'string' || !input.id) issues.push('页面缺少有效 ID');
  if (!Array.isArray(input.blocks)) issues.push('页面 blocks 不是数组');
  const treeFormat = Number(input.formatVersion || input.version || 0) >= 4;
  if (treeFormat && !Array.isArray(input.rootBlockIds)) issues.push('页面缺少 rootBlockIds');
  const ids = new Set();
  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  for (const [index, raw] of rawBlocks.entries()) {
    if (!raw || typeof raw !== 'object') { issues.push(`第 ${index + 1} 个块不是有效对象`); continue; }
    if (typeof raw.id !== 'string' || !raw.id) issues.push(`第 ${index + 1} 个块缺少 ID`);
    else if (ids.has(raw.id)) issues.push(`存在重复块 ID：${raw.id}`);
    else ids.add(raw.id);
    if (!BLOCK_TYPES.has(raw.type)) issues.push(`块 ${raw.id || index + 1} 类型无效：${raw.type}`);
    const textLength = String(raw.text ?? '').length;
    for (const mark of Array.isArray(raw.marks) ? raw.marks : []) if (!normalizeInlineMark(mark, textLength)) issues.push(`块 ${raw.id || index + 1} 存在无效文字格式`);
    const appearance = raw.appearance && typeof raw.appearance === 'object' ? raw.appearance : {};
    if (appearance.textColor && !SEMANTIC_COLORS.has(appearance.textColor)) issues.push(`块 ${raw.id || index + 1} 文字颜色无效`);
    if (appearance.background && !SEMANTIC_COLORS.has(appearance.background)) issues.push(`块 ${raw.id || index + 1} 背景颜色无效`);
    if (appearance.align && !BLOCK_ALIGNS.has(appearance.align)) issues.push(`块 ${raw.id || index + 1} 对齐方式无效`);
    if (raw.parentId && typeof raw.parentId !== 'string') issues.push(`块 ${raw.id || index + 1} parentId 无效`);
    if (raw.children && !Array.isArray(raw.children)) issues.push(`块 ${raw.id || index + 1} children 无效`);
  }
  const rawById = new Map(rawBlocks.filter((block) => block && typeof block.id === 'string').map((block) => [block.id, block]));
  const rawRoots = Array.isArray(input.rootBlockIds) ? input.rootBlockIds : [];
  const rootIds = new Set();
  for (const rootId of rawRoots) {
    if (typeof rootId !== 'string' || !rootId) {
      issues.push('rootBlockIds 包含无效 ID');
      continue;
    }
    if (rootIds.has(rootId)) issues.push(`rootBlockIds 重复包含块：${rootId}`);
    rootIds.add(rootId);
    if (!rawById.has(rootId)) issues.push(`rootBlockIds 指向不存在的块：${rootId}`);
  }
  const childOwners = new Map();
  for (const raw of rawBlocks) {
    if (!raw || !raw.id) continue;
    if (raw.parentId && !rawById.has(raw.parentId)) issues.push(`块 ${raw.id} 指向不存在的父块：${raw.parentId}`);
    if (treeFormat) {
      if (raw.parentId && rootIds.has(raw.id)) issues.push(`块 ${raw.id} 同时是根块和子块`);
      if (!raw.parentId && !rootIds.has(raw.id)) issues.push(`根块 ${raw.id} 未出现在 rootBlockIds`);
      if (raw.parentId) {
        const parent = rawById.get(raw.parentId);
        if (parent && !(Array.isArray(parent.children) ? parent.children : []).includes(raw.id)) {
          issues.push(`块 ${raw.id} 的父块 ${raw.parentId} 未反向包含它`);
        }
      }
    }
    const childIds = Array.isArray(raw.children) ? raw.children : [];
    const childSeen = new Set();
    for (const childId of childIds) {
      if (childId === raw.id) issues.push(`块 ${raw.id} 不能包含自身`);
      else if (!rawById.has(childId)) issues.push(`块 ${raw.id} 包含不存在的子块：${childId}`);
      else {
        if (childSeen.has(childId)) issues.push(`块 ${raw.id} 重复包含子块：${childId}`);
        const owner = childOwners.get(childId);
        if (owner && owner !== raw.id) issues.push(`块 ${childId} 同时被多个父块包含：${owner}、${raw.id}`);
        else childOwners.set(childId, raw.id);
        const child = rawById.get(childId);
        if (treeFormat && child && child.parentId !== raw.id) {
          issues.push(`父块 ${raw.id} 包含块 ${childId}，但子块 parentId 不一致`);
        }
      }
      childSeen.add(childId);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const detectCycle = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const raw = rawById.get(id);
    for (const childId of (raw && Array.isArray(raw.children) ? raw.children : [])) {
      if (rawById.has(childId) && detectCycle(childId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of rawById.keys()) {
    if (detectCycle(id)) {
      issues.push('块树存在循环引用');
      break;
    }
  }
  const normalized = normalizePage(input);
  const allFlattened = flattenBlocks(normalized, { includeCollapsed: true });
  if (allFlattened.length !== normalized.blocks.length) issues.push('块树存在无法访问的孤立结构');
  return Array.from(new Set(issues));
}

function hashString(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function obsidianBlockAnchor(blockId) {
  const readable = String(blockId || '').toLocaleLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(-10);
  return `bs-${hashString(blockId)}${readable ? `-${readable}` : ''}`;
}

function pageContentHash(page) {
  return hashString(JSON.stringify(comparablePage(page)));
}

function splitLines(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').split('\n');
}

const LOOSE_METADATA_KEYS = new Map([
  ['title', 'title'],
  ['source', 'source'],
  ['url', 'source'],
  ['author', 'author'],
  ['authors', 'author'],
  ['published', 'publishedAt'],
  ['published at', 'publishedAt'],
  ['published_at', 'publishedAt'],
  ['created', 'createdAt'],
  ['created at', 'createdAt'],
  ['created_at', 'createdAt'],
  ['date created', 'createdAt'],
  ['date_created', 'createdAt'],
  ['modified', 'modifiedAt'],
  ['modified at', 'modifiedAt'],
  ['modified_at', 'modifiedAt'],
  ['date modified', 'modifiedAt'],
  ['date_modified', 'modifiedAt'],
  ['description', 'description'],
  ['summary', 'description'],
  ['tags', 'tags'],
  ['tag', 'tags'],
  ['view count', 'viewCount'],
  ['view_count', 'viewCount'],
]);

function cleanMetadataScalar(value) {
  const source = String(value ?? '').trim();
  if (!source) return '';
  const unquoted = (
    (source.startsWith('"') && source.endsWith('"'))
    || (source.startsWith("'") && source.endsWith("'"))
  ) ? source.slice(1, -1) : source;
  return unquoted.replace(/^\s*[-*+]\s+/, '').trim();
}

function extractLooseMarkdownMetadata(markdown) {
  const lines = splitLines(markdown);
  let cursor = 0;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  const start = cursor;
  const entries = [];
  let current = null;
  let lastMetadataLine = start;

  const flush = () => {
    if (!current) return;
    entries.push(current);
    current = null;
  };

  for (; cursor < Math.min(lines.length, start + 80); cursor += 1) {
    const line = lines[cursor];
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{0,48}):\s*(.*)$/);
    const normalizedKey = match ? match[1].trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const field = match && LOOSE_METADATA_KEYS.get(normalizedKey);
    if (field) {
      flush();
      current = { field, values: match[2] ? [match[2]] : [] };
      lastMetadataLine = cursor + 1;
      continue;
    }
    if (current && (/^\s+/.test(line) || /^\s*[-*+]\s+/.test(line))) {
      const continuation = cleanMetadataScalar(line);
      if (continuation) current.values.push(continuation);
      lastMetadataLine = cursor + 1;
      continue;
    }
    if (!line.trim() && current) {
      lastMetadataLine = cursor + 1;
      continue;
    }
    break;
  }
  flush();

  const fields = new Set(entries.map((entry) => entry.field));
  const looksLikeMetadata = entries.length >= 3
    && ['title', 'source', 'description', 'tags'].some((field) => fields.has(field));
  if (!looksLikeMetadata) return { metadata: {}, body: String(markdown ?? ''), matched: false };

  const metadata = {};
  for (const entry of entries) {
    const values = entry.values.map(cleanMetadataScalar).filter(Boolean);
    if (!values.length || metadata[entry.field]) continue;
    if (entry.field === 'tags') {
      metadata.tags = values
        .flatMap((value) => value.replace(/^\[|\]$/g, '').split(/[,，]/))
        .map(cleanMetadataScalar)
        .filter(Boolean);
    } else {
      metadata[entry.field] = values.join(entry.field === 'description' ? '\n' : ', ');
    }
  }
  if (!metadata.publishedAt && metadata.createdAt) metadata.publishedAt = metadata.createdAt;
  const body = lines.slice(lastMetadataLine).join('\n').replace(/^\s*\n+/, '');
  return { metadata, body, matched: true };
}

function normalizeMarkdownLinkWhitespace(markdown) {
  return String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    // Copied Markdown is frequently wrapped between a label/image and its destination.
    // Common renderers treat that form inconsistently, so canonicalize it before parsing.
    .replace(/\]\s*\n[ \t]*\(/g, '](')
    // Long image-proxy URLs are also wrapped by some clipboard sources. A newline is
    // never meaningful inside an http(s) destination, so join only complete URL
    // destinations and leave ordinary multiline prose untouched.
    .replace(/\((https?:\/\/[^\s)]*(?:[ \t]*\n[ \t]*[^\s)]+)+)\)/gi, (match, destination) => (
      `(${destination.replace(/[ \t]*\n[ \t]*/g, '')})`
    ));
}

function isEscapedAt(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function findUnescapedToken(text, token, start = 0) {
  for (let index = Math.max(0, start); index <= text.length - token.length; index += 1) {
    if (text.startsWith(token, index) && !isEscapedAt(text, index)) return index;
  }
  return -1;
}

function findClosingParen(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (isEscapedAt(text, index)) continue;
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function unescapeMarkdownText(text) {
  return String(text ?? '').replace(/\\([\\`*_{}\[\]()#+.!|>~-])/g, '$1');
}

// `[label](destination "title")` keeps an optional title after the destination.
// Only the destination is a usable href, so the title must never reach the mark value.
function extractLinkDestination(raw) {
  const source = String(raw ?? '').trim();
  if (!source) return '';
  if (source.startsWith('<')) {
    const close = findUnescapedToken(source, '>', 1);
    if (close > 0) return unescapeMarkdownText(source.slice(1, close)).trim();
  }
  let end = 0;
  while (end < source.length && !(/\s/.test(source[end]) && !isEscapedAt(source, end))) end += 1;
  return unescapeMarkdownText(source.slice(0, end)).trim();
}

function parseInlineMarkdown(markdown) {
  const source = normalizeMarkdownLinkWhitespace(markdown);
  let text = '';
  const marks = [];

  const append = (value, activeMarks = []) => {
    if (!value) return;
    const from = text.length;
    text += value;
    const to = text.length;
    for (const active of activeMarks) marks.push({ type: active.type, from, to, ...(active.value ? { value: active.value } : {}) });
  };

  const parse = (segment, activeMarks = []) => {
    let index = 0;
    while (index < segment.length) {
      if (segment[index] === '\\' && index + 1 < segment.length) {
        append(segment[index + 1], activeMarks);
        index += 2;
        continue;
      }

      if (segment[index] === '`') {
        const close = findUnescapedToken(segment, '`', index + 1);
        if (close > index + 1) {
          append(segment.slice(index + 1, close), [...activeMarks, { type: 'code' }]);
          index = close + 1;
          continue;
        }
      }

      if (segment.startsWith('![[', index)) {
        const close = findUnescapedToken(segment, ']]', index + 3);
        if (close > index + 3) {
          const raw = segment.slice(index + 3, close);
          const separator = raw.indexOf('|');
          const target = unescapeMarkdownText(separator >= 0 ? raw.slice(0, separator) : raw).trim();
          const label = unescapeMarkdownText(separator >= 0 ? raw.slice(separator + 1) : raw).trim() || target;
          if (target) append(label, [...activeMarks, { type: 'link', value: `wikiembed:${target}` }]);
          else append(segment.slice(index, close + 2), activeMarks);
          index = close + 2;
          continue;
        }
      }

      if (segment.startsWith('[[', index)) {
        const close = findUnescapedToken(segment, ']]', index + 2);
        if (close > index + 2) {
          const raw = segment.slice(index + 2, close);
          const separator = raw.indexOf('|');
          const target = unescapeMarkdownText(separator >= 0 ? raw.slice(0, separator) : raw).trim();
          const label = unescapeMarkdownText(separator >= 0 ? raw.slice(separator + 1) : raw).trim() || target;
          if (target) append(label, [...activeMarks, { type: 'link', value: `wikilink:${target}` }]);
          else append(segment.slice(index, close + 2), activeMarks);
          index = close + 2;
          continue;
        }
      }

      if (segment[index] === '<') {
        const close = findUnescapedToken(segment, '>', index + 1);
        if (close > index + 1) {
          const destination = segment.slice(index + 1, close).trim();
          if (/^(https?:\/\/|mailto:)/i.test(destination)) {
            append(destination.replace(/^mailto:/i, ''), [...activeMarks, { type: 'link', value: destination }]);
            index = close + 1;
            continue;
          }
        }
      }

      if (segment[index] === '[' && !segment.startsWith('[[', index)) {
        const closeBracket = findUnescapedToken(segment, ']', index + 1);
        if (closeBracket > index + 1 && segment[closeBracket + 1] === '(') {
          const closeParen = findClosingParen(segment, closeBracket + 1);
          if (closeParen > closeBracket + 2) {
            const label = segment.slice(index + 1, closeBracket);
            const destination = extractLinkDestination(segment.slice(closeBracket + 2, closeParen));
            if (destination) {
              parse(label, [...activeMarks, { type: 'link', value: destination }]);
              index = closeParen + 1;
              continue;
            }
          }
        }
      }

      if (segment.startsWith('((', index)) {
        const match = segment.slice(index).match(/^\(\(([A-Za-z0-9_-]+)(?:\s+(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'))?\)\)/);
        if (match) {
          const target = match[1];
          const label = unescapeMarkdownText(String(match[2] ?? match[3] ?? target).replace(/\\(["'])/g, '$1')).trim() || target;
          append(label, [...activeMarks, { type: 'link', value: `blockref:${target}` }]);
          index += match[0].length;
          continue;
        }
      }

      // A highlight mark without a semantic color is dropped during normalization, so
      // `==text==` must carry one or both the markers and the emphasis are lost.
      const delimiters = [
        ['**', 'bold'], ['__', 'bold'], ['~~', 'strike'], ['==', 'highlight', 'yellow'], ['*', 'italic'], ['_', 'italic'],
      ];
      let matched = false;
      for (const [delimiter, type, value] of delimiters) {
        if (!segment.startsWith(delimiter, index)) continue;
        if (delimiter === '_' && index > 0 && /[\p{L}\p{N}]/u.test(segment[index - 1] || '')) continue;
        const close = findUnescapedToken(segment, delimiter, index + delimiter.length);
        if (close <= index + delimiter.length) continue;
        if (delimiter === '_' && /[\p{L}\p{N}]/u.test(segment[close + delimiter.length] || '')) continue;
        parse(segment.slice(index + delimiter.length, close), [...activeMarks, value ? { type, value } : { type }]);
        index = close + delimiter.length;
        matched = true;
        break;
      }
      if (matched) continue;

      let next = index + 1;
      while (next < segment.length && !'\\`[<(*_~='.includes(segment[next])) next += 1;
      append(segment.slice(index, next), activeMarks);
      index = next;
    }
  };

  parse(source);
  return { text, marks: normalizeInlineMarks(marks, text.length) };
}

function containsMarkdownMedia(markdown) {
  const text = normalizeMarkdownLinkWhitespace(markdown);
  return /!\[\[[^\]]+\]\]/.test(text) || /!\[[\s\S]*?\]\([^\n]+?\)/.test(text);
}

function markdownResourceType(target) {
  const clean = String(target || '').split(/[?#]/, 1)[0].toLowerCase();
  const extension = (clean.match(/\.([a-z0-9]{2,8})$/i) || [])[1] || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'heic'].includes(extension)) return 'image';
  if (['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'].includes(extension)) return 'audio';
  if (extension === 'pdf') return 'attachment';
  return '';
}

function splitMarkdownTableRow(line) {
  let source = String(line || '').trim();
  if (source.startsWith('|')) source = source.slice(1);
  if (source.endsWith('|') && !source.endsWith('\\|')) source = source.slice(0, -1);
  const cells = [];
  let current = '';
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
      current += character;
    } else if (character === '|') {
      cells.push(current.trim().replace(/\\\|/g, '|'));
      current = '';
    } else current += character;
  }
  if (escaped) current += '\\';
  cells.push(current.trim().replace(/\\\|/g, '|'));
  return cells;
}

function parseMarkdownTable(markdown) {
  const lines = splitLines(String(markdown || '').trim()).filter((line) => line.trim());
  if (lines.length < 2 || !lines[0].includes('|') || !lines[1].includes('|')) return null;
  const headers = splitMarkdownTableRow(lines[0]);
  const separators = splitMarkdownTableRow(lines[1]);
  if (!headers.length || headers.length !== separators.length) return null;
  if (!separators.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))) return null;
  const columns = headers.map((name, index) => {
    const separator = separators[index].replace(/\s+/g, '');
    const align = separator.startsWith(':') && separator.endsWith(':')
      ? 'center'
      : separator.endsWith(':') ? 'right' : 'left';
    return { id: randomId('column'), name, align, width: 0 };
  });
  const rows = lines.slice(2).map((line) => {
    const values = splitMarkdownTableRow(line);
    const cells = {};
    columns.forEach((column, index) => { cells[column.id] = values[index] || ''; });
    return { id: randomId('row'), cells };
  });
  return createBlock('table', '', { data: { header: true, columns, rows } });
}

function parseAdvancedMarkdownBlock(markdown) {
  const source = normalizeMarkdownLinkWhitespace(markdown).trim();
  if (!source) return null;
  const table = parseMarkdownTable(source);
  if (table) return table;

  let match = source.match(/^!\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]$/);
  if (match) {
    const rawTarget = match[1].trim();
    const type = markdownResourceType(rawTarget);
    if (!type) return null;
    const hashIndex = rawTarget.indexOf('#');
    const path = (hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget).trim();
    const fragment = hashIndex >= 0 ? rawTarget.slice(hashIndex + 1) : '';
    const size = String(match[2] || '').trim().match(/^(\d+)(?:x(\d+))?$/);
    if (type === 'image') {
      return createBlock('image', '', {
        data: {
          sourceType: 'vault',
          path,
          alt: '',
          width: size ? Number(size[1]) : 0,
          height: size && size[2] ? Number(size[2]) : 0,
        },
      });
    }
    if (type === 'video' || type === 'audio') {
      return createBlock(type, '', { data: { sourceType: 'vault', path, title: path.split('/').pop() || path } });
    }
    const page = Number((fragment.match(/(?:^|&)page=(\d+)/i) || [])[1]) || 0;
    const height = Number((fragment.match(/(?:^|&)height=(\d+)/i) || [])[1]) || 0;
    return createBlock('attachment', '', {
      data: {
        sourceType: 'vault',
        path,
        name: path.split('/').pop() || path,
        mime: 'application/pdf',
        embed: true,
        page,
        height,
      },
    });
  }

  match = source.match(/^!\[([^\]]*)\]\((\S+?)(?:\s+["'][^"']*["'])?\)$/);
  if (match) {
    const url = match[2].trim();
    const type = markdownResourceType(url);
    if (type !== 'image' && !/^https?:\/\//i.test(url)) return null;
    const altParts = match[1].match(/^(.*?)(?:\|(\d+)(?:x(\d+))?)?$/);
    return createBlock('image', '', {
      data: {
        sourceType: 'remote',
        url,
        alt: altParts ? altParts[1] : match[1],
        width: altParts && altParts[2] ? Number(altParts[2]) : 0,
        height: altParts && altParts[3] ? Number(altParts[3]) : 0,
      },
    });
  }
  return null;
}

function shouldPreserveRawMarkdown(markdown) {
  const text = String(markdown ?? '').trim();
  if (!text) return false;
  return containsMarkdownMedia(text)
    || /^#{4,6}\s+/m.test(text)
    || /^\s*\$\$[\s\S]*\$\$\s*$/m.test(text)
    || /^\s*<\/?(?:iframe|video|audio|picture|figure|table|details|div)\b/i.test(text)
    || /^\[\^[^\]]+\]:/m.test(text);
}

function isCompleteMarkdownMedia(markdown) {
  const text = normalizeMarkdownLinkWhitespace(markdown).trim();
  if (!text) return false;
  return /^!\[\[[^\]]+\]\]$/.test(text)
    || /^!\[[^\]]*\]\([\s\S]+\)$/.test(text)
    || /^\[!\[[^\]]*\]\([\s\S]+\)\]\([\s\S]+\)$/.test(text);
}

function isCompleteRawMarkdownBlock(markdown) {
  const text = normalizeMarkdownLinkWhitespace(markdown).trim();
  if (!text) return false;
  return isCompleteMarkdownMedia(text)
    || /^#{4,6}\s+/m.test(text)
    || /^\s*\$\$[\s\S]*\$\$\s*$/m.test(text)
    || /^\s*<\/?(?:iframe|video|audio|picture|figure|table|details|div)\b/i.test(text)
    || /^\[\^[^\]]+\]:/m.test(text);
}

function looksLikeRawMarkdownText(markdown) {
  const text = normalizeMarkdownLinkWhitespace(markdown).trim();
  if (!text) return false;
  return shouldPreserveRawMarkdown(text)
    || /\[[^\]\n]+\]\([^\n)]+\)|\[\[[^\]]+\]\]/.test(text)
    || /\*\*[^*\n]+\*\*|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`/.test(text);
}

// Closing characters that can complete an inline span. Checking this first keeps the
// per-keystroke cost at one character comparison for ordinary typing.
const INLINE_MARKDOWN_CLOSERS = new Set([']', ')', '`', '*', '_', '~', '=']);

const notPrecededBy = (character) => (head, from) => head[from - 1] !== character;
const notInsideWord = (head, from) => !/[\p{L}\p{N}]/u.test(head[from - 1] || '');

// Ordered longest-delimiter-first so `**bold**` never matches the italic rule.
const TRAILING_INLINE_PATTERNS = [
  { pattern: /!?\[\[[^\]\n]+\]\]$/ },
  { pattern: /\(\([A-Za-z0-9_-]+(?:\s+(?:"(?:\\.|[^"\n])*"|'(?:\\.|[^'\n])*'))?\)\)$/ },
  { pattern: /\[[^\[\]\n]*\]\([^\s()\n]+(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\)$/ },
  { pattern: /`[^`\n]+`$/ },
  { pattern: /\*\*[^*\n]+\*\*$/ },
  { pattern: /__[^_\n]+__$/, guard: notInsideWord },
  { pattern: /~~[^~\n]+~~$/ },
  { pattern: /==[^=\n]+==$/ },
  { pattern: /\*[^*\n]+\*$/, guard: notPrecededBy('*') },
  { pattern: /_[^_\n]+_$/, guard: (head, from) => notPrecededBy('_')(head, from) && notInsideWord(head, from) },
];

function matchTrailingInlineMarkdown(head) {
  if (!head || !INLINE_MARKDOWN_CLOSERS.has(head[head.length - 1])) return null;
  for (const { pattern, guard } of TRAILING_INLINE_PATTERNS) {
    const match = pattern.exec(head);
    if (!match) continue;
    if (guard && !guard(head, match.index)) continue;
    return { from: match.index };
  }
  return null;
}

// Turns the Markdown span that just closed at the caret into real inline marks, so
// typing a link behaves like pasting one instead of leaving literal brackets behind.
function convertTrailingInlineMarkdown(block, caret) {
  const normalized = normalizeBlock(block);
  const text = normalized.text;
  const to = Math.max(0, Math.min(Number(caret) || 0, text.length));
  const match = matchTrailingInlineMarkdown(text.slice(0, to));
  if (!match) return null;
  const from = match.from;
  // Never rewrite a span that already carries formatting.
  if (normalized.marks.some((mark) => mark.from < to && mark.to > from)) return null;
  const parsed = parseInlineMarkdown(text.slice(from, to));
  if (!parsed.marks.length) return null;
  const nextText = text.slice(0, from) + parsed.text + text.slice(to);
  const delta = parsed.text.length - (to - from);
  const marks = [];
  for (const mark of normalized.marks) {
    const shift = (index) => (index >= to ? index + delta : index);
    marks.push({ ...mark, from: shift(mark.from), to: shift(mark.to) });
  }
  for (const mark of parsed.marks) marks.push({ ...mark, from: mark.from + from, to: mark.to + from });
  return {
    text: nextText,
    marks: normalizeInlineMarks(marks, nextText.length),
    caret: from + parsed.text.length,
  };
}

function replaceInlineRangeWithMarkdown(block, from, to, markdown) {
  const normalized = normalizeBlock(block);
  if (!INLINE_TEXT_BLOCK_TYPES.has(normalized.type)) return null;
  const start = Math.max(0, Math.min(Number(from) || 0, normalized.text.length));
  const end = Math.max(start, Math.min(Number(to) || start, normalized.text.length));
  const parsed = parseInlineMarkdown(markdown);
  if (!parsed.marks.length) return null;

  const nextText = normalized.text.slice(0, start) + parsed.text + normalized.text.slice(end);
  const delta = parsed.text.length - (end - start);
  const marks = [];
  for (const mark of normalized.marks) {
    if (mark.from < start) marks.push({ ...mark, to: Math.min(mark.to, start) });
    if (mark.to > end) {
      marks.push({
        ...mark,
        from: Math.max(mark.from, end) + delta,
        to: mark.to + delta,
      });
    }
  }
  for (const mark of parsed.marks) marks.push({ ...mark, from: mark.from + start, to: mark.to + start });
  return {
    text: nextText,
    marks: normalizeInlineMarks(marks, nextText.length),
    caret: start + parsed.text.length,
  };
}

// Some older clipboard/import paths stored a linked image as two or more adjacent
// paragraph blocks. Repair only complete, anchored media expressions so unrelated
// prose is never merged merely because it contains brackets or a URL.
function repairSplitMarkdownMedia(page) {
  const map = blockMap(page);
  const removed = new Set();
  let changed = 0;
  const isCandidate = (block) => Boolean(
    block
    && block.type === 'paragraph'
    && (!Array.isArray(block.marks) || block.marks.length === 0)
    && (!Array.isArray(block.children) || block.children.length === 0)
  );

  const repairSiblings = (siblingIds) => {
    for (let index = 0; index < siblingIds.length; index += 1) {
      const first = map.get(siblingIds[index]);
      if (isCandidate(first)) {
        const maxEnd = Math.min(siblingIds.length, index + 12);
        for (let end = index + 2; end <= maxEnd; end += 1) {
          const group = siblingIds.slice(index, end).map((id) => map.get(id));
          if (!group.every(isCandidate)) break;
          const candidate = normalizeMarkdownLinkWhitespace(group.map((block) => block.text).join('\n')).trim();
          if (!isCompleteMarkdownMedia(candidate)) continue;
          first.type = 'markdown';
          first.text = candidate;
          first.marks = [];
          for (const block of group.slice(1)) {
            removed.add(block.id);
            map.delete(block.id);
          }
          siblingIds.splice(index + 1, group.length - 1);
          changed += group.length;
          break;
        }
      }
      const current = map.get(siblingIds[index]);
      if (current && Array.isArray(current.children) && current.children.length) repairSiblings(current.children);
    }
  };

  repairSiblings(page.rootBlockIds);
  if (removed.size) {
    page.blocks = page.blocks.filter((block) => !removed.has(block.id));
    rebuildBlockOrder(page);
  }
  return changed;
}

// Pages imported before Markdown parsing existed store syntax as plain text, and one
// legacy paste path even split linked images across sibling blocks. Re-run the
// conservative parser so opening an old page produces the same structure as a fresh
// import without touching code blocks or ordinary prose.
function reparseInlineMarkdown(page) {
  if (!page || !Array.isArray(page.blocks) || !Array.isArray(page.rootBlockIds)) return 0;
  let changed = repairSplitMarkdownMedia(page);
  for (const block of page.blocks) {
    if (!INLINE_TEXT_BLOCK_TYPES.has(block.type)) continue;
    const text = String(block.text ?? '');
    if (!text.trim()) continue;
    const normalized = normalizeMarkdownLinkWhitespace(text).trim();
    // A complete raw-media expression is atomic. Older builds sometimes attached
    // underline/link marks to a slice of its URL, so structural repair must win over
    // those stale marks rather than skipping the block as "already formatted".
    if (block.type === 'paragraph' && (!block.children || block.children.length === 0) && isCompleteRawMarkdownBlock(normalized)) {
      block.type = 'markdown';
      block.text = normalized;
      block.marks = [];
      changed += 1;
      continue;
    }
    if (Array.isArray(block.marks) && block.marks.length) continue;
    if (shouldPreserveRawMarkdown(text) || !looksLikeRawMarkdownText(text)) continue;
    const parsed = parseInlineMarkdown(text);
    if (!parsed.marks.length) continue;
    block.text = parsed.text;
    block.marks = parsed.marks;
    changed += 1;
  }
  return changed;
}

function createInlineMarkdownBlock(type, markdown, extras = {}) {
  const parsed = parseInlineMarkdown(markdown);
  return createBlock(type, parsed.text, { ...extras, marks: parsed.marks });
}

function markdownToBlocks(markdown) {
  const lines = splitLines(markdown);
  const blocks = [];
  const listStack = [];
  let inCode = false;
  let codeFenceLength = 3;
  let codeBuffer = [];
  let inRawMarkdown = false;
  let rawMarkdownBuffer = [];
  let paragraphBuffer = [];
  let pendingDepth = null;
  let pendingQuotePrefixes = 0;
  let skipGeneratedToc = false;
  const columnsStack = [];

  const addBlock = (block, depth = 0, structural = false) => {
    const activeColumns = columnsStack[columnsStack.length - 1];
    const defaultDepth = !structural && activeColumns && activeColumns.columnOpen
      ? activeColumns.contentDepth + depth
      : depth;
    block.depth = Math.max(0, pendingDepth == null ? defaultDepth : pendingDepth);
    blocks.push(block);
    pendingDepth = null;
    pendingQuotePrefixes = 0;
  };
  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const source = normalizeMarkdownLinkWhitespace(paragraphBuffer.join('\n').trim());
    if (source) {
      const advanced = parseAdvancedMarkdownBlock(source);
      if (advanced) addBlock(advanced);
      else if (shouldPreserveRawMarkdown(source)) addBlock(createBlock('markdown', source));
      else addBlock(createInlineMarkdownBlock('paragraph', source));
    }
    paragraphBuffer = [];
  };
  const flushCode = () => { addBlock(createBlock('code', codeBuffer.join('\n'))); codeBuffer = []; };
  const flushRawMarkdown = () => { addBlock(createBlock('markdown', rawMarkdownBuffer.join('\n'))); rawMarkdownBuffer = []; };

  for (const rawLine of lines) {
    let line = rawLine;
    const columnsStart = line.trim().match(/^<!--\s*blockspace:columns(?:\s+count=(2|3))?(?:\s+ratio=([\d:]+))?\s*-->$/);
    if (columnsStart) {
      flushParagraph();
      const parentColumns = columnsStack[columnsStack.length - 1];
      const baseDepth = parentColumns && parentColumns.columnOpen ? parentColumns.contentDepth : 0;
      const columnsBlock = createBlock('columns', '', {
        columns: { count: Number(columnsStart[1]) || 2, ratio: columnsStart[2] || '' },
      });
      addBlock(columnsBlock, baseDepth, true);
      columnsStack.push({ baseDepth, contentDepth: baseDepth + 2, columnOpen: false });
      continue;
    }
    if (line.trim() === '<!-- blockspace:column -->' && columnsStack.length) {
      flushParagraph();
      const activeColumns = columnsStack[columnsStack.length - 1];
      addBlock(createBlock('column'), activeColumns.baseDepth + 1, true);
      activeColumns.columnOpen = true;
      continue;
    }
    if (line.trim() === '<!-- blockspace:column:end -->' && columnsStack.length) {
      flushParagraph();
      columnsStack[columnsStack.length - 1].columnOpen = false;
      continue;
    }
    if (line.trim() === '<!-- blockspace:columns:end -->' && columnsStack.length) {
      flushParagraph();
      columnsStack.pop();
      continue;
    }
    const depthMarker = line.match(/^((?:>\s*)*)<!--\s*blockspace:depth:(\d+)\s*-->$/);
    if (depthMarker) {
      flushParagraph();
      pendingDepth = Math.max(0, Number(depthMarker[2]) || 0);
      pendingQuotePrefixes = (depthMarker[1].match(/>/g) || []).length;
      continue;
    }
    for (let count = 0; count < pendingQuotePrefixes && /^>\s?/.test(line); count += 1) {
      line = line.replace(/^>\s?/, '');
    }
    if (line.trim() === '<!-- blockspace:markdown:start -->') {
      flushParagraph();
      if (inCode) { flushCode(); inCode = false; }
      inRawMarkdown = true;
      rawMarkdownBuffer = [];
      continue;
    }
    if (line.trim() === '<!-- blockspace:markdown:end -->' && inRawMarkdown) {
      flushRawMarkdown();
      inRawMarkdown = false;
      continue;
    }
    if (inRawMarkdown) { rawMarkdownBuffer.push(line); continue; }
    const fenceMatch = line.trim().match(/^(`{3,})(.*)$/);
    if (fenceMatch && (!inCode || fenceMatch[1].length >= codeFenceLength)) {
      flushParagraph();
      if (inCode) {
        flushCode();
        inCode = false;
        codeFenceLength = 3;
      } else {
        inCode = true;
        codeFenceLength = fenceMatch[1].length;
      }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }
    if (skipGeneratedToc) {
      if (!line.trim() || /^(\s*)[-*+]\s+/.test(line)) continue;
      skipGeneratedToc = false;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    if (line.trim() === '<!-- blockspace:toc -->') {
      flushParagraph();
      addBlock(createBlock('table-of-contents'));
      skipGeneratedToc = true;
      continue;
    }
    let match = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (match) {
      flushParagraph();
      if (match[1].length <= 3) addBlock(createInlineMarkdownBlock(`heading-${match[1].length}`, match[2]));
      else addBlock(createBlock('markdown', normalizeMarkdownLinkWhitespace(line)));
      continue;
    }
    match = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (match) { flushParagraph(); addBlock(createInlineMarkdownBlock('todo', match[3], { checked: match[2].toLowerCase() === 'x' }), Math.floor(match[1].replace(/\t/g, '  ').length / 2)); continue; }
    match = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (match) { flushParagraph(); addBlock(createInlineMarkdownBlock('bulleted-list', match[2]), Math.floor(match[1].replace(/\t/g, '  ').length / 2)); continue; }
    match = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (match) { flushParagraph(); addBlock(createInlineMarkdownBlock('numbered-list', match[2]), Math.floor(match[1].replace(/\t/g, '  ').length / 2)); continue; }
    match = line.match(/^\s*>\s*\[![^\]]+\]\s*(.*)$/);
    if (match) { flushParagraph(); addBlock(createInlineMarkdownBlock('callout', match[1])); continue; }
    match = line.match(/^\s*>\s?(.*)$/);
    if (match) { flushParagraph(); addBlock(createInlineMarkdownBlock('quote', match[1])); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushParagraph(); addBlock(createBlock('divider', '')); continue; }
    paragraphBuffer.push(line);
  }
  flushParagraph();
  if (inCode) flushCode();
  if (inRawMarkdown) flushRawMarkdown();
  const tree = normalizeBlockTree(blocks.length ? blocks : [createBlock()], null, 0);
  return tree.blocks;
}

function escapeMarkdownText(text) {
  return String(text ?? '').replace(/([\\`*_{}\[\]()#+.!|>~-])/g, '\\$1');
}

function inlineTextToMarkdown(block, options = {}) {
  const normalized = normalizeBlock(block);
  const nativeObsidian = options.profile === 'obsidian-native';
  if (!normalized.text) return normalized.text;
  if (!normalized.marks.length) return looksLikeRawMarkdownText(normalized.text)
    ? normalizeMarkdownLinkWhitespace(normalized.text)
    : normalized.text;
  const boundaries = new Set([0, normalized.text.length]);
  for (const mark of normalized.marks) { boundaries.add(mark.from); boundaries.add(mark.to); }
  const points = Array.from(boundaries).sort((a, b) => a - b);
  const colorMap = { gray: '#7a7a7a', brown: '#9a6b4a', orange: '#d9730d', yellow: '#cb912f', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' };
  const backgroundMap = { gray: '#e8e8e8', brown: '#eee0da', orange: '#fadec9', yellow: '#fdecc8', green: '#dbeddb', blue: '#d3e5ef', purple: '#e8deee', pink: '#f5e0e9', red: '#ffe2dd' };
  const parts = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]; const to = points[index + 1];
    if (to <= from) continue;
    const active = normalized.marks.filter((mark) => mark.from <= from && mark.to >= to);
    let text = escapeMarkdownText(normalized.text.slice(from, to));
    if (active.some((mark) => mark.type === 'code')) text = `\`${normalized.text.slice(from, to).replace(/`/g, '\\`')}\``;
    else {
      if (active.some((mark) => mark.type === 'bold')) text = `**${text}**`;
      if (active.some((mark) => mark.type === 'italic')) text = `*${text}*`;
      if (active.some((mark) => mark.type === 'strike')) text = `~~${text}~~`;
      // Yellow is the canonical `==` highlight; other colors need the HTML span below.
      // Emitting both wrappers for one mark made the export unstable across a round trip.
      if (active.some((mark) => mark.type === 'highlight' && mark.value === 'yellow')) text = `==${text}==`;
      if (!nativeObsidian && active.some((mark) => mark.type === 'underline')) text = `<u>${text}</u>`;
    }
    const link = active.find((mark) => mark.type === 'link');
    if (link) {
      const value = String(link.value || '');
      const plain = normalized.text.slice(from, to);
      const custom = typeof options.linkResolver === 'function'
        ? options.linkResolver({ value, plain, reference: parseStoredReference(value) })
        : null;
      if (typeof custom === 'string') {
        text = custom;
      } else if (value.startsWith('wikilink:')) {
        const target = value.slice('wikilink:'.length);
        text = plain === target ? `[[${target}]]` : `[[${target}|${plain}]]`;
      } else if (value.startsWith('wikiembed:')) {
        const target = value.slice('wikiembed:'.length);
        text = plain === target ? `![[${target}]]` : `![[${target}|${plain}]]`;
      } else if (value.startsWith('blockref:')) {
        const target = value.slice('blockref:'.length);
        const escaped = plain.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        text = `((${target} "${escaped}"))`;
      } else if (value.startsWith('blockembed:')) {
        const target = value.slice('blockembed:'.length);
        const escaped = plain.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        text = `![](blockspace://block/${encodeURIComponent(target)} "${escaped}")`;
      } else if (value.startsWith('blockspace-page:')) {
        const target = value.slice('blockspace-page:'.length);
        text = `[${text}](blockspace://page/${encodeURIComponent(target)})`;
      } else if (value.startsWith('blockspace-block:')) {
        const target = value.slice('blockspace-block:'.length);
        text = `[${text}](blockspace://block/${encodeURIComponent(target)})`;
      } else text = `[${text}](${value.replace(/\)/g, '\\)')})`;
    }
    const foreground = active.find((mark) => mark.type === 'textColor');
    const highlight = active.find((mark) => mark.type === 'highlight');
    const styles = [];
    if (foreground && colorMap[foreground.value]) styles.push(`color:${colorMap[foreground.value]}`);
    if (highlight && highlight.value !== 'yellow' && backgroundMap[highlight.value]) styles.push(`background-color:${backgroundMap[highlight.value]}`);
    if (!nativeObsidian && styles.length) text = `<span style="${styles.join(';')}">${text}</span>`;
    parts.push(text);
  }
  return parts.join('');
}

function blockAppearanceToHtml(text, appearance, options = {}) {
  if (options.profile === 'obsidian-native') return text;
  const normalized = normalizeBlockAppearance(appearance);
  const colorMap = { gray: '#7a7a7a', brown: '#9a6b4a', orange: '#d9730d', yellow: '#a07400', green: '#448361', blue: '#337ea9', purple: '#9065b0', pink: '#c14c8a', red: '#d44c47' };
  const backgroundMap = { gray: '#e8e8e8', brown: '#eee0da', orange: '#fadec9', yellow: '#fdecc8', green: '#dbeddb', blue: '#d3e5ef', purple: '#e8deee', pink: '#f5e0e9', red: '#ffe2dd' };
  const styles = [];
  if (normalized.textColor !== 'default') styles.push(`color:${colorMap[normalized.textColor]}`);
  if (normalized.background !== 'default') styles.push(`background-color:${backgroundMap[normalized.background]}`, 'padding:2px 6px', 'border-radius:4px');
  if (normalized.align !== 'left') styles.push(`text-align:${normalized.align}`);
  return styles.length ? `<div style="${styles.join(';')}">${text}</div>` : text;
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
}

function advancedBlockToMarkdown(block) {
  const data = normalizeBlockData(block.type, block.data) || {};
  if (block.type === 'table') {
    const columns = data.columns || [];
    const header = `| ${columns.map((column) => escapeMarkdownTableCell(column.name)).join(' | ')} |`;
    const separator = `| ${columns.map((column) => (
      column.align === 'center' ? ':---:'
        : column.align === 'right' ? '---:'
          : '---'
    )).join(' | ')} |`;
    const rows = (data.rows || []).map((row) => (
      `| ${columns.map((column) => escapeMarkdownTableCell(row.cells && row.cells[column.id])).join(' | ')} |`
    ));
    return [header, separator, ...rows].join('\n');
  }
  if (block.type === 'bookmark') {
    const label = String(data.title || block.text || data.url || '链接').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
    return data.url ? `[${label}](${data.url})` : label;
  }
  const source = data.sourceType === 'remote' ? data.url : data.path;
  if (!source) return block.text || '';
  if (block.type === 'image') {
    const alt = String(data.alt || block.text || '').replace(/\]/g, '\\]');
    const size = data.width ? `|${data.width}${data.height ? `x${data.height}` : ''}` : '';
    const image = data.sourceType === 'remote'
      ? `![${alt}${size}](${source})`
      : `![[${source}${size}]]`;
    return data.link ? `[${image}](${data.link})` : image;
  }
  if (block.type === 'video' || block.type === 'audio') {
    if (data.sourceType === 'vault') return `![[${source}]]`;
    const label = String(data.title || block.text || source).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
    return `[${label}](${source})`;
  }
  if (block.type === 'attachment') {
    const fragment = [
      data.page ? `page=${data.page}` : '',
      data.height ? `height=${data.height}` : '',
    ].filter(Boolean).join('&');
    if (data.sourceType === 'vault') {
      const target = `${source}${fragment ? `#${fragment}` : ''}`;
      const label = String(data.name || '').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
      if (data.embed) return `![[${target}]]`;
      return label && label !== source ? `[[${target}|${label}]]` : `[[${target}]]`;
    }
    const label = String(data.name || block.text || source).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
    return `[${label}](${source})`;
  }
  return block.text || '';
}

function blocksToMarkdown(blocksOrPage, title = '', options = {}) {
  if (title && typeof title === 'object') {
    options = title;
    title = '';
  }
  const page = Array.isArray(blocksOrPage)
    ? normalizePage({ title: title || 'Untitled', blocks: blocksOrPage })
    : normalizePage(blocksOrPage);
  const nativeObsidian = options.profile === 'obsidian-native';
  const map = blockMap(page);
  const output = [];
  if (title) output.push(`# ${String(title).trim()}`, '');
  const render = (id, depth, context = {}) => {
    const block = map.get(id);
    if (!block) return;
    const text = blockAppearanceToHtml(inlineTextToMarkdown(block, options), block.appearance, options);
    const indent = '  '.repeat(depth);
    const quotePrefix = context.quotePrefix || '';
    const anchor = typeof options.blockAnchor === 'function' ? String(options.blockAnchor(block) || '') : '';
    const anchorSuffix = anchor ? ` ^${anchor}` : '';
    const emit = (...lines) => {
      for (const value of lines) {
        const parts = String(value ?? '').split('\n');
        for (const part of parts) output.push(part ? `${quotePrefix}${part}` : quotePrefix.trimEnd());
      }
    };
    switch (block.type) {
      case 'heading-1': emit(`${indent}# ${text}${anchorSuffix}`); break;
      case 'heading-2': emit(`${indent}## ${text}${anchorSuffix}`); break;
      case 'heading-3': emit(`${indent}### ${text}${anchorSuffix}`); break;
      case 'table-of-contents': {
        if (!nativeObsidian) emit(`${indent}<!-- blockspace:toc -->`);
        const items = deriveOutline(page, block.toc);
        for (const item of items) {
          const relative = Math.max(0, item.level - block.toc.minLevel);
          const prefix = block.toc.showNumbers && item.numberPath ? `${item.numberPath} ` : '';
          if (nativeObsidian) {
            const target = String(item.title || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
            const label = `${prefix}${String(item.title || '')}`.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\]/g, '\\]');
            emit(`${indent}${'  '.repeat(relative)}- [[#${target}|${label}]]`);
          } else {
            emit(`${indent}${'  '.repeat(relative)}- ${prefix}${escapeMarkdownText(item.title)}`);
          }
        }
        break;
      }
      case 'columns':
        if (!nativeObsidian) emit(`${indent}<!-- blockspace:columns count=${block.columns.count} ratio=${block.columns.ratio} -->`);
        break;
      case 'column':
        if (!nativeObsidian) emit(`${indent}<!-- blockspace:column -->`);
        break;
      case 'todo': emit(`${indent}- [${block.checked ? 'x' : ' '}] ${text}${anchorSuffix}`); break;
      case 'bulleted-list': emit(`${indent}- ${text}${anchorSuffix}`); break;
      case 'numbered-list': emit(`${indent}1. ${text}${anchorSuffix}`); break;
      case 'quote': emit(`${indent}> ${text}`); if (anchor) emit('', `${indent}^${anchor}`); break;
      case 'callout': emit(`${indent}> [!note] ${text}`); if (anchor) emit('', `${indent}^${anchor}`); break;
      case 'toggle':
        if (nativeObsidian) emit(`${indent}> [!note]${block.collapsed ? '-' : '+'} ${text || '详情'}`);
        else emit(`${indent}<details${block.collapsed ? '' : ' open'}>`, `${indent}<summary>${text}</summary>`);
        break;
      case 'code': {
        const longestFence = Math.max(0, ...Array.from(String(block.text || '').matchAll(/`+/g), (match) => match[0].length));
        const fence = '`'.repeat(Math.max(3, longestFence + 1));
        emit(`${indent}${fence}`, block.text, `${indent}${fence}`);
        break;
      }
      case 'markdown':
        if (nativeObsidian) emit(block.text);
        else {
          emit(`${indent}<!-- blockspace:markdown:start -->`);
          emit(block.text);
          emit(`${indent}<!-- blockspace:markdown:end -->`);
        }
        break;
      case 'image':
      case 'video':
      case 'audio':
      case 'attachment':
      case 'bookmark':
      case 'table':
        emit(advancedBlockToMarkdown(block).split('\n').map((line) => `${indent}${line}`).join('\n'));
        break;
      case 'divider': emit(`${indent}---`); break;
      default: emit(`${indent}${text}${anchorSuffix}`); break;
    }
    if (anchor && ['table-of-contents', 'toggle', 'code', 'markdown', 'divider', 'image', 'video', 'audio', 'attachment', 'bookmark', 'table'].includes(block.type)) emit('', `${indent}^${anchor}`);
    const quoteContainer = ['quote', 'callout'].includes(block.type) || (nativeObsidian && block.type === 'toggle');
    const structuralLayout = block.type === 'columns' || block.type === 'column';
    const childDepth = depth + (block.type === 'toggle' || structuralLayout ? 0 : 1);
    const childQuotePrefix = quoteContainer ? `${quotePrefix}> ` : quotePrefix;
    for (const childId of block.children) {
      if (!nativeObsidian && ['quote', 'callout'].includes(block.type)) {
        output.push(`${childQuotePrefix}<!-- blockspace:depth:${childDepth} -->`);
      }
      render(childId, childDepth, { parentType: block.type, quotePrefix: childQuotePrefix });
    }
    if (block.type === 'toggle' && !nativeObsidian) emit(`${indent}</details>`);
    if (block.type === 'column' && !nativeObsidian) emit(`${indent}<!-- blockspace:column:end -->`);
    if (block.type === 'columns' && !nativeObsidian) emit(`${indent}<!-- blockspace:columns:end -->`);
    if (!['todo', 'bulleted-list', 'numbered-list'].includes(block.type)) emit('');
  };
  for (const rootId of page.rootBlockIds) render(rootId, 0);
  return `${output.join('\n').trim()}\n`;
}


function blockToNativePreviewMarkdown(block) {
  const normalized = normalizeBlock(block);
  if (normalized.type === 'markdown') return normalized.text;
  if (normalized.type === 'code') return `\`\`\`\n${normalized.text}\n\`\`\``;
  return inlineTextToMarkdown(normalized, {
    linkResolver: ({ plain, reference }) => {
      if (reference.kind !== 'blockspace-block' && reference.kind !== 'blockspace-page') return null;
      const label = escapeMarkdownText(plain);
      const href = reference.kind === 'blockspace-block'
        ? `blockspace://block/${encodeURIComponent(reference.blockId)}`
        : `blockspace://page/${encodeURIComponent(reference.pageId)}`;
      return `[${label}](${href})`;
    },
  }).replace(/\n/g, '  \n');
}

function parseStoredReference(value) {
  const href = String(value || '').trim();
  if (!href) return { kind: 'empty', target: '', mode: 'link' };
  if (href.startsWith('blockspace-page:')) {
    const pageId = href.slice('blockspace-page:'.length).trim();
    return pageId ? { kind: 'blockspace-page', pageId, target: pageId, mode: 'link' } : { kind: 'empty', target: '', mode: 'link' };
  }
  if (href.startsWith('blockspace-block:')) {
    const blockId = href.slice('blockspace-block:'.length).trim();
    return blockId ? { kind: 'blockspace-block', blockId, target: blockId, mode: 'link' } : { kind: 'empty', target: '', mode: 'link' };
  }
  if (href.startsWith('blockref:') || href.startsWith('blockembed:')) {
    const mode = href.startsWith('blockembed:') ? 'embed' : 'reference';
    const blockId = href.slice(href.indexOf(':') + 1).trim();
    return blockId ? { kind: 'blockspace-block', blockId, target: blockId, mode } : { kind: 'empty', target: '', mode };
  }
  const blockspaceUri = href.match(/^blockspace:\/\/(page|block)\/([^/?#]+)/i);
  if (blockspaceUri) {
    let id = blockspaceUri[2];
    try { id = decodeURIComponent(id); } catch (error) { /* retain literal ID */ }
    return blockspaceUri[1].toLowerCase() === 'page'
      ? { kind: 'blockspace-page', pageId: id, target: id, mode: 'link' }
      : { kind: 'blockspace-block', blockId: id, target: id, mode: 'link' };
  }
  if (href.startsWith('wikilink:') || href.startsWith('wikiembed:')) {
    const mode = href.startsWith('wikiembed:') ? 'embed' : 'link';
    const target = href.slice('wikilink:'.length).trim();
    const normalizedTarget = mode === 'embed' ? href.slice('wikiembed:'.length).trim() : target;
    return normalizedTarget
      ? { kind: 'obsidian', target: normalizedTarget, mode }
      : { kind: 'empty', target: '', mode };
  }
  if (/^!?\[\[[^\]]+\]\]$/.test(href)) {
    const embed = href.startsWith('![[');
    const target = href.slice(embed ? 3 : 2, -2).split('|')[0].trim();
    return target ? { kind: 'obsidian', target, mode: embed ? 'embed' : 'link' } : { kind: 'empty', target: '', mode: embed ? 'embed' : 'link' };
  }
  const siyuan = href.match(/^\(\(([A-Za-z0-9_-]+)(?:\s+(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'))?\)\)$/);
  if (siyuan) return { kind: 'blockspace-block', blockId: siyuan[1], target: siyuan[1], mode: 'reference' };
  if (href.startsWith('//')) return { kind: 'external', target: `https:${href}`, protocol: 'https', mode: 'link' };
  const scheme = href.match(/^([a-z][a-z\d+.-]*):/i);
  if (!scheme) return { kind: 'obsidian', target: href, mode: 'link' };
  const protocol = scheme[1].toLowerCase();
  if (['http', 'https', 'mailto', 'obsidian'].includes(protocol)) {
    return { kind: 'external', target: href, protocol, mode: 'link' };
  }
  return { kind: 'blocked', target: href, protocol, mode: 'link' };
}

function classifyStoredLink(value) {
  const reference = parseStoredReference(value);
  if (reference.kind === 'obsidian') return { kind: 'internal', target: reference.target, ...(reference.mode !== 'link' ? { mode: reference.mode } : {}) };
  if (reference.kind === 'blockspace-page') return { kind: 'blockspace-page', target: reference.pageId, pageId: reference.pageId, mode: reference.mode };
  if (reference.kind === 'blockspace-block') return { kind: 'blockspace-block', target: reference.blockId, blockId: reference.blockId, mode: reference.mode };
  if (reference.kind === 'external') return { kind: 'external', target: reference.target, protocol: reference.protocol };
  if (reference.kind === 'blocked') return { kind: 'blocked', target: reference.target, protocol: reference.protocol };
  return { kind: 'empty', target: '' };
}

function referenceLookupKeys(page) {
  const normalized = normalizePage(page);
  const keys = new Set([normalized.id, normalized.title]);
  if (normalized.sourcePath) {
    keys.add(normalized.sourcePath);
    keys.add(normalized.sourcePath.replace(/\.md$/i, ''));
    const base = normalized.sourcePath.split('/').pop() || '';
    keys.add(base);
    keys.add(base.replace(/\.md$/i, ''));
  }
  return Array.from(keys).map((key) => String(key || '').trim().toLocaleLowerCase()).filter(Boolean);
}

function splitReferenceTarget(target) {
  const value = String(target || '');
  const hash = value.indexOf('#');
  if (hash < 0) return { path: value, subpath: '' };
  return { path: value.slice(0, hash), subpath: value.slice(hash + 1) };
}

function resolveStoredReference(valueOrReference, index, sourcePageId = null) {
  const reference = typeof valueOrReference === 'string' ? parseStoredReference(valueOrReference) : valueOrReference;
  if (!reference || !index) return null;
  if (reference.kind === 'blockspace-page') {
    const page = index.pagesById.get(reference.pageId);
    return page ? { ...reference, pageId: page.id, page } : { ...reference, unresolved: true };
  }
  if (reference.kind === 'blockspace-block') {
    const location = index.blockLocations.get(reference.blockId);
    if (!location) return { ...reference, unresolved: true };
    return { ...reference, pageId: location.pageId, blockId: location.blockId, page: location.page, block: location.block };
  }
  if (reference.kind !== 'obsidian') return reference;

  const target = splitReferenceTarget(reference.target);
  let pageIds = [];
  if (!target.path && sourcePageId) pageIds = [sourcePageId];
  else {
    const key = target.path.replace(/\.md$/i, '').trim().toLocaleLowerCase();
    pageIds = index.pageLookup.get(key) || [];
    if (!pageIds.length && index.pagesById.has(target.path)) pageIds = [target.path];
  }
  if (pageIds.length !== 1) return reference;
  const page = index.pagesById.get(pageIds[0]);
  if (!page) return reference;
  if (!target.subpath) return { ...reference, kind: 'blockspace-page', pageId: page.id, page, originalKind: 'obsidian' };
  if (target.subpath.startsWith('^')) {
    const blockId = target.subpath.slice(1);
    const location = index.blockLocations.get(blockId);
    if (location && location.pageId === page.id) {
      return { ...reference, kind: 'blockspace-block', pageId: page.id, blockId, page, block: location.block, originalKind: 'obsidian' };
    }
    return reference;
  }
  let heading = target.subpath;
  try { heading = decodeURIComponent(heading); } catch (error) { /* retain literal heading */ }
  const block = page.blocks.find((candidate) => isHeadingBlock(candidate) && candidate.text.trim().toLocaleLowerCase() === heading.trim().toLocaleLowerCase());
  return block
    ? { ...reference, kind: 'blockspace-block', pageId: page.id, blockId: block.id, page, block, originalKind: 'obsidian' }
    : reference;
}

function buildReferenceIndex(pages) {
  const normalizedPages = Array.from(pages || []).filter(Boolean).map((page) => normalizePage(page));
  const index = {
    pagesById: new Map(),
    pageLookup: new Map(),
    blockLocations: new Map(),
    byPage: new Map(),
    byBlock: new Map(),
    outgoingByPage: new Map(),
  };
  for (const page of normalizedPages) {
    index.pagesById.set(page.id, page);
    for (const key of referenceLookupKeys(page)) {
      const values = index.pageLookup.get(key) || [];
      if (!values.includes(page.id)) values.push(page.id);
      index.pageLookup.set(key, values);
    }
    for (const block of page.blocks) {
      if (!index.blockLocations.has(block.id)) index.blockLocations.set(block.id, { pageId: page.id, blockId: block.id, page, block });
    }
  }
  for (const page of normalizedPages) {
    const outgoing = [];
    for (const block of page.blocks) {
      for (const mark of block.marks.filter((candidate) => candidate.type === 'link')) {
        const reference = parseStoredReference(mark.value);
        if (['empty', 'external', 'blocked'].includes(reference.kind)) continue;
        const resolved = resolveStoredReference(reference, index, page.id);
        const occurrence = {
          sourcePageId: page.id,
          sourcePageTitle: page.title,
          sourceBlockId: block.id,
          sourceText: block.text,
          from: mark.from,
          to: mark.to,
          label: block.text.slice(mark.from, mark.to),
          value: mark.value,
          mode: reference.mode || 'link',
          targetKind: resolved && resolved.kind || reference.kind,
          targetPageId: resolved && resolved.pageId || null,
          targetBlockId: resolved && resolved.blockId || null,
          unresolved: Boolean(resolved && resolved.unresolved),
        };
        outgoing.push(occurrence);
        if (occurrence.targetPageId) {
          const backlinks = index.byPage.get(occurrence.targetPageId) || [];
          backlinks.push(occurrence);
          index.byPage.set(occurrence.targetPageId, backlinks);
        }
        if (occurrence.targetBlockId) {
          const backlinks = index.byBlock.get(occurrence.targetBlockId) || [];
          backlinks.push(occurrence);
          index.byBlock.set(occurrence.targetBlockId, backlinks);
        }
      }
    }
    index.outgoingByPage.set(page.id, outgoing);
  }
  return index;
}

function safeFileName(value) {
  const cleaned = String(value || 'Untitled').replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 100) || 'Untitled';
}

function sortPageMetas(pages) {
  return Array.from(pages || []).sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || '') || 0;
    return bTime - aTime || String(a.title).localeCompare(String(b.title));
  });
}

const Core = {
  DATA_VERSION,
  PAGE_STATUSES,
  PAGE_PRIORITIES,
  CUSTOM_PROPERTY_TYPES,
  RESERVED_PAGE_PROPERTY_NAMES,
  BLOCK_TYPES,
  INLINE_MARK_TYPES,
  SEMANTIC_COLORS,
  BLOCK_ALIGNS,
  CONTAINER_BLOCK_TYPES,
  ADVANCED_BLOCK_TYPES,
  randomId,
  nowIso,
  deepClone,
  normalizeCustomPropertyValue,
  normalizeCustomProperties,
  isValidCustomPropertyName,
  createBlock,
  createDefaultPage,
  normalizeBlock,
  normalizeTocConfig,
  normalizeColumnsConfig,
  isHeadingBlock,
  getHeadingLevel,
  normalizeBlockAppearance,
  normalizeBlockData,
  normalizeTableData,
  normalizeInlineMark,
  normalizeInlineMarks,
  applyInlineMark,
  setInlineMark,
  normalizeTextRanges,
  inlineMarkRangeState,
  applyInlineMarkToRanges,
  clearInlineMarksFromRanges,
  textFromRanges,
  clearInlineMarks,
  splitInlineMarks,
  mergeInlineMarks,
  normalizePage,
  normalizeWorkspace,
  clonePage,
  blockMap,
  getBlock,
  getSiblingIds,
  flattenBlockEntries,
  flattenBlocks,
  deriveOutline,
  getHeadingSectionRootIds,
  getCollapsedSectionHeadingIds,
  toggleHeadingSectionCollapsed,
  moveHeadingSection,
  getBlockDepth,
  getAncestorIds,
  getSubtreeIds,
  normalizeTopLevelSelection,
  canBlockHaveChildren,
  rebuildBlockOrder,
  insertBlock,
  appendRootBlock,
  insertBlockAfter,
  insertBlocksAfter,
  convertBlockToColumns,
  setColumnsCount,
  setColumnsRatio,
  unwrapColumns,
  removeSubtrees,
  unwrapBlock,
  duplicateSubtrees,
  moveSubtrees,
  moveSiblingGroup,
  indentBlocks,
  outdentBlocks,
  splitBlock,
  mergeBlockWithPrevious,
  numberedOrdinal,
  toggleBlockCollapsed,
  convertBlockType,
  serializeSubtrees,
  insertSerializedSubtrees,
  deleteSiblingTextRange,
  pageExcerpt,
  pageSearchText,
  findTextRanges,
  createPageTextIndex,
  findPageTextIndex,
  findPageTextMatches,
  replaceInlineTextRange,
  replaceInlineTextRanges,
  replacePageTextMatch,
  replaceAllPageText,
  pageToMeta,
  touchPage,
  duplicateBlock,
  moveArrayItem,
  moveArrayItemByInsertion,
  moveArrayItemsByInsertion,
  pageContentEquals,
  createHistory,
  createTransaction,
  recordHistory,
  undoHistory,
  redoHistory,
  validatePage,
  hashString,
  obsidianBlockAnchor,
  pageContentHash,
  extractLooseMarkdownMetadata,
  normalizeMarkdownLinkWhitespace,
  parseInlineMarkdown,
  extractLinkDestination,
  reparseInlineMarkdown,
  convertTrailingInlineMarkdown,
  replaceInlineRangeWithMarkdown,
  INLINE_TEXT_BLOCK_TYPES,
  containsMarkdownMedia,
  parseMarkdownTable,
  parseAdvancedMarkdownBlock,
  advancedBlockToMarkdown,
  shouldPreserveRawMarkdown,
  looksLikeRawMarkdownText,
  markdownToBlocks,
  blocksToMarkdown,
  blockToNativePreviewMarkdown,
  parseStoredReference,
  resolveStoredReference,
  buildReferenceIndex,
  classifyStoredLink,
  safeFileName,
  sortPageMetas,
};


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

const Exporters = {
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

const SLASH_COMMANDS = [
  { type: 'paragraph', label: '文本', description: '普通文本块', icon: 'pilcrow', category: '基础', aliases: ['text', 'p', '正文'] },
  { type: 'heading-1', label: '一级标题', description: '页面大标题', icon: 'heading-1', category: '基础', aliases: ['h1', '标题1'] },
  { type: 'heading-2', label: '二级标题', description: '章节标题', icon: 'heading-2', category: '基础', aliases: ['h2', '标题2'] },
  { type: 'heading-3', label: '三级标题', description: '小节标题', icon: 'heading-3', category: '基础', aliases: ['h3', '标题3'] },
  { type: 'todo', label: '待办事项', description: '可勾选任务', icon: 'square-check-big', category: '列表', aliases: ['todo', 'task', '待办'] },
  { type: 'bulleted-list', label: '无序列表', description: '项目符号列表', icon: 'list', category: '列表', aliases: ['ul', 'bullet', '列表'] },
  { type: 'numbered-list', label: '有序列表', description: '编号列表', icon: 'list-ordered', category: '列表', aliases: ['ol', 'number', '编号'] },
  { type: 'quote', label: '引用', description: '引用内容', icon: 'quote', category: '强调', aliases: ['quote', '引用'] },
  { type: 'callout', label: '提示块', description: '可容纳子块的强调容器', icon: 'message-square-text', category: '强调', aliases: ['callout', 'note', '提示'] },
  { type: 'toggle', label: '折叠块', description: '可展开和收起子内容', icon: 'chevron-right-square', category: '高级', aliases: ['toggle', '折叠', '展开'] },
  { type: 'table-of-contents', label: '目录', description: '根据标题块自动生成页面目录', icon: 'list-tree', category: '高级', aliases: ['toc', '目录', '大纲'] },
  { type: 'image', label: '图片', description: '粘贴、上传或引用 Vault 图片', icon: 'image', category: '媒体', aliases: ['image', 'img', '图片', '照片'] },
  { type: 'video', label: '视频', description: '上传或引用视频文件', icon: 'video', category: '媒体', aliases: ['video', '视频'] },
  { type: 'audio', label: '音频', description: '上传或引用音频文件', icon: 'audio-lines', category: '媒体', aliases: ['audio', '音频'] },
  { type: 'attachment', label: '附件', description: '上传 PDF 或其他 Vault 文件', icon: 'paperclip', category: '媒体', aliases: ['file', 'attachment', '附件', '文件', 'pdf'] },
  { type: 'bookmark', label: '书签', description: '创建可编辑的链接预览卡片', icon: 'bookmark', category: '媒体', aliases: ['bookmark', 'url', 'link', '书签', '链接卡片'] },
  { type: 'table', label: '表格', description: '可直接编辑并导出为原生 Markdown 表格', icon: 'table-2', category: '高级', aliases: ['table', '表格'] },
  { type: 'columns', label: '分栏', description: '两栏或三栏并排编辑，窄窗口自动上下排列', icon: 'columns-3', category: '高级', aliases: ['columns', 'column', '分栏', '双栏', '三栏'] },
  { type: 'markdown', label: '原生 Markdown', description: '使用 Obsidian 渲染器显示原始 Markdown', icon: 'file-code-2', category: '高级', aliases: ['markdown', 'md', '原生 markdown'] },
  { type: 'code', label: '代码块', description: '等宽代码内容', icon: 'code-2', category: '高级', aliases: ['code', '代码'] },
  { type: 'divider', label: '分隔线', description: '分隔内容', icon: 'minus', category: '高级', aliases: ['divider', 'hr', '分割线'] },
];

const COLUMN_RATIO_TEMPLATES = Object.freeze({
  '1:1': 'minmax(0, 1fr) minmax(0, 1fr)',
  '1:2': 'minmax(0, 1fr) minmax(0, 2fr)',
  '2:1': 'minmax(0, 2fr) minmax(0, 1fr)',
  '1:1:1': 'repeat(3, minmax(0, 1fr))',
  '1:2:1': 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)',
  '2:1:1': 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
  '1:1:2': 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 2fr)',
});


const STATUS_LABELS = { todo: '待开始', doing: '进行中', done: '已完成' };
const PRIORITY_LABELS = { low: '低', medium: '中', high: '高' };
const ICON_OPTIONS = ['✨', '📄', '🚀', '💡', '📌', '🎯', '🧠', '🛠️'];
const STYLE_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
const STYLE_COLOR_LABELS = {
  default: '默认', gray: '灰色', brown: '棕色', orange: '橙色', yellow: '黄色',
  green: '绿色', blue: '蓝色', purple: '紫色', pink: '粉色', red: '红色',
};
const FONT_FAMILIES = {
  theme: '跟随 Obsidian', sans: '无衬线', serif: '衬线', monospace: '等宽',
};
const VISUAL_STYLES = {
  notion: 'Notion 风格',
  siyuan: '思源风格',
  native: 'Obsidian 原生',
};
const PAGE_DENSITIES = {
  compact: '紧凑',
  standard: '标准',
  immersive: '沉浸',
};
const CUSTOM_PROPERTY_TYPE_DETAILS = {
  text: { label: '文本', icon: 'text' },
  list: { label: '列表', icon: 'list' },
  number: { label: '数字', icon: 'hash' },
  checkbox: { label: '复选框', icon: 'square-check' },
  date: { label: '日期', icon: 'calendar-days' },
  datetime: { label: '日期与时间', icon: 'calendar-clock' },
};
const MARKDOWN_RENDER_MODES = {
  'reading-only': '仅原生阅读模式',
  'native-blocks': '未聚焦块使用原生渲染',
  off: '关闭原生 Markdown 渲染',
};
const MARKDOWN_BLOCK_ID_MODES = {
  none: '不导出（阅读优先）',
  referenced: '仅被引用块（推荐）',
  all: '全部可定位块（兼容模式）',
};
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

const SAVE_STATE_LABELS = {
  saved: '已保存',
  dirty: '等待保存',
  saving: '正在保存…',
  conflict: '存在保存冲突',
  error: '保存失败',
};

const ADVANCED_BLOCK_LABELS = {
  image: { label: '图片', icon: 'image' },
  video: { label: '视频', icon: 'video' },
  audio: { label: '音频', icon: 'audio-lines' },
  attachment: { label: '附件', icon: 'paperclip' },
  bookmark: { label: '书签', icon: 'bookmark' },
  table: { label: '表格', icon: 'table-2' },
};

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
        span.title = 'Ctrl/Cmd + 悬停预览 · Ctrl/Cmd + 点击打开';
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
  const fields = [command.label, command.type, command.description, ...(command.aliases || [])];
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
  if (!value) return '空块';
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
            throw new Error(`无法创建目录 ${folderPath}：${detail}`);
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
      if (!options.silent) new Notice(`Blockspace 无法读取 ${path}`);
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
          throw new Error(`无法写入 ${path}：${error.message}`);
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
          new Notice(`Blockspace 已恢复 ${recovered} 个未完成保存`);
        }
        if (this.lastJournalRecovery.conflicts > 0) {
          new Notice(`Blockspace 发现 ${this.lastJournalRecovery.conflicts} 个恢复冲突，已保留副本`);
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
    if (!target) throw new Error('数据目录不能为空');
    if (target === source) return { moved: 0, target, source };
    if (target.startsWith(`${source}/`) || source.startsWith(`${target}/`)) {
      throw new Error('新数据目录不能与原目录互相嵌套');
    }
    await this.init();
    await this.flush();
    if ((await this.listFilesRecursive(target)).length) {
      throw new Error(`目标目录 ${target} 已有内容，请换一个名字或先清空`);
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
    if (issues.length) throw new Error(`页面完整性校验失败：${issues.join('；')}`);
    await this.ensureFolder(this.pagesFolder);
    const target = this.pagePath(normalized.id);
    const disk = await this.readJson(target, null, { silent: true });
    if (expectedRevision !== null && (!disk || Number(disk.revision) !== expectedRevision)) {
      const conflictPath = await this.writeConflict(normalized, disk, expectedRevision);
      throw new ConflictError(disk ? '页面已在其他窗口或设备中修改' : '页面文件已被删除或无法读取', {
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

  async createPage(title = 'Untitled', extras = {}) {
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
      const page = await this.createPage('Untitled');
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
        && replacement.title === 'Untitled'
        && replacement.blocks.every((block) => !String(block.text || '').trim());
      if (isPristineReplacement) {
        await this.removePath(replacementPath);
        this.workspace.pages = [];
      }
    }
    const target = this.pagePath(page.id);
    if (await this.app.vault.adapter.exists(target)) {
      return this.restorePageAsCopy(page, '（删除恢复）');
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
    return this.restoreLatestFromFiles(await this.listFilesRecursive(this.trashFolder), (payload) => payload, '（回收站恢复）');
  }

  async restoreLatestSnapshot(pageId) {
    if (!pageId) return null;
    const folder = normalizePath(`${this.snapshotsFolder}/${pageId}`);
    return this.restoreLatestFromFiles(await this.listFilesRecursive(folder), (payload) => payload, '（快照恢复）');
  }

  async restoreLatestConflict() {
    return this.restoreLatestFromFiles(
      await this.listFilesRecursive(this.recoveryFolder),
      (payload) => payload.localPage || (payload.page && payload.page.id ? payload.page : null),
      '（冲突恢复）',
    );
  }

  async restoreConflictFile(path) {
    if (!path) return null;
    const payload = await this.readJson(path, null, { silent: true });
    const page = payload && (payload.localPage || (payload.page && payload.page.id ? payload.page : null));
    return page ? this.restorePageAsCopy(page, '（冲突恢复）') : null;
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
    if (report.pendingJournals) report.warnings.push(`存在 ${report.pendingJournals} 个待恢复日志`);
    for (const meta of this.workspace.pages) {
      const raw = await this.readJson(this.pagePath(meta.id), null, { silent: true });
      if (!raw) {
        report.errors.push(`页面文件缺失：${meta.title} (${meta.id})`);
        continue;
      }
      report.pages += 1;
      const issues = Core.validatePage(raw);
      for (const issue of issues) report.errors.push(`${meta.title}：${issue}`);
      if (Number(raw.formatVersion || raw.version || 1) < Core.DATA_VERSION) {
        report.warnings.push(`${meta.title} 使用旧数据格式，将在下次保存时升级`);
      }
    }
    const pageFiles = (await this.listFiles(this.pagesFolder)).filter((path) => path.endsWith('.json'));
    const indexedIds = new Set(this.workspace.pages.map((page) => page.id));
    const diskIds = new Set(pageFiles.map((path) => path.split('/').pop().replace(/\.json$/, '')));
    report.orphanPages = Array.from(diskIds).filter((id) => !indexedIds.has(id)).length;
    report.missingIndexedPages = Array.from(indexedIds).filter((id) => !diskIds.has(id)).length;
    if (report.orphanPages) report.warnings.push(`存在 ${report.orphanPages} 个尚未进入索引的页面文件`);
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
    this.setPlaceholder('选择要导入的 Markdown 文件…');
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
    this.setPlaceholder('搜索页面或执行操作…');
  }

  getItems() {
    const actions = [
      { kind: 'action', id: 'new-page', label: '新建页面', hint: '创建一个空白页面' },
      { kind: 'action', id: 'document', label: '切换到文档', hint: '打开当前页面正文' },
      { kind: 'action', id: 'board', label: '切换到看板', hint: '按状态查看所有页面' },
      { kind: 'action', id: 'focus', label: '切换专注模式', hint: '沉浸式编辑当前页面' },
      { kind: 'action', id: 'inspector', label: '打开页面检查器', hint: '在 Obsidian 右侧栏查看属性、大纲和统计' },
      { kind: 'action', id: 'import', label: '导入 Markdown', hint: '从现有笔记创建页面' },
      { kind: 'action', id: 'diagnostics', label: '诊断与恢复', hint: '检查结构化数据' },
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
      body.createSpan({ cls: 'bs-switcher-hint', text: `${STATUS_LABELS[item.page.status] || '页面'} · ${new Date(item.page.updatedAt).toLocaleDateString()}` });
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
    contentEl.createEl('h2', { text: '添加链接' });
    contentEl.createDiv({ cls: 'bs-style-modal-description', text: '输入网页地址、Obsidian URI、锚点，或 [[页面名称]]。' });
    const input = contentEl.createEl('input', { cls: 'bs-style-link-input', attr: { type: 'text', placeholder: 'https://example.com 或 [[页面名称]]' } });
    input.value = this.initialValue;
    const actions = contentEl.createDiv({ cls: 'bs-style-modal-actions' });
    const cancel = createButton(actions, '', '取消', 'x', '取消');
    cancel.addEventListener('click', () => this.close());
    const apply = createButton(actions, 'mod-cta', '应用链接', 'link', '应用');
    const submit = () => {
      const value = sanitizeLink(input.value);
      if (!value) {
        new Notice('请输入有效链接');
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
    contentEl.createEl('h2', { text: '自定义页面图标' });
    contentEl.createDiv({ cls: 'bs-style-modal-description', text: '粘贴任意 Emoji 或字符作为页面图标，留空表示不使用图标。' });
    const input = contentEl.createEl('input', { cls: 'bs-style-link-input', attr: { type: 'text', placeholder: '例如 📘', maxlength: '8' } });
    input.value = this.initialValue;
    const actions = contentEl.createDiv({ cls: 'bs-style-modal-actions' });
    const cancel = createButton(actions, '', '取消', 'x', '取消');
    cancel.addEventListener('click', () => this.close());
    const apply = createButton(actions, 'mod-cta', '应用图标', 'check', '应用');
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
    contentEl.createEl('h2', { text: this.blockIds.length > 1 ? `块样式（${this.blockIds.length} 个块）` : '块样式' });
    contentEl.createDiv({ cls: 'bs-style-modal-description', text: '颜色使用语义化主题值，会自动适配 Obsidian 的明暗主题。' });

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
    renderColorSection('文字颜色', 'textColor');
    renderColorSection('背景颜色', 'background');

    const alignSection = contentEl.createDiv({ cls: 'bs-style-section' });
    alignSection.createDiv({ cls: 'bs-style-section-title', text: '对齐方式' });
    const alignGroup = alignSection.createDiv({ cls: 'bs-style-align-group' });
    for (const [align, label, iconName] of [['left', '左对齐', 'align-left'], ['center', '居中', 'align-center'], ['right', '右对齐', 'align-right']]) {
      const button = createButton(alignGroup, `bs-style-align${this.appearance.align === align ? ' is-selected' : ''}`, label, iconName, label);
      button.addEventListener('click', () => {
        this.appearance.align = align;
        alignGroup.querySelectorAll('.bs-style-align').forEach((candidate) => candidate.toggleClass('is-selected', candidate === button));
      });
    }

    const actions = contentEl.createDiv({ cls: 'bs-style-modal-actions' });
    const reset = createButton(actions, '', '清除块样式', 'eraser', '清除样式');
    reset.addEventListener('click', () => {
      this.appearance = Core.normalizeBlockAppearance({});
      this.applyAndClose();
    });
    const apply = createButton(actions, 'mod-cta', '应用块样式', 'check', '应用');
    apply.addEventListener('click', () => this.applyAndClose());
  }

  applyAndClose() {
    const appearance = Core.normalizeBlockAppearance(this.appearance);
    const changed = this.view.performMutation(this.blockIds.length > 1 ? '批量修改块样式' : '修改块样式', (page) => {
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
    add('search', '切换 Blockspace 页面', () => this.openQuickSwitcher());
    add('panel-right', '打开 Blockspace 大纲', () => void this.plugin.activateInspector());
    add('book-open', '切换 Obsidian 原生 Markdown 阅读模式', () => this.toggleReadingMode());
    add('blocks', 'Blockspace 页面操作', (event) => this.showWorkspaceMenu(event));
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
    const changed = this.performMutation('删除跨块文字', (page) => {
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
          '此页面已在其他窗口或设备修改。本地内容已安全保留，请选择继续方式。',
          issue.conflictPath || '',
          (actions) => {
            const keepLocal = createButton(actions, 'bs-status-banner-action mod-cta', '将本地冲突内容恢复为新页面', 'copy-plus', '保留本地副本');
            keepLocal.addEventListener('click', () => void this.restoreConflictCopy(keepLocal));
            const reload = createButton(actions, 'bs-status-banner-action', '放弃当前未保存状态并载入磁盘版本', 'refresh-cw', '载入磁盘版本');
            reload.addEventListener('click', () => void this.reloadDiskPage(reload));
          },
        );
      } else {
        mount(
          'is-error',
          'alert',
          '保存失败，待恢复日志仍然保留。请检查存储状态后重试。',
          issue.message || '',
          (actions) => {
            const retry = createButton(actions, 'bs-status-banner-action mod-cta', '重新尝试保存当前页面', 'refresh-cw', '重试保存');
            retry.addEventListener('click', () => void this.retrySave(retry));
            const diagnostics = createButton(actions, 'bs-status-banner-action', '打开诊断与恢复', 'life-buoy', '诊断与恢复');
            diagnostics.addEventListener('click', () => new BlockspaceDiagnosticsModal(this.app, this.plugin).open());
          },
        );
      }
    }
    if (this.pendingDeletion) {
      const title = this.pendingDeletion.page && this.pendingDeletion.page.title || '页面';
      mount(
        'is-undo',
        'status',
        `“${title}”已移入 Blockspace 回收站。`,
        '',
        (actions) => {
          const undo = createButton(actions, 'bs-status-banner-action mod-cta', `撤销删除“${title}”`, 'undo-2', '撤销删除');
          undo.addEventListener('click', () => void this.undoPageDeletion(undo));
          const dismiss = createButton(actions, 'bs-status-banner-action', '关闭删除提示', 'x', '关闭');
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
        new Notice('没有找到可恢复的本地冲突副本');
        return;
      }
      this.saveIssue = null;
      this.setPage(restored);
      this.render();
      new Notice(`已将本地内容恢复为新页面：${restored.title}`);
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
        new Notice('磁盘版本不存在，本地冲突副本仍然保留');
        return;
      }
      this.saveIssue = null;
      this.setPage(disk);
      this.render();
      new Notice('已载入磁盘版本');
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
        new Notice('无法恢复刚刚删除的页面，请在诊断与恢复中检查回收站');
        return;
      }
      this.pendingDeletion = null;
      if (deletion.wasActive !== false) this.setPage(restored);
      this.render();
      new Notice(`已恢复页面：${restored.title}`);
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
    toolbar.setAttribute('aria-label', `${ids.length} 个块已选择`);
    toolbar.addEventListener('mousedown', (event) => event.preventDefault());
    const count = document.createElement('span');
    count.className = 'bs-block-selection-count';
    count.textContent = `${ids.length} 个块`;
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
    makeButton('copy', '复制所选块（Ctrl/Cmd + D）', () => this.duplicateSelectedBlocks());
    makeButton('clipboard-copy', '复制为 Markdown（Ctrl/Cmd + C）', () => void this.copySelectedBlocks());
    makeButton('arrow-up', '上移同级位置（Alt + ↑）', () => this.moveSelectedBlocks(-1));
    makeButton('arrow-down', '下移同级位置（Alt + ↓）', () => this.moveSelectedBlocks(1));
    makeButton('palette', '设置所选块样式', () => new BlockAppearanceModal(this.app, this, ids).open());
    makeButton('replace', '转换块类型', (event) => this.showBlockTypeMenu(event, ids), ids.some((id) => Core.getBlock(this.page, id)?.type === 'columns'));
    const separator = document.createElement('span');
    separator.className = 'bs-block-selection-separator';
    toolbar.appendChild(separator);
    makeButton('trash-2', '删除所选块（Delete）', () => this.deleteSelectedBlocks()).classList.add('is-destructive');
    makeButton('x', '取消选择（Esc）', () => this.clearBlockSelection());
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
        this.performMutation(blockIds.length > 1 ? `批量转换为${command.label}` : `转换为${command.label}`, (page) => {
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
    this.performMutation(ids.length > 1 ? '复制多个块及其子块' : '复制块及其子块', (page) => {
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
    this.performMutation(direction < 0 ? '上移所选子树' : '下移所选子树', (page) => {
      Core.moveSiblingGroup(page, ids, direction);
    });
  }

  indentSelectedBlocks(delta) {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length) return;
    this.performMutation(delta < 0 ? '减少所选块层级' : '将所选块移入上一容器', (page) => {
      if (delta < 0) Core.outdentBlocks(page, ids);
      else Core.indentBlocks(page, ids);
    });
  }

  deleteSelectedBlocks() {
    const ids = this.getOrderedSelectedBlockIds();
    if (!ids.length || !this.page) return;
    const visible = this.getVisibleBlocks();
    const firstIndex = Math.min(...ids.map((id) => visible.findIndex((block) => block.id === id)).filter((index) => index >= 0));
    this.performMutation(ids.length > 1 ? '删除多个块及其子块' : '删除块及其子块', (page) => {
      Core.removeSubtrees(page, ids);
    }, { render: false });
    this.clearBlockSelection({ updateDom: false });
    this.render();
    const nextVisible = this.getVisibleBlocks();
    const target = nextVisible[Math.max(0, Math.min(firstIndex, nextVisible.length - 1))];
    if (target) focusEditorAt(this, target.id, 0);
    new Notice(`已删除 ${ids.length} 个块（Ctrl/Cmd + Z 撤销）`);
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
      new Notice(`已复制 ${selectedRoots.length} 个块子树`);
    } catch (error) {
      const textarea = this.contentEl.ownerDocument.createElement('textarea');
      textarea.value = markdown;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      this.contentEl.ownerDocument.body.appendChild(textarea);
      textarea.select();
      this.contentEl.ownerDocument.execCommand('copy');
      textarea.remove();
      new Notice(`已复制 ${selectedRoots.length} 个块子树`);
    }
  }

  async writeClipboardText(text, message = '已复制') {
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
    const label = String(block.text || '未命名块').replace(/\s+/g, ' ').trim().slice(0, 120) || '未命名块';
    if (mode === 'link') {
      await this.writeClipboardText(`[${label}](blockspace://block/${encodeURIComponent(block.id)})`, '已复制块链接');
      return;
    }
    const escaped = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    await this.writeClipboardText(`((${block.id} "${escaped}"))`, '已复制思源兼容块引用');
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
    toolbar.setAttribute('aria-label', '文字格式');
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
      count.textContent = `${ranges.length} 个块`;
      count.title = '当前格式操作会应用到跨块文字选区';
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
    button('bold', '加粗（Ctrl/Cmd + B）', 'bold', () => this.applyInlineFormat('bold'));
    button('italic', '斜体（Ctrl/Cmd + I）', 'italic', () => this.applyInlineFormat('italic'));
    button('underline', '下划线（Ctrl/Cmd + U）', 'underline', () => this.applyInlineFormat('underline'));
    button('strikethrough', '删除线（Ctrl/Cmd + Shift + S）', 'strike', () => this.applyInlineFormat('strike'));
    button('code-2', '行内代码', 'code', () => this.applyInlineFormat('code'));
    toolbar.appendChild(document.createElement('span')).className = 'bs-format-separator';
    button('link', '添加或修改链接（Ctrl/Cmd + K）', 'link', () => this.openLinkForSelection());
    const textButton = button('palette', '文字颜色', null, (_event, element) => this.toggleInlineColorPalette(element, 'textColor'));
    const textMark = active.find((mark) => mark.type === 'textColor');
    if (textMark) textButton.dataset.activeColor = textMark.value;
    const highlightButton = button('highlighter', '高亮颜色', null, (_event, element) => this.toggleInlineColorPalette(element, 'highlight'));
    const highlightMark = active.find((mark) => mark.type === 'highlight');
    if (highlightMark) highlightButton.dataset.activeColor = highlightMark.value;
    toolbar.appendChild(document.createElement('span')).className = 'bs-format-separator';
    button('remove-formatting', '清除格式（Ctrl/Cmd + \\）', null, () => this.clearInlineFormatting());
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
      swatch.setAttribute('aria-label', `${type === 'textColor' ? '文字' : '高亮'}：${STYLE_COLOR_LABELS[color]}`);
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
    this.performMutation(type === 'textColor' ? '修改文字颜色' : type === 'highlight' ? '修改高亮颜色' : '修改文字格式', (page) => {
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
    this.performMutation('清除文字格式', (page) => {
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
      ? `移入“${label}”`
      : position === 'before'
        ? `放在“${label}”之前`
        : `放在“${label}”之后`;
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
      ? `☷ ${roots.length} 个块`
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
      this.findCountEl.title = state.truncated ? `结果超过 ${MAX_FIND_MATCHES} 项，已限制导航范围` : '';
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
    const changed = this.performMutation('替换文本', (page) => {
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
    const changed = this.performMutation(`全部替换“${state.query}”`, (page) => {
      replaced = Core.replaceAllPageText(page, state.query, state.replacement, this.findOptions());
    }, { render: false });
    if (!changed || !replaced) return;
    state.focusTarget = 'replacement';
    this.refreshFindMatches({ resetActive: true });
    this.render();
    new Notice(`已替换 ${replaced} 处文本，可用 Ctrl/Cmd + Z 一次撤销`);
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
    bar.setAttribute('aria-label', '在当前页面中查找和替换');
    this.findReplaceEl = bar;

    const dragHandle = bar.createEl('button', {
      cls: 'bs-find-drag-handle',
      attr: {
        type: 'button',
        'aria-label': '拖动查找框；方向键微调位置；Home 复位',
        title: '拖动移动 · 方向键微调 · 双击或 Home 复位',
      },
    });
    dragHandle.addEventListener('pointerdown', (event) => this.beginFindReplaceDrag(event, bar, dragHandle));
    dragHandle.addEventListener('keydown', (event) => this.moveFindReplaceWithKeyboard(event, bar));
    dragHandle.addEventListener('dblclick', () => this.resetFindReplacePosition(bar));

    const findRow = bar.createDiv({ cls: 'bs-find-row' });
    const expand = createButton(findRow, 'bs-find-icon-button bs-find-expand', state.showReplace ? '收起替换' : '展开替换', state.showReplace ? 'chevron-up' : 'chevron-down');
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
        placeholder: '查找',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': '查找文本',
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
    const caseButton = createButton(findRow, 'bs-find-text-button', '区分大小写', null, 'Aa');
    caseButton.toggleClass('is-active', state.matchCase);
    caseButton.setAttribute('aria-pressed', state.matchCase ? 'true' : 'false');
    caseButton.addEventListener('click', () => {
      state.matchCase = !state.matchCase;
      caseButton.toggleClass('is-active', state.matchCase);
      caseButton.setAttribute('aria-pressed', state.matchCase ? 'true' : 'false');
      this.scheduleFindRefresh({ resetActive: true, scroll: true }, 0);
    });
    const wholeWordButton = createButton(findRow, 'bs-find-text-button', '全词匹配', null, '词');
    wholeWordButton.toggleClass('is-active', state.wholeWord);
    wholeWordButton.setAttribute('aria-pressed', state.wholeWord ? 'true' : 'false');
    wholeWordButton.addEventListener('click', () => {
      state.wholeWord = !state.wholeWord;
      wholeWordButton.toggleClass('is-active', state.wholeWord);
      wholeWordButton.setAttribute('aria-pressed', state.wholeWord ? 'true' : 'false');
      this.scheduleFindRefresh({ resetActive: true, scroll: true }, 0);
    });
    this.findPreviousButton = createButton(findRow, 'bs-find-icon-button', '上一个结果（Shift + Enter）', 'chevron-up');
    this.findPreviousButton.addEventListener('click', () => this.navigateFindMatch(-1));
    this.findNextButton = createButton(findRow, 'bs-find-icon-button', '下一个结果（Enter）', 'chevron-down');
    this.findNextButton.addEventListener('click', () => this.navigateFindMatch(1));
    const close = createButton(findRow, 'bs-find-icon-button', '关闭查找', 'x');
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
          placeholder: '替换为',
          autocomplete: 'off',
          spellcheck: 'false',
          'aria-label': '替换为',
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
      this.findReplaceButton = createButton(replaceRow, 'bs-find-action-button', '替换当前结果', null, '替换');
      this.findReplaceButton.addEventListener('click', () => this.replaceCurrentFindMatch());
      this.findReplaceAllButton = createButton(replaceRow, 'bs-find-action-button', '替换当前页面中的全部结果', null, '全部');
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
      this.performMutation('展开目标块路径', (page) => {
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
    return normalizePath(`${folder}/${Core.safeFileName(this.page.title || 'Untitled')}.md`);
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
      new Notice(`Blockspace 已阻止不安全或不受支持的链接协议：${link.protocol}`);
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
      text: preview.blockId ? `块引用 · ${preview.backlinkCount} 条反链` : `页面 · ${preview.backlinkCount} 条反链`,
    });
    const body = popover.createDiv({ cls: 'bs-reference-popover-body' });
    if (preview.blockText) body.createDiv({ cls: 'bs-reference-popover-primary', text: preview.blockText });
    for (const child of preview.children) {
      if (!String(child.text || '').trim()) continue;
      body.createDiv({ cls: 'bs-reference-popover-child', text: child.text });
    }
    if (!body.childElementCount) body.createDiv({ cls: 'bs-reference-popover-empty', text: '空页面' });
    const footer = popover.createDiv({ cls: 'bs-reference-popover-footer' });
    const open = createButton(footer, 'bs-reference-popover-open', '打开引用目标', 'arrow-up-right', '打开');
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
      title.textContent = String(image.getAttribute('alt') || '').trim() || '图片暂时无法显示';
      const detail = document.createElement('span');
      detail.className = 'bs-image-fallback-detail';
      detail.textContent = '图片资源不可用 · 点击尝试打开原地址';
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
      } else throw new Error('当前 Obsidian 版本未提供 MarkdownRenderer');
      if (generation !== this.markdownRenderGeneration || this.markdownRenderComponents.get(key) !== component) return;
      container.querySelectorAll('a.internal-link').forEach((link) => link.setAttribute('data-blockspace-native-link', 'true'));
      this.attachRenderedLinkInteractions(container);
      this.attachRenderedMediaInteractions(container);
    } catch (error) {
      if (this.markdownRenderComponents.get(key) !== component) return;
      clearElement(container);
      const message = container.createDiv({ cls: 'bs-markdown-render-error' });
      message.createDiv({ cls: 'bs-markdown-render-error-title', text: 'Obsidian Markdown 渲染失败' });
      message.createDiv({ cls: 'bs-markdown-render-error-detail', text: String(error && error.message ? error.message : error) });
    }
  }

  toggleReadingMode(force = null) {
    if (this.activeTab !== 'document' || this.plugin.settings.markdownRenderMode === 'off') {
      if (this.plugin.settings.markdownRenderMode === 'off') new Notice('请先在 Blockspace 设置中启用 Obsidian 原生 Markdown 渲染');
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
      host.createDiv({ cls: 'bs-empty-state', text: '没有可显示的页面' });
      return;
    }
    const scroll = host.createDiv({ cls: 'bs-document-scroll bs-native-reading-scroll' });
    const pageShell = scroll.createDiv({ cls: 'bs-page-shell bs-native-reading-shell is-coverless' });
    const header = pageShell.createDiv({ cls: 'bs-page-header bs-native-reading-header' });
    header.createEl('h1', { cls: 'bs-page-title bs-native-reading-title', text: this.page.title || 'Untitled' });
    const modeBar = pageShell.createDiv({ cls: 'bs-reading-mode-bar' });
    const label = modeBar.createDiv({ cls: 'bs-reading-mode-label' });
    const icon = label.createSpan({ cls: 'bs-reading-mode-icon' });
    setIcon(icon, 'book-open');
    label.createSpan({ text: 'Obsidian 原生 Markdown 阅读模式' });
    const edit = createButton(modeBar, 'bs-reading-mode-edit', '返回块编辑模式', 'square-pen', '编辑');
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
    button.setAttribute('aria-label', editing ? '完成 Markdown 编辑' : '编辑 Markdown 源码');
    const label = button.querySelector('.bs-button-label');
    if (label) label.textContent = editing ? '完成' : '编辑';
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
      ['md', '导出无损 Markdown', 'file-output'],
      ['docx', '导出 Word 文档', 'file-type-2'],
      ['pdf', '导出 PDF', 'file-text'],
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
      .setTitle(boardActive ? '返回文档视图' : '打开项目看板')
      .setIcon(boardActive ? 'file-text' : 'columns-3')
      .onClick(() => this.switchTab(boardActive ? 'document' : 'board')));
    menu.addItem((item) => item.setTitle('新建页面').setIcon('square-plus').onClick(() => void this.createPage()));
    menu.addItem((item) => item.setTitle('查找当前页面文本').setIcon('search').onClick(() => this.openFindReplace(false)));
    menu.addItem((item) => item.setTitle('查找并替换').setIcon('replace').onClick(() => this.openFindReplace(true)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(this.focusMode ? '退出专注模式' : '进入专注模式').setIcon(this.focusMode ? 'minimize-2' : 'maximize-2').onClick(() => this.toggleFocusMode()));
    menu.addItem((item) => item
      .setTitle('以 Obsidian 原生 Markdown 打开')
      .setIcon('file-text')
      .setDisabled(!this.page || !this.plugin.generatedMarkdownPathForPage(this.page.id))
      .onClick(() => void this.plugin.openPageAsNativeMarkdown(this.page.id, this.leaf)));
    menu.addSeparator();
    this.addExportMenuItems(menu);
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('诊断与恢复').setIcon('stethoscope').onClick(() => new BlockspaceDiagnosticsModal(this.app, this.plugin).open()));
    menu.showAtMouseEvent(event);
  }

  reparseInlineMarkdown() {
    if (!this.page) return;
    // Probe on a clone so a page with nothing to fix never lands a no-op undo step.
    const changed = Core.reparseInlineMarkdown(Core.clonePage(this.page));
    if (!changed) {
      new Notice('当前页面没有需要解析的 Markdown 文本');
      return;
    }
    this.performMutation('解析 Markdown 行内格式', (page) => { Core.reparseInlineMarkdown(page); });
    new Notice(`已解析 ${changed} 个块中的 Markdown 链接与格式（Ctrl/Cmd + Z 撤销）`);
  }

  showIconMenu(event) {
    if (!this.page) return;
    const menu = new Menu();
    for (const option of ICON_OPTIONS) {
      menu.addItem((item) => item
        .setTitle(`${option} 使用此图标`)
        .setChecked(this.page.icon === option)
        .onClick(() => this.performMutation('更换页面图标', (page) => { page.icon = option; })));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('自定义图标…').setIcon('smile-plus').onClick(() => {
      new PageIconModal(this.app, this.page.icon, (value) => {
        this.performMutation('更换页面图标', (page) => { page.icon = value; });
      }).open();
    }));
    menu.addItem((item) => item
      .setTitle('移除图标')
      .setIcon('circle-slash')
      .setDisabled(!this.page.icon)
      .onClick(() => this.performMutation('移除页面图标', (page) => { page.icon = ''; })));
    menu.showAtMouseEvent(event);
  }

  renderDocument(host) {
    if (!this.page) {
      host.createDiv({ cls: 'bs-empty-state', text: '没有可显示的页面' });
      return;
    }
    const scroll = host.createDiv({ cls: 'bs-document-scroll' });
    const pageShell = scroll.createDiv({ cls: 'bs-page-shell is-coverless' });
    const header = pageShell.createDiv({ cls: 'bs-page-header' });
    const title = header.createDiv({ cls: 'bs-page-title', attr: { contenteditable: 'true', role: 'textbox', 'aria-label': '页面标题', 'aria-multiline': 'false' }, text: this.page.title });
    const syncTitleDensity = () => {
      const length = Array.from(String(title.textContent || '')).length;
      title.toggleClass('is-long-title', length > 34);
      title.toggleClass('is-very-long-title', length > 58);
    };
    syncTitleDensity();
    title.addEventListener('paste', (event) => this.pastePlainText(event));
    title.addEventListener('beforeinput', () => this.beginLiveEdit('编辑页面标题', 'title'));
    title.addEventListener('focus', () => {
      if (this.selectedBlockIds.size) this.clearBlockSelection();
    });
    title.addEventListener('compositionstart', () => { this.isComposing = true; this.beginLiveEdit('编辑页面标题', 'title'); });
    title.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.page.title = String(title.textContent || '').trimStart() || 'Untitled';
      syncTitleDensity();
      this.refreshNativeHeader();
      this.afterLiveEdit({ commitNow: true });
    });
    title.addEventListener('input', () => {
      this.beginLiveEdit('编辑页面标题', 'title');
      this.page.title = String(title.textContent || '').trimStart() || 'Untitled';
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
      hint.createSpan({ text: '输入 / 选择块类型，也可以直接粘贴 Markdown 内容' });
    }
    const addBottom = createButton(pageShell, 'bs-add-bottom', '添加块', 'plus', '添加一个块');
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
          'aria-label': imageData.wrapMode === 'square-left' ? '图片左侧文字环绕' : '图片右侧文字环绕',
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
    label.createSpan({ text: '属性' });
    const summary = header.createSpan({ cls: 'bs-properties-summary' });
    if (!this.propertiesExpanded) {
      const statusLabel = STATUS_LABELS[this.page.properties.status];
      const priorityLabel = PRIORITY_LABELS[this.page.properties.priority];
      summary.createSpan({
        cls: `bs-property-chip is-${this.page.properties.status}`,
        text: statusLabel,
        attr: { 'data-property': 'status', title: `状态：${statusLabel}` },
      });
      summary.createSpan({
        cls: `bs-property-chip priority-${this.page.properties.priority}`,
        text: priorityLabel,
        attr: { 'data-property': 'priority', title: `优先级：${priorityLabel}` },
      });
      for (const tag of this.page.properties.tags.slice(0, 2)) {
        summary.createSpan({
          cls: 'bs-property-chip is-tag',
          text: `#${tag}`,
          attr: { 'data-property': 'tag', title: `标签：${tag}` },
        });
      }
      if (this.page.properties.tags.length > 2) {
        summary.createSpan({
          cls: 'bs-property-chip is-more',
          text: `+${this.page.properties.tags.length - 2}`,
          attr: { 'data-property': 'more', title: `另有 ${this.page.properties.tags.length - 2} 个标签` },
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
      const button = createButton(valueEl, 'bs-property-row-menu', `${labelText}属性菜单`, 'ellipsis');
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem((item) => item
          .setTitle('删除属性')
          .setIcon('trash-2')
          .onClick(onDelete));
        menu.showAtMouseEvent(event);
      });
      return button;
    };

    const statusValue = makeProperty('状态', 'circle-dot', 'status').valueEl;
    const statusControl = statusValue.createDiv({
      cls: 'bs-property-control is-status',
      attr: { 'data-state': this.page.properties.status },
    });
    const statusSelect = statusControl.createEl('select', { cls: 'bs-select', attr: { 'aria-label': '状态' } });
    for (const status of Core.PAGE_STATUSES) statusSelect.createEl('option', { value: status, text: STATUS_LABELS[status] });
    statusSelect.value = this.page.properties.status;
    statusSelect.addEventListener('change', () => {
      this.performMutation('修改页面状态', (page) => { page.properties.status = statusSelect.value; }, { render: false });
      statusControl.dataset.state = statusSelect.value;
    });

    const priorityValue = makeProperty('优先级', 'signal', 'priority').valueEl;
    const priorityControl = priorityValue.createDiv({
      cls: 'bs-property-control is-priority',
      attr: { 'data-state': this.page.properties.priority },
    });
    const prioritySelect = priorityControl.createEl('select', { cls: 'bs-select', attr: { 'aria-label': '优先级' } });
    for (const priority of Core.PAGE_PRIORITIES) prioritySelect.createEl('option', { value: priority, text: PRIORITY_LABELS[priority] });
    prioritySelect.value = this.page.properties.priority;
    prioritySelect.addEventListener('change', () => {
      this.performMutation('修改页面优先级', (page) => { page.properties.priority = prioritySelect.value; }, { render: false });
      priorityControl.dataset.state = prioritySelect.value;
    });

    const tagValue = makeProperty('标签', 'tag', 'tags').valueEl;
    const tagControl = tagValue.createDiv({ cls: 'bs-property-control is-tags' });
    const tagInput = tagControl.createEl('input', { cls: 'bs-property-input', attr: { type: 'text', placeholder: '输入标签，用逗号分隔', 'aria-label': '标签' } });
    tagInput.value = this.page.properties.tags.join(', ');
    tagInput.addEventListener('change', () => {
      this.performMutation('修改页面标签', (page) => {
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
        this.performMutation(`修改页面${labelText}`, (page) => {
          page.properties[propertyName] = String(input.value || '').trim();
        }, { render: false });
      });
      addDeleteMenu(propertyValue, labelText, () => {
        this.performMutation(`删除页面${labelText}`, (page) => {
          page.properties[propertyName] = '';
        });
      });
    };

    makeTextProperty('source', '来源', 'link-2', { type: 'url', placeholder: 'https://…' });
    makeTextProperty('author', '作者', 'user-round');
    makeTextProperty('publishedAt', '发布日期', 'calendar-days');
    makeTextProperty('description', '摘要', 'align-left', { multiline: true });

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
        attr: { type: 'text', value: property.name, 'aria-label': `属性名称：${property.name}` },
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
          new Notice('属性名称不能为空、不能重复，也不能使用内置属性名');
          return;
        }
        updateCustomProperty(property.id, `重命名属性 ${property.name}`, (target) => { target.name = name; }, { render: false });
      });

      const control = propertyRow.valueEl.createDiv({ cls: `bs-property-control is-custom is-${property.type}` });
      const commitValue = (value) => updateCustomProperty(
        property.id,
        `修改属性 ${property.name}`,
        (target) => { target.value = value; },
        { render: false },
      );

      if (property.type === 'checkbox') {
        const checkboxLabel = control.createEl('label', { cls: 'bs-property-checkbox' });
        const input = checkboxLabel.createEl('input', {
          attr: { type: 'checkbox', 'aria-label': property.name },
        });
        input.checked = Boolean(property.value);
        checkboxLabel.createSpan({ text: input.checked ? '是' : '否', cls: 'bs-property-checkbox-label' });
        input.addEventListener('change', () => {
          const label = checkboxLabel.querySelector('.bs-property-checkbox-label');
          if (label) label.textContent = input.checked ? '是' : '否';
          commitValue(input.checked);
        });
      } else {
        const input = control.createEl('input', {
          cls: 'bs-property-input',
          attr: {
            type: property.type === 'number' ? 'number' : property.type === 'date' ? 'date' : property.type === 'datetime' ? 'datetime-local' : 'text',
            'aria-label': property.name,
            placeholder: property.type === 'list' ? '输入值，用逗号分隔' : '',
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

      const menuButton = createButton(propertyRow.valueEl, 'bs-property-row-menu', `${property.name}属性菜单`, 'ellipsis');
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
              updateCustomProperty(property.id, `更改属性类型 ${property.name}`, (target) => {
                target.type = type;
                target.value = Core.normalizeCustomPropertyValue(type, target.value);
              });
            }));
        }
        menu.addSeparator();
        menu.addItem((item) => item
          .setTitle('删除属性')
          .setIcon('trash-2')
          .onClick(() => {
            this.performMutation(`删除属性 ${property.name}`, (page) => {
              page.properties.custom = (page.properties.custom || [])
                .filter((candidate) => candidate.id !== property.id);
            });
          }));
        menu.showAtMouseEvent(event);
      });
    }

    const addProperty = createButton(body, 'bs-property-add', '添加属性', 'plus', '添加属性');
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
        attr: { type: 'text', placeholder: '属性名称', 'aria-label': '新属性名称' },
      });
      const draftValue = draft.createDiv({ cls: 'bs-property-value' });
      const typeSelect = draftValue.createEl('select', { cls: 'bs-select bs-property-type-select', attr: { 'aria-label': '属性类型' } });
      for (const type of Core.CUSTOM_PROPERTY_TYPES) {
        typeSelect.createEl('option', { value: type, text: CUSTOM_PROPERTY_TYPE_DETAILS[type].label });
      }
      const confirm = createButton(draftValue, 'bs-property-draft-action is-confirm', '确认添加属性', 'check');
      const cancel = createButton(draftValue, 'bs-property-draft-action', '取消添加属性', 'x');
      const removeDraft = () => draft.remove();
      const commitDraft = () => {
        const name = String(nameInput.value || '').trim().slice(0, 100);
        if (!Core.isValidCustomPropertyName(name, customProperties.map((property) => property.name))) {
          new Notice('属性名称不能为空、不能重复，也不能使用内置属性名');
          nameInput.focus();
          return;
        }
        const type = Core.CUSTOM_PROPERTY_TYPES.includes(typeSelect.value) ? typeSelect.value : 'text';
        const value = type === 'list' ? [] : type === 'number' ? null : type === 'checkbox' ? false : '';
        this.performMutation(`添加属性 ${name}`, (page) => {
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
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('无法读取附件内容');
    const path = await this.availableAttachmentPath(file.name);
    const buffer = await file.arrayBuffer();
    if (typeof this.app.vault.createBinary === 'function') await this.app.vault.createBinary(path, buffer);
    else if (typeof this.app.vault.adapter.writeBinary === 'function') await this.app.vault.adapter.writeBinary(path, buffer);
    else throw new Error('当前 Obsidian 版本不支持写入二进制附件');
    return {
      path,
      name: path.split('/').pop() || file.name || '附件',
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
    this.performMutation('插入网络内容', (page) => {
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
      new Notice(`附件导入失败：${error && error.message ? error.message : error}`);
      return [];
    }
    const blocks = records.map((record) => this.uploadedFileBlock(record));
    const current = Core.getBlock(this.page, anchorId);
    const replaceEmpty = current && current.type === 'paragraph' && !current.text && !current.children.length;
    let insertedIds = [];
    this.performMutation(records.length > 1 ? '插入多个附件' : '插入附件', (page) => {
      insertedIds = Core.insertBlocksAfter(page, anchorId, blocks).map((block) => block.id);
      if (replaceEmpty) Core.removeSubtrees(page, [anchorId]);
    });
    new Notice(records.length > 1 ? `已导入 ${records.length} 个附件` : `已导入 ${records[0].name}`);
    return insertedIds;
  }

  async replaceAdvancedBlockFile(blockId, file) {
    if (!file || !this.page) return false;
    let record;
    try {
      record = await this.writeAttachmentFile(file);
    } catch (error) {
      console.error('Blockspace: attachment replacement failed', error);
      new Notice(`附件写入失败：${error && error.message ? error.message : error}`);
      return false;
    }
    const replacement = this.uploadedFileBlock(record);
    this.performMutation('替换块文件', (page) => {
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
    this.updateAdvancedBlock(blockId, '添加表格行', (target) => {
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
    menu.addItem((item) => item.setTitle('在上方插入行').setIcon('arrow-up-to-line').onClick(() => {
      this.insertStructuredTableRow(blockId, rowId, 'before');
    }));
    menu.addItem((item) => item.setTitle('在下方插入行').setIcon('arrow-down-to-line').onClick(() => {
      this.insertStructuredTableRow(blockId, rowId, 'after');
    }));
    menu.addItem((item) => item.setTitle('复制此行').setIcon('copy-plus').onClick(() => {
      const copyId = Core.randomId('row');
      this.updateAdvancedBlock(blockId, '复制表格行', (target) => {
        const index = target.data.rows.findIndex((entry) => entry.id === rowId);
        if (index < 0) return;
        target.data.rows.splice(index + 1, 0, { id: copyId, cells: { ...target.data.rows[index].cells } });
      }, { render: true });
    }));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('删除此行')
      .setIcon('trash-2')
      .setDisabled(data.rows.length <= 1)
      .onClick(() => {
        this.updateAdvancedBlock(blockId, '删除表格行', (target) => {
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
      ['left', '左对齐', 'align-left'],
      ['center', '居中', 'align-center'],
      ['right', '右对齐', 'align-right'],
    ]) {
      menu.addItem((item) => {
        item.setTitle(label).setIcon(icon).onClick(() => {
          this.updateAdvancedBlock(blockId, '修改表格列对齐', (target) => {
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
      this.updateAdvancedBlock(blockId, '添加表格列', (target) => {
        const currentIndex = target.data.columns.findIndex((entry) => entry.id === columnId);
        const index = currentIndex < 0
          ? target.data.columns.length
          : currentIndex + (position === 'right' ? 1 : 0);
        target.data.columns.splice(index, 0, {
          id: newColumnId,
          name: `列 ${target.data.columns.length + 1}`,
          align: 'left',
          width: 160,
        });
        for (const row of target.data.rows) row.cells[newColumnId] = '';
      }, { render: true });
    };
    menu.addItem((item) => item.setTitle('在左侧插入列').setIcon('panel-left-open').onClick(() => insertColumn('left')));
    menu.addItem((item) => item.setTitle('在右侧插入列').setIcon('panel-right-open').onClick(() => insertColumn('right')));
    if (column.width) {
      menu.addItem((item) => item.setTitle('恢复自动列宽').setIcon('minimize-2').onClick(() => {
        this.updateAdvancedBlock(blockId, '恢复表格自动列宽', (target) => {
          const targetColumn = target.data.columns.find((entry) => entry.id === columnId);
          if (targetColumn) targetColumn.width = 0;
        }, { render: true });
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('删除此列')
      .setIcon('trash-2')
      .setDisabled(data.columns.length <= 1)
      .onClick(() => {
        this.updateAdvancedBlock(blockId, '删除表格列', (target) => {
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
        attr: { type: 'text', 'aria-label': `编辑列标题：${column.name || '未命名列'}` },
      });
      input.value = column.name;
      input.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改表格列标题', (target) => {
          const targetColumn = target.data.columns.find((entry) => entry.id === column.id);
          if (targetColumn) targetColumn.name = input.value;
        });
      });
      const menuButton = createButton(content, 'bs-table-column-menu', `打开“${column.name || '未命名列'}”列菜单`, 'chevron-down');
      menuButton.addEventListener('click', (event) => this.showStructuredTableColumnMenu(event, block.id, column.id));
      cell.addEventListener('contextmenu', (event) => this.showStructuredTableColumnMenu(event, block.id, column.id));
      const resize = cell.createDiv({ cls: 'bs-table-column-resize', attr: { role: 'separator', 'aria-label': `调整“${column.name || '未命名列'}”列宽`, tabindex: '0' } });
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
          this.updateAdvancedBlock(block.id, '调整表格列宽', (target) => {
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
      const rowMenu = createButton(rowHandle, 'bs-table-row-menu', `打开第 ${rowIndex + 1} 行菜单`, 'grip-vertical');
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
            'aria-label': `第 ${rowIndex + 1} 行，${column.name || `第 ${columnIndex + 1} 列`}`,
            placeholder: '空',
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
          this.updateAdvancedBlock(block.id, '编辑表格单元格', (target) => {
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
    const addRow = createButton(actions, 'bs-table-add-row', '添加表格行', 'plus', '新建一行');
    addRow.addEventListener('click', () => {
      this.insertStructuredTableRow(block.id, data.rows[data.rows.length - 1]?.id || null, 'after');
    });
    const addColumn = createButton(actions, 'bs-table-add-column', '添加表格列', 'columns-3', '添加列');
    addColumn.addEventListener('click', () => {
      this.updateAdvancedBlock(block.id, '添加表格列', (target) => {
        const id = Core.randomId('column');
        target.data.columns.push({ id, name: `列 ${target.data.columns.length + 1}`, align: 'left', width: 160 });
        for (const row of target.data.rows) row.cells[id] = '';
      }, { render: true });
    });
  }

  renderAdvancedFloatingToolbar(shell, block, options = {}) {
    const toolbar = shell.createDiv({ cls: 'bs-media-toolbar', attr: { role: 'toolbar', 'aria-label': `${ADVANCED_BLOCK_LABELS[block.type]?.label || '媒体'}操作` } });
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
        '上传或替换文件',
        'replace',
        '替换',
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
        '打开原始内容',
        'arrow-up-right',
        '打开',
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
        attr: { role: 'group', 'aria-label': '文字环绕' },
      });
      for (const [wrapMode, icon, label, shortLabel] of [
        ['top-bottom', 'rows-3', '独占一行：文字只在图片上方和下方', '独占'],
        ['square-left', 'panel-left', '图片靠左：文字在右侧环绕', '靠左'],
        ['square-right', 'panel-right', '图片靠右：文字在左侧环绕', '靠右'],
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
          this.updateAdvancedBlock(block.id, '修改文字环绕', (target) => {
            target.data.wrapMode = wrapMode;
          }, { render: true });
          refocusImage();
        });
      }
    }
    const settings = createButton(
      toolbar,
      `bs-media-toolbar-button${block.type === 'image' ? ' is-icon-only bs-media-toolbar-secondary' : ''}`,
      '编辑媒体设置',
      'sliders-horizontal',
      '设置',
    );
    if (block.type === 'image') {
      const remove = createButton(
        toolbar,
        'bs-media-toolbar-button is-icon-only bs-media-toolbar-secondary is-destructive',
        '删除图片块',
        'trash-2',
        '删除',
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
      attr: { type: 'button', 'aria-label': data.title ? `打开 ${data.title}` : '打开书签链接' },
    });
    const body = card.createDiv({ cls: 'bs-bookmark-body' });
    const copy = body.createDiv({ cls: 'bs-bookmark-copy' });
    copy.createDiv({ cls: 'bs-bookmark-title', text: data.title || data.url || '添加书签链接' });
    if (data.description) copy.createDiv({ cls: 'bs-bookmark-description', text: data.description });
    const meta = copy.createDiv({ cls: 'bs-bookmark-meta' });
    const icon = meta.createSpan({ cls: 'bs-bookmark-icon' });
    if (data.icon) {
      icon.createEl('img', { attr: { src: data.icon, alt: '', loading: 'lazy' } });
    } else setIcon(icon, 'globe-2');
    meta.createSpan({ cls: 'bs-bookmark-url', text: data.siteName || data.url || '尚未设置地址' });
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
    properties.createEl('summary', { text: '书签设置' });
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
        this.updateAdvancedBlock(block.id, '编辑书签', (target) => { target.data[key] = input.value.trim(); }, { render: true });
      });
    };
    addField('链接', 'url');
    addField('标题', 'title');
    addField('描述', 'description', true);
    addField('站点', 'siteName');
    addField('预览图', 'image');
    addField('站点图标', 'icon');
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
          'aria-label': '选择图片；选中后可调整尺寸和对齐',
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
        this.updateAdvancedBlock(block.id, '调整图片宽度', (target) => {
          target.data.width = width;
          target.data.height = 0;
          target.data.widthMode = 'fixed';
        }, { render: false });
      };
      const addResizeHandle = (corner) => {
        const isLeft = corner.endsWith('w');
        const isTop = corner.startsWith('n');
        const cornerLabel = {
          nw: '左上角',
          ne: '右上角',
          sw: '左下角',
          se: '右下角',
        }[corner];
        const handle = imageFrame.createEl('button', {
          cls: `bs-image-resize-handle is-${corner}`,
          attr: {
            type: 'button',
            'aria-label': `从${cornerLabel}等比例调整图片大小`,
            title: '拖动等比例缩放；方向键微调',
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
      audioBody.createDiv({ cls: 'bs-audio-title', text: data.title || data.path || data.url || '音频' });
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
      embedHeader.createDiv({ cls: 'bs-attachment-name', text: data.name || data.path || 'PDF 文档' });
      const frameSource = `${source}${data.page ? `#page=${data.page}` : ''}`;
      const frame = embed.createEl('iframe', {
        cls: 'bs-attachment-frame',
        attr: { src: frameSource, title: data.name || data.path || 'PDF 附件预览', loading: 'lazy' },
      });
      frame.style.height = `${data.height || 520}px`;
    } else if (block.type === 'attachment' && (data.path || data.url)) {
      const card = preview.createEl('button', {
        cls: 'bs-attachment-card',
        attr: { type: 'button', 'aria-label': `打开附件 ${data.name || data.path || data.url}` },
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
        attr: { type: 'button', 'aria-label': `添加${ADVANCED_BLOCK_LABELS[block.type]?.label || '内容'}` },
      });
      const icon = empty.createSpan();
      setIcon(icon, ADVANCED_BLOCK_LABELS[block.type]?.icon || 'paperclip');
      const copy = empty.createDiv();
      copy.createDiv({ cls: 'bs-advanced-empty-title', text: `添加${ADVANCED_BLOCK_LABELS[block.type]?.label || '内容'}` });
      copy.createDiv({ cls: 'bs-advanced-empty-hint', text: '上传文件，或在设置中粘贴地址' });
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
        attr: { type: 'text', placeholder: '添加图片说明…', 'aria-label': '图片说明' },
      });
      imageCaption.value = data.caption || '';
      imageCaption.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改图片说明', (target) => { target.data.caption = imageCaption.value.trim(); }, { render: true });
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
    properties.createEl('summary', { text: `${ADVANCED_BLOCK_LABELS[block.type]?.label || '媒体'}设置` });
    tools.settings.addEventListener('click', () => {
      properties.open = !properties.open;
      if (properties.open) properties.querySelector('input, select')?.focus();
    });
    const fields = properties.createDiv({ cls: 'bs-advanced-fields' });
    const sourceTypeField = fields.createEl('label', { cls: 'bs-advanced-field' });
    sourceTypeField.createSpan({ text: '来源' });
    const sourceType = sourceTypeField.createEl('select');
    sourceType.createEl('option', { value: 'vault', text: 'Vault 文件' });
    sourceType.createEl('option', { value: 'remote', text: '网络地址' });
    sourceType.value = data.sourceType;
    sourceType.addEventListener('change', () => {
      this.updateAdvancedBlock(block.id, '修改资源来源', (target) => { target.data.sourceType = sourceType.value; }, { render: true });
    });
    const sourceField = fields.createEl('label', { cls: 'bs-advanced-field' });
    sourceField.createSpan({ text: data.sourceType === 'vault' ? 'Vault 路径' : '网络地址' });
    const sourceInput = sourceField.createEl('input', {
      attr: { type: data.sourceType === 'remote' ? 'url' : 'text', placeholder: data.sourceType === 'remote' ? 'https://…' : 'Assets/file.ext' },
    });
    sourceInput.value = data.sourceType === 'remote' ? data.url : data.path;
    sourceInput.addEventListener('change', () => {
      this.updateAdvancedBlock(block.id, '修改资源地址', (target) => {
        if (target.data.sourceType === 'remote') target.data.url = sourceInput.value.trim();
        else target.data.path = normalizePath(sourceInput.value.trim());
      }, { render: true });
    });
    if (block.type === 'image') {
      const altField = fields.createEl('label', { cls: 'bs-advanced-field' });
      altField.createSpan({ text: '替代文字' });
      const alt = altField.createEl('input', { attr: { type: 'text' } });
      alt.value = data.alt || '';
      alt.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改图片替代文字', (target) => { target.data.alt = alt.value; }, { render: true });
      });
      const alignField = fields.createEl('label', { cls: 'bs-advanced-field' });
      alignField.createSpan({ text: '图片对齐' });
      const align = alignField.createEl('select');
      for (const [value, text] of [
        ['left', '左对齐'],
        ['center', '居中'],
        ['right', '右对齐'],
      ]) align.createEl('option', { value, text });
      align.value = Core.normalizeBlockAppearance(block.appearance).align;
      align.addEventListener('change', () => {
        this.performMutation('修改图片对齐', (page) => {
          const target = Core.getBlock(page, block.id);
          if (!target) return;
          target.appearance = { ...Core.normalizeBlockAppearance(target.appearance), align: align.value };
        }, { render: true });
      });
      const sizeModeField = fields.createEl('label', { cls: 'bs-advanced-field' });
      sizeModeField.createSpan({ text: '图片尺寸' });
      const sizeMode = sizeModeField.createEl('select');
      for (const [value, text] of [
        ['auto', '自然尺寸'],
        ['fixed', '固定宽度'],
        ['full', '适应内容宽度'],
      ]) sizeMode.createEl('option', { value, text });
      sizeMode.value = data.widthMode;
      sizeMode.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改图片尺寸模式', (target) => {
          target.data.widthMode = sizeMode.value;
          target.data.height = 0;
          if (sizeMode.value === 'fixed') target.data.width = target.data.width || 320;
          else target.data.width = 0;
        }, { render: true });
      });
      const widthField = fields.createEl('label', { cls: 'bs-advanced-field' });
      widthField.createSpan({ text: '显示宽度' });
      const width = widthField.createEl('input', { attr: { type: 'number', min: '0', max: '4000', placeholder: '自动' } });
      width.value = data.width ? String(data.width) : '';
      width.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改图片宽度', (target) => {
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
      addImageSelect('文字环绕', 'wrapMode', [
        ['top-bottom', '独占一行'],
        ['square-left', '图片靠左'],
        ['square-right', '图片靠右'],
      ], '修改文字环绕');
      addImageSelect('文字垂直对齐', 'wrapTextAlign', [
        ['top', '顶部对齐'],
        ['center', '垂直居中'],
        ['bottom', '底部对齐'],
      ], '修改文字垂直对齐');
      addImageSelect('图文间距', 'wrapGap', [
        [12, '紧凑 · 12px'],
        [20, '标准 · 20px'],
        [28, '宽松 · 28px'],
        [36, '松散 · 36px'],
      ], '修改图文间距');
      addImageSelect('图注对齐', 'captionAlign', [
        ['left', '左对齐'],
        ['center', '居中'],
        ['right', '右对齐'],
      ], '修改图注对齐');
      addImageSelect('图注字号', 'captionSize', [
        ['small', '小号'],
        ['normal', '正文'],
      ], '修改图注字号');
      addImageSelect('图注样式', 'captionStyle', [
        ['regular', '常规'],
        ['italic', '斜体'],
        ['bold', '粗体'],
      ], '修改图注样式');
      fields.createDiv({
        cls: 'bs-image-caption-guidance',
        text: '图注适合简短说明，可设置整段对齐、字号和字形；颜色、链接或局部格式请在图片下方使用普通文本块。',
      });
    } else {
      const titleField = fields.createEl('label', { cls: 'bs-advanced-field' });
      titleField.createSpan({ text: block.type === 'attachment' ? '文件名' : '标题' });
      const title = titleField.createEl('input', { attr: { type: 'text' } });
      title.value = block.type === 'attachment' ? data.name || '' : data.title || '';
      title.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改媒体标题', (target) => {
          if (target.type === 'attachment') target.data.name = title.value;
          else target.data.title = title.value;
        }, { render: true });
      });
    }
    if (block.type === 'attachment') {
      const embedField = fields.createEl('label', { cls: 'bs-advanced-field is-toggle' });
      const embed = embedField.createEl('input', { attr: { type: 'checkbox' } });
      embed.checked = !!data.embed;
      embedField.createSpan({ text: '嵌入 PDF 预览' });
      embed.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '切换附件嵌入', (target) => { target.data.embed = embed.checked; }, { render: true });
      });
      const pageField = fields.createEl('label', { cls: 'bs-advanced-field' });
      pageField.createSpan({ text: '起始页码' });
      const page = pageField.createEl('input', { attr: { type: 'number', min: '0', placeholder: '默认' } });
      page.value = data.page ? String(data.page) : '';
      page.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改附件页码', (target) => { target.data.page = Number(page.value) || 0; }, { render: true });
      });
      const heightField = fields.createEl('label', { cls: 'bs-advanced-field' });
      heightField.createSpan({ text: '预览高度' });
      const height = heightField.createEl('input', { attr: { type: 'number', min: '240', max: '4000', placeholder: '520' } });
      height.value = data.height ? String(data.height) : '';
      height.addEventListener('change', () => {
        this.updateAdvancedBlock(block.id, '修改附件高度', (target) => { target.data.height = Number(height.value) || 0; }, { render: true });
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
    wrapper.setAttribute('aria-label', `${config.count} 栏布局`);
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
          'aria-label': `第 ${columnIndex + 1} 栏`,
          'data-column-id': column.id,
        },
      });
      const addBlock = () => {
        let createdId = null;
        this.performMutation('在分栏中添加块', (page) => {
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
          text: '拖入块，或点击添加',
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
        this.performMutation(sourceIds.length > 1 ? '将多个块移入分栏' : '将块移入分栏', (page) => {
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
        'aria-label': '选择当前块；选择后可用 Shift 加方向键扩展范围',
        'aria-pressed': this.selectedBlockIds.has(block.id) ? 'true' : 'false',
        title: '拖动选择连续块，或按 Enter/空格选择当前块',
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
    const addButton = createButton(controls, 'bs-block-control', '在当前块后添加同级块', 'plus');
    addButton.addEventListener('click', () => this.insertBlock(block.id));
    const handle = createButton(controls, 'bs-block-control bs-drag-handle', '选择、拖动或打开块菜单', 'grip-vertical');
    handle.draggable = true;
    handle.title = '单击或右键打开菜单 · Shift 连选 · Ctrl/Cmd 多选 · 拖动整棵子树 · Shift+F10 键盘菜单';
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
      this.performMutation(sourceIds.length > 1 ? '拖动多个块子树' : '拖动块子树', (page) => {
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
      const disclosure = createButton(content, 'bs-collapse-toggle', isCollapsed ? '展开内容' : '折叠内容', isCollapsed ? 'chevron-right' : 'chevron-down');
      disclosure.setAttribute('aria-expanded', String(!isCollapsed));
      disclosure.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.performMutation(isCollapsed ? '展开内容' : '折叠内容', (page) => {
          if (Core.isHeadingBlock(block)) Core.toggleHeadingSectionCollapsed(page, block.id);
          else Core.toggleBlockCollapsed(page, block.id);
        });
      });
    } else {
      content.createSpan({ cls: 'bs-collapse-spacer' });
    }

    if (block.type === 'todo') {
      const checkbox = content.createEl('input', { cls: 'bs-todo-checkbox', attr: { type: 'checkbox', 'aria-label': '完成任务' } });
      checkbox.checked = block.checked;
      checkbox.addEventListener('change', () => {
        this.performMutation('切换待办状态', (page) => {
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
      const toc = content.createEl('nav', { cls: 'bs-toc', attr: { 'aria-label': '页面目录' } });
      const tocHeader = toc.createDiv({ cls: 'bs-toc-header' });
      const tocIcon = tocHeader.createSpan({ cls: 'bs-toc-header-icon' });
      setIcon(tocIcon, 'list-tree');
      tocHeader.createSpan({ text: '目录' });
      const items = Core.deriveOutline(this.page, block.toc);
      if (!items.length) {
        const empty = toc.createDiv({ cls: 'bs-toc-empty' });
        empty.createDiv({ cls: 'bs-toc-empty-title', text: '此页面还没有标题' });
        empty.createDiv({ cls: 'bs-toc-empty-hint', text: '输入 /标题，或使用下方按钮创建第一个章节。' });
        const createHeading = createButton(empty, 'bs-toc-create-heading', '创建一级标题', 'heading-1', '创建标题');
        createHeading.addEventListener('click', () => {
          let headingId = null;
          this.performMutation('创建目录标题', (page) => {
            const heading = Core.createBlock('heading-1', '新章节');
            headingId = Core.insertBlocksAfter(page, block.id, [heading])[0].id;
          });
          if (headingId) focusEditorAt(this, headingId, '新章节'.length);
        });
      }
      for (const item of items) {
        const link = toc.createEl('button', {
          cls: `bs-toc-item level-${item.level}${item.sectionCollapsed ? ' is-collapsed' : ''}`,
          attr: { type: 'button', 'data-heading-id': item.blockId },
        });
        link.style.setProperty('--bs-toc-level', String(Math.max(0, item.level - block.toc.minLevel)));
        if (block.toc.showNumbers && item.numberPath) link.createSpan({ cls: 'bs-toc-number', text: item.numberPath });
        link.createSpan({ cls: 'bs-toc-label', text: item.title });
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
      const editButton = createButton(markdownHeader, 'bs-markdown-edit-button', '编辑 Markdown 源码', 'square-pen', '编辑');
      editButton.tabIndex = 0;
      const preview = markdownBlock.createDiv({
        cls: 'bs-markdown-preview markdown-preview-view',
        attr: {
          tabindex: '0',
          'aria-label': 'Markdown 预览，点击正文或按 Enter 编辑源码',
        },
      });
      const editor = markdownBlock.createEl('textarea', {
        cls: 'bs-markdown-source-editor',
        attr: {
          'aria-label': '编辑 Markdown',
          placeholder: '输入 Markdown，例如 [[页面]]、![[图片.png]]、公式、Mermaid 或 Callout…',
          spellcheck: 'false',
        },
      });
      editor.value = block.text || '';
      editor.hidden = true;
      if (block.text) void this.renderMarkdownInto(preview, block.text, `markdown:${block.id}`);
      else preview.createDiv({ cls: 'bs-markdown-empty', text: '空 Markdown 块' });
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
      editor.addEventListener('beforeinput', () => this.beginLiveEdit('编辑原生 Markdown', `markdown:${block.id}`));
      editor.addEventListener('compositionstart', () => { this.isComposing = true; this.beginLiveEdit('编辑原生 Markdown', `markdown:${block.id}`); });
      editor.addEventListener('compositionend', () => {
        this.isComposing = false;
        const current = Core.getBlock(this.page, block.id);
        if (current) { current.text = editor.value; current.marks = []; }
        this.afterLiveEdit({ commitNow: true });
      });
      editor.addEventListener('input', () => {
        this.beginLiveEdit('编辑原生 Markdown', `markdown:${block.id}`);
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
      else nativePreview.createSpan({ cls: 'bs-native-block-empty', text: index === 0 ? '点击输入内容，或输入 /' : '点击输入内容' });
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
        'aria-label': `编辑${SLASH_COMMANDS.find((command) => command.type === block.type)?.label || '文本'}块`,
        'data-placeholder': depth > 0 && block.type === 'todo'
          ? '输入子任务…'
          : depth > 0 && (block.type === 'bulleted-list' || block.type === 'numbered-list')
            ? '输入子项…'
            : index === 0 ? '输入 / 打开命令菜单' : '输入内容，或输入 /',
        spellcheck: 'true',
      },
    });
    renderInlineContent(editor, block);
    if (useNativePreview) editor.hidden = true;
    editor.addEventListener('paste', (event) => this.handleBlockPaste(event, block.id, editor));
    editor.addEventListener('beforeinput', () => this.beginLiveEdit('编辑块内容', `block:${block.id}`));
    editor.addEventListener('compositionstart', () => {
      this.isComposing = true;
      this.setInteractionState('composing', { blockId: block.id });
      this.beginLiveEdit('编辑块内容', `block:${block.id}`);
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
      this.beginLiveEdit('编辑块内容', `block:${block.id}`);
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
          this.performMutation('粘贴 Blockspace 块', (page) => {
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
        this.performMutation('粘贴 Markdown 结构', (page) => {
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
        this.performMutation('粘贴 Markdown 行内格式', (page) => {
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
    this.performMutation('粘贴多个块', (page) => {
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
    this.performMutation('Markdown 行内格式', (page) => {
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
      this.performMutation('Markdown 快捷输入：分隔线', (page) => {
        Core.convertBlockType(page, [blockId], 'divider');
        const target = Core.getBlock(page, blockId);
        if (target) { target.text = ''; target.marks = []; }
        const next = Core.createBlock('paragraph', '');
        nextId = Core.insertBlocksAfter(page, blockId, [next])[0].id;
      });
      if (nextId) focusEditorAt(this, nextId, 0);
      return true;
    }
    this.performMutation('Markdown 快捷输入', (page) => {
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
        new Notice('请先选择要设置格式的文字');
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
      this.runCommand('复制块及其子块', (page) => {
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
      this.performMutation(direction < 0 ? '上移块子树' : '下移块子树', (page) => {
        moved = Core.moveSiblingGroup(page, [blockId], direction);
      });
      if (moved) focusEditorAt(this, blockId, caretOffset);
      return;
    }

    if (modifier && event.key === 'Enter') {
      if (currentBlock.type === 'todo') {
        event.preventDefault();
        this.performMutation('切换待办状态', (page) => {
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
        this.performMutation(currentBlock.sectionCollapsed ? '展开章节' : '折叠章节', (page) => Core.toggleHeadingSectionCollapsed(page, blockId));
        return;
      }
      if (currentBlock.type === 'toggle' || currentBlock.children.length) {
        event.preventDefault();
        this.performMutation(currentBlock.collapsed ? '展开子块' : '折叠子块', (page) => Core.toggleBlockCollapsed(page, blockId));
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
          this.runCommand('退出容器', (page) => ({ changed: Core.outdentBlocks(page, [blockId]) }), {
            focus: { type: 'block', blockId, offset: 0 },
          });
          return;
        }
      }

      if (!text && ['todo', 'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle'].includes(currentBlock.type)) {
        if (currentBlock.parentId) {
          this.performMutation('退出一级嵌套', (page) => Core.outdentBlocks(page, [blockId]));
        } else {
          this.performMutation('退出当前块类型', (page) => Core.convertBlockType(page, [blockId], 'paragraph'));
        }
        focusEditorAt(this, blockId, 0);
        return;
      }

      if (currentBlock.type === 'toggle') {
        let childId = null;
        this.performMutation('在折叠块中插入内容', (page) => {
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

      this.runCommand('拆分块', (page) => {
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
            this.runCommand('删除分栏中的空块', (page) => Core.removeSubtrees(page, [blockId]), {
              focus: focusTarget ? { type: 'block', blockId: focusTarget.id, offset: focusTarget.text.length } : null,
            });
            return;
          }
          this.performMutation('退出一级嵌套', (page) => Core.outdentBlocks(page, [blockId]));
          focusEditorAt(this, blockId, 0);
          return;
        }
        if (currentBlock.children.length && ['quote', 'callout', 'toggle'].includes(currentBlock.type)) {
          let focusId = null;
          this.performMutation('移除容器外壳', (page) => {
            const result = Core.unwrapBlock(page, blockId);
            focusId = result && result.focusId;
          });
          if (focusId) focusEditorAt(this, focusId, 0);
          return;
        }
        if (['todo', 'bulleted-list', 'numbered-list', 'quote', 'callout', 'toggle'].includes(currentBlock.type)) {
          this.performMutation('转为普通文本', (page) => Core.convertBlockType(page, [blockId], 'paragraph'));
          focusEditorAt(this, blockId, 0);
          return;
        }
        if (currentBlock.children.length) return;
        const previous = visible[currentIndex - 1];
        if (previous) {
          const previousLength = previous.text.length;
          this.runCommand('删除空块', (page) => Core.removeSubtrees(page, [blockId]), {
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
            this.runCommand('合并分栏内块', (page) => {
              const result = Core.mergeBlockWithPrevious(page, blockId);
              return result ? { blockId: result.block.id, offset: result.offset } : {};
            }, { focus: (result) => result.blockId ? { type: 'block', blockId: result.blockId, offset: result.offset } : null });
            return;
          }
          this.performMutation('减少块层级', (page) => Core.outdentBlocks(page, [blockId]));
          focusEditorAt(this, blockId, 0);
          return;
        }
        this.runCommand('合并块', (page) => {
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
        new Notice('当前块已经位于本栏最外层');
        return;
      }
      let changed = false;
      this.runCommand(event.shiftKey ? '减少块层级' : '将块移入上一容器', (page) => {
        changed = event.shiftKey ? Core.outdentBlocks(page, [blockId]) : Core.indentBlocks(page, [blockId]);
        return { changed };
      }, { focus: (_result, page) => changed ? {
        type: 'block', blockId,
        offset: Math.min(caret, Core.getBlock(page, blockId).text.length),
      } : null });
      if (!changed) new Notice(event.shiftKey ? '当前块已经位于最外层' : '上一同级块不能容纳子块');
      return;
    }

    if (event.key === 'ArrowLeft' && isSelectionCollapsed(editor) && getCaretOffset(editor) === 0 && Core.isHeadingBlock(currentBlock) && Core.getHeadingSectionRootIds(this.page, blockId).length > 1 && !currentBlock.sectionCollapsed) {
      event.preventDefault();
      this.performMutation('折叠章节', (page) => Core.toggleHeadingSectionCollapsed(page, blockId, true));
      return;
    }
    if (event.key === 'ArrowRight' && isSelectionCollapsed(editor) && getCaretOffset(editor) === currentBlock.text.length && Core.isHeadingBlock(currentBlock) && currentBlock.sectionCollapsed) {
      event.preventDefault();
      this.performMutation('展开章节', (page) => Core.toggleHeadingSectionCollapsed(page, blockId, false));
      return;
    }
    if (event.key === 'ArrowLeft' && isSelectionCollapsed(editor) && getCaretOffset(editor) === 0 && currentBlock.children.length && !currentBlock.collapsed) {
      event.preventDefault();
      this.performMutation('折叠子块', (page) => Core.toggleBlockCollapsed(page, blockId, true));
      return;
    }
    if (event.key === 'ArrowRight' && isSelectionCollapsed(editor) && getCaretOffset(editor) === currentBlock.text.length && currentBlock.children.length && currentBlock.collapsed) {
      event.preventDefault();
      this.performMutation('展开子块', (page) => Core.toggleBlockCollapsed(page, blockId, false));
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
        attr: { id: menuId, role: 'listbox', 'aria-label': '块类型' },
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
    title.createSpan({ text: this.slashState.query ? `搜索“${this.slashState.query}”` : (slashBlock && slashBlock.parentId ? '在当前结构中插入' : '插入或转换块') });
    title.createSpan({ cls: 'bs-slash-hint', text: '↑↓ 选择 · Enter 插入 · Esc 关闭' });
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
      this.runCommand('插入分栏', (page) => {
        const result = Core.convertBlockToColumns(page, blockId, 2, { preserveText: false });
        firstBlockId = result && result.firstBlockId;
        return { firstBlockId };
      }, { focus: (result) => result.firstBlockId ? { type: 'block', blockId: result.firstBlockId, offset: 0 } : null });
      return;
    }
    this.runCommand('转换块类型', (page) => {
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
      .setTitle(block.type === 'table' ? '编辑表格' : block.type === 'bookmark' ? '编辑书签' : '编辑内容与地址')
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
      menu.addItem((item) => item.setTitle('添加行').setIcon('rows-3').onClick(() => {
        this.updateAdvancedBlock(block.id, '添加表格行', (target) => {
          const cells = {};
          for (const column of target.data.columns) cells[column.id] = '';
          target.data.rows.push({ id: Core.randomId('row'), cells });
        }, { render: true });
      }));
      menu.addItem((item) => item.setTitle('添加列').setIcon('columns-3').onClick(() => {
        this.updateAdvancedBlock(block.id, '添加表格列', (target) => {
          const id = Core.randomId('column');
          target.data.columns.push({ id, name: `列 ${target.data.columns.length + 1}`, align: 'left', width: 160 });
          for (const row of target.data.rows) row.cells[id] = '';
        }, { render: true });
      }));
    } else if (!['bookmark'].includes(block.type)) {
      menu.addItem((item) => item
        .setTitle('上传或替换文件')
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
        .setTitle(block.type === 'bookmark' ? '打开链接' : '打开源文件')
        .setIcon('arrow-up-right')
        .onClick((clickEvent) => void this.openStoredLink(data.sourceType === 'vault' ? `wikilink:${source}` : source, clickEvent || event)));
      menu.addItem((item) => item
        .setTitle('复制资源地址')
        .setIcon('link')
        .onClick(() => void this.writeClipboardText(source, '已复制资源地址')));
    } else if (block.type === 'bookmark' && data.url) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle('打开链接').setIcon('arrow-up-right').onClick((clickEvent) => void this.openStoredLink(data.url, clickEvent || event)));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('复制原生 Markdown')
      .setIcon('clipboard-copy')
      .onClick(() => void this.writeClipboardText(Core.advancedBlockToMarkdown(block), '已复制原生 Markdown')));
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
        .setTitle(`已选择 ${blockIds.length} 个块`)
        .setIcon('layers-3')
        .setDisabled(true));
    }
    if (!blockIds.some((selectedId) => Core.getBlock(this.page, selectedId)?.type === 'columns')) {
      menu.addItem((item) => item
        .setTitle(blockIds.length > 1 ? '转换所选块类型…' : '转换块类型…')
        .setIcon('replace')
        .onClick((clickEvent) => this.showBlockTypeMenu(clickEvent || event, blockIds)));
    }
    menu.addItem((item) => item
      .setTitle(blockIds.length > 1 ? `设置 ${blockIds.length} 个块的样式…` : '块样式…')
      .setIcon('palette')
      .onClick(() => new BlockAppearanceModal(this.app, this, blockIds).open()));

    if (current && blockIds.length === 1 && Core.isHeadingBlock(current)) {
      menu.addItem((item) => item
        .setTitle('章节操作…')
        .setIcon('list-collapse')
        .onClick((clickEvent) => this.showHeadingContextMenu(clickEvent || event, current)));
    } else if (current && current.type !== 'columns' && blockIds.length === 1 && (current.type === 'toggle' || current.children.length || headingSection.length > 1)) {
      const collapsed = !!current.collapsed;
      menu.addItem((item) => item
        .setTitle(collapsed ? '展开内容' : '折叠内容')
        .setIcon(collapsed ? 'chevrons-down' : 'chevrons-up')
        .onClick(() => this.performMutation(collapsed ? '展开内容' : '折叠内容', (page) => {
          Core.toggleBlockCollapsed(page, blockId);
        })));
    }

    if (current && blockIds.length === 1 && current.type === 'table-of-contents') {
      menu.addItem((item) => item
        .setTitle('目录设置…')
        .setIcon('list-tree')
        .onClick((clickEvent) => this.showTocContextMenu(clickEvent || event, current)));
    }

    if (current && blockIds.length === 1 && current.type === 'columns') {
      menu.addItem((item) => item
        .setTitle('分栏设置…')
        .setIcon('columns-3')
        .onClick((clickEvent) => this.showColumnsContextMenu(clickEvent || event, current)));
    }

    if (current && current.type === 'markdown' && blockIds.length === 1) {
      menu.addItem((item) => item
        .setTitle('高级：编辑 Markdown 源码')
        .setIcon('file-code-2')
        .onClick(() => {
          const ownerWindow = this.contentEl.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.activateMarkdownBlockEditor(blockId), 0);
        }));
    }
    if (current && Core.ADVANCED_BLOCK_TYPES.has(current.type) && blockIds.length === 1) {
      menu.addItem((item) => item
        .setTitle(`${ADVANCED_BLOCK_LABELS[current.type]?.label || '高级块'}操作…`)
        .setIcon(ADVANCED_BLOCK_LABELS[current.type]?.icon || 'blocks')
        .onClick((clickEvent) => this.showAdvancedBlockContextMenu(clickEvent || event, current)));
    }

    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('复制与引用…')
      .setIcon('copy')
      .onClick((clickEvent) => this.showBlockCopyContextMenu(clickEvent || event, current, blockIds)));
    menu.addItem((item) => item
      .setTitle('移动与层级…')
      .setIcon('move')
      .onClick((clickEvent) => this.showBlockMoveContextMenu(clickEvent || event, blockIds)));
    if (current && blockIds.length === 1) {
      menu.addItem((item) => item.setTitle('查看块反向链接').setIcon('link-2').onClick(() => this.showBacklinksForBlock(blockId)));
    }

    menu.addItem((item) => item.setTitle('选择当前可见页面全部块').setIcon('list-checks').onClick(() => {
      const visibleIds = this.getVisibleBlockIds();
      this.setBlockSelection(visibleIds, visibleIds[0] || null, visibleIds[visibleIds.length - 1] || null);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(blockIds.length > 1 ? `删除 ${blockIds.length} 个块子树` : '删除块及其子块').setIcon('trash-2').onClick(() => this.deleteSelectedBlocks()));
    menu.showAtMouseEvent(event);
  }

  showBlockCopyContextMenu(event, current, blockIds) {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(blockIds.length > 1 ? `创建 ${blockIds.length} 个块的副本` : '创建块副本')
      .setIcon('copy-plus')
      .onClick(() => this.duplicateSelectedBlocks()));
    menu.addItem((item) => item
      .setTitle('复制为 Markdown')
      .setIcon('clipboard-copy')
      .onClick(() => void this.copySelectedBlocks()));
    if (current && blockIds.length === 1) {
      menu.addItem((item) => item
        .setTitle('复制纯文本')
        .setIcon('text')
        .onClick(() => void this.writeClipboardText(current.text || '', '已复制块文本')));
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle('复制块引用')
        .setIcon('quote')
        .onClick(() => void this.copyBlockReference(current, 'reference')));
      menu.addItem((item) => item
        .setTitle('复制块链接')
        .setIcon('link')
        .onClick(() => void this.copyBlockReference(current, 'link')));
    }
    menu.showAtMouseEvent(event);
  }

  showBlockMoveContextMenu(event, blockIds) {
    const menu = new Menu();
    const canOutdent = blockIds.some((id) => !!Core.getBlock(this.page, id)?.parentId);
    menu.addItem((item) => item.setTitle('上移同级位置').setIcon('arrow-up').onClick(() => this.moveSelectedBlocks(-1)));
    menu.addItem((item) => item.setTitle('下移同级位置').setIcon('arrow-down').onClick(() => this.moveSelectedBlocks(1)));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('减少层级').setIcon('outdent').setDisabled(!canOutdent).onClick(() => this.indentSelectedBlocks(-1)));
    menu.addItem((item) => item.setTitle('移入上一容器').setIcon('indent').onClick(() => this.indentSelectedBlocks(1)));
    menu.showAtMouseEvent(event);
  }

  showHeadingContextMenu(event, block) {
    if (!block || !Core.isHeadingBlock(block)) return;
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle(block.sectionCollapsed ? '展开章节' : '折叠章节')
      .setIcon(block.sectionCollapsed ? 'chevrons-down' : 'chevrons-up')
      .onClick(() => this.performMutation(block.sectionCollapsed ? '展开章节' : '折叠章节', (page) => {
        Core.toggleHeadingSectionCollapsed(page, block.id);
      })));
    menu.addItem((item) => item.setTitle('选择整个章节').setIcon('list-collapse').onClick(() => {
      const sectionIds = Core.getHeadingSectionRootIds(this.page, block.id);
      this.setBlockSelection(sectionIds, sectionIds[0] || null, sectionIds[sectionIds.length - 1] || null);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('上移整个章节').setIcon('arrow-up-to-line').onClick(() => {
      this.performMutation('上移整个章节', (page) => Core.moveHeadingSection(page, block.id, -1));
    }));
    menu.addItem((item) => item.setTitle('下移整个章节').setIcon('arrow-down-to-line').onClick(() => {
      this.performMutation('下移整个章节', (page) => Core.moveHeadingSection(page, block.id, 1));
    }));
    menu.showAtMouseEvent(event);
  }

  showTocContextMenu(event, block) {
    if (!block || block.type !== 'table-of-contents') return;
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(block.toc.showNumbers ? '隐藏目录编号' : '显示目录编号').setIcon('list-ordered').onClick(() => {
      this.performMutation(block.toc.showNumbers ? '隐藏目录编号' : '显示目录编号', (page) => {
        const target = Core.getBlock(page, block.id);
        if (target) target.toc.showNumbers = !target.toc.showNumbers;
      });
    }));
    menu.addItem((item) => item.setTitle(block.toc.maxLevel === 3 ? '目录仅显示一二级标题' : '目录显示一至三级标题').setIcon('list-tree').onClick(() => {
      this.performMutation('修改目录层级', (page) => {
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
        .setTitle(`${count} 栏`)
        .setIcon(count === 2 ? 'columns-2' : 'columns-3')
        .setChecked(config.count === count)
        .onClick(() => {
          if (config.count === count) return;
          this.performMutation(`切换为 ${count} 栏`, (page) => Core.setColumnsCount(page, block.id, count));
        }));
    }
    menu.addSeparator();
    const ratios = config.count === 3 ? ['1:1:1', '1:2:1', '2:1:1', '1:1:2'] : ['1:1', '1:2', '2:1'];
    for (const ratio of ratios) {
      menu.addItem((item) => item
        .setTitle(`比例 ${ratio}`)
        .setIcon('panel-left-dashed')
        .setChecked(config.ratio === ratio)
        .onClick(() => {
          if (config.ratio === ratio) return;
          this.performMutation('调整分栏比例', (page) => Core.setColumnsRatio(page, block.id, ratio));
        }));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('转为上下排列')
      .setIcon('rows-3')
      .onClick(() => {
        let focusId = null;
        this.performMutation('移除分栏布局', (page) => {
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
    const text = String(label || reference.target || '链接').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
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
    const label = String(element.textContent || element.getAttribute('aria-label') || '链接').replace(/\s+/g, ' ').trim() || '链接';
    const resolved = this.plugin.store.resolveStoredReference(value, this.page && this.page.id);
    if (resolved && ['obsidian', 'blockspace-page', 'blockspace-block'].includes(resolved.kind)) {
      menu.addItem((item) => item
        .setTitle('预览链接')
        .setIcon('scan-eye')
        .onClick((clickEvent) => {
          const ownerWindow = element.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.handleStoredLinkHover(element, value, clickEvent || event, false), 0);
        }));
    }
    menu.addItem((item) => item
      .setTitle('打开链接')
      .setIcon('arrow-up-right')
      .onClick((clickEvent) => void this.openStoredLink(value, clickEvent || event)));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('复制显示文本')
      .setIcon('text')
      .onClick(() => void this.writeClipboardText(label, '已复制显示文本')));
    menu.addItem((item) => item
      .setTitle('复制链接目标')
      .setIcon('link')
      .onClick(() => void this.writeClipboardText(this.storedLinkClipboardTarget(value), '已复制链接目标')));
    menu.addItem((item) => item
      .setTitle('复制为 Markdown')
      .setIcon('clipboard-copy')
      .onClick(() => void this.writeClipboardText(this.storedLinkMarkdown(value, label), '已复制 Markdown 链接')));
    if (resolved && resolved.kind === 'blockspace-block' && resolved.blockId) {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle('查看目标块反向链接')
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
        .setTitle('打开图片链接目标')
        .setIcon('external-link')
        .onClick((clickEvent) => void this.openStoredLink(outerValue, clickEvent || event)));
      menu.addSeparator();
    }
    menu.addItem((item) => item
      .setTitle('打开原图')
      .setIcon('image')
      .setDisabled(!source)
      .onClick((clickEvent) => void this.openStoredLink(source, clickEvent || event)));
    menu.addItem((item) => item
      .setTitle('重新加载图片')
      .setIcon('refresh-cw')
      .setDisabled(!source)
      .onClick(() => {
        const original = image.getAttribute('src') || image.currentSrc || source;
        image.removeAttribute('src');
        image.ownerDocument.defaultView.requestAnimationFrame(() => image.setAttribute('src', original));
      }));
    menu.addItem((item) => item
      .setTitle('复制图片地址')
      .setIcon('link')
      .setDisabled(!source)
      .onClick(() => void this.writeClipboardText(source, '已复制图片地址')));
    const alt = String(image.getAttribute('alt') || '').trim();
    menu.addItem((item) => item
      .setTitle('复制替代文本')
      .setIcon('text')
      .setDisabled(!alt)
      .onClick(() => void this.writeClipboardText(alt, '已复制图片替代文本')));
    const wrapper = image.closest('.bs-block[data-block-id]');
    const block = wrapper && this.page ? Core.getBlock(this.page, wrapper.dataset.blockId) : null;
    if (block && block.type === 'markdown') {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle('编辑所属 Markdown 源码')
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
    menu.addItem((item) => item.setTitle('定位到标题').setIcon('locate-fixed').onClick(() => this.focusBlock(block.id)));
    if (Core.isHeadingBlock(block)) {
      menu.addItem((item) => item
        .setTitle(block.sectionCollapsed ? '展开章节' : '折叠章节')
        .setIcon(block.sectionCollapsed ? 'chevrons-down' : 'chevrons-up')
        .onClick(() => this.performMutation(block.sectionCollapsed ? '展开章节' : '折叠章节', (page) => {
          Core.toggleHeadingSectionCollapsed(page, block.id);
        })));
      menu.addItem((item) => item.setTitle('选择整个章节').setIcon('list-collapse').onClick(() => {
        const sectionIds = Core.getHeadingSectionRootIds(this.page, block.id);
        this.setBlockSelection(sectionIds, sectionIds[0] || null, sectionIds[sectionIds.length - 1] || null);
      }));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('复制标题块链接').setIcon('link').onClick(() => void this.copyBlockReference(block, 'link')));
    menu.addItem((item) => item.setTitle('查看标题块反向链接').setIcon('link-2').onClick(() => this.showBacklinksForBlock(block.id)));
    menu.showAtMouseEvent(event);
  }

  showBacklinkContextMenu(event, backlink, element = null) {
    if (!backlink) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    const sourceValue = `blockspace://block/${encodeURIComponent(backlink.sourceBlockId)}`;
    menu.addItem((item) => item
      .setTitle('打开引用来源')
      .setIcon('arrow-up-right')
      .onClick(() => void this.openPageAtBlock(backlink.sourcePageId, backlink.sourceBlockId)));
    if (element) {
      menu.addItem((item) => item
        .setTitle('预览引用来源')
        .setIcon('scan-eye')
        .onClick((clickEvent) => {
          const ownerWindow = element.ownerDocument.defaultView;
          ownerWindow.setTimeout(() => this.handleStoredLinkHover(element, sourceValue, clickEvent || event, false), 0);
        }));
    }
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle('复制来源块链接')
      .setIcon('link')
      .onClick(() => void this.writeClipboardText(
        `[${String(backlink.sourcePageTitle || '引用来源').replace(/\]/g, '\\]')}](blockspace://block/${encodeURIComponent(backlink.sourceBlockId)})`,
        '已复制来源块链接',
      )));
    const snippet = String(backlink.sourceText || backlink.label || '').replace(/\s+/g, ' ').trim();
    menu.addItem((item) => item
      .setTitle('复制引用内容')
      .setIcon('text')
      .setDisabled(!snippet)
      .onClick(() => void this.writeClipboardText(snippet, '已复制引用内容')));
    menu.showAtMouseEvent(event);
  }

  showDocumentContextMenu(event) {
    if (!this.page) return;
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('在页面末尾添加块').setIcon('plus').onClick(() => this.insertBlock(this.getVisibleBlocks().length)));
    menu.addItem((item) => item.setTitle('选择全部可见块').setIcon('list-checks').setDisabled(!this.getVisibleBlocks().length).onClick(() => {
      const ids = this.getVisibleBlockIds();
      this.setBlockSelection(ids, ids[0] || null, ids[ids.length - 1] || null);
    }));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('新建页面').setIcon('square-plus').onClick(() => void this.createPage()));
    menu.addItem((item) => item.setTitle('导入当前 Markdown').setIcon('file-input').onClick(() => void this.plugin.importActiveMarkdown()));
    this.addExportMenuItems(menu);
    menu.addItem((item) => item.setTitle(this.focusMode ? '退出专注模式' : '进入专注模式').setIcon(this.focusMode ? 'minimize-2' : 'maximize-2').onClick(() => this.toggleFocusMode()));
    menu.showAtMouseEvent(event);
  }


  showPageMenu(event, meta) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('打开').setIcon('arrow-up-right').onClick(() => void this.openPage(meta.id)));
    menu.addItem((item) => item.setTitle('复制页面链接').setIcon('link').onClick(() => {
      const label = String(meta.title || 'Untitled').replace(/\]/g, '\\]');
      void this.writeClipboardText(`[${label}](blockspace://page/${encodeURIComponent(meta.id)})`, '已复制页面链接');
    }));
    this.addExportMenuItems(menu, () => this.plugin.store.loadPage(meta.id));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('删除页面').setIcon('trash-2').onClick(() => void this.removePage(meta)));
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
    new Notice('页面已删除');
  }

  insertBlock(indexOrAnchor) {
    const block = Core.createBlock();
    this.performMutation('插入块', (page) => {
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
      this.performMutation('移动页面状态', (page) => { page.properties.status = status; }, { render: false });
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
      new Notice(error instanceof ConflictError ? '页面已在其他位置修改，未覆盖原内容' : '更新页面状态失败');
      return false;
    }
  }

  showBoardCardMenu(event, meta) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('打开').setIcon('arrow-up-right').onClick(() => void this.openPage(meta.id)));
    menu.addItem((item) => item.setTitle('复制页面链接').setIcon('link').onClick(() => {
      const label = String(meta.title || 'Untitled').replace(/\]/g, '\\]');
      void this.writeClipboardText(`[${label}](blockspace://page/${encodeURIComponent(meta.id)})`, '已复制页面链接');
    }));
    this.addExportMenuItems(menu, () => this.plugin.store.loadPage(meta.id));
    menu.addSeparator();
    for (const status of Core.PAGE_STATUSES) {
      menu.addItem((item) => item
        .setTitle(`移动到“${STATUS_LABELS[status]}”`)
        .setIcon(status === 'done' ? 'circle-check-big' : status === 'doing' ? 'loader-circle' : 'circle-dashed')
        .setChecked(meta.status === status)
        .setDisabled(meta.status === status)
        .onClick(() => void this.movePageToStatus(meta.id, status)));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('删除页面').setIcon('trash-2').onClick(() => void this.removePage(meta)));
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
          attr: { role: 'group', 'aria-label': `页面 ${meta.title}`, 'data-page-id': meta.id },
        });
        card.draggable = true;
        card.addEventListener('dragstart', (event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-blockspace-page', meta.id);
        });
        const openButton = card.createEl('button', {
          cls: 'bs-card-open',
          attr: { type: 'button', 'aria-label': `打开页面 ${meta.title}` },
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
        const moveButton = createButton(card, 'bs-card-move', `页面“${meta.title}”的更多操作`, 'ellipsis');
        moveButton.addEventListener('click', (event) => this.showBoardCardMenu(event, meta));
      }
      const addCard = createButton(column, 'bs-board-add', '新增页面', 'plus', '新增页面');
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
      headingText.createSpan({ text: targetBlockId ? '块反向链接' : '反向链接' });
      headingText.createSpan({ cls: 'bs-backlinks-count', text: String(backlinks.length) });
      if (targetBlockId) {
        const clear = createButton(heading, 'bs-backlinks-clear', '返回页面反链', 'x');
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
        text: target && target.text ? target.text.replace(/\s+/g, ' ').slice(0, 120) : '当前块',
      });
    }
    if (!backlinks.length) {
      section.createDiv({
        cls: 'bs-empty-small',
        text: targetBlockId ? '还没有其他块引用这里' : '还没有页面或块引用这里',
      });
      return;
    }
    const list = section.createDiv({ cls: 'bs-backlinks-list' });
    for (const backlink of backlinks) {
      const item = list.createEl('button', {
        cls: 'bs-backlink-item',
        attr: { type: 'button', 'aria-label': `打开 ${backlink.sourcePageTitle} 中的引用` },
      });
      item.__blockspaceBacklink = backlink;
      const itemHeader = item.createDiv({ cls: 'bs-backlink-item-header' });
      itemHeader.createSpan({ cls: 'bs-backlink-page', text: backlink.sourcePageTitle || 'Untitled' });
      itemHeader.createSpan({
        cls: `bs-backlink-mode is-${backlink.mode || 'link'}`,
        text: ({ link: '链接', reference: '引用', embed: '嵌入' })[backlink.mode] || '链接',
      });
      const snippet = String(backlink.sourceText || backlink.label || '').replace(/\s+/g, ' ').trim();
      item.createDiv({ cls: 'bs-backlink-snippet', text: snippet || '空块' });
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
      new Notice('无法打开该页面');
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
    this.setPage(await this.plugin.store.createPage('Untitled', { status }));
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
            message: error.message || '保存冲突',
          };
          this.setSaveState('conflict');
          new Notice(`Blockspace 检测到保存冲突，已保留恢复副本：${error.details.conflictPath || ''}`);
        } else {
          this.saveIssue = {
            type: 'error',
            message: error && (error.message || String(error)) || '保存失败',
          };
          this.setSaveState('error');
          new Notice('Blockspace 保存失败，待恢复日志已保留');
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
  getDisplayText() { return 'Blockspace 检查器'; }
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
    titleWrap.createDiv({ cls: 'bs-inspector-title', text: page ? page.title : '页面检查器' });
    const refresh = createButton(header, 'bs-icon-button', '刷新检查器', 'refresh-cw');
    refresh.addEventListener('click', () => this.render());
    if (!view || !page) {
      const empty = this.contentEl.createDiv({ cls: 'bs-inspector-empty' });
      const icon = empty.createDiv({ cls: 'bs-inspector-empty-icon' });
      setIcon(icon, 'panel-right');
      empty.createDiv({ cls: 'bs-inspector-empty-title', text: '没有活动的 Blockspace 页面' });
      empty.createDiv({ cls: 'bs-inspector-empty-hint', text: '打开一个 Blockspace 工作台后，这里会显示属性、大纲和页面状态。' });
      return;
    }

    const properties = this.createSection('页面属性', 'sliders-horizontal');
    const statusRow = properties.createDiv({ cls: 'bs-inspector-property' });
    statusRow.createSpan({ cls: 'bs-inspector-property-label', text: '状态' });
    const statusSelect = statusRow.createEl('select', { cls: 'dropdown' });
    for (const [value, label] of Object.entries(STATUS_LABELS)) statusSelect.createEl('option', { value, text: label });
    statusSelect.value = page.properties.status;
    statusSelect.addEventListener('change', () => view.performMutation('修改页面状态', (target) => { target.properties.status = statusSelect.value; }));

    const priorityRow = properties.createDiv({ cls: 'bs-inspector-property' });
    priorityRow.createSpan({ cls: 'bs-inspector-property-label', text: '优先级' });
    const prioritySelect = priorityRow.createEl('select', { cls: 'dropdown' });
    for (const [value, label] of Object.entries(PRIORITY_LABELS)) prioritySelect.createEl('option', { value, text: label });
    prioritySelect.value = page.properties.priority;
    prioritySelect.addEventListener('change', () => view.performMutation('修改页面优先级', (target) => { target.properties.priority = prioritySelect.value; }));

    const tagsRow = properties.createDiv({ cls: 'bs-inspector-property is-column' });
    tagsRow.createSpan({ cls: 'bs-inspector-property-label', text: '标签' });
    const tags = tagsRow.createEl('input', { cls: 'bs-inspector-tags-input', attr: { type: 'text', placeholder: '用逗号分隔标签' } });
    tags.value = Array.isArray(page.properties.tags) ? page.properties.tags.join(', ') : '';
    tags.addEventListener('change', () => view.performMutation('修改页面标签', (target) => {
      target.properties.tags = tags.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
    }));

    const outline = this.createSection('大纲', 'list-tree');
    const headings = Core.deriveOutline(page);
    outline.addClass('bs-inspector-outline-tree');
    outline.setAttribute('role', 'tree');
    if (!headings.length) outline.createDiv({ cls: 'bs-inspector-muted', text: '还没有标题块' });
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
    const backlinks = this.createSection(backlinkTargetId ? '块反向链接' : '反向链接', 'link-2', {
      count: backlinkCount,
      action: backlinkTargetId
        ? {
          icon: 'x',
          label: '返回页面反链',
          onClick: () => {
            view.backlinkTargetBlockId = null;
            this.plugin.notifyContextChanged();
          },
        }
        : null,
    });
    view.renderBacklinksPanel(backlinks, { inspector: true, heading: false });

    const stats = this.createSection('页面统计', 'chart-no-axes-column-increasing');
    const todos = page.blocks.filter((block) => block.type === 'todo');
    for (const [label, value] of [
      ['块数量', page.blocks.length],
      ['待办完成', `${todos.filter((block) => block.checked).length}/${todos.length}`],
      ['修订版本', page.revision],
    ]) {
      const row = stats.createDiv({ cls: 'bs-inspector-stat' });
      row.createSpan({ text: label });
      row.createSpan({ cls: 'bs-inspector-stat-value', text: String(value) });
    }

    const storage = this.createSection('高级', 'database');
    storage.createDiv({ cls: 'bs-inspector-storage-path', text: `${this.plugin.store.pagesFolder}/${page.id}.json` });
    const diagnostics = createButton(storage, 'bs-inspector-action', '打开诊断与恢复', 'stethoscope', '诊断与恢复');
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
    contentEl.createEl('h2', { text: 'Blockspace 诊断与恢复' });
    const loading = contentEl.createDiv({ cls: 'bs-diagnostics-loading', text: '正在检查结构化数据…' });
    let report;
    try {
      report = await this.plugin.store.diagnose();
    } catch (error) {
      loading.setText(`诊断失败：${error.message || error}`);
      return;
    }
    loading.remove();
    const summary = contentEl.createDiv({ cls: 'bs-diagnostics-summary' });
    const items = [
      ['页面文件', report.pages],
      ['待恢复日志', report.pendingJournals],
      ['历史快照', report.snapshots],
      ['恢复副本', report.recoveryFiles],
      ['回收站页面', report.trashFiles],
      ['错误', report.errors.length],
      ['警告', report.warnings.length],
    ];
    for (const [label, value] of items) {
      const card = summary.createDiv({ cls: 'bs-diagnostic-card' });
      card.createDiv({ cls: 'bs-diagnostic-value', text: String(value) });
      card.createDiv({ cls: 'bs-diagnostic-label', text: label });
    }
    const renderIssues = (title, issues, type) => {
      const section = contentEl.createDiv({ cls: `bs-diagnostic-section is-${type}` });
      section.createEl('h3', { text: title });
      if (!issues.length) section.createDiv({ cls: 'bs-diagnostic-ok', text: '未发现问题' });
      else for (const issue of issues) section.createDiv({ cls: 'bs-diagnostic-issue', text: issue });
    };
    renderIssues('错误', report.errors, 'error');
    renderIssues('警告', report.warnings, 'warning');
    const actions = contentEl.createDiv({ cls: 'bs-diagnostic-actions' });
    const rerun = createButton(actions, 'mod-cta', '重新检查', 'refresh-cw', '重新检查');
    rerun.addEventListener('click', () => void this.renderReport());
    const rebuild = createButton(actions, '', '重建页面索引', 'list-restart', '重建索引');
    rebuild.addEventListener('click', async () => {
      rebuild.disabled = true;
      try {
        const count = await this.plugin.store.rebuildWorkspaceIndex();
        new Notice(`Blockspace 已重建 ${count} 个页面索引`);
        for (const view of this.plugin.views) view.render();
        await this.renderReport();
      } finally {
        rebuild.disabled = false;
      }
    });
    const recover = createButton(actions, '', '恢复未完成保存', 'life-buoy', '恢复日志');
    recover.addEventListener('click', async () => {
      recover.disabled = true;
      try {
        const count = await this.plugin.store.recoverPendingJournals();
        if (count > 0) await this.plugin.store.rebuildWorkspaceIndex();
        new Notice(count ? `已恢复 ${count} 个页面` : '没有需要恢复的页面');
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
      new Notice(`已恢复为新页面：${page.title}`);
      await this.renderReport();
    };
    const activeView = this.plugin.getActiveView();
    const restoreSnapshot = createButton(actions, '', '将当前页最近快照恢复为新页面', 'history', '恢复当前页快照');
    restoreSnapshot.disabled = !(activeView && activeView.page);
    restoreSnapshot.addEventListener('click', async () => {
      restoreSnapshot.disabled = true;
      try {
        const pageId = this.plugin.getActiveView()?.page?.id;
        const restored = await this.plugin.store.restoreLatestSnapshot(pageId);
        await openRestoredPage(restored, '当前页面没有可恢复的快照');
      } finally {
        restoreSnapshot.disabled = !(this.plugin.getActiveView()?.page);
      }
    });
    const restoreConflict = createButton(actions, '', '将最近冲突中的本地版本恢复为新页面', 'copy-plus', '恢复最近冲突');
    restoreConflict.addEventListener('click', async () => {
      restoreConflict.disabled = true;
      try {
        await openRestoredPage(await this.plugin.store.restoreLatestConflict(), '没有可恢复的冲突副本');
      } finally {
        restoreConflict.disabled = false;
      }
    });
    const restoreTrash = createButton(actions, '', '将最近删除页面恢复为新页面', 'archive-restore', '恢复最近删除');
    restoreTrash.addEventListener('click', async () => {
      restoreTrash.disabled = true;
      try {
        await openRestoredPage(await this.plugin.store.restoreLatestTrash(), '回收站中没有可恢复的页面');
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
    let pendingDataFolder = this.plugin.settings.dataFolder;
    new Setting(containerEl)
      .setName('数据目录')
      .setDesc('Blockspace 结构化页面存储目录。iOS / iPadOS 对点开头的隐藏目录限制较多，若移动端提示无权限保存，可改为不带点的名字（例如 Blockspace Data）。改好后点“迁移并应用”，原目录会保留为备份，重启插件后生效。')
      .addText((text) => text
        .setValue(this.plugin.settings.dataFolder)
        .onChange((value) => { pendingDataFolder = value; }))
      .addButton((button) => button
        .setButtonText('迁移并应用')
        .onClick(async () => {
          const nextFolder = String(pendingDataFolder || '').trim() || DEFAULT_SETTINGS.dataFolder;
          if (!this.plugin.store || normalizePath(nextFolder) === this.plugin.store.folder) {
            new Notice('数据目录未变化');
            return;
          }
          button.setDisabled(true);
          try {
            const result = await this.plugin.store.migrateDataFolder(nextFolder);
            this.plugin.settings.dataFolder = result.target;
            await this.plugin.saveSettings();
            new Notice(
              `已复制 ${result.moved} 个文件到 ${result.target}，原目录 ${result.source} 保留为备份。请重启 Obsidian 后生效。`,
              15000,
            );
          } catch (error) {
            console.error('Blockspace: data folder migration failed', error);
            new Notice(`数据目录迁移失败：${error && error.message ? error.message : error}`, 15000);
          } finally {
            button.setDisabled(false);
          }
        }));
    new Setting(containerEl)
      .setName('Markdown 导出目录')
      .setDesc('导出页面时保存 Markdown 文件的位置。')
      .addText((text) => text.setValue(this.plugin.settings.exportFolder).onChange(async (value) => {
        this.plugin.settings.exportFolder = value.trim() || DEFAULT_SETTINGS.exportFolder;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('附件目录')
      .setDesc('粘贴、拖入或上传的图片、视频、音频和文件会写入此 Vault 相对目录。')
      .addText((text) => text.setValue(this.plugin.settings.attachmentFolder || DEFAULT_SETTINGS.attachmentFolder).onChange(async (value) => {
        this.plugin.settings.attachmentFolder = value.trim() || DEFAULT_SETTINGS.attachmentFolder;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('自动生成原生 Markdown')
      .setDesc('每次保存、重命名或删除 Blockspace 页面时，在仓库中同步对应的 Obsidian 原生 Markdown。JSON 仍是唯一事实源，生成文件会被自动更新。')
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.nativeMarkdownSyncEnabled).onChange(async (value) => {
        this.plugin.settings.nativeMarkdownSyncEnabled = value;
        await this.plugin.saveSettings();
        if (value) {
          await this.plugin.ensureStore();
          const count = await this.plugin.store.syncNativeMarkdown();
          new Notice(`已生成 ${count} 个原生 Markdown 页面`);
        }
      }));
    new Setting(containerEl)
      .setName('原生 Markdown 目录')
      .setDesc('自动生成文件所在的仓库相对目录。文件使用 Obsidian 双链、嵌入、Callout 和块 ID，不包含 Blockspace 包装注释或内联样式。')
      .addText((text) => text.setValue(this.plugin.settings.nativeMarkdownFolder || DEFAULT_SETTINGS.nativeMarkdownFolder).onChange(async (value) => {
        this.plugin.settings.nativeMarkdownFolder = value.trim() || DEFAULT_SETTINGS.nativeMarkdownFolder;
        await this.plugin.saveSettings();
        if (this.plugin.settings.nativeMarkdownSyncEnabled) {
          await this.plugin.ensureStore();
          await this.plugin.store.syncNativeMarkdown();
        }
      }));
    new Setting(containerEl)
      .setName('从文件树直接打开 Blockspace')
      .setDesc('单击 Blockspace Notes 或 Bridge 中的生成文件时，在当前标签直接进入对应 Blockspace 页面。右键菜单仍可选择“以原生 Markdown 打开”。')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.openGeneratedMarkdownInBlockspace !== false)
        .onChange(async (value) => {
          this.plugin.settings.openGeneratedMarkdownInBlockspace = value;
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName('Markdown 块 ID 输出')
      .setDesc('控制手动导出、原生 Markdown 和 Bridge 中的 ^bs-… 标识。不导出时，块链接会自动降级为标题或页面链接。')
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
      .setName('同步无损 Markdown Bridge')
      .setDesc('兼容旧工作流的无损往返格式，会保留 Blockspace 注释和必要的 HTML。若只需要原生笔记，请使用上方的“自动生成原生 Markdown”。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.markdownBridgeEnabled !== false).onChange(async (value) => {
        this.plugin.settings.markdownBridgeEnabled = value;
        await this.plugin.saveSettings();
        if (value) {
          const count = await this.plugin.store.syncMarkdownBridge();
          new Notice(`已同步 ${count} 个 Blockspace 页面到 Obsidian`);
        }
      }));
    new Setting(containerEl)
      .setName('双链 Bridge 目录')
      .setDesc('无损 Bridge 文件目录。文件可供 Obsidian 索引，但请在 Blockspace 中编辑内容。')
      .addText((text) => text.setValue(this.plugin.settings.markdownBridgeFolder || DEFAULT_SETTINGS.markdownBridgeFolder).onChange(async (value) => {
        this.plugin.settings.markdownBridgeFolder = value.trim() || DEFAULT_SETTINGS.markdownBridgeFolder;
        await this.plugin.saveSettings();
        if (this.plugin.settings.markdownBridgeEnabled) await this.plugin.store.syncMarkdownBridge();
      }));
    new Setting(containerEl)
      .setName('Obsidian 原生 Markdown 渲染')
      .setDesc('控制整页阅读模式和未聚焦块是否使用 Obsidian MarkdownRenderer。原生阅读模式兼容性最稳。')
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
      .setName('自动保存延迟')
      .setDesc('停止输入后等待多少毫秒写入页面文件。')
      .addText((text) => text.setValue(String(this.plugin.settings.autosaveDelay)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.autosaveDelay = Number.isFinite(parsed) ? Math.max(100, Math.min(3000, parsed)) : 350;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('撤销历史条数')
      .setDesc('每个打开页面在内存中保留的事务历史，范围 20–1000。')
      .addText((text) => text.setValue(String(this.plugin.settings.historyLimit)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.historyLimit = Number.isFinite(parsed) ? Math.max(20, Math.min(1000, parsed)) : 150;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('每页恢复快照数')
      .setDesc('保存新修订前保留旧页面快照，范围 1–100。')
      .addText((text) => text.setValue(String(this.plugin.settings.snapshotLimit)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.snapshotLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : 12;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('恢复快照最小间隔')
      .setDesc('连续保存时至少间隔多少分钟才生成下一份完整快照，范围 1–240。待恢复日志仍会在每次保存前写入。')
      .addText((text) => text.setValue(String(this.plugin.settings.snapshotIntervalMinutes)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.snapshotIntervalMinutes = Number.isFinite(parsed) ? Math.max(1, Math.min(240, parsed)) : 5;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('默认展开页面属性')
      .setDesc('关闭后，状态、优先级和标签会以紧凑摘要显示。')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.showProperties !== false).onChange(async (value) => {
        this.plugin.settings.showProperties = value;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('界面风格')
      .setDesc('Notion 风格更克制留白，思源风格更紧凑清晰，Obsidian 原生最大限度跟随当前主题。')
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
      .setName('页面密度')
      .setDesc('紧凑适合持续写作，标准兼顾展示与编辑，沉浸强化封面和页面头部。')
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
      .setName('正文宽度')
      .setDesc('正文内容宽度，范围 580–1100 像素。')
      .addText((text) => text.setValue(String(this.plugin.settings.contentWidth)).onChange(async (value) => {
        const parsed = Number(value);
        this.plugin.settings.contentWidth = Number.isFinite(parsed) ? Math.max(580, Math.min(1100, parsed)) : 760;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName('正文字体')
      .setDesc('选择 Blockspace 正文的字体族。跟随 Obsidian 可获得最佳主题兼容性。')
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
      .setName('正文字号')
      .setDesc('Blockspace 正文基础字号，范围 12–24 像素。标题会按比例缩放。')
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
      .setName('正文行高')
      .setDesc('正文行高，范围 1.2–2.2。')
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
      .setName('紧凑界面密度')
      .setDesc('缩小导航、属性和看板间距，适合小屏幕或高信息密度使用。')
      .addToggle((toggle) => toggle.setValue(!!this.plugin.settings.compactMode).onChange(async (value) => {
        this.plugin.settings.compactMode = value;
        await this.plugin.saveSettings();
        for (const view of this.plugin.views) view.render();
      }));
    new Setting(containerEl)
      .setName('打开工作台时显示页面检查器')
      .setDesc('在 Obsidian 原生右侧栏中显示属性、大纲、统计和存储状态。')
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
    this.addRibbonIcon('layout-dashboard', '打开 Blockspace', () => void this.activateView());
    this.addCommand({ id: 'open-workspace', name: '打开工作台', callback: () => void this.activateView() });
    this.addCommand({ id: 'new-page', name: '新建页面', callback: async () => {
      const view = await this.activateView();
      if (view) await view.createPage();
    } });
    this.addCommand({ id: 'quick-switcher', name: '快速切换页面与操作', callback: async () => {
      const view = await this.activateView();
      if (view) view.openQuickSwitcher();
    } });
    this.addCommand({ id: 'find-in-page', name: '查找当前页面文本', callback: async () => {
      const view = await this.activateView();
      if (view) view.openFindReplace(false);
    } });
    this.addCommand({ id: 'replace-in-page', name: '查找并替换当前页面文本', callback: async () => {
      const view = await this.activateView();
      if (view) view.openFindReplace(true);
    } });
    this.addCommand({ id: 'open-inspector', name: '打开页面检查器', callback: () => void this.activateInspector() });
    this.addCommand({ id: 'toggle-focus-mode', name: '切换专注模式', checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view) return false;
      if (!checking) view.toggleFocusMode();
      return true;
    } });
    this.addCommand({ id: 'toggle-native-markdown-reading', name: '切换 Obsidian 原生 Markdown 阅读模式', checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view || view.activeTab !== 'document' || this.settings.markdownRenderMode === 'off') return false;
      if (!checking) view.toggleReadingMode();
      return true;
    } });
    this.addCommand({ id: 'import-active-markdown', name: '导入当前 Markdown 文件', callback: () => {
      void this.importActiveMarkdown().catch((error) => this.reportOpenFailure('导入 Markdown', error));
    } });
    this.addCommand({ id: 'export-current-page', name: '导出当前页面为无损 Markdown', callback: async () => {
      const view = this.getActiveView();
      if (view) await view.exportCurrentPage('md');
      else new Notice('请先打开 Blockspace 工作台');
    } });
    this.addCommand({ id: 'export-current-page-word', name: '导出当前页面为 Word', callback: async () => {
      const view = this.getActiveView();
      if (view) await view.exportCurrentPage('docx');
      else new Notice('请先打开 Blockspace 工作台');
    } });
    this.addCommand({ id: 'export-current-page-pdf', name: '导出当前页面为 PDF', callback: async () => {
      const view = this.getActiveView();
      if (view) await view.exportCurrentPage('pdf');
      else new Notice('请先打开 Blockspace 工作台');
    } });
    this.addCommand({ id: 'undo', name: '撤销当前页面操作', checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view || view.history.undo.length === 0) return false;
      if (!checking) view.undo();
      return true;
    } });
    this.addCommand({ id: 'redo', name: '重做当前页面操作', checkCallback: (checking) => {
      const view = this.getActiveView();
      if (!view || view.history.redo.length === 0) return false;
      if (!checking) view.redo();
      return true;
    } });
    this.addCommand({ id: 'diagnostics', name: '打开诊断与恢复', callback: async () => {
      try {
        await this.ensureStore();
      } catch (error) {
        this.reportOpenFailure('打开诊断与恢复', error);
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
        .setTitle('在 Blockspace 中打开')
        .setIcon('blocks')
        .onClick(() => void this.openMarkdownFileInBlockspace(file, leaf)));
      if (generatedPageId) {
        menu.addItem((item) => item
          .setTitle('以原生 Markdown 打开')
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
      view.performMutation(followsSource ? '跟随来源笔记重命名' : '跟随附件重命名', (page) => {
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
      new Notice('请先启用“自动生成原生 Markdown”或 Markdown Bridge');
      return false;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice('未找到对应的生成 Markdown 文件');
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
    item.setAttribute('aria-label', `Blockspace 保存状态：${label}`);
    item.setAttribute('title', state === 'error' || state === 'conflict'
      ? `${label}；请打开 Blockspace 诊断与恢复`
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
    console.error(`Blockspace: ${action}失败`, error);
    const detail = error && error.message ? error.message : String(error);
    new Notice(`Blockspace ${action}失败：${detail}`, 10000);
  }

  async activateInspector() {
    try {
      await this.ensureStore();
      let leaf = this.app.workspace.getLeavesOfType(INSPECTOR_VIEW_TYPE)[0];
      if (!leaf) {
        if (typeof this.app.workspace.getRightLeaf === 'function') leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) leaf = this.app.workspace.getLeaf('tab');
        if (!leaf) throw new Error('当前布局没有可用的面板');
        await leaf.setViewState({ type: INSPECTOR_VIEW_TYPE, active: true });
      }
      await this.app.workspace.revealLeaf(leaf);
      this.notifyContextChanged();
      return leaf.view instanceof BlockspaceInspectorView ? leaf.view : null;
    } catch (error) {
      this.reportOpenFailure('打开页面检查器', error);
      return null;
    }
  }

  async activateView() {
    try {
      await this.ensureStore();
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) {
        leaf = this.app.workspace.getLeaf(true);
        if (!leaf) throw new Error('当前布局没有可用的标签页');
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
      await this.app.workspace.revealLeaf(leaf);
      const view = leaf.view instanceof BlockspaceView ? leaf.view : null;
      if (view && this.settings.showInspectorOnOpen) void this.activateInspector();
      return view;
    } catch (error) {
      this.reportOpenFailure('打开工作台', error);
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
    throw new Error('当前 Obsidian 版本不支持写入二进制导出文件');
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
    const workingNotice = targetFormat === 'md' ? null : new Notice(`正在生成 ${label}…`, 0);
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
        ? `已无损导出 Markdown：${path}（正文不含恢复载荷）`
        : `已无损导出 ${label}：${path}`);
      await this.openExportedFile(file, targetFormat);
      return { path, file, format: targetFormat, sidecarPath };
    } catch (error) {
      if (workingNotice && typeof workingNotice.hide === 'function') workingNotice.hide();
      console.error(`Blockspace: ${targetFormat} export failed`, error);
      new Notice(`${label} 导出失败：${error && error.message ? error.message : '未知错误'}`);
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
      new Notice('请选择 Markdown 文件');
      return null;
    }
    const text = await this.app.vault.cachedRead(file);
    await this.ensureStore();
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const losslessPage = await this.losslessPageFromMarkdown(text, frontmatter);
    if (losslessPage) {
      const existing = this.store.workspace.pages.some((page) => page.id === losslessPage.id);
      const imported = existing
        ? await this.store.restorePageAsCopy(losslessPage, '（无损导入）')
        : await this.store.savePage(losslessPage, { expectedRevision: null, createSnapshot: false });
      const view = await this.activateView();
      if (view) await view.openPage(imported.id);
      new Notice(`已无损导入 ${file.basename}`);
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
    new Notice(`已导入 ${file.basename}`);
    return page;
  }
}

module.exports = BlockspaceWorkspacePlugin;
