import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const database = require('../electron/database.cjs');

const CURRENT_SCHEMA_VERSION = 8;
const REQUIRED_TABLES = ['settings', 'jira_issues', 'jira_sprints', 'product_records'];
const SQLITE_SIDECARS = ['-wal', '-shm', '-journal'];
const COUNT_GUARD_TABLES = [
  'settings', 'jira_issues', 'jira_issue_tombstones', 'jira_issue_revisions', 'jira_issue_history',
  'jira_sprints', 'jira_sprint_revisions', 'configuration_revisions', 'import_runs', 'import_files', 'import_conflicts',
  'product_records', 'record_events', 'local_issue_links', 'local_issue_link_events',
];
const EVIDENCE_ROWS = [
  { table: 'configuration_revisions', keys: ['revision'], fields: ['schema_version', 'fingerprint', 'event_type', 'profile_json', 'source_profile_json', 'created_at'] },
  { table: 'jira_issue_tombstones', keys: ['issue_key'], fields: ['jira_id', 'deleted_at', 'raw_json'] },
  { table: 'jira_issue_revisions', keys: ['revision_id'], fields: ['snapshot_hash', 'raw_json', 'source_file'] },
  { table: 'jira_issue_history', keys: ['jira_id', 'history_id'], fields: ['raw_json'] },
  { table: 'jira_sprint_revisions', keys: ['revision_id'], fields: ['snapshot_hash', 'raw_json', 'source_file'] },
  { table: 'import_runs', keys: ['id'], fields: ['started_at', 'finished_at', 'files_json', 'issues_added', 'issues_updated', 'duplicates', 'conflicts', 'sprints_added', 'sprints_updated', 'skipped', 'note'] },
  { table: 'import_files', keys: ['id'], fields: ['run_id', 'file_name', 'kind', 'size_bytes', 'metadata_json', 'imported_at'] },
  { table: 'import_conflicts', keys: ['id'], fields: ['run_id', 'identity', 'source_file', 'reason', 'current_json', 'incoming_json', 'created_at'] },
  { table: 'product_records', keys: ['id'], fields: ['kind', 'title', 'payload_json', 'created_at', 'updated_at', 'archived_at'] },
  { table: 'record_events', keys: ['id'], fields: ['record_id', 'event_type', 'occurred_at', 'payload_json'] },
  { table: 'local_issue_links', keys: ['id'], fields: ['business_issue_key', 'technical_issue_key', 'relationship', 'note', 'created_at', 'updated_at'] },
  { table: 'local_issue_link_events', keys: ['id'], fields: ['link_id', 'event_type', 'occurred_at', 'payload_json'] },
];

export function assertSingleLink(stat, label = 'Source workspace') {
  if (Number(stat?.nlink || 0) > 1) throw new Error(`${label} must not be hard-linked; WAL sidecars are resolved from its canonical file path.`);
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function getTables(db) {
  return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name));
}

function getTableCounts(db, tables = getTables(db)) {
  const counts = {};
  for (const table of [...tables].sort()) counts[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
  return counts;
}

function integrityCheck(db, label) {
  const result = db.prepare('PRAGMA integrity_check').get()?.integrity_check;
  if (result !== 'ok') throw new Error(`${label} failed SQLite integrity_check: ${result || 'no result'}`);
  const foreignKeyFailure = db.prepare('PRAGMA foreign_key_check').get();
  if (foreignKeyFailure) throw new Error(`${label} failed SQLite foreign_key_check in table ${foreignKeyFailure.table}.`);
}

function compareProtectedRows(sourceDb, migratedDb, sourceTables, migratedTables) {
  const verified = {};
  for (const spec of EVIDENCE_ROWS) {
    if (!sourceTables.has(spec.table)) continue;
    if (!migratedTables.has(spec.table)) throw new Error(`Migration removed evidence table ${spec.table}.`);
    const sourceColumns = new Set(sourceDb.prepare(`PRAGMA table_info(${quoteIdentifier(spec.table)})`).all().map((row) => row.name));
    const migratedColumns = new Set(migratedDb.prepare(`PRAGMA table_info(${quoteIdentifier(spec.table)})`).all().map((row) => row.name));
    if (!spec.keys.every((column) => sourceColumns.has(column) && migratedColumns.has(column))) {
      throw new Error(`Migration cannot reconcile stable row identity for ${spec.table}.`);
    }
    const fields = spec.fields.filter((column) => sourceColumns.has(column));
    if (fields.some((column) => !migratedColumns.has(column))) throw new Error(`Migration removed an evidence field from ${spec.table}.`);
    const selectedColumns = [...spec.keys, ...fields];
    const selectSql = `SELECT ${selectedColumns.map(quoteIdentifier).join(',')} FROM ${quoteIdentifier(spec.table)}`;
    const lookupSql = `SELECT ${selectedColumns.map(quoteIdentifier).join(',')} FROM ${quoteIdentifier(spec.table)} WHERE ${spec.keys.map((key) => `${quoteIdentifier(key)}=?`).join(' AND ')}`;
    const lookup = migratedDb.prepare(lookupSql);
    let count = 0;
    for (const sourceRow of sourceDb.prepare(selectSql).iterate()) {
      const destinationRow = lookup.get(...spec.keys.map((key) => sourceRow[key]));
      if (!destinationRow) throw new Error(`Migration removed a source row from ${spec.table}.`);
      for (const field of fields) {
        if (destinationRow[field] !== sourceRow[field]) throw new Error(`Migration changed preserved evidence in ${spec.table}.${field}.`);
      }
      count += 1;
    }
    verified[spec.table] = count;
  }

  const settingsPresent = sourceTables.has('settings') && migratedTables.has('settings');
  if (settingsPresent) {
    const originalSettings = sourceDb.prepare("SELECT key,value_json,updated_at FROM settings WHERE key<>'config'").iterate();
    const lookup = migratedDb.prepare('SELECT value_json,updated_at FROM settings WHERE key=?');
    let count = 0;
    for (const row of originalSettings) {
      const next = lookup.get(row.key);
      if (!next || next.value_json !== row.value_json || next.updated_at !== row.updated_at) throw new Error(`Migration changed a non-configuration workspace setting: ${row.key}.`);
      count += 1;
    }
    verified.nonConfigurationSettings = count;
  }
  return verified;
}

function compareSourceIssues(sourceDb, migratedDb) {
  const issueRows = sourceDb.prepare('SELECT jira_id,issue_key,project_key,updated_at,raw_json,source_file,imported_at FROM jira_issues').iterate();
  const destination = migratedDb.prepare('SELECT jira_id,issue_key,project_key,updated_at,raw_json,source_file,imported_at FROM jira_issues WHERE jira_id=?');
  const revision = migratedDb.prepare('SELECT 1 AS found FROM jira_issue_revisions WHERE jira_id=? AND raw_json=? LIMIT 1');
  let count = 0;
  for (const source of issueRows) {
    const next = destination.get(source.jira_id);
    if (!next) throw new Error(`Migration removed Jira issue ${source.issue_key}.`);
    for (const field of ['issue_key', 'project_key', 'updated_at', 'source_file', 'imported_at']) {
      if (next[field] !== source[field]) throw new Error(`Migration changed ${field} for Jira issue ${source.issue_key}.`);
    }
    if (next.raw_json !== source.raw_json && !revision.get(source.jira_id, source.raw_json)) {
      throw new Error(`Migration changed Jira issue ${source.issue_key} without retaining its original payload as a revision.`);
    }
    count += 1;
  }
  return count;
}

function compareSourceSprints(sourceDb, migratedDb) {
  const sourceRows = sourceDb.prepare('SELECT sprint_id,board_id,team_route,state,start_date,end_date,activated_date,complete_date,raw_json,source_file,imported_at FROM jira_sprints').iterate();
  const destination = migratedDb.prepare('SELECT sprint_id,board_id,team_route,state,start_date,end_date,activated_date,complete_date,raw_json,source_file,imported_at FROM jira_sprints WHERE sprint_id=?');
  let count = 0;
  for (const source of sourceRows) {
    const next = destination.get(source.sprint_id);
    if (!next) throw new Error(`Migration removed Jira sprint ${source.sprint_id}.`);
    for (const field of ['board_id', 'team_route', 'state', 'start_date', 'end_date', 'activated_date', 'complete_date', 'raw_json', 'source_file', 'imported_at']) {
      if (next[field] !== source[field]) throw new Error(`Migration changed ${field} for Jira sprint ${source.sprint_id}.`);
    }
    count += 1;
  }
  return count;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function sourceFileHashes(sourcePath) {
  const hashes = { database: await sha256File(sourcePath) };
  for (const suffix of SQLITE_SIDECARS) {
    const filePath = `${sourcePath}${suffix}`;
    hashes[suffix] = fs.existsSync(filePath) ? await sha256File(filePath) : null;
  }
  return hashes;
}

function copyClosedDatabaseFiles(sourcePath, snapshotPath) {
  for (const suffix of ['', ...SQLITE_SIDECARS]) {
    const sourceFile = `${sourcePath}${suffix}`;
    if (fs.existsSync(sourceFile)) fs.copyFileSync(sourceFile, `${snapshotPath}${suffix}`, fs.constants.COPYFILE_EXCL);
  }
}

function readConfigSchemaVersion(db, tables) {
  if (!tables.has('settings')) return null;
  const row = db.prepare("SELECT value_json FROM settings WHERE key='config'").get();
  if (!row) return null;
  try { return Number(JSON.parse(row.value_json).schemaVersion || 0); } catch { return null; }
}

function removeSqliteFiles(filePath) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.rmSync(`${filePath}${suffix}`, { force: true }); } catch { /* Preserve the original migration error. */ }
  }
}

export async function migrateWorkspace({ sourcePath, destinationPath, dryRun = false }) {
  if (!sourcePath || !destinationPath) throw new Error('Provide both --source and --destination paths.');
  const suppliedSource = path.resolve(sourcePath);
  if (!fs.existsSync(suppliedSource)) throw new Error('Source workspace file does not exist or is not a regular file.');
  const source = fs.realpathSync(suppliedSource);
  const destination = path.resolve(destinationPath);
  if ((process.platform === 'win32' && source.toLowerCase() === destination.toLowerCase()) || source === destination) {
    throw new Error('Source and destination must be different files.');
  }
  const sourceStats = fs.statSync(source);
  if (!sourceStats.isFile()) throw new Error('Source workspace file does not exist or is not a regular file.');
  assertSingleLink(sourceStats);
  const sourceHandle = fs.openSync(source, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(sourceHandle, header, 0, 16, 0);
    if (header.toString('utf8') !== 'SQLite format 3\0') throw new Error('Source is not a SQLite database.');
  } finally { fs.closeSync(sourceHandle); }
  const outputDirectory = path.dirname(destination);
  if (!fs.existsSync(outputDirectory) || !fs.statSync(outputDirectory).isDirectory()) throw new Error('Destination directory must already exist.');
  const manifestPath = `${destination}.migration.json`;
  if (fs.existsSync(destination) || fs.existsSync(manifestPath)) throw new Error('Destination or its migration manifest already exists; no files were changed.');

  const uniqueName = `.${path.basename(destination)}.${randomUUID()}`;
  const snapshotPath = path.join(outputDirectory, `${uniqueName}.source.sqlite`);
  const temporaryPath = path.join(outputDirectory, `${uniqueName}.stage.sqlite`);
  const temporaryManifest = `${temporaryPath}.migration.json`;
  let sourceDb;
  let migratedDb;
  let movedDatabase = false;
  try {
    const sourceHashesBeforeCopy = await sourceFileHashes(source);
    copyClosedDatabaseFiles(source, snapshotPath);
    const sourceHashesAfterCopy = await sourceFileHashes(source);
    if (JSON.stringify(sourceHashesAfterCopy) !== JSON.stringify(sourceHashesBeforeCopy)) {
      throw new Error('Source database files changed while the read-only migration snapshot was being copied; no destination was written. Close the source application and retry.');
    }
    const sourceDatabaseSha256 = sourceHashesBeforeCopy.database;
    const sourceWalSha256 = sourceHashesBeforeCopy['-wal'];
    sourceDb = new DatabaseSync(snapshotPath, { readOnly: true });
    sourceDb.exec('PRAGMA busy_timeout=10000;');
    integrityCheck(sourceDb, 'Source workspace');
    const sourceTables = getTables(sourceDb);
    const missing = REQUIRED_TABLES.filter((table) => !sourceTables.has(table));
    if (missing.length) throw new Error(`Source is not a supported workspace; required tables are missing: ${missing.join(', ')}.`);
    const sourceVersion = Number(sourceDb.prepare('PRAGMA user_version').get().user_version || 0);
    if (sourceVersion > CURRENT_SCHEMA_VERSION) throw new Error(`Source schema ${sourceVersion} is newer than this Axiloom migration tool supports (${CURRENT_SCHEMA_VERSION}).`);
    const countsBefore = getTableCounts(sourceDb, sourceTables);
    const sourceConfigSchemaVersion = readConfigSchemaVersion(sourceDb, sourceTables);
    const escapedPath = temporaryPath.replaceAll("'", "''");
    sourceDb.exec(`VACUUM INTO '${escapedPath}'`);
    sourceDb.close();
    sourceDb = null;
    migratedDb = database.openDatabase(temporaryPath);
    integrityCheck(migratedDb, 'Migrated workspace');
    const migratedTables = getTables(migratedDb);
    const comparisonSourceDb = new DatabaseSync(snapshotPath, { readOnly: true });
    let evidenceRowsVerified;
    let issueRowsVerified;
    let sprintRowsVerified;
    try {
      evidenceRowsVerified = compareProtectedRows(comparisonSourceDb, migratedDb, sourceTables, migratedTables);
      issueRowsVerified = compareSourceIssues(comparisonSourceDb, migratedDb);
      sprintRowsVerified = compareSourceSprints(comparisonSourceDb, migratedDb);
    } finally { comparisonSourceDb.close(); }
    const countsAfter = getTableCounts(migratedDb, migratedTables);
    for (const table of COUNT_GUARD_TABLES) {
      if (sourceTables.has(table) && (countsAfter[table] || 0) < (countsBefore[table] || 0)) {
        throw new Error(`Migration reduced the ${table} row count from ${countsBefore[table]} to ${countsAfter[table] || 0}.`);
      }
    }
    const config = database.getConfig(migratedDb);
    const destinationVersion = Number(migratedDb.prepare('PRAGMA user_version').get().user_version || 0);
    migratedDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    migratedDb.exec('PRAGMA journal_mode=DELETE;');
    migratedDb.close();
    migratedDb = null;

    const finalDb = new DatabaseSync(temporaryPath, { readOnly: true });
    try { integrityCheck(finalDb, 'Final migrated workspace'); }
    finally { finalDb.close(); }
    const report = {
      product: 'Axiloom',
      migrationToolVersion: 1,
      dryRun: Boolean(dryRun),
      sourceFileName: path.basename(source),
      sourceDatabaseSha256,
      sourceWalSha256,
      sourceSidecarSha256: { shm: sourceHashesBeforeCopy['-shm'], journal: sourceHashesBeforeCopy['-journal'] },
      migratedWorkspaceSha256: await sha256File(temporaryPath),
      sourceSchemaVersion: sourceVersion,
      sourceConfigSchemaVersion,
      destinationSchemaVersion: destinationVersion,
      destinationConfigSchemaVersion: config.schemaVersion,
      verifiedAt: new Date().toISOString(),
      tableCountsBefore: countsBefore,
      tableCountsAfter: countsAfter,
      preservedEvidenceRowsVerified: evidenceRowsVerified,
      jiraIssuesVerified: issueRowsVerified,
      jiraSprintsVerified: sprintRowsVerified,
      sourceModified: false,
      userReviewRequired: config.migrationStatus === 'review-required' || config.migrationStatus === 'unconfigured',
    };
    fs.writeFileSync(temporaryManifest, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    if (dryRun) return report;

    fs.renameSync(temporaryPath, destination);
    movedDatabase = true;
    try { fs.renameSync(temporaryManifest, manifestPath); }
    catch (error) {
      fs.renameSync(destination, temporaryPath);
      movedDatabase = false;
      throw error;
    }
    return { ...report, destinationFileName: path.basename(destination), manifestFileName: path.basename(manifestPath) };
  } finally {
    if (migratedDb) { try { migratedDb.close(); } catch { /* Preserve the original migration error. */ } }
    if (sourceDb) { try { sourceDb.close(); } catch { /* Preserve the original migration error. */ } }
    removeSqliteFiles(snapshotPath);
    // The main staging database has been renamed on success, but SQLite may leave WAL/SHM sidecars at the old path.
    removeSqliteFiles(temporaryPath);
    if (!movedDatabase || dryRun) {
      try { fs.rmSync(temporaryManifest, { force: true }); } catch { /* Best effort staging cleanup. */ }
    }
  }
}

function parseArgs(args) {
  const options = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--dry-run') { options.dryRun = true; continue; }
    if (args[index] === '--help' || args[index] === '-h') { options.help = true; continue; }
    if (args[index] === '--source' || args[index] === '--destination') {
      const name = args[index] === '--source' ? 'sourcePath' : 'destinationPath';
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value after ${args[index]}.`);
      options[name] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${args[index]}`);
  }
  return options;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('Usage: node tools/migrate-workspace.mjs --source <closed-workspace.sqlite> --destination <new-workspace.sqlite> [--dry-run]\n');
    } else {
      const report = await migrateWorkspace(options);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
