import assert from 'node:assert/strict';
import management from '../electron/jira-management.cjs';

const handlers = new Map();
const touched = [];
let active = 0;
const database = (name) => ({ prepare: () => ({ run: () => touched.push(name) }) });
let current = database('first');
let finish;
management.registerJiraManagement({
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  getDatabase: () => current,
  beginOperation: () => { active++; }, endOperation: () => { active--; },
  savedPat: () => 'synthetic-token',
  jiraFetch: () => new Promise((resolve) => { finish = resolve; }),
});
const confirm = handlers.get('jira:confirm-create-retry');
await confirm(null, 'I checked Jira and no issue was created');
current = database('second');
await confirm(null, 'I checked Jira and no issue was created');
assert.deepEqual(touched, ['first', 'second']);
assert.equal(active, 0);
await assert.rejects(confirm(null, 'invalid'), /Confirm/);
assert.equal(active, 0);
const pending = handlers.get('jira:link-types')();
assert.equal(active, 1, 'Operation must remain busy throughout the network wait');
finish({ issueLinkTypes: [] });
await pending;
assert.equal(active, 0);
console.log('Jira active-database and operation lifetime checks passed.');
