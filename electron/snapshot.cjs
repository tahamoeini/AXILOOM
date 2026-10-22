const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { getConfig, readRows, getDataGeneration, getMetricsGeneration, getCachedReport, saveCachedReport, saveBusinessIssueCache, getCachedMetrics, saveCachedMetrics, listRecordRelationships } = require('./database.cjs');
const { calculateMetrics, compactMetricsForCache, publicSnapshot } = require('./metrics.cjs');

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function buildSnapshot(db, filters = {}, options = {}) {
  const config = getConfig(db);
  const dataGeneration = getDataGeneration(db);
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const engineHash = createHash('sha256')
    .update(fs.readFileSync(__filename))
    .update(fs.readFileSync(require.resolve('./metrics.cjs')))
    .update(fs.readFileSync(require.resolve('./semantic-mapping.cjs')))
    .update(fs.readFileSync(require.resolve('./team-attribution.cjs')))
    .update(fs.readFileSync(require.resolve('./database.cjs')))
    .digest('hex');
  const asOfDate = new Date().toISOString().slice(0, 10);
  const metricsGeneration = getMetricsGeneration(db);
  const cacheKey = createHash('sha256').update(JSON.stringify({ filters, asOfDate })).digest('hex');
  const cached = getCachedReport(db, cacheKey, dataGeneration, engineHash, configHash);
  if (cached) return cached;

  let metrics = getCachedMetrics(db, metricsGeneration, asOfDate, engineHash, configHash);
  let metricsCacheMiss = !metrics;
  if (!metrics) {
    const issueRows = db.prepare('SELECT * FROM jira_issues WHERE issue_key NOT IN (SELECT issue_key FROM jira_issue_tombstones) ORDER BY issue_key').all().map((row) => safeJson(row.raw_json, null)).filter(Boolean);
    const sprintRows = readRows(db, 'jira_sprints', 'ORDER BY start_date').map((row) => safeJson(row.raw_json, null)).filter(Boolean);
    metrics = calculateMetrics(issueRows, sprintRows, getConfig(db));
  } else {
    // Metrics contain an internal Map used by publicSnapshot for exact key joins.
    // JSON remains the persistent format; reconstruct the runtime index on read.
    metrics.issueByKey = new Map((metrics.issues || []).map((issue) => [issue.key, issue]));
  }
  const snapshot = publicSnapshot(
    metrics,
    readRows(db, 'product_records', 'ORDER BY updated_at DESC'),
    readRows(db, 'import_runs', 'ORDER BY started_at'),
    readRows(db, 'import_conflicts', 'ORDER BY created_at DESC'),
    filters,
    db.prepare('SELECT * FROM local_issue_links ORDER BY updated_at DESC').all(),
    config,
  );
  snapshot.relationships = listRecordRelationships(db);
  // Issue tables are requested through indexed, server-paginated projections. Keep
  // historical calculations on the trusted metrics engine, while avoiding shipping
  // every normalized issue row to the renderer on each page load.
  snapshot.issues = [];
  const eventRows = db.prepare(`SELECT record_id,event_type,occurred_at,payload_json FROM (
    SELECT events.record_id,events.event_type,events.occurred_at,events.payload_json,events.id,
      ROW_NUMBER() OVER (PARTITION BY events.record_id ORDER BY events.occurred_at DESC,events.id DESC) AS event_rank
    FROM record_events AS events JOIN product_records AS records ON records.id=events.record_id
    WHERE records.archived_at IS NULL
  ) WHERE event_rank <= 10 ORDER BY occurred_at DESC`).all();
  const historyByRecord = new Map();
  eventRows.forEach((row) => {
    if (!historyByRecord.has(row.record_id)) historyByRecord.set(row.record_id, []);
    historyByRecord.get(row.record_id).push({ eventType: row.event_type, occurredAt: row.occurred_at, payload: safeJson(row.payload_json, {}) });
  });
  snapshot.records = snapshot.records.map((record) => ({ ...record, history: historyByRecord.get(record.id) || [] }));
  const linkEvents = db.prepare(`SELECT link_id,event_type,occurred_at,payload_json FROM (
    SELECT events.link_id,events.event_type,events.occurred_at,events.payload_json,events.id,
      ROW_NUMBER() OVER (PARTITION BY events.link_id ORDER BY events.occurred_at DESC,events.id DESC) AS event_rank
    FROM local_issue_link_events AS events
  ) WHERE event_rank <= 10 ORDER BY occurred_at DESC`).all();
  const linkHistory = new Map();
  linkEvents.forEach((row) => {
    if (!linkHistory.has(row.link_id)) linkHistory.set(row.link_id, []);
    linkHistory.get(row.link_id).push({ eventType: row.event_type, occurredAt: row.occurred_at, payload: safeJson(row.payload_json, {}) });
  });
  snapshot.localIssueLinks = snapshot.localIssueLinks.map((link) => ({ ...link, history: linkHistory.get(link.id) || [] }));
  const businessIssues = snapshot.business.issues || [];
  snapshot.business.issues = [];
  snapshot.quality.evidence = {
    issueRevisions: Number(db.prepare('SELECT COUNT(*) AS count FROM jira_issue_revisions').get().count),
    issueHistoryEvents: Number(db.prepare('SELECT COUNT(*) AS count FROM jira_issue_history').get().count),
    sprintRevisions: Number(db.prepare('SELECT COUNT(*) AS count FROM jira_sprint_revisions').get().count),
    localLinkEvents: Number(db.prepare('SELECT COUNT(*) AS count FROM local_issue_link_events').get().count),
    recordRelationshipEvents: Number(db.prepare('SELECT COUNT(*) AS count FROM record_relationship_events').get().count),
  };
  if (options.cacheMetadata) options.cacheMetadata.value = {
    cacheKey, dataGeneration, engineHash, configHash,
    metricsGeneration,
    metricsToCache: metricsCacheMiss ? compactMetricsForCache(metrics, config) : null,
    snapshotDate: asOfDate,
    businessIssues,
  };
  if (options.persist === true) {
    if (metricsCacheMiss) saveCachedMetrics(db, metricsGeneration, asOfDate, engineHash, configHash, compactMetricsForCache(metrics, config));
    saveCachedReport(db, cacheKey, dataGeneration, engineHash, configHash, snapshot);
    saveBusinessIssueCache(db, dataGeneration, asOfDate, businessIssues);
  }
  return snapshot;
}

module.exports = { buildSnapshot };
