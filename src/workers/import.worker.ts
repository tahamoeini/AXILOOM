import limits from '../../shared/resource-limits.json';

type ImportWorkerMessage = { type: 'import'; files: File[] } | { type: 'ack'; id: string; error?: string };
let ackResolve: ((error?: string) => void) | null = null;
let ackId = '';
let batchSequence = 0;

function waitForAck(id: string) {
  return new Promise<void>((resolve, reject) => {
    ackId = id;
    ackResolve = (error) => error ? reject(new Error(error)) : resolve();
  });
}

async function send(type: string, payload: Record<string, unknown>) {
  const id = `import-${++batchSequence}`;
  self.postMessage({ type, id, ...payload });
  await waitForAck(id);
}

async function handleImport(files: File[]) {
  try {
    if (!Array.isArray(files) || !files.length || files.length > limits.imports.maxFiles) throw new Error(`Choose between 1 and ${limits.imports.maxFiles} JSON files.`);
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (files.some((file) => file.size > limits.imports.maxFileBytes) || totalBytes > limits.imports.maxTotalBytes) throw new Error('Selected JSON files exceed the individual or combined import size limit.');
    let totalRecords = 0;
    for (const file of files) {
      if (file.size > limits.imports.maxFileBytes) throw new Error(`${file.name}: file exceeds the ${limits.imports.maxFileBytes / 1024 / 1024} MB limit.`);
      const root = JSON.parse(await file.text());
      const hasIssues = Array.isArray(root?.issues) || Boolean(root?.key && root?.id && root?.fields);
      const hasSprints = Array.isArray(root?.values) && root.values.every((item: any) => item?.id !== undefined && ('state' in item || 'originBoardId' in item));
      let kind: string;
      let rows: any[] = [];
      let details: Record<string, unknown> = {};
      if (hasIssues) {
        kind = 'issues';
        rows = Array.isArray(root.issues) ? root.issues.map((issue: any) => ({ ...issue, names: { ...(root.names || {}), ...(issue.names || {}) }, schema: { ...(root.schema || {}), ...(issue.schema || {}) } })) : [root];
        details = { startAt: root.startAt, maxResults: root.maxResults, total: root.total, warningMessages: root.warningMessages ?? null, names: root.names ?? {}, schema: root.schema ?? {} };
      } else if (hasSprints) { kind = 'sprints'; rows = root.values; details = { startAt: root.startAt, maxResults: root.maxResults, isLast: root.isLast }; }
      else if (Array.isArray(root) && root.length && root.every((item) => item.id && item.name && ('custom' in item || 'schema' in item))) { kind = 'field-catalog'; details = { data: root }; }
      else if (Array.isArray(root) && root.length && root.every((item) => item.id && item.key && item.name)) { kind = 'project-catalog'; details = { data: root }; }
      else if (Array.isArray(root) && root.length && root.every((item) => item.id && item.name && typeof item.subtask === 'boolean')) { kind = 'issue-type-catalog'; details = { data: root }; }
      else if (root?.fields && !root.key && typeof root.fields === 'object' && Object.values(root.fields).every((item: any) => item?.name && item?.schema)) { kind = 'field-metadata'; details = { data: root, contextVerified: false }; }
      else if (Array.isArray(root?.projects)) { kind = 'create-metadata'; details = { data: root }; }
      else throw new Error(`${file.name}: ساختار تسک، اسپرینت یا متادیتای Jira شناخته نشد.`);
      if (rows.length) {
        totalRecords += rows.length;
        if (totalRecords > limits.imports.maxRecordsPerRun) throw new Error(`Import exceeds the ${limits.imports.maxRecordsPerRun.toLocaleString()} record limit.`);
      }
      const encoder = new TextEncoder();
      if (encoder.encode(JSON.stringify(details)).byteLength > limits.imports.maxMetadataBytes) throw new Error(`${file.name}: metadata exceeds the configured size limit.`);
      for (const row of rows) if (encoder.encode(JSON.stringify(row)).byteLength > limits.imports.maxRecordBytes) throw new Error(`${file.name}: one source record exceeds the ${limits.imports.maxRecordBytes / 1024 / 1024} MB limit.`);
      const metadata = { fileName: file.name, sizeBytes: file.size, kind, metadata: details };
      await send('file', { metadata });
      for (let offset = 0; offset < rows.length; offset += 100) {
        const items = rows.slice(offset, offset + 100);
        if (items.length > limits.imports.maxBatchRecords || encoder.encode(JSON.stringify(items)).byteLength > limits.imports.maxBatchBytes) throw new Error(`${file.name}: one import batch exceeds its safety limit.`);
        if (kind === 'issues' && items.some((item: any) => !item?.id || !item?.key || !item?.fields || typeof item.fields !== 'object')) {
          throw new Error(`${file.name}: یک issue بدون id، key یا fields پیدا شد.`);
        }
        if (kind === 'sprints' && items.some((item: any) => item?.id === undefined)) throw new Error(`${file.name}: sprint بدون شناسه پیدا شد.`);
        await send('batch', { kind, fileName: file.name, items, completed: offset + items.length, total: rows.length });
      }
    }
    self.postMessage({ type: 'done' });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'ساختار JSON معتبر نیست.' });
  }
}

self.onmessage = (event: MessageEvent<ImportWorkerMessage>) => {
  const request = event.data;
  if (request.type === 'ack' && ackResolve && request.id === ackId) {
    const resolve = ackResolve;
    ackResolve = null;
    resolve(request.error);
    return;
  }
  if (request.type === 'import') void handleImport(request.files);
};
