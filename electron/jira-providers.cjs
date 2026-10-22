const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

const PROVIDERS = Object.freeze({
  'offline-json': Object.freeze({
    id: 'offline-json',
    label: 'Offline Jira JSON import',
    authentication: 'none',
    capabilities: Object.freeze({ fileImport: true, projectDiscovery: false, fieldDiscovery: false, readOnlySync: false, userInitiatedWrites: false }),
  }),
  'jira-datacenter': Object.freeze({
    id: 'jira-datacenter',
    label: 'Jira Server / Data Center',
    authentication: 'personal-access-token',
    capabilities: Object.freeze({ fileImport: true, projectDiscovery: true, fieldDiscovery: true, readOnlySync: true, userInitiatedWrites: true }),
  }),
});

const PUBLIC_IPV4_RESERVED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([network, bits]) => ({ first: ipv4Number(network), mask: (0xffffffff << (32 - bits)) >>> 0 }));

function ipv4Number(address) {
  return address.split('.').reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function isPrivateAddress(address) {
  const value = String(address || '').replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (net.isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254
      || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
      || parts[0] === 192 && parts[1] === 168;
  }
  if (net.isIP(value) !== 6) return false;
  return value === '::1' || /^f[cd]/.test(value) || /^fe[89ab]/.test(value);
}

function isApprovedPublicIpv4(address) {
  const value = String(address || '').trim();
  if (net.isIP(value) !== 4) return false;
  const number = ipv4Number(value);
  return !PUBLIC_IPV4_RESERVED.some(({ first, mask }) => ((number & mask) >>> 0) === ((first & mask) >>> 0));
}

function describeProvider(providerId) {
  const descriptor = PROVIDERS[String(providerId || '')];
  if (!descriptor) throw new Error(`Unsupported source provider: ${providerId || '(empty)'}`);
  return { ...descriptor, capabilities: { ...descriptor.capabilities } };
}

function parseJiraBaseUrl(value) {
  let base;
  try { base = new URL(String(value || '')); } catch { throw new Error('Jira URL is invalid.'); }
  if (base.protocol !== 'https:') throw new Error('Jira URL must use HTTPS.');
  if (base.username || base.password) throw new Error('Credentials must not be embedded in the Jira URL.');
  if (base.search || base.hash) throw new Error('Jira URL must not contain a query or fragment.');
  base.pathname = base.pathname.replace(/\/+$/, '');
  return base;
}

function validateNetworkAccess(networkAccess = {}) {
  const mode = String(networkAccess.mode || 'private');
  const approvedAddresses = Array.isArray(networkAccess.approvedAddresses)
    ? [...new Set(networkAccess.approvedAddresses.map((address) => String(address || '').trim()).filter(Boolean))]
    : [];
  if (!['private', 'public-pinned'].includes(mode)) throw new Error('Jira network access mode must be private or public-pinned.');
  if (approvedAddresses.length > 20) throw new Error('At most 20 approved Jira addresses may be configured.');
  if (approvedAddresses.some((address) => !isApprovedPublicIpv4(address))) {
    throw new Error('Approved public Jira addresses must be globally routable IPv4 addresses.');
  }
  if (mode === 'public-pinned' && approvedAddresses.length === 0) {
    throw new Error('Public Jira access requires at least one administrator-approved IPv4 address.');
  }
  if (mode === 'private' && approvedAddresses.length) {
    throw new Error('Approved public addresses are only valid with public-pinned Jira access.');
  }
  return { mode, approvedAddresses };
}

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Jira request cancelled.');
  error.name = 'AbortError';
  return error;
}

function sendHttpsRequest({ target, method, headers, body, address, signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBytes = 0;
    const chunks = [];
    const family = net.isIP(address);
    const lookup = (_hostname, _options, callback) => callback(null, address, family);
    const finish = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve(response);
    };
    const request = https.request(target, {
      method,
      headers,
      agent: false,
      lookup,
      rejectUnauthorized: true,
      ...(net.isIP(target.hostname) ? {} : { servername: target.hostname }),
    }, (response) => {
      response.on('data', (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > 64 * 1024 * 1024) {
          const error = new Error('Jira response exceeded the 64 MB safety limit.');
          request.destroy(error);
          finish(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, {
        status: Number(response.statusCode || 0),
        headers: response.headers || {},
        text: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', (error) => finish(error));
    });
    const timeout = setTimeout(() => {
      const error = new Error('Jira request timed out.');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    }, timeoutMs);
    timeout.unref?.();
    const onAbort = () => request.destroy(abortError(signal));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    request.on('error', (error) => finish(error));
    request.end(body);
  });
}

function sanitizeText(value, secrets) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('[redacted]');
  return text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]').slice(0, 500);
}

function retryAfterMilliseconds(header, now = Date.now()) {
  if (header === undefined || header === null || header === '') return null;
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(String(header)) - now;
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.min(30000, milliseconds));
}

function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() { signal?.removeEventListener('abort', cancel); resolve(); }
    function cancel() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError(signal)); }
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function apiError(response, body, secrets) {
  const status = response.status;
  const details = typeof body === 'string' ? body : body?.errorMessages?.join(' · ') || body?.message
    || (body?.errors ? JSON.stringify(body.errors) : '') || '';
  const retryAfterMs = retryAfterMilliseconds(response.headers?.['retry-after']);
  const messages = {
    401: 'Jira rejected the credential (401). Confirm that the token is valid and has not been revoked.',
    403: 'Jira denied this operation (403). Check the user’s project permissions and granted access.',
    429: 'Jira rate limited the request (429). Wait briefly before trying again.',
  };
  const message = messages[status] || `Jira returned HTTP ${status}.${details ? ` ${sanitizeText(details, secrets)}` : ''}`;
  const error = new Error(message);
  error.name = 'JiraProviderError';
  error.status = status;
  error.retryAfterMs = retryAfterMs;
  error.category = status === 401 ? 'authentication' : status === 403 ? 'permission' : status === 429 ? 'rate-limit' : 'http';
  return error;
}

function isRetryableNetworkError(error) {
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED'].includes(error?.code);
}

function isRetryableResponse(response) {
  return response.status === 429 || [502, 503, 504].includes(response.status);
}

async function resolveApprovedAddress(base, networkAccess, resolveHost) {
  const hostname = base.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = await resolveHost(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Jira hostname could not be resolved. Check DNS and the configured endpoint.');
  }
  if (!Array.isArray(addresses) || !addresses.length) throw new Error('Jira hostname returned no network addresses.');
  if (networkAccess.mode === 'public-pinned') {
    const approved = new Set(networkAccess.approvedAddresses);
    const resolved = addresses.map(({ address }) => String(address || '').trim());
    if (resolved.some((address) => !approved.has(address) || !isApprovedPublicIpv4(address))) {
      throw new Error('Jira DNS returned an address outside the administrator-approved public address list.');
    }
    return resolved[0];
  }
  const resolved = addresses.map(({ address }) => String(address || '').trim());
  if (resolved.some((address) => !isPrivateAddress(address))) {
    throw new Error('Jira must resolve only to private, loopback, or link-local network addresses.');
  }
  return resolved[0];
}

function createOfflineAdapter(config, idFactory = () => require('node:crypto').randomUUID()) {
  return {
    descriptor: describeProvider('offline-json'),
    attestImportSource(requestedSourceName) {
      const sourceName = String(requestedSourceName || '').trim();
      if (!sourceName || sourceName.length > 160 || /[\u0000-\u001f\u007f]/.test(sourceName)) {
        throw new Error('Confirm a valid source name before importing Jira files.');
      }
      const currentSourceName = String(config.sourceInstance.displayName || '').trim();
      if (currentSourceName && currentSourceName.toLocaleLowerCase('en-US') !== sourceName.toLocaleLowerCase('en-US')) {
        throw new Error(`This workspace is bound to "${currentSourceName}". Use a separate workspace for another Jira source.`);
      }
      if (currentSourceName && config.sourceInstance.id) return { sourceInstance: config.sourceInstance, changed: false };
      return {
        changed: true,
        sourceInstance: {
          ...config.sourceInstance,
          id: config.sourceInstance.id || idFactory(),
          displayName: currentSourceName || sourceName,
        },
      };
    },
  };
}

function createDataCenterAdapter(config, token, dependencies = {}) {
  if (!config?.jiraUrl) throw new Error('Jira URL is not configured.');
  const base = parseJiraBaseUrl(config.jiraUrl);
  const networkAccess = validateNetworkAccess(config.sourceInstance?.networkAccess);
  const resolveHost = dependencies.resolveHost || dns.lookup.bind(dns);
  const sendRequest = dependencies.sendRequest || sendHttpsRequest;
  const delay = dependencies.delay || waitForRetry;
  const capabilities = describeProvider('jira-datacenter');

  async function request(resourcePath, options = {}) {
    const path = String(resourcePath || '').replace(/^\//, '');
    const target = new URL(path, `${base.toString().replace(/\/$/, '')}/`);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`)) {
      throw new Error('Jira request attempted to leave the configured endpoint.');
    }
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (token && !Object.keys(headers).some((name) => name.toLowerCase() === 'authorization')) headers.Authorization = `Bearer ${token}`;
    const secrets = [token, ...Object.entries(headers).filter(([name]) => name.toLowerCase() === 'authorization').map(([, value]) => value)];
    const signal = options.signal;
    const timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs) || 60000));
    const retryableMethod = method === 'GET' || method === 'HEAD';
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw abortError(signal);
      const address = await resolveApprovedAddress(base, networkAccess, resolveHost);
      let response;
      try {
        response = await sendRequest({ target, method, headers, body: options.body, address, signal, timeoutMs });
      } catch (error) {
        if (signal?.aborted) throw abortError(signal);
        if (retryableMethod && attempt < 2 && isRetryableNetworkError(error)) {
          await delay(250 * (2 ** attempt), signal);
          continue;
        }
        const message = error?.code === 'ETIMEDOUT'
          ? 'Jira request timed out. Check the endpoint and network latency.'
          : 'Jira network request failed. Check DNS, connectivity, and the TLS certificate.';
        const safeError = new Error(message);
        safeError.name = 'JiraProviderError';
        safeError.category = error?.code === 'ETIMEDOUT' ? 'timeout' : 'network';
        safeError.code = error?.code;
        throw safeError;
      }
      if (response.status >= 300 && response.status < 400) {
        throw new Error('Jira returned a redirect. Check the configured base URL and reverse-proxy settings.');
      }
      let body = null;
      try { body = response.text ? JSON.parse(response.text) : null; }
      catch { body = response.text; }
      if (response.status >= 200 && response.status < 300) return body;
      const error = apiError(response, body, secrets);
      if (retryableMethod && attempt < 2 && isRetryableResponse(response)) {
        await delay(error.retryAfterMs ?? 250 * (2 ** attempt), signal);
        continue;
      }
      throw error;
    }
  }

  return { descriptor: capabilities, baseUrl: base, request };
}

function createProviderAdapter(config, token, dependencies) {
  if (config?.sourceInstance?.provider === 'offline-json') return createOfflineAdapter(config);
  if (config?.sourceInstance?.provider === 'jira-datacenter') return createDataCenterAdapter(config, token, dependencies);
  throw new Error(`Unsupported source provider: ${config?.sourceInstance?.provider || '(empty)'}`);
}

module.exports = {
  createDataCenterAdapter,
  createOfflineAdapter,
  createProviderAdapter,
  describeProvider,
  isApprovedPublicIpv4,
  isPrivateAddress,
  parseJiraBaseUrl,
  retryAfterMilliseconds,
  validateNetworkAccess,
};
