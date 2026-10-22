import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import workspaces from '../electron/workspaces.cjs';
import database from '../electron/database.cjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'axiloom-workspaces-'));
try {
  let registry = workspaces.loadRegistry(root);
  const defaultWorkspace = workspaces.activeWorkspace(root, registry);
  const firstDb = database.openDatabase(defaultWorkspace.databaseFile);
  database.saveIssue(firstDb, { id: 'same-id', key: 'CORE-1', fields: { project: { key: 'CORE' }, issuetype: { id: '1', name: 'Task' }, summary: 'First source' } }, 'first.json', null);
  firstDb.close();

  const created = workspaces.addWorkspace(root, registry, 'Second source');
  registry = created.registry;
  workspaces.saveRegistry(root, registry);
  const secondDb = database.openDatabase(created.workspace.databaseFile);
  database.saveIssue(secondDb, { id: 'same-id', key: 'CORE-1', fields: { project: { key: 'CORE' }, issuetype: { id: '1', name: 'Task' }, summary: 'Second source' } }, 'second.json', null);
  assert.equal(secondDb.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1);
  assert.equal(JSON.parse(secondDb.prepare('SELECT raw_json FROM jira_issues').get().raw_json).fields.summary, 'Second source');
  secondDb.close();

  registry = workspaces.activateWorkspace(root, registry, 'default');
  workspaces.saveRegistry(root, registry);
  const reopened = database.openDatabase(workspaces.activeWorkspace(root, registry).databaseFile);
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM jira_issues').get().count, 1);
  assert.equal(JSON.parse(reopened.prepare('SELECT raw_json FROM jira_issues').get().raw_json).fields.summary, 'First source');
  reopened.close();

  assert.throws(() => workspaces.resolveFolder(root, '..\\outside'), /outside/);
  assert.equal(workspaces.describeRegistry(root, registry).length, 2);
  console.log('Workspace isolation checks passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
