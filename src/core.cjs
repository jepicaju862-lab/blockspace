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

module.exports = {
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
