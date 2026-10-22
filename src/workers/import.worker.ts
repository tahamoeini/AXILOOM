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
    for (const file of files) {
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
      const metadata = { fileName: file.name, sizeBytes: file.size, kind, metadata: details };
      await send('file', { metadata });
      for (let offset = 0; offset < rows.length; offset += 100) {
        const items = rows.slice(offset, offset + 100);
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
