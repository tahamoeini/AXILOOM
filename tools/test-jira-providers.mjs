import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createDataCenterAdapter, createOfflineAdapter, describeProvider,
  isApprovedPublicIpv4, isPrivateAddress, parseJiraBaseUrl, validateNetworkAccess,
} = require('../electron/jira-providers.cjs');

assert.equal(describeProvider('jira-datacenter').capabilities.readOnlySync, true);
assert.equal(describeProvider('offline-json').capabilities.fileImport, true);
assert.throws(() => describeProvider('jira-cloud'), /Unsupported source provider/);
assert.equal(isPrivateAddress('10.22.0.4'), true);
assert.equal(isPrivateAddress('fe80::1'), true);
assert.equal(isPrivateAddress('8.8.8.8'), false);
assert.equal(isApprovedPublicIpv4('8.8.8.8'), true);
for (const address of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '192.168.1.1', '198.51.100.7', '203.0.113.7', '224.0.0.1', '::1']) {
  assert.equal(isApprovedPublicIpv4(address), false, `${address} must not be accepted as an approved public address`);
}
assert.throws(() => parseJiraBaseUrl('http://jira.example.test'), /HTTPS/);
assert.throws(() => parseJiraBaseUrl('https://user:secret@jira.example.test'), /Credentials/);
assert.throws(() => validateNetworkAccess({ mode: 'public-pinned', approvedAddresses: [] }), /requires at least one/);

const offlineConfig = { sourceInstance: { id: '', provider: 'offline-json', displayName: '', endpoint: '', networkAccess: { mode: 'private', approvedAddresses: [] } } };
const importer = createOfflineAdapter(offlineConfig, () => 'source-fixed');
const firstAttestation = importer.attestImportSource('Sanitized fixture');
assert.equal(firstAttestation.changed, true);
assert.equal(firstAttestation.sourceInstance.id, 'source-fixed');
assert.equal(firstAttestation.sourceInstance.displayName, 'Sanitized fixture');
const boundImporter = createOfflineAdapter({ sourceInstance: firstAttestation.sourceInstance }, () => 'unused');
assert.equal(boundImporter.attestImportSource('sanitized FIXTURE').changed, false);
assert.throws(() => boundImporter.attestImportSource('Different export'), /bound to/);
assert.throws(() => importer.attestImportSource('Bad\nsource'), /valid source name/);

const baseConfig = {
  jiraUrl: 'https://jira.example.test/context',
  sourceInstance: { provider: 'jira-datacenter', networkAccess: { mode: 'private', approvedAddresses: [] } },
};
const observed = [];
const privateAdapter = createDataCenterAdapter(baseConfig, 'secret-token', {
  resolveHost: async () => [{ address: '10.4.5.6', family: 4 }],
  sendRequest: async (request) => {
    observed.push(request);
    return { status: 200, headers: {}, text: '{"displayName":"Synthetic user"}' };
  },
});
assert.deepEqual(await privateAdapter.request('rest/api/2/myself'), { displayName: 'Synthetic user' });
assert.equal(observed[0].address, '10.4.5.6', 'the request uses the address that passed policy validation');
assert.equal(observed[0].target.href, 'https://jira.example.test/context/rest/api/2/myself');
assert.equal(observed[0].headers.Authorization, 'Bearer secret-token');
await assert.rejects(privateAdapter.request('https://other.example.test/rest/api/2/myself'), /leave the configured endpoint/);
await assert.rejects(privateAdapter.request('../outside'), /leave the configured endpoint/);

const unpinnedDns = createDataCenterAdapter(baseConfig, 'secret-token', {
  resolveHost: async () => [{ address: '10.4.5.6', family: 4 }, { address: '8.8.8.8', family: 4 }],
  sendRequest: async () => assert.fail('A mixed public/private DNS response must not reach the network.'),
});
await assert.rejects(unpinnedDns.request('rest/api/2/myself'), /resolve only to private/);

const publicConfig = {
  ...baseConfig,
  sourceInstance: { provider: 'jira-datacenter', networkAccess: { mode: 'public-pinned', approvedAddresses: ['8.8.8.8'] } },
};
const publicAdapter = createDataCenterAdapter(publicConfig, 'secret-token', {
  resolveHost: async () => [{ address: '8.8.8.8', family: 4 }],
  sendRequest: async (request) => { observed.push(request); return { status: 200, headers: {}, text: '{}' }; },
});
await publicAdapter.request('rest/api/2/myself');
assert.equal(observed.at(-1).address, '8.8.8.8', 'public connections use an administrator-approved pinned address');
const mismatchedPublicDns = createDataCenterAdapter(publicConfig, 'secret-token', {
  resolveHost: async () => [{ address: '1.1.1.1', family: 4 }],
  sendRequest: async () => assert.fail('An address outside the approved list must not reach the network.'),
});
await assert.rejects(mismatchedPublicDns.request('rest/api/2/myself'), /outside the administrator-approved/);

for (const [status, category, expected] of [
  [401, 'authentication', /rejected the credential/],
  [403, 'permission', /denied this operation/],
]) {
  const adapter = createDataCenterAdapter(baseConfig, 'secret-token', {
    resolveHost: async () => [{ address: '10.4.5.6', family: 4 }],
    sendRequest: async () => ({ status, headers: {}, text: '{"message":"token secret-token expired"}' }),
  });
  await assert.rejects(adapter.request('rest/api/2/myself'), (error) => {
    assert.match(error.message, expected);
    assert.equal(error.category, category);
    assert.equal(error.message.includes('secret-token'), false, 'upstream errors must not echo credentials to the renderer');
    return true;
  });
}

const delays = [];
let rateLimitedAttempts = 0;
const rateLimitedAdapter = createDataCenterAdapter(baseConfig, 'secret-token', {
  resolveHost: async () => [{ address: '10.4.5.6', family: 4 }],
  delay: async (milliseconds) => { delays.push(milliseconds); },
  sendRequest: async () => {
    rateLimitedAttempts += 1;
    return rateLimitedAttempts === 1
      ? { status: 429, headers: { 'retry-after': '0.001' }, text: '{"message":"busy"}' }
      : { status: 200, headers: {}, text: '{"ok":true}' };
  },
});
assert.deepEqual(await rateLimitedAdapter.request('rest/api/2/myself'), { ok: true });
assert.equal(rateLimitedAttempts, 2, 'GET requests retry after a rate-limit response');
assert.deepEqual(delays, [1]);

let writeAttempts = 0;
const writeAdapter = createDataCenterAdapter(baseConfig, 'secret-token', {
  resolveHost: async () => [{ address: '10.4.5.6', family: 4 }],
  delay: async () => assert.fail('Write requests must not be retried automatically.'),
  sendRequest: async () => { writeAttempts += 1; return { status: 503, headers: {}, text: '' }; },
});
await assert.rejects(writeAdapter.request('rest/api/2/issue', { method: 'POST', body: '{}' }), /HTTP 503/);
assert.equal(writeAttempts, 1);

const controller = new AbortController();
controller.abort();
await assert.rejects(privateAdapter.request('rest/api/2/myself', { signal: controller.signal }), { name: 'AbortError' });

console.log('Jira provider adapter checks passed.');
