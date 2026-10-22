import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { openDatabase, listIssues, listRecords } = require(path.join(root, 'electron/database.cjs'));
const { buildSnapshot } = require(path.join(root, 'electron/snapshot.cjs'));

function argument(name, fallback) {
  const value = process.argv.find((entry) => entry.startsWith(`${name}=`));
  return value ? Number(value.slice(name.length + 1)) : fallback;
}

function percentiles(samples) {
  const ordered = [...samples].sort((a, b) => a - b);
  const at = (percentile) => ordered[Math.min(ordered.length - 1, Math.ceil(percentile * ordered.length) - 1)] || 0;
  return { p50Ms: Number(at(0.5).toFixed(2)), p95Ms: Number(at(0.95).toFixed(2)) };
}

const targetMb = argument('--target-mb', Number(process.env.AXILOOM_BENCHMARK_MB) || 50);
if (!Number.isFinite(targetMb) || targetMb < 1 || targetMb > 1024) throw new Error('Choose a synthetic fixture size from 1 to 1024 MB.');
const skipSnapshot = process.argv.includes('--skip-snapshot');
const targetBytes = Math.round(targetMb * 1024 * 1024);
const rowCount = Math.max(1, Math.ceil(targetBytes / 8192));
const description = 'S'.repeat(Math.max(64, Math.floor(targetBytes / rowCount) - 900));
const recordCount = Math.max(25, Math.ceil(rowCount / 10));
const temporaryRoot = path.resolve(os.tmpdir());
const temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'axiloom-benchmark-'));
const databasePath = path.join(temporaryDirectory, 'synthetic-workspace.sqlite');
if (!path.resolve(temporaryDirectory).startsWith(temporaryRoot + path.sep)) throw new Error('Benchmark temporary path escaped the system temp folder.');

const db = openDatabase(databasePath);
let peakRssBytes = process.memoryUsage().rss;
let issuePayloadBytes = 0;
try {
  const insertIssue = db.prepare(`INSERT INTO jira_issues(jira_id,issue_key,project_key,updated_at,raw_json,source_file,imported_at,history_complete,history_total)
    VALUES(?,?,?,?,?,NULL,?,0,0)`);
  const insertRecord = db.prepare('INSERT INTO product_records(id,kind,title,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?)');
  for (let start = 0; start < rowCount; start += 500) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const end = Math.min(rowCount, start + 500);
      for (let index = start; index < end; index += 1) {
        const key = `SYNTH-${index + 1}`;
        const updated = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
        const raw = {
          id: String(index + 1), key,
          fields: {
            project: { key: 'SYNTH' }, issuetype: { id: '10001', name: 'Story' },
            status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
            summary: `Synthetic benchmark issue ${index + 1}`, created: updated, updated,
            assignee: { accountId: `user-${index % 20}`, displayName: `Synthetic User ${index % 20}` },
            components: [{ name: `Component ${index % 8}` }], priority: { name: index % 2 ? 'Medium' : 'High' },
            description,
          },
        };
        const rawJson = JSON.stringify(raw);
        issuePayloadBytes += Buffer.byteLength(rawJson);
        insertIssue.run(String(index + 1), key, 'SYNTH', updated, rawJson, updated);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let index = 0; index < recordCount; index += 1) {
      const id = `synthetic-objective-${index + 1}`;
      const timestamp = new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
      insertRecord.run(id, 'objective', `Synthetic objective ${index + 1}`, JSON.stringify({ status: 'Active', evidence: `Fixture row ${index + 1}` }), timestamp, timestamp);
      db.prepare('INSERT INTO record_events(record_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?)')
        .run(id, 'created', timestamp, JSON.stringify({ source: 'synthetic benchmark fixture' }));
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }

  const issueSamples = [];
  for (let index = 0; index < 40; index += 1) {
    const offset = (index * 100) % rowCount;
    const started = performance.now();
    const page = listIssues(db, { project: 'SYNTH', offset, limit: 100, sortBy: 'key' });
    issueSamples.push(performance.now() - started);
    assert.equal(page.total, rowCount, 'paged SQL issue query returns the complete synthetic workspace count');
    assert.ok(page.items.length > 0 && page.items.length <= 100);
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  const recordSamples = [];
  for (let index = 0; index < 40; index += 1) {
    const offset = (index * 50) % recordCount;
    const started = performance.now();
    const page = listRecords(db, { kind: 'objective', offset, limit: 50 });
    recordSamples.push(performance.now() - started);
    assert.equal(page.total, recordCount, 'paged SQL record query returns the complete synthetic record count');
    assert.ok(page.items.length > 0 && page.items.length <= 50);
    assert.ok(page.items.every((record) => record.history.length <= 10));
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }

  let snapshot = null;
  let snapshotMs = null;
  let responseBytes = null;
  if (!skipSnapshot) {
    const snapshotStarted = performance.now();
    snapshot = buildSnapshot(db, {}, { persist: false });
    snapshotMs = performance.now() - snapshotStarted;
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    assert.equal(snapshot.summary.issueCount, rowCount, 'summary issue count matches source rows');
    assert.equal(snapshot.summary.recordCount, recordCount, 'summary product-record count matches source rows');
    assert.deepEqual(snapshot.records, [], 'snapshot response does not contain product record rows');
    responseBytes = Buffer.byteLength(JSON.stringify(snapshot));
  }

  const issuePlan = db.prepare(`EXPLAIN QUERY PLAN SELECT issue_key FROM jira_issues WHERE project_key='SYNTH' ORDER BY issue_key LIMIT 100`).all();
  const recordPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM product_records WHERE kind='objective' AND archived_at IS NULL ORDER BY updated_at DESC,id LIMIT 50`).all();
  assert.ok(issuePlan.some((row) => String(row.detail).includes('idx_jira_issues_project_key')));
  assert.ok(recordPlan.some((row) => String(row.detail).includes('idx_product_records_active_page')));
  const memory = process.memoryUsage();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const databaseBytes = fs.statSync(databasePath).size;
  process.stdout.write(`${JSON.stringify({
    fixtureTargetMb: targetMb, issueRows: rowCount, productRecordRows: recordCount,
    serializedIssuePayloadBytes: issuePayloadBytes, databaseBytes,
    issuePage: percentiles(issueSamples), recordPage: percentiles(recordSamples),
    snapshotSkipped: skipSnapshot, snapshotMs: snapshotMs === null ? null : Number(snapshotMs.toFixed(2)), snapshotResponseBytes: responseBytes,
    rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, peakObservedRssBytes: peakRssBytes,
    queryPlans: { issues: issuePlan.map((row) => row.detail), records: recordPlan.map((row) => row.detail) },
  }, null, 2)}\n`);
} finally {
  db.close();
  const resolvedRoot = path.resolve(temporaryRoot) + path.sep;
  const resolvedTarget = path.resolve(temporaryDirectory);
  if (!resolvedTarget.startsWith(resolvedRoot) || !path.basename(resolvedTarget).startsWith('axiloom-benchmark-')) {
    throw new Error('Refusing to remove an unexpected benchmark directory.');
  }
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}
