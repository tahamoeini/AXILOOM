const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_CONFIG, normalizeConfig, validateConfig, configurationFingerprint, sourceIdentityKey } = require('./configuration.cjs');
const { resolveSemanticFields, isIssueDone, completionPolicyForProject, lifecycleRolesForStatus } = require('./semantic-mapping.cjs');

function openDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS configuration_revisions (
      revision INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      event_type TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      source_profile_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jira_semantic_projection (
      issue_key TEXT PRIMARY KEY,
      project_key TEXT NOT NULL DEFAULT '',
      issue_type_id TEXT NOT NULL DEFAULT '',
      story_points REAL,
      epic_key TEXT,
      epic_name TEXT,
      sprint_value_json TEXT,
      team_label TEXT,
      work_classification TEXT,
      issue_tags_json TEXT,
      requester TEXT,
      department TEXT,
      product_owner TEXT,
      logged_time,
      mapping_revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_projection_epic ON jira_semantic_projection(project_key,epic_key,issue_key);
    CREATE INDEX IF NOT EXISTS idx_semantic_projection_team ON jira_semantic_projection(team_label,project_key,issue_key);
    CREATE TABLE IF NOT EXISTS jira_issue_tombstones (
      issue_key TEXT PRIMARY KEY, jira_id TEXT NOT NULL, deleted_at TEXT NOT NULL, raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jira_issues (
      jira_id TEXT PRIMARY KEY,
      issue_key TEXT NOT NULL UNIQUE,
      project_key TEXT,
      updated_at TEXT,
      raw_json TEXT NOT NULL,
      source_file TEXT,
      imported_at TEXT NOT NULL,
      history_complete INTEGER NOT NULL DEFAULT 0,
      history_total INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_jira_issues_project ON jira_issues(project_key);
    CREATE INDEX IF NOT EXISTS idx_jira_issues_updated ON jira_issues(updated_at);
    CREATE TABLE IF NOT EXISTS jira_issue_revisions (
      revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
      jira_id TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      updated_at TEXT,
      imported_at TEXT NOT NULL,
      source_file TEXT,
      snapshot_hash TEXT NOT NULL,
      history_count INTEGER NOT NULL DEFAULT 0,
      history_total INTEGER,
      history_complete INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT NOT NULL,
      UNIQUE(jira_id, snapshot_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_issue_revisions_key ON jira_issue_revisions(issue_key, imported_at);
    CREATE TABLE IF NOT EXISTS jira_issue_history (
      jira_id TEXT NOT NULL,
      history_id TEXT NOT NULL,
      history_index INTEGER,
      created_at TEXT,
      raw_json TEXT NOT NULL,
      PRIMARY KEY(jira_id, history_id)
    );
    CREATE INDEX IF NOT EXISTS idx_issue_history_order ON jira_issue_history(jira_id, history_index, created_at);
    CREATE TABLE IF NOT EXISTS jira_sprints (
      sprint_id TEXT PRIMARY KEY,
      board_id TEXT,
      team_route TEXT,
      state TEXT,
      start_date TEXT,
      end_date TEXT,
      activated_date TEXT,
      complete_date TEXT,
      raw_json TEXT NOT NULL,
      source_file TEXT,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jira_sprints_board ON jira_sprints(board_id);
    CREATE TABLE IF NOT EXISTS jira_sprint_revisions (
      revision_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sprint_id TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      source_file TEXT,
      snapshot_hash TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      UNIQUE(sprint_id, snapshot_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_sprint_revisions ON jira_sprint_revisions(sprint_id, imported_at);
    CREATE TABLE IF NOT EXISTS import_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      files_json TEXT NOT NULL DEFAULT '[]',
      issues_added INTEGER NOT NULL DEFAULT 0,
      issues_updated INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0,
      conflicts INTEGER NOT NULL DEFAULT 0,
      sprints_added INTEGER NOT NULL DEFAULT 0,
      sprints_updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS import_files (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      size_bytes INTEGER,
      metadata_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES import_runs(id)
    );
    CREATE TABLE IF NOT EXISTS import_conflicts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      identity TEXT,
      source_file TEXT,
      reason TEXT NOT NULL,
      current_json TEXT,
      incoming_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_records (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_product_records_kind ON product_records(kind, archived_at);
    CREATE TABLE IF NOT EXISTS record_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_record_events_record ON record_events(record_id, occurred_at);
    CREATE TABLE IF NOT EXISTS local_issue_links (
      id TEXT PRIMARY KEY,
      business_issue_key TEXT NOT NULL,
      technical_issue_key TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'implements',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(business_issue_key, technical_issue_key)
    );
    CREATE INDEX IF NOT EXISTS idx_local_issue_links_business ON local_issue_links(business_issue_key);
    CREATE INDEX IF NOT EXISTS idx_local_issue_links_technical ON local_issue_links(technical_issue_key);
    CREATE TABLE IF NOT EXISTS local_issue_link_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      business_issue_key TEXT,
      technical_issue_key TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_local_issue_link_events ON local_issue_link_events(link_id, occurred_at);
  `);
  ensureColumn(db, 'jira_issues', 'history_total', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'local_issue_link_events', 'business_issue_key', 'TEXT');
  ensureColumn(db, 'local_issue_link_events', 'technical_issue_key', 'TEXT');
  migrateIssueEvidence(db);
  migrateLocalIssueLinkEventKeys(db);
  migrateReportAndIssueIndexes(db);
  ensureColumn(db, 'configuration_revisions', 'source_profile_json', 'TEXT');
  initializeConfiguration(db);
  rebuildSemanticProjection(db, getConfig(db));
  return db;
}

function ensureGeneratedColumn(db, name, definition) {
  const columns = db.prepare('PRAGMA table_xinfo(jira_issues)').all();
  if (!columns.some((entry) => entry.name === name)) db.exec(`ALTER TABLE jira_issues ADD COLUMN ${name} ${definition}`);
}

function migrateReportAndIssueIndexes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_generation (
      id INTEGER PRIMARY KEY CHECK(id=1), generation INTEGER NOT NULL DEFAULT 0,
      metrics_generation INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO workspace_generation(id,generation) VALUES(1,0);
    CREATE TABLE IF NOT EXISTS report_cache (
      cache_key TEXT PRIMARY KEY,
      data_generation INTEGER NOT NULL,
      engine_hash TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      accessed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS business_issue_cache (
      issue_key TEXT PRIMARY KEY,
      data_generation INTEGER NOT NULL,
      snapshot_date TEXT NOT NULL,
      project TEXT NOT NULL,
      summary_text TEXT NOT NULL DEFAULT '',
      issue_type_name TEXT NOT NULL DEFAULT '',
      status_name TEXT NOT NULL DEFAULT '',
      assignee_key TEXT NOT NULL DEFAULT '',
      assignee_name TEXT NOT NULL DEFAULT '',
      priority_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      component_search TEXT NOT NULL DEFAULT '',
      components_json TEXT NOT NULL DEFAULT '[]',
      done INTEGER NOT NULL DEFAULT 0,
      linked INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metric_cache (
      cache_key TEXT PRIMARY KEY,
      metrics_generation INTEGER NOT NULL,
      as_of_date TEXT NOT NULL,
      engine_hash TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      accessed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metric_cache_lookup ON metric_cache(metrics_generation,as_of_date,engine_hash,config_hash);
    CREATE INDEX IF NOT EXISTS idx_metric_cache_recent ON metric_cache(accessed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_business_cache_generation_key ON business_issue_cache(data_generation,snapshot_date,issue_key);
    CREATE INDEX IF NOT EXISTS idx_business_cache_status ON business_issue_cache(data_generation,snapshot_date,status_name,issue_key);
    CREATE INDEX IF NOT EXISTS idx_business_cache_assignee ON business_issue_cache(data_generation,snapshot_date,assignee_key,issue_key);
    CREATE INDEX IF NOT EXISTS idx_business_cache_priority ON business_issue_cache(data_generation,snapshot_date,priority_name,issue_key);
    CREATE INDEX IF NOT EXISTS idx_report_cache_recent ON report_cache(accessed_at DESC);
  `);
  ensureColumn(db, 'workspace_generation', 'metrics_generation', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'business_issue_cache', 'issue_type_name', "TEXT NOT NULL DEFAULT ''");
  const generated = [
    ['summary_text', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.summary')) VIRTUAL"],
    ['issue_type_name', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.issuetype.name')) VIRTUAL"],
    ['status_name', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.status.name')) VIRTUAL"],
    ['status_category', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.status.statusCategory.key')) VIRTUAL"],
    ['assignee_name', "TEXT GENERATED ALWAYS AS (COALESCE(json_extract(raw_json,'$.fields.assignee.displayName'),json_extract(raw_json,'$.fields.assignee.name'))) VIRTUAL"],
    ['assignee_key', "TEXT GENERATED ALWAYS AS (COALESCE(json_extract(raw_json,'$.fields.assignee.accountId'),json_extract(raw_json,'$.fields.assignee.key'),json_extract(raw_json,'$.fields.assignee.name'))) VIRTUAL"],
    ['created_at', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.created')) VIRTUAL"],
    ['resolution_date', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.resolutiondate')) VIRTUAL"],
    ['priority_name', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.priority.name')) VIRTUAL"],
    ['components_json', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.components')) VIRTUAL"],
    ['issue_links_json', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.issuelinks')) VIRTUAL"],
    ['due_date', "TEXT GENERATED ALWAYS AS (json_extract(raw_json,'$.fields.duedate')) VIRTUAL"],
  ];
  generated.forEach(([name, definition]) => ensureGeneratedColumn(db, name, definition));
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jira_issues_project_key ON jira_issues(project_key,issue_key);
    CREATE INDEX IF NOT EXISTS idx_jira_issues_project_type_key ON jira_issues(project_key,issue_type_name,issue_key);
    CREATE INDEX IF NOT EXISTS idx_jira_issues_project_status_key ON jira_issues(project_key,status_name,issue_key);
    CREATE INDEX IF NOT EXISTS idx_jira_issues_project_created_key ON jira_issues(project_key,created_at,issue_key);
  `);
  const tables = ['jira_issues','jira_issue_tombstones','jira_issue_revisions','jira_issue_history','jira_sprints','jira_sprint_revisions','settings','product_records','record_events','local_issue_links','local_issue_link_events','import_runs','import_files','import_conflicts','sync_state'];
  for (const table of tables) {
    for (const action of ['INSERT','UPDATE','DELETE']) {
      const trigger = `generation_${table}_${action.toLowerCase()}`;
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${trigger} AFTER ${action} ON ${table} BEGIN UPDATE workspace_generation SET generation=generation+1 WHERE id=1; END`);
    }
  }
  const metricsTables = ['jira_issues','jira_issue_tombstones','jira_issue_revisions','jira_issue_history','jira_sprints','jira_sprint_revisions'];
  for (const table of metricsTables) {
    for (const action of ['INSERT','UPDATE','DELETE']) {
      const trigger = `metrics_generation_${table}_${action.toLowerCase()}`;
      db.exec(`CREATE TRIGGER IF NOT EXISTS ${trigger} AFTER ${action} ON ${table} BEGIN UPDATE workspace_generation SET metrics_generation=metrics_generation+1 WHERE id=1; END`);
    }
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS metrics_generation_settings_insert AFTER INSERT ON settings
    WHEN NEW.key='config' BEGIN UPDATE workspace_generation SET metrics_generation=metrics_generation+1 WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS metrics_generation_settings_update AFTER UPDATE ON settings
    WHEN NEW.key='config' OR OLD.key='config' BEGIN UPDATE workspace_generation SET metrics_generation=metrics_generation+1 WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS metrics_generation_settings_delete AFTER DELETE ON settings
    WHEN OLD.key='config' BEGIN UPDATE workspace_generation SET metrics_generation=metrics_generation+1 WHERE id=1; END;`);
  const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version < 8) db.exec('PRAGMA user_version=8');
}

function getDataGeneration(db) {
  return Number(db.prepare('SELECT generation FROM workspace_generation WHERE id=1').get()?.generation || 0);
}

function getMetricsGeneration(db) {
  return Number(db.prepare('SELECT metrics_generation FROM workspace_generation WHERE id=1').get()?.metrics_generation || 0);
}

function encodeCachePayload(value) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(value)), { level: 6 });
  return { payload: `gz:${compressed.toString('base64')}`, bytes: compressed.byteLength };
}

function decodeCachePayload(value) {
  try {
    if (String(value).startsWith('gz:')) return JSON.parse(gunzipSync(Buffer.from(String(value).slice(3), 'base64')).toString('utf8'));
    return JSON.parse(value);
  } catch { return null; }
}

function getCachedMetrics(db, metricsGeneration, asOfDate, engineHash, configHash) {
  const row = db.prepare(`SELECT payload_json FROM metric_cache
    WHERE metrics_generation=? AND as_of_date=? AND engine_hash=? AND config_hash=?`)
    .get(metricsGeneration, asOfDate, engineHash, configHash);
  if (!row) return null;
  return decodeCachePayload(row.payload_json);
}

function saveCachedMetrics(db, metricsGeneration, asOfDate, engineHash, configHash, metrics) {
  const { payload, bytes } = encodeCachePayload(metrics);
  const now = new Date().toISOString();
  const cacheKey = createHash('sha256').update(JSON.stringify([metricsGeneration, asOfDate, engineHash, configHash])).digest('hex');
  db.prepare(`INSERT INTO metric_cache(cache_key,metrics_generation,as_of_date,engine_hash,config_hash,payload_json,payload_bytes,updated_at,accessed_at)
    VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload_json=excluded.payload_json,
    payload_bytes=excluded.payload_bytes,updated_at=excluded.updated_at,accessed_at=excluded.accessed_at`)
    .run(cacheKey, metricsGeneration, asOfDate, engineHash, configHash, payload, bytes, now, now);
  db.prepare(`DELETE FROM metric_cache WHERE cache_key NOT IN
    (SELECT cache_key FROM metric_cache ORDER BY accessed_at DESC LIMIT 4)`).run();
}

function getCachedReport(db, cacheKey, dataGeneration, engineHash, configHash) {
  const row = db.prepare(`SELECT payload_json FROM report_cache
    WHERE cache_key=? AND data_generation=? AND engine_hash=? AND config_hash=?`)
    .get(cacheKey, dataGeneration, engineHash, configHash);
  if (!row) return null;
  return decodeCachePayload(row.payload_json);
}

function saveCachedReport(db, cacheKey, dataGeneration, engineHash, configHash, payload) {
  const { payload: json, bytes } = encodeCachePayload(payload);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO report_cache(cache_key,data_generation,engine_hash,config_hash,payload_json,payload_bytes,updated_at,accessed_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET data_generation=excluded.data_generation,
    engine_hash=excluded.engine_hash,config_hash=excluded.config_hash,payload_json=excluded.payload_json,
    payload_bytes=excluded.payload_bytes,updated_at=excluded.updated_at,accessed_at=excluded.accessed_at`)
    .run(cacheKey, dataGeneration, engineHash, configHash, json, bytes, now, now);
  db.prepare(`DELETE FROM report_cache WHERE cache_key NOT IN
    (SELECT cache_key FROM report_cache ORDER BY accessed_at DESC LIMIT 8)`).run();
}

function saveBusinessIssueCache(db, dataGeneration, snapshotDate, issues) {
  db.exec('DELETE FROM business_issue_cache');
  const insert = db.prepare(`INSERT INTO business_issue_cache(
    issue_key,data_generation,snapshot_date,project,summary_text,issue_type_name,status_name,assignee_key,assignee_name,
    priority_name,created_at,component_search,components_json,done,linked,payload_json
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  issues.forEach((issue) => {
    // The page API only needs normalized intake columns. The raw Jira payload can
    // contain a complete changelog and is already available from issue details.
    const { raw: _raw, ...pageIssue } = issue;
    const components = Array.isArray(issue.components) ? issue.components : [];
    insert.run(
      String(issue.key || ''), dataGeneration, snapshotDate, String(issue.project || ''), String(issue.summary || ''),
      String(issue.issueType || ''), String(issue.status || ''), String(issue.assigneeKey || ''), String(issue.assignee || ''), String(issue.priority || ''),
      String(issue.created || ''), components.join(' '), JSON.stringify(components), issue.done ? 1 : 0,
      Array.isArray(issue.linkedTechnicalKeys) && issue.linkedTechnicalKeys.length ? 1 : 0, JSON.stringify(pageIssue),
    );
  });
}

function getBusinessBoardReport(db, filters = {}) {
  const config = getConfig(db);
  const projects = config.projectRoles.productIntake || [];
  const pageSize = Math.max(1, Math.min(250, Math.trunc(Number(filters.limit) || 50)));
  const offset = Math.max(0, Math.trunc(Number(filters.offset) || 0));
  const emptyAggregates = { total: 0, openCount: 0, doneCount: 0, linkedCount: 0, withoutOwner: 0,
    withStatusAge: 0, withoutStatusAgeOpen: 0, statusSinceCount: 0, epicCount: 0, withoutComponent: 0,
    uniqueDeliveryKeyCount: 0, statuses: [], components: [], assignees: [], componentAssignees: [], aging: [], monthly: [],
    departments: [], productOwners: [], organizationMonthly: [], matchingRecordIds: [] };
  if (!projects.length || !config.modules.productIntake) return { items: [], total: 0, offset, limit: pageSize, hasMore: false, aggregates: emptyAggregates };
  const dataGeneration = getDataGeneration(db);
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const where = ['data_generation=?', 'snapshot_date=?', 'project IN (' + projects.map(() => '?').join(',') + ')'];
  const params = [dataGeneration, snapshotDate, ...projects];
  const add = (sql, value) => { where.push(sql); params.push(value); };
  if (filters.component) {
    if (filters.component === 'بدون Component') where.push('json_array_length(components_json)=0');
    else { where.push('EXISTS (SELECT 1 FROM json_each(business_issue_cache.components_json) c WHERE c.value=?)'); params.push(String(filters.component)); }
  }
  if (filters.assignee === 'unassigned') where.push("COALESCE(assignee_key,'')=''");
  else if (filters.assignee) add('assignee_key=?', String(filters.assignee));
  if (filters.status) add('status_name=?', String(filters.status));
  if (filters.priority) add('priority_name=?', String(filters.priority));
  if (filters.createdFrom) add("substr(COALESCE(created_at,''),1,10)>=?", String(filters.createdFrom));
  if (filters.createdTo) add("substr(COALESCE(created_at,''),1,10)<=?", String(filters.createdTo));
  if (filters.query) {
    const query = String(filters.query).trim().toLocaleLowerCase('en-US');
    if (query) { where.push("instr(lower(issue_key||' '||summary_text||' '||issue_type_name||' '||assignee_name||' '||component_search||' '||status_name||' '||priority_name),?)>0"); params.push(query); }
  }
  const clause = where.join(' AND ');
  const total = Number(db.prepare('SELECT COUNT(*) AS count FROM business_issue_cache WHERE ' + clause).get(...params)?.count || 0);
  const page = db.prepare('SELECT payload_json FROM business_issue_cache WHERE ' + clause + ' ORDER BY issue_key LIMIT ? OFFSET ?')
    .all(...params, pageSize, offset).map((row) => safeJson(row.payload_json, null)).filter(Boolean);
  const matchingStatement = filters.includeAggregates === false
    ? null
    : db.prepare('SELECT payload_json FROM business_issue_cache WHERE ' + clause + ' ORDER BY issue_key');
  const matchingRows = matchingStatement ? matchingStatement.iterate(...params) : [];
  const statuses = new Map(), components = new Map(), assignees = new Map(), componentAssignees = new Map(), monthly = new Map();
  const departments = new Map(), productOwners = new Map(), organizationMonthly = new Map();
  const uniqueDeliveryKeys = new Set(), matchingRecordIds = new Set(), ageRanges = [
    { key: '0–7 days', min: 0, max: 7 }, { key: '8–30 days', min: 8, max: 30 },
    { key: '31–90 days', min: 31, max: 90 }, { key: '91–180 days', min: 91, max: 180 }, { key: 'More than 180 days', min: 181, max: Infinity },
  ];
  const aging = ageRanges.map((range) => ({ key: range.key, count: 0 }));
  const values = (value) => Array.from(new Set((Array.isArray(value) ? value : String(value || '').split(/[,;،\s]+/)).map((item) => String(item || '').trim()).filter(Boolean)));
  const organizationMonth = (level, key, month) => {
    const mapKey = level + '|' + key + '|' + month;
    if (!organizationMonthly.has(mapKey)) organizationMonthly.set(mapKey, { level, key, month, created: 0, completed: 0 });
    return organizationMonthly.get(mapKey);
  };
  let matchingCount = 0, openCount = 0, linkedCount = 0, withoutOwner = 0, withStatusAge = 0, statusSinceCount = 0, epicCount = 0, withoutComponent = 0;
  for (const row of matchingRows) {
    const issue = safeJson(row.payload_json, null);
    if (!issue) continue;
    matchingCount += 1;
    const done = Boolean(issue.done), componentsForIssue = issue.components?.length ? issue.components : ['بدون Component'];
    const assigneeKey = issue.assigneeKey || 'unassigned', hasLinks = (issue.linkedTechnicalKeys || []).length > 0;
    statuses.set(issue.status || 'بدون وضعیت', (statuses.get(issue.status || 'بدون وضعیت') || 0) + 1);
    if (!done) openCount += 1;
    if (hasLinks) linkedCount += 1;
    if (!issue.assigneeKey) withoutOwner += 1;
    if (issue.statusAgeDays !== null && issue.statusAgeDays !== undefined && !done) withStatusAge += 1;
    if (issue.statusSince) statusSinceCount += 1;
    if (issue.epicLink) epicCount += 1;
    if (!issue.components?.length) withoutComponent += 1;
    (issue.linkedTechnicalKeys || []).forEach((key) => uniqueDeliveryKeys.add(key));
    (issue.linkedProducts || []).forEach((record) => matchingRecordIds.add(record.id));
    ageRanges.forEach((range, index) => { if (!done && issue.issueAgeDays !== null && issue.issueAgeDays !== undefined && issue.issueAgeDays >= range.min && issue.issueAgeDays <= range.max) aging[index].count += 1; });
    const monthRow = (key) => { if (!monthly.has(key)) monthly.set(key, { month: key, created: 0, completed: 0 }); return monthly.get(key); };
    if (issue.created) monthRow(String(issue.created).slice(0, 7)).created += 1;
    const completion = issue.resolutionDate || (done ? issue.statusSince : '');
    if (completion) monthRow(String(completion).slice(0, 7)).completed += 1;
    const orgGroups = [
      ['department', values(issue.department), departments],
      ['productOwner', values(issue.productOwner), productOwners],
    ];
    orgGroups.forEach(([level, labels, groups]) => {
      const keys = labels.length ? labels : ['Unmapped'];
      keys.forEach((key) => {
        const group = groups.get(key) || { key, total: 0, open: 0, done: 0, assigneeSet: new Set() };
        group.total += 1; done ? group.done += 1 : group.open += 1;
        if (issue.assigneeKey) group.assigneeSet.add(issue.assigneeKey);
        groups.set(key, group);
        if (issue.created) organizationMonth(level, key, String(issue.created).slice(0, 7)).created += 1;
        if (completion) organizationMonth(level, key, String(completion).slice(0, 7)).completed += 1;
      });
    });
    for (const component of componentsForIssue) {
      const current = components.get(component) || { key: component, total: 0, open: 0, done: 0, linked: 0, assignees: new Set() };
      current.total += 1; done ? current.done += 1 : current.open += 1; if (hasLinks) current.linked += 1;
      if (issue.assigneeKey) current.assignees.add(issue.assigneeKey);
      components.set(component, current);
      const key = component + '|' + assigneeKey;
      const assigned = componentAssignees.get(key) || { component, key: assigneeKey, name: issue.assignee || 'Unassigned', total: 0, open: 0, done: 0 };
      assigned.total += 1; done ? assigned.done += 1 : assigned.open += 1; componentAssignees.set(key, assigned);
    }
    const owner = assignees.get(assigneeKey) || { key: assigneeKey, name: issue.assignee || 'Unassigned', total: 0, open: 0, done: 0, linked: 0 };
    owner.total += 1; done ? owner.done += 1 : owner.open += 1; if (hasLinks) owner.linked += 1; assignees.set(assigneeKey, owner);
  }
  const mapGroups = (map) => Array.from(map.values()).map((row) => ({ ...row, assignees: row.assigneeSet.size, assigneeSet: undefined })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  const aggregate = {
    total: matchingCount, openCount, doneCount: matchingCount - openCount, linkedCount, withoutOwner,
    withStatusAge, withoutStatusAgeOpen: openCount - withStatusAge, statusSinceCount, epicCount, withoutComponent,
    uniqueDeliveryKeyCount: uniqueDeliveryKeys.size,
    statuses: Array.from(statuses, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    components: Array.from(components.values()).map((row) => ({ ...row, assigneeCount: row.assignees.size, assignees: undefined })).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)),
    assignees: Array.from(assignees.values()).sort((a, b) => b.open - a.open || b.total - a.total || a.name.localeCompare(b.name)),
    componentAssignees: Array.from(componentAssignees.values()).sort((a, b) => a.component.localeCompare(b.component) || b.open - a.open || a.name.localeCompare(b.name)),
    aging, monthly: Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-18),
    departments: mapGroups(departments), productOwners: mapGroups(productOwners),
    organizationMonthly: Array.from(organizationMonthly.values()).sort((a, b) => a.month.localeCompare(b.month) || a.level.localeCompare(b.level) || a.key.localeCompare(b.key)).slice(-240),
    matchingRecordIds: Array.from(matchingRecordIds),
  };
  return { items: page, total, offset, limit: pageSize, hasMore: offset + page.length < total, aggregates: aggregate };
}

function migrateLocalIssueLinkEventKeys(db) {
  const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  db.exec('CREATE INDEX IF NOT EXISTS idx_local_link_events_business ON local_issue_link_events(business_issue_key, occurred_at DESC, id DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_local_link_events_technical ON local_issue_link_events(technical_issue_key, occurred_at DESC, id DESC)');
  if (version >= 4) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`UPDATE local_issue_link_events SET
      business_issue_key=COALESCE(json_extract(payload_json,'$.after.business_issue_key'),json_extract(payload_json,'$.before.business_issue_key')),
      technical_issue_key=COALESCE(json_extract(payload_json,'$.after.technical_issue_key'),json_extract(payload_json,'$.before.technical_issue_key'))
      WHERE business_issue_key IS NULL OR technical_issue_key IS NULL`);
    db.exec('PRAGMA user_version=4');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function issueHistoryId(history) {
  if (history?.id !== undefined && history?.id !== null && String(history.id)) return String(history.id);
  return createHash('sha256').update(JSON.stringify([history?.created || '', history?.author || {}, history?.items || []])).digest('hex');
}

function historyCoverage(db, jiraId, reportedTotal = null, hasChangelog = false) {
  const rows = db.prepare('SELECT history_id,history_index,created_at,raw_json FROM jira_issue_history WHERE jira_id=? ORDER BY history_index,created_at,history_id').all(jiraId);
  const totalRow = db.prepare('SELECT MAX(history_total) AS total FROM jira_issue_revisions WHERE jira_id=?').get(jiraId);
  const total = Math.max(Number(totalRow?.total || 0), Number(reportedTotal || 0), rows.length);
  const complete = hasChangelog && rows.length === total && rows.every((row, index) => Number(row.history_index) === index);
  return { rows, total, complete };
}

function storeIssueEvidence(db, issue, jiraId, issueKey, sourceFile, importedAt, preservedRawJson = null) {
  const rawJson = typeof preservedRawJson === 'string' ? preservedRawJson : JSON.stringify(issue);
  const hash = createHash('sha256').update(rawJson).digest('hex');
  const changelog = issue?.changelog;
  const histories = Array.isArray(changelog?.histories) ? changelog.histories : [];
  const startAt = Math.max(0, Number(changelog?.startAt) || 0);
  const reportedTotal = changelog?.total === undefined || changelog?.total === null ? null : Number(changelog.total);
  const validTotal = Number.isFinite(reportedTotal) ? Math.max(0, reportedTotal) : null;
  const historyPositions = histories.map((history, index) => {
    const recordedIndex = Number(history?.axiloomHistoryIndex);
    return Number.isInteger(recordedIndex) && recordedIndex >= 0 ? recordedIndex : startAt + index;
  }).sort((a, b) => a - b);
  const snapshotHistoryComplete = Boolean(changelog) && validTotal !== null && historyPositions.length === validTotal
    && historyPositions.every((position, index) => position === index);
  db.prepare(`INSERT OR IGNORE INTO jira_issue_revisions
    (jira_id,issue_key,updated_at,imported_at,source_file,snapshot_hash,history_count,history_total,history_complete,raw_json)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    jiraId, issueKey, issue?.fields?.updated || null, importedAt, sourceFile || null, hash,
    histories.length, validTotal,
    snapshotHistoryComplete ? 1 : 0,
    rawJson,
  );
  const upsertHistory = db.prepare(`INSERT INTO jira_issue_history(jira_id,history_id,history_index,created_at,raw_json)
    VALUES(?,?,?,?,?) ON CONFLICT(jira_id,history_id) DO UPDATE SET
    history_index=CASE WHEN excluded.history_index IS NULL THEN jira_issue_history.history_index
      WHEN jira_issue_history.history_index IS NULL THEN excluded.history_index
      ELSE MIN(jira_issue_history.history_index,excluded.history_index) END,
    raw_json=CASE WHEN length(excluded.raw_json)>length(jira_issue_history.raw_json) THEN excluded.raw_json ELSE jira_issue_history.raw_json END`);
  histories.forEach((history, index) => {
    const recordedIndex = Number(history?.axiloomHistoryIndex);
    const historyIndex = Number.isInteger(recordedIndex) && recordedIndex >= 0 ? recordedIndex : startAt + index;
    upsertHistory.run(jiraId, issueHistoryId(history), historyIndex, history?.created || null, JSON.stringify(history));
  });
  return { rawJson, validTotal, histories, startAt, hasChangelog: Boolean(changelog) };
}

function buildMergedIssue(currentIssue, incomingIssue, preferIncoming, historyRows, historyTotal, historyComplete) {
  const older = preferIncoming ? currentIssue : incomingIssue;
  const newer = preferIncoming ? incomingIssue : currentIssue;
  const merged = {
    ...older,
    ...newer,
    fields: { ...(older?.fields || {}), ...(newer?.fields || {}) },
  };
  if (historyRows.length || currentIssue?.changelog || incomingIssue?.changelog) {
    const selectedChangelog = preferIncoming ? incomingIssue?.changelog : currentIssue?.changelog;
    const fallbackChangelog = currentIssue?.changelog || incomingIssue?.changelog || {};
    merged.changelog = {
      ...fallbackChangelog,
      ...(selectedChangelog || {}),
      startAt: 0,
      maxResults: historyRows.length,
      total: historyTotal,
      histories: historyRows.map((row) => {
        const history = JSON.parse(row.raw_json);
        return { ...history, axiloomHistoryIndex: row.history_index };
      }),
      historyComplete,
    };
  }
  return merged;
}

function migrateIssueEvidence(db) {
  const version = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (version < 2) {
    const rows = db.prepare('SELECT jira_id,issue_key,updated_at,raw_json,source_file,imported_at FROM jira_issues').all();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        let issue;
        try { issue = JSON.parse(row.raw_json); } catch { continue; }
        const importedAt = row.imported_at || new Date().toISOString();
        storeIssueEvidence(db, issue, row.jira_id, row.issue_key, row.source_file, importedAt, row.raw_json);
        const coverage = historyCoverage(db, row.jira_id, issue?.changelog?.total, Boolean(issue?.changelog));
        const merged = buildMergedIssue(issue, issue, false, coverage.rows, coverage.total, coverage.complete);
        db.prepare('UPDATE jira_issues SET raw_json=?,history_complete=?,history_total=? WHERE jira_id=?')
          .run(JSON.stringify(merged), coverage.complete ? 1 : 0, coverage.total, row.jira_id);
      }
      db.exec('PRAGMA user_version=2');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const migratedVersion = Number(db.prepare('PRAGMA user_version').get().user_version || 0);
  if (migratedVersion < 3) {
    const sprints = db.prepare('SELECT sprint_id,raw_json,source_file,imported_at FROM jira_sprints').all();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const sprint of sprints) storeSprintRevision(db, sprint.sprint_id, sprint.raw_json, sprint.source_file, sprint.imported_at || new Date().toISOString());
      db.exec('PRAGMA user_version=3');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function storeSprintRevision(db, sprintId, rawJson, sourceFile, importedAt) {
  const hash = createHash('sha256').update(rawJson).digest('hex');
  db.prepare('INSERT OR IGNORE INTO jira_sprint_revisions(sprint_id,imported_at,source_file,snapshot_hash,raw_json) VALUES(?,?,?,?,?)')
    .run(String(sprintId), importedAt, sourceFile || null, hash, rawJson);
}

function initializeConfiguration(db) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get('config');
  if (!row) {
    saveConfig(db, DEFAULT_CONFIG, 'workspace-initialized');
    return;
  }

  let saved;
  try { saved = JSON.parse(row.value_json); }
  catch (error) { throw new Error(`Workspace configuration is unreadable; preserve the workspace and restore a backup before continuing: ${error.message}`); }

  const legacy = Number(saved?.schemaVersion || 0) < 1;
  const normalized = validateConfig(saved);
  const currentFingerprint = configurationFingerprint(normalized);
  const latest = db.prepare('SELECT fingerprint FROM configuration_revisions ORDER BY revision DESC LIMIT 1').get();
  if (!latest) {
    const timestamp = new Date().toISOString();
    const revision = Math.max(0, Number(saved?.configurationRevision) || 0) + 1;
    normalized.configurationRevision = revision;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO configuration_revisions(revision,schema_version,fingerprint,event_type,profile_json,source_profile_json,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(revision, normalized.schemaVersion, currentFingerprint, legacy ? 'legacy-migration' : 'history-initialized', JSON.stringify(normalized), legacy ? row.value_json : null, timestamp);
      db.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE key=?').run(JSON.stringify(normalized), timestamp, 'config');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return;
  }

  const alreadyCurrent = Number(saved?.schemaVersion) === normalized.schemaVersion
    && saved?.configurationRevision === normalized.configurationRevision;
  if (latest.fingerprint === currentFingerprint && alreadyCurrent) return;
  saveConfig(db, normalized, legacy ? 'legacy-migration' : 'schema-normalization', legacy ? row.value_json : null);
}

function getConfig(db) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get('config');
  if (!row) return validateConfig(DEFAULT_CONFIG);
  let saved;
  try { saved = JSON.parse(row.value_json); }
  catch (error) { throw new Error(`Workspace configuration is unreadable; restore a validated backup before continuing: ${error.message}`); }
  return validateConfig(saved);
}

function hasSourceEvidence(db) {
  const row = db.prepare(`SELECT
    EXISTS(SELECT 1 FROM jira_issues) OR
    EXISTS(SELECT 1 FROM jira_issue_tombstones) OR
    EXISTS(SELECT 1 FROM jira_issue_revisions) OR
    EXISTS(SELECT 1 FROM jira_issue_history) OR
    EXISTS(SELECT 1 FROM jira_sprints) OR
    EXISTS(SELECT 1 FROM jira_sprint_revisions) OR
    EXISTS(SELECT 1 FROM import_runs) OR
    EXISTS(SELECT 1 FROM import_files) OR
    EXISTS(SELECT 1 FROM import_conflicts) OR
    EXISTS(SELECT 1 FROM local_issue_links) OR
    EXISTS(SELECT 1 FROM sync_state) AS has_evidence`).get();
  return Boolean(row.has_evidence);
}

function isOfflineSourceAttestation(previous, next, eventType) {
  const current = previous.sourceInstance;
  const proposed = next.sourceInstance;
  const sameWorkspaceSource = eventType === 'offline-source-attested'
    && !previous.jiraUrl && !next.jiraUrl
    && current.provider === 'offline-json' && proposed.provider === 'offline-json'
    && current.endpoint === proposed.endpoint
    && (!current.id || current.id === proposed.id)
    && (!current.displayName || current.displayName.trim().toLocaleLowerCase('en-US') === proposed.displayName.trim().toLocaleLowerCase('en-US'));
  const firstIdentity = !current.id && Boolean(proposed.id);
  const firstName = !current.displayName && Boolean(proposed.displayName);
  return sameWorkspaceSource && (firstIdentity || firstName);
}

function projectionForIssue(issue, config) {
  const fields = issue?.fields || {};
  const semantic = resolveSemanticFields(issue, config);
  const projectKey = String(fields.project?.key || issue?.key?.split('-')[0] || '').toUpperCase();
  const sprintValue = semantic.sprint;
  return {
    issueKey: String(issue?.key || '').toUpperCase(),
    projectKey,
    issueTypeId: String(fields.issuetype?.id || ''),
    storyPoints: typeof semantic.storyPoints === 'number' ? semantic.storyPoints : null,
    epicKey: typeof semantic.epicLink === 'string' ? semantic.epicLink.toUpperCase() : null,
    epicName: typeof semantic.epicName === 'string' ? semantic.epicName : null,
    sprintValueJson: sprintValue == null ? null : JSON.stringify(sprintValue),
    teamLabel: typeof semantic.team === 'string' ? semantic.team : null,
    workClassification: typeof semantic.workClassification === 'string' ? semantic.workClassification : null,
    issueTagsJson: semantic.issueTags == null ? null : JSON.stringify(semantic.issueTags),
    requester: typeof semantic.requester === 'string' ? semantic.requester : null,
    department: typeof semantic.department === 'string' ? semantic.department : null,
    productOwner: typeof semantic.productOwner === 'string' ? semantic.productOwner : null,
    loggedTime: semantic.loggedTime == null ? null : String(semantic.loggedTime),
    mappingRevision: Number(config?.configurationRevision || 0),
  };
}

function saveSemanticProjection(db, issue, config = getConfig(db)) {
  const projection = projectionForIssue(issue, config);
  db.prepare(`INSERT INTO jira_semantic_projection(
    issue_key,project_key,issue_type_id,story_points,epic_key,epic_name,sprint_value_json,team_label,
    work_classification,issue_tags_json,requester,department,product_owner,logged_time,mapping_revision
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(issue_key) DO UPDATE SET
    project_key=excluded.project_key,issue_type_id=excluded.issue_type_id,story_points=excluded.story_points,
    epic_key=excluded.epic_key,epic_name=excluded.epic_name,sprint_value_json=excluded.sprint_value_json,
    team_label=excluded.team_label,work_classification=excluded.work_classification,issue_tags_json=excluded.issue_tags_json,
    requester=excluded.requester,department=excluded.department,product_owner=excluded.product_owner,
    logged_time=excluded.logged_time,mapping_revision=excluded.mapping_revision`).run(
    projection.issueKey, projection.projectKey, projection.issueTypeId, projection.storyPoints, projection.epicKey,
    projection.epicName, projection.sprintValueJson, projection.teamLabel, projection.workClassification,
    projection.issueTagsJson, projection.requester, projection.department, projection.productOwner,
    projection.loggedTime, projection.mappingRevision,
  );
}

function rebuildSemanticProjection(db, config = getConfig(db)) {
  db.prepare('DELETE FROM jira_semantic_projection').run();
  const insert = db.prepare(`INSERT INTO jira_semantic_projection(
    issue_key,project_key,issue_type_id,story_points,epic_key,epic_name,sprint_value_json,team_label,
    work_classification,issue_tags_json,requester,department,product_owner,logged_time,mapping_revision
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const issuesStatement = db.prepare('SELECT issue_key,raw_json FROM jira_issues');
  for (const row of issuesStatement.iterate()) {
    const issue = safeJson(row.raw_json, null);
    if (!issue) continue;
    const item = projectionForIssue(issue, config);
    insert.run(item.issueKey, item.projectKey, item.issueTypeId, item.storyPoints, item.epicKey, item.epicName,
      item.sprintValueJson, item.teamLabel, item.workClassification, item.issueTagsJson, item.requester,
      item.department, item.productOwner, item.loggedTime, item.mappingRevision);
  }
}

function saveConfig(db, value, eventType = 'user-update', sourceProfileJson = null) {
  const next = validateConfig(value);
  const previous = getConfig(db);
  const sourceChanged = sourceIdentityKey(previous) !== sourceIdentityKey(next);
  const offlineSourceAttested = sourceChanged && isOfflineSourceAttestation(previous, next, eventType);
  if (sourceChanged && hasSourceEvidence(db) && !offlineSourceAttested) {
    throw new Error('This workspace already contains source evidence. Create a separate workspace to connect another source; existing history and links remain attached to their current source.');
  }
  const timestamp = new Date().toISOString();
  const fingerprint = configurationFingerprint(next);
  const latest = db.prepare('SELECT revision,fingerprint FROM configuration_revisions ORDER BY revision DESC LIMIT 1').get();
  if (latest?.fingerprint === fingerprint) return getConfig(db);
  next.configurationRevision = Math.max(Number(latest?.revision) || 0, Number(next.configurationRevision) || 0) + 1;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
      .run('config', JSON.stringify(next), timestamp);
    db.prepare(`INSERT INTO configuration_revisions(revision,schema_version,fingerprint,event_type,profile_json,source_profile_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).run(next.configurationRevision, next.schemaVersion, fingerprint, String(eventType).slice(0, 80), JSON.stringify(next), sourceProfileJson, timestamp);
    if (sourceChanged) {
      db.prepare('DELETE FROM settings WHERE key=?').run('jira_pat_encrypted');
      db.prepare("DELETE FROM settings WHERE key LIKE 'jira:metadata:%'").run();
    }
    rebuildSemanticProjection(db, next);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return next;
}

function routeForBoard(db, boardId, timestamp = Date.now()) {
  const config = getConfig(db);
  const date = Number.isFinite(Number(timestamp)) ? new Date(Number(timestamp)).toISOString().slice(0, 10) : '';
  const routes = (config.boardRoutes || []).filter((route) => String(route.boardId) === String(boardId)
    && (!date || !route.activeFrom || date >= route.activeFrom) && (!date || !route.activeTo || date <= route.activeTo));
  if (routes.length !== 1) return null;
  const team = config.teams.find((candidate) => candidate.id === routes[0].teamId);
  if (!team || (team.activeFrom && date < team.activeFrom) || (team.activeTo && date > team.activeTo)) return null;
  return team.name;
}

function saveIssue(db, issue, sourceFile, runId, options = {}) {
  const jiraId = String(issue?.id ?? '').trim();
  const issueKey = String(issue?.key ?? '').trim().toUpperCase();
  if (!jiraId || !issueKey || !issue?.fields || typeof issue.fields !== 'object') {
    return { status: 'skipped', reason: 'ISSUE_IDENTITY_OR_FIELDS_MISSING' };
  }
  if (db.prepare('SELECT 1 FROM jira_issue_tombstones WHERE issue_key=? OR jira_id=?').get(issueKey, jiraId)) return { status: 'skipped', reason: 'DELETED_IN_JIRA' };
  const existing = db.prepare('SELECT jira_id,issue_key,updated_at,raw_json,source_file,imported_at,history_complete FROM jira_issues WHERE jira_id=? OR issue_key=?').get(jiraId, issueKey);
  const incomingUpdated = issue.fields.updated || null;
  const rawJson = JSON.stringify(issue);
  if (existing && (existing.jira_id !== jiraId || existing.issue_key !== issueKey)) {
    db.prepare('INSERT INTO import_conflicts(run_id,identity,source_file,reason,current_json,incoming_json,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(runId || null, `${jiraId}/${issueKey}`, sourceFile || null, 'IDENTITY_COLLISION', existing.raw_json, rawJson, new Date().toISOString());
    return { status: 'conflict' };
  }
  if (existing) {
    if (existing.raw_json === rawJson) return { status: 'duplicate' };
    const incomingHash = createHash('sha256').update(rawJson).digest('hex');
    if (!options.authoritative && db.prepare('SELECT 1 FROM jira_issue_revisions WHERE jira_id=? AND snapshot_hash=?').get(jiraId, incomingHash)) return { status: 'duplicate' };
    const currentMs = Date.parse(existing.updated_at || '') || 0;
    const incomingMs = Date.parse(incomingUpdated || '') || 0;
    const importedAt = new Date().toISOString();
    storeIssueEvidence(db, issue, jiraId, issueKey, sourceFile, importedAt);
    let currentIssue = {};
    try { currentIssue = JSON.parse(existing.raw_json); } catch { currentIssue = {}; }
    const incomingWins = incomingMs > currentMs;
    const sameTimestamp = incomingMs === currentMs;
    const liveSource = options.authoritative === true;
    const coverage = historyCoverage(db, jiraId, issue?.changelog?.total, Boolean(issue?.changelog || currentIssue?.changelog));
    if (sameTimestamp && !liveSource) {
      db.prepare('INSERT INTO import_conflicts(run_id,identity,source_file,reason,current_json,incoming_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(runId || null, issueKey, sourceFile || null, 'SAME_TIMESTAMP_DIFFERENT_CONTENT', existing.raw_json, rawJson, new Date().toISOString());
    }
    const merged = buildMergedIssue(currentIssue, issue, incomingWins || (sameTimestamp && (liveSource || Object.keys(issue.fields || {}).length > Object.keys(currentIssue.fields || {}).length)), coverage.rows, coverage.total, coverage.complete);
    const mergedJson = JSON.stringify(merged);
    const currentLatest = incomingWins ? incomingUpdated : existing.updated_at;
    const project = merged.fields.project?.key || issueKey.split('-')[0];
    if (mergedJson !== existing.raw_json || coverage.complete !== Boolean(existing.history_complete)) {
      db.prepare('UPDATE jira_issues SET project_key=?,updated_at=?,raw_json=?,source_file=?,imported_at=?,history_complete=?,history_total=? WHERE jira_id=?')
        .run(project, currentLatest, mergedJson, incomingWins || sameTimestamp ? sourceFile || null : existing.source_file,
          incomingWins || sameTimestamp ? importedAt : existing.imported_at,
          coverage.complete ? 1 : 0, coverage.total, jiraId);
      saveSemanticProjection(db, merged, getConfig(db));
    }
    if (sameTimestamp) return { status: liveSource ? 'updated' : 'conflict' };
    if (incomingWins) return { status: 'updated' };
    return { status: 'duplicate' };
  }
  const importedAt = new Date().toISOString();
  storeIssueEvidence(db, issue, jiraId, issueKey, sourceFile, importedAt);
  const coverage = historyCoverage(db, jiraId, issue?.changelog?.total, Boolean(issue?.changelog));
  const merged = buildMergedIssue(issue, issue, true, coverage.rows, coverage.total, coverage.complete);
  db.prepare('INSERT INTO jira_issues(jira_id,issue_key,project_key,updated_at,raw_json,source_file,imported_at,history_complete) VALUES(?,?,?,?,?,?,?,?)')
    .run(jiraId, issueKey, issue.fields.project?.key || issueKey.split('-')[0], incomingUpdated, JSON.stringify(merged), sourceFile || null, importedAt, coverage.complete ? 1 : 0);
  db.prepare('UPDATE jira_issues SET history_total=? WHERE jira_id=?').run(coverage.total, jiraId);
  saveSemanticProjection(db, merged, getConfig(db));
  return { status: 'added' };
}

function saveSprint(db, sprint, sourceFile, runId) {
  const id = sprint?.id === undefined ? '' : String(sprint.id);
  if (!id) return { status: 'skipped', reason: 'SPRINT_ID_MISSING' };
  const boardId = sprint.originBoardId === undefined ? null : String(sprint.originBoardId);
  const routeDate = Date.parse(sprint.completeDate || sprint.activatedDate || sprint.endDate || sprint.startDate || '') || Date.now();
  const teamRoute = routeForBoard(db, boardId, routeDate);
  const existing = db.prepare('SELECT raw_json,source_file,imported_at,state FROM jira_sprints WHERE sprint_id=?').get(id);
  const rawJson = JSON.stringify(sprint);
  if (existing?.raw_json === rawJson) return { status: 'duplicate' };
  const importedAt = new Date().toISOString();
  storeSprintRevision(db, id, rawJson, sourceFile, importedAt);
  if (existing) {
    let previous = {};
    try { previous = JSON.parse(existing.raw_json); } catch { previous = {}; }
    const stateRank = { future: 0, active: 1, closed: 2 };
    const previousRank = stateRank[String(previous.state || '').toLowerCase()];
    const incomingRank = stateRank[String(sprint.state || '').toLowerCase()];
    if (Number.isFinite(previousRank) && Number.isFinite(incomingRank) && incomingRank < previousRank) {
      db.prepare('INSERT INTO import_conflicts(run_id,identity,source_file,reason,current_json,incoming_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(runId || null, `SPRINT-${id}`, sourceFile || null, 'SPRINT_STALE_STATE', existing.raw_json, rawJson, importedAt);
      return { status: 'duplicate' };
    }
    const mergedSprint = { ...previous, ...sprint };
    const mergedJson = JSON.stringify(mergedSprint);
    db.prepare('UPDATE jira_sprints SET board_id=?,team_route=?,state=?,start_date=?,end_date=?,activated_date=?,complete_date=?,raw_json=?,source_file=?,imported_at=? WHERE sprint_id=?')
      .run(boardId, teamRoute, mergedSprint.state || null, mergedSprint.startDate || null, mergedSprint.endDate || null, mergedSprint.activatedDate || null, mergedSprint.completeDate || null, mergedJson, sourceFile || null, importedAt, id);
    return { status: 'updated' };
  }
  db.prepare('INSERT INTO jira_sprints(sprint_id,board_id,team_route,state,start_date,end_date,activated_date,complete_date,raw_json,source_file,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, boardId, teamRoute, sprint.state || null, sprint.startDate || null, sprint.endDate || null, sprint.activatedDate || null, sprint.completeDate || null, rawJson, sourceFile || null, importedAt);
  return { status: 'added' };
}

function saveLocalIssueLink(db, input) {
  const businessIssueKey = String(input?.intakeIssueKey || input?.businessIssueKey || '').trim().toUpperCase();
  const technicalIssueKey = String(input?.deliveryIssueKey || input?.technicalIssueKey || '').trim().toUpperCase();
  const issueKeyPattern = /^[A-Z][A-Z0-9_]*-\d+$/;
  if (!issueKeyPattern.test(businessIssueKey) || !issueKeyPattern.test(technicalIssueKey)) throw new Error('Enter valid issue keys for both sides of the relationship.');
  const config = getConfig(db);
  const intake = db.prepare('SELECT project_key FROM jira_issues WHERE issue_key=?').get(businessIssueKey);
  const delivery = db.prepare('SELECT project_key FROM jira_issues WHERE issue_key=?').get(technicalIssueKey);
  if (!intake || !delivery) throw new Error('Both linked issues must exist in the active workspace.');
  if (!(config.projectRoles.productIntake || []).includes(intake.project_key)) throw new Error('The first issue is not in a configured product-intake project.');
  if (!(config.projectRoles.technicalDelivery || []).includes(delivery.project_key)) throw new Error('The second issue is not in a configured delivery project.');
  const relationship = String(input?.relationship || 'implements').trim().slice(0, 80) || 'implements';
  const note = String(input?.note || '').trim().slice(0, 2000);
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM local_issue_links WHERE business_issue_key=? AND technical_issue_key=?').get(businessIssueKey, technicalIssueKey);
  const id = existing?.id || randomUUID();
  db.prepare(`INSERT INTO local_issue_links(id,business_issue_key,technical_issue_key,relationship,note,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(business_issue_key,technical_issue_key) DO UPDATE SET
    relationship=excluded.relationship,note=excluded.note,updated_at=excluded.updated_at`)
    .run(id, businessIssueKey, technicalIssueKey, relationship, note, existing?.created_at || now, now);
  const after = db.prepare('SELECT * FROM local_issue_links WHERE id=?').get(id);
  if (!existing || existing.relationship !== relationship || existing.note !== note) {
    db.prepare('INSERT INTO local_issue_link_events(link_id,event_type,occurred_at,payload_json,business_issue_key,technical_issue_key) VALUES(?,?,?,?,?,?)')
      .run(id, existing ? 'updated' : 'created', now, JSON.stringify({ before: existing || null, after }), businessIssueKey, technicalIssueKey);
  }
  return after;
}

function removeLocalIssueLink(db, id) {
  const existing = db.prepare('SELECT * FROM local_issue_links WHERE id=?').get(String(id || ''));
  if (!existing) return { ok: false };
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM local_issue_links WHERE id=?').run(existing.id);
    db.prepare('INSERT INTO local_issue_link_events(link_id,event_type,occurred_at,payload_json,business_issue_key,technical_issue_key) VALUES(?,?,?,?,?,?)')
      .run(existing.id, 'removed', now, JSON.stringify({ before: existing }), existing.business_issue_key, existing.technical_issue_key);
    db.exec('COMMIT');
    return { ok: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function safeJson(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

function parseCurrentSprintIds(value) {
  const ids = new Set();
  const visit = (item) => {
    if (item == null || item === '') return;
    if (typeof item === 'number') { ids.add(String(item)); return; }
    if (typeof item === 'object') {
      if (item.id !== undefined && /^\d+$/.test(String(item.id))) ids.add(String(item.id));
      if (item.name) visit(item.name);
      return;
    }
    const text = String(item);
    for (const match of text.matchAll(/\bid=(\d+)/g)) ids.add(match[1]);
    if (!text.includes('id=') && /^\d+$/.test(text.trim())) ids.add(text.trim());
  };
  (Array.isArray(value) ? value : [value]).forEach(visit);
  return Array.from(ids);
}

function issueDoneSql(config, scope = '') {
  const projects = new Map();
  Object.values(config?.projectRoles || {}).flat().forEach((projectValue) => {
    const project = String(projectValue || '').trim().toUpperCase();
    if (project && !projects.has(project)) projects.set(project, completionPolicyForProject(config, project, scope));
  });
  const completionClause = (policy) => {
    const clauses = [];
    const categories = [...policy.completionStatusCategories].sort();
    const statuses = [...policy.completedStatuses].sort();
  const params = [];
    if (categories.length) {
      clauses.push(`lower(trim(COALESCE(status_category,''))) IN (${categories.map(() => '?').join(',')})`);
      params.push(...categories);
    }
    if (policy.resolutionCompletes) clauses.push("COALESCE(resolution_date,'')<>''");
    if (statuses.length) {
      clauses.push(`lower(trim(COALESCE(status_name,''))) IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
    return { sql: clauses.length ? `(${clauses.join(' OR ')})` : '0', params };
  };
  const groups = new Map();
  for (const [project, policy] of projects) {
    const signature = JSON.stringify([ [...policy.completionStatusCategories].sort(), policy.resolutionCompletes, [...policy.completedStatuses].sort() ]);
    if (!groups.has(signature)) groups.set(signature, { projects: [], policy });
    groups.get(signature).projects.push(project);
  }
  const rules = [];
  const params = [];
  groups.forEach((group) => {
    const completion = completionClause(group.policy);
    rules.push(`(project_key IN (${group.projects.map(() => '?').join(',')}) AND ${completion.sql})`);
    params.push(...group.projects, ...completion.params);
  });
  const defaultCompletion = completionClause(completionPolicyForProject(config, '', scope));
  if (projects.size) {
    rules.push(`(project_key NOT IN (${[...projects.keys()].map(() => '?').join(',')}) AND ${defaultCompletion.sql})`);
    params.push(...projects.keys(), ...defaultCompletion.params);
  } else rules.push(defaultCompletion.sql);
  return {
    sql: `(${rules.join(' OR ')})`,
    params,
  };
}

function jiraOptionLabel(value) {
  if (Array.isArray(value)) return value.map(jiraOptionLabel).filter(Boolean).join('، ');
  if (value && typeof value === 'object') return String(value.value || value.name || value.displayName || value.key || '').trim();
  return String(value || '').trim();
}

function normalizedStatus(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
}

function buildIssueWhere(filters, config) {
  const where = ["issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)"];
  const params = [];
  const add = (expression, value) => { where.push(expression); params.push(value); };
  const text = (value, max = 160) => String(value || '').trim().slice(0, max);
  if (text(filters.project, 40)) add('project_key=?', text(filters.project, 40).toUpperCase());
  if (text(filters.issueType, 100)) add('issue_type_name=?', text(filters.issueType, 100));
  if (text(filters.status, 100)) add('status_name=?', text(filters.status, 100));
  if (text(filters.priority, 100)) add('priority_name=?', text(filters.priority, 100));
  if (text(filters.assignee, 200) === 'unassigned') {
    where.push("COALESCE(assignee_key,'')='' AND COALESCE(json_extract(raw_json,'$.fields.assignee.accountId'),'')=''");
  } else if (text(filters.assignee, 200)) {
    const assignee = text(filters.assignee, 200);
    where.push("(assignee_key=? OR json_extract(raw_json,'$.fields.assignee.accountId')=?)");
    params.push(assignee, assignee);
  }
  if (text(filters.epic, 100)) {
    where.push('(EXISTS (SELECT 1 FROM jira_semantic_projection semantic WHERE semantic.issue_key=jira_issues.issue_key AND semantic.epic_key=?) OR issue_key=?)');
    params.push(text(filters.epic, 100).toUpperCase(), text(filters.epic, 100).toUpperCase());
  }
  if (text(filters.component, 200)) {
    where.push("EXISTS (SELECT 1 FROM json_each(COALESCE(components_json,'[]')) c WHERE json_extract(c.value,'$.name')=?)");
    params.push(text(filters.component, 200));
  }
  if (text(filters.sprintId, 30)) add("instr(COALESCE((SELECT semantic.sprint_value_json FROM jira_semantic_projection semantic WHERE semantic.issue_key=jira_issues.issue_key),''),?)>0", `id=${text(filters.sprintId, 30)}`);
  if (text(filters.createdFrom, 10)) add('substr(COALESCE(created_at,\'\'),1,10)>=?', text(filters.createdFrom, 10));
  if (text(filters.createdTo, 10)) add('substr(COALESCE(created_at,\'\'),1,10)<=?', text(filters.createdTo, 10));
  if (text(filters.query)) {
    const query = text(filters.query).toLocaleLowerCase('en-US');
    where.push("(instr(lower(issue_key),?)>0 OR instr(lower(COALESCE(summary_text,'')),?)>0 OR instr(lower(COALESCE(assignee_name,'')),?)>0)");
    params.push(query, query, query);
  }
  if (filters.done === true || filters.done === false) {
    const done = issueDoneSql(config, filters.workflowScope);
    where.push(filters.done ? done.sql : `NOT ${done.sql}`);
    params.push(...done.params);
  }
  return { sql: where.join(' AND '), params };
}

function mapIssueProjection(row, config, workflowScope = '') {
  const project = String(row.project_key || row.issue_key?.split('-')[0] || '').toUpperCase();
  const raw = safeJson(row.raw_json, {});
  const fields = raw.fields || {};
  const semantic = resolveSemanticFields(raw, config);
  const done = isIssueDone(raw, config, workflowScope);
  const status = row.status_name || '';
  const statusCategory = row.status_category || '';
  const resolutionDate = row.resolution_date || '';
  const links = safeJson(row.issue_links_json, []);
  const issueLinks = (Array.isArray(links) ? links : []).flatMap((link) => {
    const type = link?.type || {};
    const result = [];
    if (link?.outwardIssue?.key) result.push({ id: String(link.id || ''), key: String(link.outwardIssue.key).toUpperCase(), direction: 'outward', relationship: type.outward || type.name || 'relates to', summary: link.outwardIssue.fields?.summary || '' });
    if (link?.inwardIssue?.key) result.push({ id: String(link.id || ''), key: String(link.inwardIssue.key).toUpperCase(), direction: 'inward', relationship: type.inward || type.name || 'relates to', summary: link.inwardIssue.fields?.summary || '' });
    return result;
  });
  const components = safeJson(row.components_json, []);
  return {
    id: row.jira_id, key: row.issue_key, project,
    summary: row.summary_text || '', issueType: row.issue_type_name || 'Unknown', status, lifecycleRoles: lifecycleRolesForStatus(config, project, status, statusCategory, Boolean(resolutionDate), workflowScope),
    statusCategory, assigneeKey: row.assignee_key || fields.assignee?.accountId || '', assignee: row.assignee_name || 'تخصیص‌نیافته',
    created: row.created_at || '', dueDate: row.due_date || '', updated: row.updated_at || '', resolutionDate,
    points: typeof semantic.storyPoints === 'number' ? semantic.storyPoints : null,
    epicLink: typeof semantic.epicLink === 'string' ? semantic.epicLink.toUpperCase() : '',
    currentSprintIds: parseCurrentSprintIds(semantic.sprint),
    components: (Array.isArray(components) ? components : []).map((component) => component?.name).filter(Boolean),
    workClassification: jiraOptionLabel(semantic.workClassification),
    tags: Array.isArray(semantic.issueTags) ? semantic.issueTags.map(jiraOptionLabel).filter(Boolean) : semantic.issueTags ? [jiraOptionLabel(semantic.issueTags)] : [],
    requester: jiraOptionLabel(semantic.requester),
    department: jiraOptionLabel(semantic.department),
    productOwner: jiraOptionLabel(semantic.productOwner),
    priority: row.priority_name || '', issueLinks, isDone: done,
  };
}

function listIssues(db, filters = {}) {
  const config = getConfig(db);
  const { sql, params } = buildIssueWhere(filters, config);
  const limit = Math.max(1, Math.min(250, Math.trunc(Number(filters.limit) || 50)));
  const offset = Math.max(0, Math.trunc(Number(filters.offset) || 0));
  const sortColumns = { key: 'issue_key', created: 'created_at', updated: 'updated_at', summary: 'summary_text', status: 'status_name', project: 'project_key' };
  const sort = sortColumns[filters.sortBy] || 'issue_key';
  const direction = String(filters.sortDirection).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const total = Number(db.prepare(`SELECT COUNT(*) AS count FROM jira_issues WHERE ${sql}`).get(...params).count);
  const rows = db.prepare(`SELECT jira_id,issue_key,project_key,updated_at,summary_text,issue_type_name,status_name,status_category,
      assignee_name,assignee_key,created_at,resolution_date,priority_name,components_json,issue_links_json,due_date,raw_json
    FROM jira_issues WHERE ${sql} ORDER BY ${sort} ${direction},issue_key ASC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const done = issueDoneSql(config, filters.workflowScope);
  const aggregates = db.prepare(`SELECT
      SUM(CASE WHEN ${done.sql} THEN 1 ELSE 0 END) AS done_count,
      SUM(CASE WHEN COALESCE(assignee_key,json_extract(raw_json,'$.fields.assignee.accountId'),'')='' THEN 1 ELSE 0 END) AS unassigned_count,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM jira_semantic_projection semantic WHERE semantic.issue_key=jira_issues.issue_key AND COALESCE(semantic.epic_key,'')<>'') THEN 1 ELSE 0 END) AS epic_link_count
    FROM jira_issues WHERE ${sql}`).get(...done.params, ...params);
  return {
    items: rows.map((row) => mapIssueProjection(row, config, filters.workflowScope)), total,
    doneCount: Number(aggregates?.done_count || 0), openCount: Math.max(0, total - Number(aggregates?.done_count || 0)),
    withoutAssignee: Number(aggregates?.unassigned_count || 0), withEpicLink: Number(aggregates?.epic_link_count || 0),
    offset, limit, hasMore: offset + rows.length < total,
  };
}

function getIssueFilterOptions(db, project = '') {
  const where = ["issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)"];
  const params = [];
  if (project) { where.push('project_key=?'); params.push(String(project).trim().toUpperCase()); }
  const clause = where.join(' AND ');
  const values = (sql) => db.prepare(sql).all(...params).map((row) => row.value).filter((value) => value != null && value !== '').map(String);
  const epics = db.prepare(`SELECT issue_key AS key,COALESCE(summary_text,issue_key) AS summary FROM jira_issues
    WHERE ${clause} AND lower(COALESCE(issue_type_name,''))='epic' ORDER BY issue_key`).all(...params);
  const components = db.prepare(`SELECT DISTINCT json_extract(c.value,'$.name') AS value FROM jira_issues, json_each(COALESCE(components_json,'[]')) c
    WHERE ${clause} ORDER BY value`).all(...params).map((row) => row.value).filter(Boolean);
  return {
    projects: values(`SELECT DISTINCT project_key AS value FROM jira_issues WHERE ${clause} ORDER BY project_key`),
    issueTypes: values(`SELECT DISTINCT issue_type_name AS value FROM jira_issues WHERE ${clause} ORDER BY issue_type_name`),
    statuses: values(`SELECT DISTINCT status_name AS value FROM jira_issues WHERE ${clause} ORDER BY status_name`),
    priorities: values(`SELECT DISTINCT priority_name AS value FROM jira_issues WHERE ${clause} ORDER BY priority_name`),
    components, epics,
  };
}

function getIssueOverviewStats(db) {
  const config = getConfig(db);
  const done = issueDoneSql(config);
  const row = db.prepare(`SELECT COUNT(*) AS total,
      SUM(CASE WHEN ${done.sql} THEN 0 ELSE 1 END) AS open_count,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM jira_semantic_projection semantic WHERE semantic.issue_key=jira_issues.issue_key AND COALESCE(semantic.epic_key,'')<>'') THEN 1 ELSE 0 END) AS epic_links,
      SUM(CASE WHEN COALESCE(assignee_key,json_extract(raw_json,'$.fields.assignee.accountId'),'')='' THEN 1 ELSE 0 END) AS without_assignee,
      MAX(updated_at) AS last_update
    FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)`).get(...done.params);
  const projectCounts = db.prepare(`SELECT project_key AS project,COUNT(*) AS count FROM jira_issues
    WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) GROUP BY project_key ORDER BY project_key`).all();
  return { issueCount:Number(row.total || 0), openCount:Number(row.open_count || 0), epicLinkedCount:Number(row.epic_links || 0),
    issuesWithoutAssignee:Number(row.without_assignee || 0), lastIssueUpdate:row.last_update || null,
    projectCounts:projectCounts.map((item) => ({project:item.project || 'Unknown',count:Number(item.count)})) };
}

function getCalendarPeriodReport(db, { projects = [], from = '', to = '', previousFrom = '', previousTo = '' } = {}) {
  const config = getConfig(db);
  const done = issueDoneSql(config);
  const projectSql = projects.length ? ` AND project_key IN (${projects.map(() => '?').join(',')})` : '';
  const projectParams = projects.map((value) => String(value).trim().toUpperCase());
  const currentCreatedParams = [...done.params];
  const currentCompletedParams = [...done.params];
  const buildRange = (dateFrom, dateTo, column) => {
    const predicates = [];
    const values = [];
    if (dateFrom) { predicates.push(`substr(COALESCE(${column},''),1,10)>=?`); values.push(dateFrom); }
    if (dateTo) { predicates.push(`substr(COALESCE(${column},''),1,10)<=?`); values.push(dateTo); }
    return { sql: predicates.length ? ` AND ${predicates.join(' AND ')}` : '', params: values };
  };
  const createdRange = buildRange(from,to,'created_at');
  const completedRange = buildRange(from,to,'resolution_date');
  const created = Number(db.prepare(`SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)${projectSql}${createdRange.sql}`)
    .get(...projectParams,...createdRange.params).count);
  const completed = Number(db.prepare(`SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) AND ${done.sql}${projectSql}${completedRange.sql}`)
    .get(...done.params,...projectParams,...completedRange.params).count);
  const doneWithoutDate = Number(db.prepare(`SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) AND ${done.sql} AND COALESCE(resolution_date,'')=''${projectSql}`)
    .get(...done.params,...projectParams).count);
  const previousCreatedRange = buildRange(previousFrom,previousTo,'created_at');
  const previousCompletedRange = buildRange(previousFrom,previousTo,'resolution_date');
  const previousCreated = previousFrom && previousTo ? Number(db.prepare(`SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)${projectSql}${previousCreatedRange.sql}`)
    .get(...projectParams,...previousCreatedRange.params).count) : null;
  const previousCompleted = previousFrom && previousTo ? Number(db.prepare(`SELECT COUNT(*) AS count FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) AND ${done.sql}${projectSql}${previousCompletedRange.sql}`)
    .get(...done.params,...projectParams,...previousCompletedRange.params).count) : null;
  const monthly = db.prepare(`SELECT month,SUM(created) AS created,SUM(completed) AS completed FROM (
      SELECT substr(created_at,1,7) AS month,COUNT(*) AS created,0 AS completed FROM jira_issues
        WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)${projectSql}${createdRange.sql} AND COALESCE(created_at,'')<>'' GROUP BY substr(created_at,1,7)
      UNION ALL
      SELECT substr(resolution_date,1,7) AS month,0 AS created,COUNT(*) AS completed FROM jira_issues
        WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) AND ${done.sql}${projectSql}${completedRange.sql} AND COALESCE(resolution_date,'')<>'' GROUP BY substr(resolution_date,1,7)
    ) GROUP BY month ORDER BY month`)
    .all(...projectParams,...createdRange.params,...done.params,...projectParams,...completedRange.params)
    .map((row) => ({ month:row.month,created:Number(row.created || 0),completed:Number(row.completed || 0) }));
  return { created, completed, completedWithoutResolution:doneWithoutDate, previousCreated, previousCompleted, monthly };
}

function getIssueDetails(db, key, includeActivity = true) {
  const issueKey = String(key || '').trim().toUpperCase();
  if (db.prepare('SELECT 1 FROM jira_issue_tombstones WHERE issue_key=?').get(issueKey)) return null;
  const row = db.prepare('SELECT jira_id,issue_key,project_key,updated_at,raw_json,source_file,imported_at,history_complete,history_total FROM jira_issues WHERE issue_key=?').get(issueKey);
  if (!row) return null;
  let issue;
  try { issue = JSON.parse(row.raw_json); } catch { throw new Error('محتوای issue در فضای محلی معتبر نیست.'); }
  const { readMetadata } = require('./jira-metadata.cjs');
  const catalog = readMetadata(db, 'field')?.value || readMetadata(db, 'uploaded:field-catalog')?.value?.data || [];
  issue.names = { ...Object.fromEntries(catalog.map((field) => [field.id, field.name])), ...(issue.names || {}) };
  issue.schema = { ...Object.fromEntries(catalog.filter((field) => field.schema).map((field) => [field.id, field.schema])), ...(issue.schema || {}) };
  if (!includeActivity) {
    const historyTotal = Number(issue.changelog?.total ?? row.history_total ?? 0);
    issue.changelog = { startAt: 0, total: historyTotal, histories: [] };
    if (issue.fields.comment) issue.fields.comment = { total: Number(issue.fields.comment.total || issue.fields.comment.comments?.length || 0), comments: [] };
    if (issue.fields.worklog) issue.fields.worklog = { ...issue.fields.worklog, worklogs: [] };
  }
  const revisions = db.prepare(`SELECT updated_at AS updatedAt,imported_at AS importedAt,source_file AS sourceFile,
    history_count AS historyCount,history_total AS historyTotal,history_complete AS historyComplete
    FROM jira_issue_revisions WHERE jira_id=? ORDER BY imported_at DESC,revision_id DESC LIMIT 100`).all(row.jira_id);
  const localLinks = db.prepare('SELECT * FROM local_issue_links WHERE business_issue_key=? OR technical_issue_key=? ORDER BY created_at')
    .all(issueKey, issueKey);
  const linkEvents = db.prepare(`SELECT link_id AS linkId,event_type AS eventType,occurred_at AS occurredAt,payload_json AS payloadJson
    FROM local_issue_link_events WHERE business_issue_key=? OR technical_issue_key=? ORDER BY occurred_at DESC,id DESC LIMIT 50`)
    .all(issueKey, issueKey).map((event) => ({ ...event, payload: JSON.parse(event.payloadJson) }));
  return {
    key: row.issue_key,
    project: row.project_key,
    raw: issue,
    sourceFile: row.source_file,
    importedAt: row.imported_at,
    historyComplete: Boolean(row.history_complete),
    historyTotal: row.history_total,
    revisions,
    localLinks,
    linkEvents,
  };
}

function getIssueActivity(db, key, offset = 0, limit = 50) {
  const issueKey=String(key||'').trim().toUpperCase();
  const row=db.prepare(`SELECT jira_id,history_complete,history_total,
      json_extract(raw_json,'$.fields.comment') AS comment_json,
      json_extract(raw_json,'$.fields.worklog') AS worklog_json
    FROM jira_issues WHERE issue_key=? AND issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones)`).get(issueKey);
  if(!row)return null;
  const pageSize=Math.max(1,Math.min(100,Math.trunc(Number(limit)||50)));
  const start=Math.max(0,Math.trunc(Number(offset)||0));
  const historyRows=db.prepare(`SELECT history_index,created_at,raw_json FROM jira_issue_history
    WHERE jira_id=? ORDER BY history_index DESC,created_at DESC,history_id DESC LIMIT ? OFFSET ?`).all(row.jira_id,pageSize,start);
  const availableHistory=Number(db.prepare('SELECT COUNT(*) AS count FROM jira_issue_history WHERE jira_id=?').get(row.jira_id).count);
  const historyTotal=Number(row.history_total||0);
  const commentObject=safeJson(row.comment_json,{});
  const allComments=Array.isArray(commentObject.comments)?commentObject.comments:[];
  const comments=[...allComments].sort((a,b)=>String(b.created||'').localeCompare(String(a.created||'')));
  const worklogObject=safeJson(row.worklog_json,{});
  const worklogs=Array.isArray(worklogObject.worklogs)?worklogObject.worklogs:[];
  return {
    key:issueKey,
    history:{histories:historyRows.map((entry)=>({...safeJson(entry.raw_json,{}),axiloomHistoryIndex:entry.history_index})),total:historyTotal,available:availableHistory,offset:start,limit:pageSize,hasMore:start+historyRows.length<availableHistory,complete:Boolean(row.history_complete)},
    comments:{items:comments.slice(start,start+pageSize),total:Number(commentObject.total||comments.length),available:comments.length,offset:start,limit:pageSize,hasMore:start+pageSize<comments.length},
    worklogs:{items:worklogs.slice(start,start+pageSize),total:Number(worklogObject.total||worklogs.length),available:worklogs.length,offset:start,limit:pageSize,hasMore:start+pageSize<worklogs.length},
  };
}

function getSprintDetails(db, sprintId) {
  const id = String(sprintId || '').trim();
  if (!/^\d+$/.test(id)) return null;
  const row = db.prepare('SELECT * FROM jira_sprints WHERE sprint_id=?').get(id);
  if (!row) return null;
  const revisions = db.prepare(`SELECT revision_id AS revisionId, imported_at AS importedAt, source_file AS sourceFile,
    snapshot_hash AS snapshotHash, raw_json AS rawJson FROM jira_sprint_revisions
    WHERE sprint_id=? ORDER BY imported_at DESC, revision_id DESC`).all(id).map((revision) => ({
    ...revision,
    raw: (() => { try { return JSON.parse(revision.rawJson); } catch { return null; } })(),
    rawJson: undefined,
  }));
  let raw;
  try { raw = JSON.parse(row.raw_json); } catch { throw new Error('محتوای Sprint در فضای محلی معتبر نیست.'); }
  return {
    id: row.sprint_id,
    boardId: row.board_id,
    team: row.team_route,
    state: row.state,
    startDate: row.start_date,
    endDate: row.end_date,
    activatedDate: row.activated_date,
    completeDate: row.complete_date,
    sourceFile: row.source_file,
    importedAt: row.imported_at,
    raw,
    revisions,
  };
}

function mergeIssueHistoryPage(db, jiraId, page, sourceFile = 'jira-sync-history') {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT issue_key,updated_at,raw_json,source_file FROM jira_issues WHERE jira_id=?').get(String(jiraId));
    if (!row) { db.exec('COMMIT'); return { complete: false, nextStart: 0, added: 0 }; }
    let issue;
    try { issue = JSON.parse(row.raw_json); } catch { throw new Error(`محتوای ${row.issue_key} برای ثبت تاریخچه معتبر نیست.`); }
    const existingHistories = Array.isArray(issue.changelog?.histories) ? issue.changelog.histories : [];
    const pageStart = Math.max(0, Number(page?.startAt) || 0);
    const mergedById = new Map();
    existingHistories.forEach((history, index) => {
      const saved = Number(history?.axiloomHistoryIndex);
      const historyIndex = Number.isInteger(saved) && saved >= 0 ? saved : Math.max(0, Number(issue.changelog?.startAt) || 0) + index;
      mergedById.set(issueHistoryId(history), { ...history, axiloomHistoryIndex: historyIndex });
    });
    let added = 0;
    (Array.isArray(page?.histories) ? page.histories : []).forEach((history, index) => {
      const id = issueHistoryId(history);
      if (!mergedById.has(id)) added += 1;
      const current = mergedById.get(id);
      const historyIndex = Math.min(Number(current?.axiloomHistoryIndex ?? Infinity), pageStart + index);
      mergedById.set(id, { ...(current || {}), ...history, axiloomHistoryIndex: historyIndex });
    });
    const histories = Array.from(mergedById.values()).sort((a, b) => Number(a.axiloomHistoryIndex) - Number(b.axiloomHistoryIndex));
    const declaredTotal = Math.max(Number(issue.changelog?.total || 0), Number(page?.total || 0), histories.length);
    issue.changelog = { ...(issue.changelog || {}), startAt: 0, maxResults: histories.length, total: declaredTotal, histories };
    storeIssueEvidence(db, issue, String(jiraId), row.issue_key, sourceFile, new Date().toISOString());
    const coverage = historyCoverage(db, String(jiraId), declaredTotal, true);
    issue.changelog.historyComplete = coverage.complete;
    issue.changelog.histories = coverage.rows.map((entry) => ({ ...JSON.parse(entry.raw_json), axiloomHistoryIndex: entry.history_index }));
    issue.changelog.total = coverage.total;
    issue.changelog.maxResults = coverage.rows.length;
    const importedAt = new Date().toISOString();
    const mergedJson = JSON.stringify(issue);
    storeIssueEvidence(db, issue, String(jiraId), row.issue_key, sourceFile, importedAt);
    db.prepare('UPDATE jira_issues SET raw_json=?,history_complete=?,history_total=?,imported_at=?,source_file=? WHERE jira_id=?')
      .run(mergedJson, coverage.complete ? 1 : 0, coverage.total, importedAt, sourceFile, String(jiraId));
    const positions = new Set(coverage.rows.map((entry) => Number(entry.history_index)));
    let nextStart = 0;
    while (nextStart < coverage.total && positions.has(nextStart)) nextStart += 1;
    db.exec('COMMIT');
    return { complete: coverage.complete, nextStart, total: coverage.total, added };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function listLocalIssueLinks(db) {
  return db.prepare('SELECT * FROM local_issue_links ORDER BY updated_at DESC').all();
}

function readRows(db, table, order = '') {
  const allowed = new Set(['jira_issues', 'jira_sprints', 'product_records', 'import_runs', 'import_files', 'import_conflicts']);
  if (!allowed.has(table)) throw new Error('Unsupported workspace table.');
  return db.prepare(`SELECT * FROM ${table} ${order}`).all();
}

module.exports = {
  openDatabase, getConfig, saveConfig, saveIssue, saveSprint, readRows, routeForBoard,
  saveLocalIssueLink, removeLocalIssueLink, getIssueDetails, getSprintDetails,
  listLocalIssueLinks, mergeIssueHistoryPage, getIssueActivity, getDataGeneration, getMetricsGeneration, getCachedReport, saveCachedReport,
  getCachedMetrics, saveCachedMetrics,
  saveBusinessIssueCache, getBusinessBoardReport,
  listIssues, getIssueFilterOptions, getIssueOverviewStats, getCalendarPeriodReport,
};
