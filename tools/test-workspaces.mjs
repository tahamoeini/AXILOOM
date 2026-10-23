import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import workspaces from '../electron/workspaces.cjs';
import database from '../electron/database.cjs';

function runWorkspaceWorker(mode, paths) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../electron/workspace-database-worker.cjs', import.meta.url), { workerData: { mode, ...paths } });
    let result;
    let messageError;
    worker.once('message', (message) => { if (message.ok) result = message; else messageError = new Error(message.error || 'Workspace database worker failed.'); });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Workspace database worker exited with code ${code}.`));
      else if (messageError) reject(messageError);
      else resolve(result);
    });
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiloom-workspaces-'));
try {
  let registry = workspaces.loadRegistry(root);
  const defaultWorkspace = workspaces.activeWorkspace(root, registry);
  const firstDb = database.openDatabase(defaultWorkspace.databaseFile);
  database.saveConfig(firstDb, {
    ...database.getConfig(firstDb),
    organization: { name: 'First source organization', locale: 'en-US', timeZone: 'UTC' },
    jiraUrl: 'https://jira-first.example.test',
    projects: ['CORE'],
    sourceInstance: { id: 'source-first', provider: 'jira-datacenter', displayName: 'Jira First', endpoint: 'https://jira-first.example.test' },
  });
  database.saveIssue(firstDb, { id: 'same-id', key: 'CORE-1', fields: { project: { key: 'CORE' }, issuetype: { id: '1', name: 'Task' }, summary: 'First source' } }, 'first.json', null);
  database.saveSprint(firstDb, { id: 'same-sprint-id', originBoardId: '1', name: 'First source sprint', state: 'active' }, 'first.json', null);
  firstDb.close();

  const created = workspaces.addWorkspace(root, registry, 'Second source');
  registry = created.registry;
  workspaces.saveRegistry(root, registry);
  const secondDb = database.openDatabase(created.workspace.databaseFile);
  database.saveConfig(secondDb, {
    ...database.getConfig(secondDb),
    organization: { name: 'Second source organization', locale: 'en-US', timeZone: 'UTC' },
    jiraUrl: 'https://jira-second.example.test',
    projects: ['CORE'],
    sourceInstance: { id: 'source-second', provider: 'jira-datacenter', displayName: 'Jira Second', endpoint: 'https://jira-second.example.test' },
  });
  database.saveIssue(secondDb, { id: 'same-id', key: 'CORE-1', fields: { project: { key: 'CORE' }, issuetype: { id: '1', name: 'Task' }, summary: 'Second source' } }, 'second.json', null);
  database.saveSprint(secondDb, { id: 'same-sprint-id', originBoardId: '1', name: 'Second source sprint', state: 'active' }, 'second.json', null);
  assert.equal(secondDb.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1);
  assert.equal(JSON.parse(secondDb.prepare('SELECT raw_json FROM jira_issues').get().raw_json).fields.summary, 'Second source');
  assert.equal(JSON.parse(secondDb.prepare('SELECT raw_json FROM jira_sprints').get().raw_json).name, 'Second source sprint');
  assert.equal(database.getConfig(secondDb).sourceInstance.id, 'source-second');
  secondDb.close();

  registry = workspaces.activateWorkspace(root, registry, 'default');
  workspaces.saveRegistry(root, registry);
  const reopened = database.openDatabase(workspaces.activeWorkspace(root, registry).databaseFile);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1);
  assert.equal(JSON.parse(reopened.prepare('SELECT raw_json FROM jira_issues').get().raw_json).fields.summary, 'First source');
  assert.equal(JSON.parse(reopened.prepare('SELECT raw_json FROM jira_sprints').get().raw_json).name, 'First source sprint');
  assert.equal(database.getConfig(reopened).sourceInstance.id, 'source-first');
  reopened.close();

  assert.throws(() => workspaces.resolveFolder(root, '..\\outside'), /outside/);
  assert.equal(workspaces.describeRegistry(root, registry).length, 2);

  assert.throws(() => workspaces.assertSingleLink({ nlink: 2 }, 'Workspace database'), /hard-linked/,
    'workspace validation rejects a database inode reachable through another path');
  const aliasPath = path.join(root, 'workspace-hardlink.sqlite');
  try {
    fs.linkSync(defaultWorkspace.databaseFile, aliasPath);
    assert.throws(() => workspaces.validateWorkspacePaths(root, '.'), /hard-linked/,
      'an active workspace database cannot also be reachable through an external hard link');
    fs.unlinkSync(aliasPath);
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    console.warn(`Workspace hard-link integration test unavailable: ${error.code}`);
  }

  const outsidePath = path.join(root, 'outside');
  const junctionPath = path.join(root, 'workspace-junction');
  fs.mkdirSync(outsidePath);
  let junctionCreated = false;
  try { fs.symlinkSync(outsidePath, junctionPath, 'junction'); junctionCreated = true; }
  catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    console.warn(`Workspace junction test unavailable: ${error.code}`);
  }
  if (junctionCreated) assert.throws(() => workspaces.resolveFolder(root, 'workspace-junction'), /symbolic link or junction/,
    'workspace paths cannot traverse a directory junction');

  const restoreSource = path.join(root, 'restore-source.sqlite');
  const restoreTarget = path.join(root, 'restore-snapshot.sqlite');
  const restoreDb = database.openDatabase(restoreSource);
  restoreDb.exec('PRAGMA journal_mode=WAL;');
  restoreDb.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run('committed-before-snapshot', '{"value":"from-wal"}', new Date().toISOString());
  await runWorkspaceWorker('restore-snapshot', { sourcePath: restoreSource, targetPath: restoreTarget });
  await runWorkspaceWorker('validate', { dbPath: restoreTarget });
  const restored = database.openDatabase(restoreTarget);
  assert.equal(restored.prepare('SELECT value_json FROM settings WHERE key=?').get('committed-before-snapshot').value_json, '{"value":"from-wal"}',
    'the restore snapshot includes committed data that is still in the source WAL');
  restored.close();
  restoreDb.close();

  console.log('Workspace isolation checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
