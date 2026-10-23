const { createHash } = require('node:crypto');
const { getConfig } = require('./database.cjs');
const { createPageBudget } = require('./jira-page-budget.cjs');
const METADATA_LIMITS = require('../shared/resource-limits.json').jira;

function metadataKey(db, kind) {
  const origin = String(getConfig(db).jiraUrl || '').replace(/\/$/, '');
  return `jira:metadata:${createHash('sha256').update(origin).digest('hex')}:${kind}`;
}
function cacheMetadata(db, kind, value) {
  const json = JSON.stringify(value);
  const limit = require('../shared/resource-limits.json').imports.maxMetadataBytes;
  if (Buffer.byteLength(json, 'utf8') > limit) throw new Error(`Jira metadata exceeds the ${limit / 1024 / 1024} MB cache safety limit.`);
  db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
    .run(metadataKey(db, kind), json, new Date().toISOString());
}
function readMetadata(db, kind) {
  const row = db.prepare('SELECT value_json,updated_at FROM settings WHERE key=?').get(metadataKey(db, kind));
  return row ? { value: JSON.parse(row.value_json), updatedAt: row.updated_at } : null;
}
function projectKey(value) {
  const key = String(value || '').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('کلید پروژه معتبر نیست.');
  return key;
}
// Field catalog describes types, not create/edit permissions or context-specific options.
async function discoverMetadata(db, request) {
  const budget = createPageBudget('Jira metadata discovery', {
    maxPages: METADATA_LIMITS.maxMetadataPages,
    maxItems: METADATA_LIMITS.maxMetadataItems,
    maxBytes: METADATA_LIMITS.maxMetadataBytes,
  });
  const results = await Promise.allSettled(['field', 'project', 'issuetype'].map(async (kind) => {
    const value = await request(`rest/api/2/${kind}`);
    if (!Array.isArray(value)) throw new Error(`پاسخ متادیتای ${kind} معتبر نیست.`);
    budget.consume(value, value.length);
    cacheMetadata(db, kind, value);
    return kind;
  }));
  return results.flatMap((result) => result.status === 'rejected' ? [result.reason.message] : []);
}
async function allPages(request, resource, property, budget) {
  const rows = []; let startAt = 0;
  for (;;) {
    const page = await request(`${resource}${resource.includes('?') ? '&' : '?'}startAt=${startAt}&maxResults=100`);
    const items = page[property] || page.values || [];
    if (!Array.isArray(items)) throw new Error('صفحهٔ متادیتا معتبر نیست.');
    budget.consume(page, items.length);
    rows.push(...items); startAt += items.length;
    if (page.isLast === true || Number.isFinite(Number(page.total)) && startAt >= Number(page.total) || page.total == null && page.isLast == null && items.length < Number(page.maxResults || 100)) break;
    if (!items.length) throw new Error('صفحه‌بندی متادیتا پیش نرفت.');
  }
  return rows;
}
async function createMetadata(db, request, value, issueType) {
  const budget = createPageBudget('Jira create metadata', {
    maxPages: METADATA_LIMITS.maxMetadataPages,
    maxItems: METADATA_LIMITS.maxMetadataItems,
    maxBytes: METADATA_LIMITS.maxMetadataBytes,
  });
  const boundedRequest = async (resource) => {
    const response = await request(resource);
    budget.consume(response);
    return response;
  };
  const project = projectKey(value);
  const actual = await boundedRequest(`rest/api/2/project/${encodeURIComponent(project)}`);
  if (actual.key !== project) throw new Error('شناسهٔ پروژه با کلید مورد انتظار مطابقت ندارد.');
  let entry;
  try {
    const params = new URLSearchParams({ projectKeys: project, expand: 'projects.issuetypes.fields' });
    if (issueType) params.set('issuetypeIds', String(issueType));
    const meta = await boundedRequest(`rest/api/2/issue/createmeta?${params}`);
    entry = meta.projects?.find((item) => item.key === project);
    if (!entry) throw new Error('متادیتا یا دسترسی ایجاد در پروژه موجود نیست.');
  } catch (error) {
    if (!/^Jira \((404|405|410)\)/.test(error.message)) throw error;
    const types = await allPages(request, `rest/api/2/issue/createmeta/${project}/issuetypes`, 'values', budget);
    entry = { id: String(actual.id), key: actual.key, issuetypes: [] };
    for (const type of types.filter((item) => !issueType || String(item.id) === String(issueType))) {
      const fields = await allPages(request, `rest/api/2/issue/createmeta/${project}/issuetypes/${type.id}`, 'values', budget);
      if (fields.some((field) => !field.fieldId && !field.key && !field.id)) throw new Error('شناسهٔ یکی از فیلدهای متادیتا موجود نیست.');
      entry.issuetypes.push({ ...type, fields: Object.fromEntries(fields.map((field) => [field.fieldId || field.key || field.id, field])) });
    }
  }
  cacheMetadata(db, `create:${project}${issueType ? `:${issueType}` : ''}`, entry);
  return entry;
}
module.exports = { cacheMetadata, readMetadata, discoverMetadata, createMetadata, projectKey };
