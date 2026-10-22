const { parentPort, workerData } = require('node:worker_threads');
const { promises: dns } = require('node:dns');
const { openDatabase, saveIssue, saveSprint, mergeIssueHistoryPage } = require('./database.cjs');

const { discoverMetadata } = require('./jira-metadata.cjs');

const { dbPath, config, token, resume } = workerData;
const db = openDatabase(dbPath);
const base = new URL(config.jiraUrl);
let activeRunId = null;

function sendProgress(value) { parentPort.postMessage({ type: 'progress', value }); }
function privateAddress(address) {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (ip.includes(':')) return ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  const parts = ip.split('.').map(Number);
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

async function validateHost() {
  if (base.protocol !== 'https:') throw new Error('همگام‌سازی Jira فقط روی HTTPS انجام می‌شود.');
  if (['localhost', '127.0.0.1', '::1'].includes(base.hostname)) return;
  const addresses = await dns.lookup(base.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !privateAddress(address))) throw new Error('آدرس Jira باید به IP خصوصی شبکهٔ داخلی resolve شود.');
}

function readSyncState(key) {
  const row = db.prepare('SELECT value_json FROM sync_state WHERE key=?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

function writeSyncState(key, value) {
  db.prepare('INSERT INTO sync_state(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
    .run(key, JSON.stringify(value), new Date().toISOString());
}

function clearSyncState(key) { db.prepare('DELETE FROM sync_state WHERE key=?').run(key); }

async function getJira(resource, options = {}) {
  await validateHost();
  const target = new URL(resource.replace(/^\//, ''), `${base.toString().replace(/\/$/, '')}/`);
  if (target.origin !== base.origin) throw new Error('درخواست Jira به دامنهٔ دیگری هدایت شد.');
  const response = await fetch(target, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(options.headers || {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(60000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error('Jira درخواست را redirect کرد؛ آدرس پایه را بررسی کنید.');
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) throw new Error(`Jira (${response.status}): ${body.errorMessages?.join('، ') || body.message || response.statusText}`);
  return body;
}

function beginRun() {
  activeRunId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  db.prepare('INSERT INTO import_runs(id,started_at,files_json,note) VALUES(?,?,?,?)')
    .run(activeRunId, new Date().toISOString(), JSON.stringify(['اتصال Jira']), 'دریافت read-only از Jira');
  return activeRunId;
}

function upsertIssuePage(issues, checkpointKey, checkpointState) {
  let added = 0; let updated = 0; let duplicate = 0; let conflict = 0; let skipped = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const issue of issues) {
      const state = saveIssue(db, issue, 'jira-sync', activeRunId, { authoritative: true }).status;
      if (state === 'added') added += 1;
      else if (state === 'updated') updated += 1;
      else if (state === 'duplicate') duplicate += 1;
      else if (state === 'conflict') conflict += 1;
      else skipped += 1;
    }
    db.prepare('UPDATE import_runs SET issues_added=issues_added+?,issues_updated=issues_updated+?,duplicates=duplicates+?,conflicts=conflicts+?,skipped=skipped+? WHERE id=?')
      .run(added, updated, duplicate, conflict, skipped, activeRunId);
    // Keep the page data and its resume cursor in one transaction. A crash can
    // then neither commit a page without advancing its cursor nor advance the
    // cursor before the page data is durable.
    if (checkpointState) writeSyncState(checkpointKey, checkpointState);
    else clearSyncState(checkpointKey);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { added, updated, duplicate, conflict, skipped };
}

async function syncIssueSearch() {

  for (const project of config.projects) {
    const checkpointKey = `jira:issues:${project}`;
    const checkpoint = resume ? readSyncState(checkpointKey) : null;
    let startAt = checkpoint?.startAt || 0;
    const projectRun = checkpoint?.runId || activeRunId;
    for (;;) {
      const params = new URLSearchParams({ jql: `project = ${project} ORDER BY key`, startAt: String(startAt), maxResults: '100', fields: '*all', expand: 'changelog,names,schema' });
      const page = await getJira(`rest/api/2/search?${params.toString()}`);
      const items = Array.isArray(page.issues) ? page.issues.map((issue) => ({ ...issue, names: { ...(page.names || {}), ...(issue.names || {}) }, schema: { ...(page.schema || {}), ...(issue.schema || {}) } })) : [];
      const next = startAt + items.length;
      const total = Number(page.total || next);
      if (!items.length && next < Number(page.total || 0)) throw new Error('صفحه‌بندی تسک‌ها پیش نرفت؛ دریافت ناقص ادامه‌پذیر باقی ماند.');
      const reachedEnd = !items.length || next >= total;
      const checkpointState = reachedEnd ? null : { startAt: next, runId: projectRun, updatedAt: new Date().toISOString() };
      const counts = upsertIssuePage(items, checkpointKey, checkpointState);
      sendProgress({ phase: 'issues', project, fetched: next, total: Number(page.total || next), ...counts });
      if (reachedEnd) break;
      startAt = next;
    }
  }
}

async function syncSprintBoards() {
  for (const route of config.boardRoutes || []) {
    const boardId = String(route.boardId);
    const checkpointKey = `jira:sprints:${boardId}`;
    const checkpoint = resume ? readSyncState(checkpointKey) : null;
    let startAt = Number(checkpoint?.startAt || 0);
    for (;;) {
      const params = new URLSearchParams({ startAt: String(startAt), maxResults: '50' });
      const page = await getJira(`rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?${params.toString()}`);
      const values = Array.isArray(page.values) ? page.values : [];
      const next = startAt + values.length;
      const reportedTotal = page.total == null ? null : Number(page.total);
      if (!values.length && reportedTotal !== null && startAt < reportedTotal && !page.isLast) {
        throw new Error(`صفحه‌بندی Sprint برد ${boardId} پیش نرفت؛ دریافت ناقص ادامه‌پذیر باقی ماند.`);
      }
      const reachedEnd = !values.length || page.isLast || reportedTotal !== null && next >= reportedTotal;
      const checkpointState = reachedEnd ? null : { startAt: next, boardId, team: route.team, updatedAt: new Date().toISOString() };
      let added = 0; let updated = 0; let duplicates = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const sprint of values) {
          const status = saveSprint(db, { ...sprint, originBoardId: sprint.originBoardId || Number(boardId) }, 'jira-sync', activeRunId).status;
          if (status === 'added') added += 1; else if (status === 'updated') updated += 1; else duplicates += 1;
        }
        db.prepare('UPDATE import_runs SET sprints_added=sprints_added+?,sprints_updated=sprints_updated+?,duplicates=duplicates+? WHERE id=?').run(added, updated, duplicates, activeRunId);
        if (checkpointState) writeSyncState(checkpointKey, checkpointState);
        else clearSyncState(checkpointKey);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      startAt = next;
      sendProgress({ phase: 'sprints', boardId, team: route.team, fetched: startAt, ...{ added, updated, duplicates } });
      if (reachedEnd) break;
    }
  }
}

function issueRowsNeedingHistory() {
  const issues = [];
  const issuesStatement = db.prepare('SELECT jira_id,issue_key,raw_json,history_complete,history_total FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)');
  for (const row of issuesStatement.iterate()) {
    let issue;
    try { issue = JSON.parse(row.raw_json); } catch { continue; }
    const history = issue.changelog;
    const complete = Boolean(row.history_complete) || (history?.historyComplete !== undefined
      ? Boolean(history.historyComplete)
      : Boolean(history && Array.isArray(history.histories) && Number.isFinite(Number(history.total))
        && Number(history.total) <= (history.histories.length + Number(history.startAt || 0))));
    if (complete) continue;
    const total = Number(history?.total || row.history_total || 0);
    const positions = new Set((history?.histories || []).map((item, index) => {
      const saved = Number(item?.axiloomHistoryIndex);
      return Number.isInteger(saved) && saved >= 0 ? saved : Number(history?.startAt || 0) + index;
    }));
    let startAt = 0;
    while (startAt < total && positions.has(startAt)) startAt += 1;
    // Retain only the small scheduling record; don't keep every raw issue JSON
    // string in memory while preparing the changelog queue.
    issues.push({ key: row.issue_key, id: row.jira_id, startAt });
  }
  return issues;
}

async function syncIssueHistory() {
  const issues = issueRowsNeedingHistory();
  let position = 0;
  let completed = 0;
  let failure = null;
  const worker = async () => {
    while (!failure) {
      const index = position++;
      if (index >= issues.length) return;
      const issue = issues[index];
      const key = `jira:changelog:${issue.key}`;
      const checkpoint = resume ? readSyncState(key) : null;
      let startAt = checkpoint?.startAt ?? issue.startAt;
      try {
        for (;;) {
          const params = new URLSearchParams({ startAt: String(startAt), maxResults: '100' });
          const page = await getJira(`rest/api/2/issue/${encodeURIComponent(issue.key)}/changelog?${params.toString()}`);
          const values = page.histories || page.values || [];
          const merged = mergeIssueHistoryPage(db, issue.id, { ...page, startAt, histories: values }, 'jira-sync-history');
          if (merged.complete) { clearSyncState(key); break; }
          if (!values.length || merged.nextStart <= startAt) throw new Error(`صفحه‌بندی changelog برای ${issue.key} پیش نرفت؛ همگام‌سازی برای ادامه حفظ شد.`);
          startAt = merged.nextStart;
          writeSyncState(key, { startAt, updatedAt: new Date().toISOString() });
        }
        completed += 1;
        if (completed % 20 === 0 || completed === issues.length) sendProgress({ phase: 'history', completed, total: issues.length, issueKey: issue.key });
      } catch (error) {
        failure = error;
        writeSyncState(key, { startAt, issueKey: issue.key, error: error.message, updatedAt: new Date().toISOString() });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failure) throw failure;
}

async function syncCollections() {
  const totalRows = Number(db.prepare('SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)').get().count);
  const readBatch = db.prepare('SELECT rowid AS scan_id,raw_json FROM jira_issues WHERE rowid>? AND issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) ORDER BY rowid LIMIT 25');
  let completed = 0;
  let lastRowId = 0;
  for (;;) {
    // Read a bounded amount of raw JSON at a time. Large workspace databases
    // must not materialize every issue row in the worker's memory at once.
    const rows = readBatch.all(lastRowId);
    if (!rows.length) break;
    for (const row of rows) {
      lastRowId = Number(row.scan_id);
      const issue = JSON.parse(row.raw_json);
      if (!config.projects.includes(issue.fields.project?.key || issue.key.split('-')[0])) continue;
      let changed = false;
      for (const [field, property] of [['comment', 'comments'], ['worklog', 'worklogs']]) {
        const collection = issue.fields[field];
        if (!collection || !Number.isFinite(Number(collection.total)) || Number(collection.total) <= (collection[property] || []).length && !Number(collection.startAt || 0)) continue;
        const items = []; let startAt = 0;
        for (;;) {
          const page = await getJira(`rest/api/2/issue/${issue.key}/${field}?startAt=${startAt}&maxResults=100`);
          const values = page[property] || [];
          items.push(...values); startAt += values.length;
          if (startAt >= Number(page.total || 0)) break;
          if (!values.length) throw new Error(`صفحه‌بندی ${field} برای ${issue.key} پیش نرفت.`);
        }
        issue.fields[field] = { ...collection, startAt: 0, total: items.length, [property]: items };
        changed = true;
      }
      if (changed) saveIssue(db, issue, 'jira-sync-collections', activeRunId, { authoritative: true });
      completed++;
      if (completed % 50 === 0) sendProgress({ phase: 'collections', completed, total: totalRows });
    }
  }
}

async function run() {
  await validateHost();
  const health = await getJira('rest/api/2/myself');
  beginRun();
  sendProgress({ phase: 'started', user: health.displayName || '', projects: config.projects.length, boards: config.boardRoutes.length });
  try {
    const metadataWarnings = await discoverMetadata(db, getJira);
    if (metadataWarnings.length) sendProgress({ phase: 'metadata', warnings: metadataWarnings });
    await syncIssueSearch();
    await syncSprintBoards();
    await syncIssueHistory();
    await syncCollections();
    db.prepare('UPDATE import_runs SET finished_at=? WHERE id=?').run(new Date().toISOString(), activeRunId);
  } catch (error) {
    db.prepare('UPDATE import_runs SET finished_at=?,note=? WHERE id=?').run(new Date().toISOString(), `ادامه‌پذیر پس از خطا: ${error.message}`, activeRunId);
    throw error;
  } finally { db.close(); }
}

run().then(() => parentPort.postMessage({ type: 'done', value: { runId: activeRunId } }))
  .catch((error) => { try { db.close(); } catch { /* already closed */ } parentPort.postMessage({ type: 'error', error: error.message }); });
