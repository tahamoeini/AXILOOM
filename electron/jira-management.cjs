// Jira mutations stay in the main process and are validated against live permissions.
const { getConfig } = require('./database.cjs');
const { cacheMetadata, readMetadata, discoverMetadata, createMetadata, projectKey } = require('./jira-metadata.cjs');
function registerJiraManagement({ ipcMain, db, jiraFetch, savedPat, saveIssue, getIssueDetails, invalidateSnapshot }) {
  const locked = new Set();
  const keyOf = (value) => {
    const key = String(value || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(key)) throw new Error('کلید Jira معتبر نیست.');
    return key;
  };
  const request = (resource, options = {}) => {
    const token = savedPat();
    if (!token) throw new Error('ابتدا در تنظیمات به Jira متصل شوید.');
    return jiraFetch(resource, options, token).then((value) => {
      if (options.method && options.method !== 'GET') invalidateSnapshot?.();
      return value;
    }).catch((error) => {
      if (options.method && options.method !== 'GET' && !String(error.message).startsWith('Jira (')) throw new Error(`نتیجهٔ ارسال به Jira مشخص نیست؛ پیش از تلاش مجدد، Jira را بازخوانی کنید. ${error.message}`);
      throw error;
    });
  };
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function exclusive(key, work) {
    if (locked.has(key)) throw new Error('عملیات دیگری روی این مورد در حال انجام است.');
    locked.add(key);
    try { return await work(); } finally { locked.delete(key); }
  }
  async function readIssue(key, includeActivity = false) {
    const expand = includeActivity ? 'names,schema,changelog,renderedFields' : 'names,schema,renderedFields';
    const issue = await request(`rest/api/2/issue/${key}?fields=*all&expand=${expand}`);
    if (!includeActivity) {
      // A normal refresh reads only the current issue. Preserve cached history and
      // activity until the user explicitly asks for the complete Jira activity.
      delete issue.changelog;
      delete issue.fields.comment;
      delete issue.fields.worklog;
    } else {
      const histories = [...(issue.changelog?.histories || [])];
      let total = Number(issue.changelog?.total || histories.length);
      while (histories.length < total) {
        const page = await request(`rest/api/2/issue/${key}/changelog?startAt=${histories.length}&maxResults=100`);
        const items = page.values || page.histories || [];
        if (!items.length) throw new Error('دریافت تاریخچه کامل نشد؛ دوباره بازخوانی کنید.');
        histories.push(...items);
        total = Number(page.total ?? total);
      }
      issue.changelog = { startAt: 0, total, histories };
      const comments = [];
      let startAt = 0;
      for (;;) {
        const page = await request(`rest/api/2/issue/${key}/comment?startAt=${startAt}&maxResults=100`);
        const items = page.comments || [];
        comments.push(...items);
        startAt += items.length;
        if (startAt >= Number(page.total || 0)) break;
        if (!items.length) throw new Error('دریافت کامنت‌ها کامل نشد.');
      }
      issue.fields.comment = { comments, total: Number(issue.fields.comment?.total || comments.length) };
      const worklog = issue.fields.worklog;
      if (worklog && (Number(worklog.startAt || 0) > 0 || Number(worklog.total || 0) > (worklog.worklogs || []).length)) {
        const worklogs = []; let offset = 0;
        for (;;) {
          const page = await request(`rest/api/2/issue/${key}/worklog?startAt=${offset}&maxResults=100`);
          const items = page.worklogs || []; worklogs.push(...items); offset += items.length;
          if (offset >= Number(page.total || 0)) break;
          if (!items.length) throw new Error('دریافت ریزکارکرد کامل نشد.');
        }
        issue.fields.worklog = { ...worklog, startAt: 0, total: Number(worklog.total || worklogs.length), worklogs };
      }
    }
    db.prepare('DELETE FROM jira_issue_tombstones WHERE issue_key=?').run(key);
    saveIssue(db, issue, 'jira-live', null, { authoritative: true });
    invalidateSnapshot?.();
    return issue;
  }
  async function unchanged(key, expected) {
    if (!expected) throw new Error('پیش از تغییر، نسخهٔ تازهٔ تسک را دریافت کنید.');
    const current = await request(`rest/api/2/issue/${key}?fields=updated`);
    if (current.fields?.updated !== expected) throw new Error('تسک در Jira تغییر کرده است؛ بازخوانی کنید و تغییرات را دوباره بررسی کنید.');
  }
  function validateFields(fields, metadata, creating = false) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('فیلدها معتبر نیستند.');
    for (const [id, value] of Object.entries(fields)) {
      const meta = metadata[id];
      if (!meta || (!creating && meta.operations && !meta.operations.includes('set'))) throw new Error(`فیلد ${id} قابل ویرایش نیست.`);
      if (meta.required && (value === null || value === '' || Array.isArray(value) && !value.length)) throw new Error(`فیلد ${meta.name} ضروری است.`);
      if (Array.isArray(meta.allowedValues) && value !== null) {
        const values = Array.isArray(value) ? value : [value];
        for (const selected of values) {
          if (!meta.allowedValues.some((option) => String(option.id ?? option.value ?? option.name) === String(selected?.id ?? selected?.value ?? selected?.name ?? selected))) {
            throw new Error(`گزینهٔ فیلد ${meta.name} دیگر معتبر نیست؛ فرم را بازخوانی کنید.`);
          }
        }
        if (value?.child && !meta.allowedValues.some((option) => String(option.id) === String(value.id) && option.children?.some((child) => String(child.id) === String(value.child.id)))) throw new Error(`زیرگزینهٔ فیلد ${meta.name} معتبر نیست.`);
      }
    }
  }
  async function capabilities(key) {
    const [result, user] = await Promise.all([
      request(`rest/api/2/mypermissions?issueKey=${key}&permissions=EDIT_ISSUES,DELETE_ISSUES,ADD_COMMENTS,EDIT_OWN_COMMENTS,EDIT_ALL_COMMENTS,DELETE_OWN_COMMENTS,DELETE_ALL_COMMENTS,LINK_ISSUES,TRANSITION_ISSUES`),
      request('rest/api/2/myself'),
    ]);
    return { permissions: Object.fromEntries(Object.entries(result.permissions || {}).map(([id, permission]) => [id, Boolean(permission.havePermission)])), user: { key: user.key, name: user.name, accountId: user.accountId } };
  }
  function ownsComment(comment, user) {
    return ['key', 'name', 'accountId'].some((id) => user[id] && user[id] === comment.author?.[id]);
  }
  async function refreshed(key, message) {
    try { await readIssue(key); return { ok: true }; }
    catch (error) { return { ok: true, warning: `${message}؛ بازخوانی ناموفق: ${error.message}` }; }
  }
  ipcMain.handle('jira:capabilities', (_event, key) => capabilities(keyOf(key)));
  ipcMain.handle('jira:edit-comment', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key); const id = String(input.commentId || '');
    if (!/^\d+$/.test(id)) throw new Error('شناسهٔ کامنت معتبر نیست.');
    const [current, caps] = await Promise.all([request(`rest/api/2/issue/${key}/comment/${id}`), capabilities(key)]);
    if (!caps.permissions.EDIT_ALL_COMMENTS && !(caps.permissions.EDIT_OWN_COMMENTS && ownsComment(current, caps.user))) throw new Error('مجوز ویرایش این کامنت را ندارید.');
    if (current.updated !== input.expectedUpdated || current.body !== input.expectedBody) throw new Error('کامنت تغییر کرده است؛ بازخوانی کنید.');
    const body = String(input.body || '').trim();
    if (!body) throw new Error('متن کامنت خالی است.');
    await request(`rest/api/2/issue/${key}/comment/${id}`, json('PUT', { body }));
    return refreshed(key, 'کامنت ویرایش شد');
  }));
  ipcMain.handle('jira:delete-comment', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key); const id = String(input.commentId || '');
    if (!/^\d+$/.test(id) || input.confirmation !== `${key}/${id}`) throw new Error('تأیید حذف کامنت معتبر نیست.');
    const [current, caps] = await Promise.all([request(`rest/api/2/issue/${key}/comment/${id}`), capabilities(key)]);
    if (!caps.permissions.DELETE_ALL_COMMENTS && !(caps.permissions.DELETE_OWN_COMMENTS && ownsComment(current, caps.user))) throw new Error('مجوز حذف این کامنت را ندارید.');
    if (current.updated !== input.expectedUpdated || current.body !== input.expectedBody) throw new Error('کامنت تغییر کرده است؛ بازخوانی کنید.');
    await request(`rest/api/2/issue/${key}/comment/${id}`, { method: 'DELETE' });
    return refreshed(key, 'کامنت حذف شد');
  }));
  ipcMain.handle('jira:delete-issue', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key);
    if (input.confirmation !== key) throw new Error('برای تأیید حذف، کلید دقیق تسک لازم است.');
    const caps = await capabilities(key);
    if (!caps.permissions.DELETE_ISSUES) throw new Error('مجوز حذف تسک را ندارید.');
    const issue = await request(`rest/api/2/issue/${key}?fields=*all`);
    if (!input.expectedUpdated || issue.fields.updated !== input.expectedUpdated) throw new Error('تسک تغییر کرده است؛ بازخوانی کنید.');
    if (issue.fields.subtasks?.length) throw new Error('تسک زیرتسک دارد؛ حذف آبشاری انجام نمی‌شود.');
    await request(`rest/api/2/issue/${key}?deleteSubtasks=false`, { method: 'DELETE' });
    db.prepare('INSERT OR REPLACE INTO jira_issue_tombstones(issue_key,jira_id,deleted_at,raw_json) VALUES(?,?,?,?)').run(key, String(issue.id), new Date().toISOString(), JSON.stringify(issue));
    return { ok: true };
  }));
  ipcMain.handle('jira:attachments', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key);
    const meta = await request(`rest/api/2/issue/${key}/editmeta`);
    if (!meta.fields?.attachment) throw new Error('پیوست در فرم این تسک در دسترس نیست.');
    if (!Array.isArray(input.files) || !input.files.length) throw new Error('فایلی انتخاب نشده است.');
    const form = new FormData();
    for (const file of input.files) {
      if (!file.name || !Array.isArray(file.bytes) && !(file.bytes instanceof Uint8Array)) throw new Error('فایل معتبر نیست.');
      form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type || 'application/octet-stream' }), String(file.name).replace(/[\\/]/g, '_'));
    }
    await request(`rest/api/2/issue/${key}/attachments`, { method: 'POST', headers: { 'X-Atlassian-Token': 'no-check' }, body: form });
    return refreshed(key, 'پیوست ارسال شد');
  }));
  ipcMain.handle('jira:live-issue', (_event, value, includeActivity = false) => exclusive(keyOf(value), async () => {
    const key = keyOf(value);
    await readIssue(key, Boolean(includeActivity));
    return getIssueDetails(db, key, Boolean(includeActivity));
  }));
  ipcMain.handle('jira:edit-meta', async (_event, key) => {
    key = keyOf(key);
    const [meta, transitions] = await Promise.all([
      request(`rest/api/2/issue/${key}/editmeta`), request(`rest/api/2/issue/${key}/transitions?expand=transitions.fields`),
    ]);
    cacheMetadata(db, `edit:${key}`, meta);
    return { fields: meta.fields || {}, transitions: transitions.transitions || [] };
  });
  ipcMain.handle('jira:catalog', async (_event, refresh = true) => {
    const warnings = refresh ? await discoverMetadata(db, request) : [];
    return { fields: readMetadata(db, 'field'), projects: readMetadata(db, 'project'), issueTypes: readMetadata(db, 'issuetype'), warnings };
  });
  ipcMain.handle('jira:create-meta', (_event, project) => createMetadata(db, request, project));
  ipcMain.handle('jira:create-issue', (_event, input) => exclusive('create', async () => {
    const project = projectKey(input?.project);
    const entry = await createMetadata(db, request, project, input.issueType);
    const type = entry.issuetypes?.find((item) => String(item.id) === String(input.issueType));
    if (!type) throw new Error('نوع تسک یا دسترسی ایجاد معتبر نیست.');
    const fields = { ...input.fields, project: { id: String(entry.id) }, issuetype: { id: String(type.id) } };
    validateFields(input.fields, type.fields, true);
    for (const [id, field] of Object.entries(type.fields || {})) {
      if (field.required && !field.hasDefaultValue && fields[id] == null) throw new Error(`فیلد ${field.name} ضروری است.`);
    }
    if (type.subtask && !fields.parent?.key) throw new Error('برای زیرتسک، تسک والد را انتخاب کنید.');
    const created = await request('rest/api/2/issue', json('POST', { fields }));
    try { await readIssue(created.key); return { key: created.key }; }
    catch (error) { return { key: created.key, warning: `تسک ایجاد شد، اما بازخوانی کامل نشد: ${error.message}` }; }
  }));
  ipcMain.handle('jira:update-issue', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key);
    const meta = await request(`rest/api/2/issue/${key}/editmeta`);
    validateFields(input.fields, meta.fields || {});
    if (!Object.keys(input.fields).length) throw new Error('تغییری انتخاب نشده است.');
    await unchanged(key, input.expectedUpdated);
    await request(`rest/api/2/issue/${key}`, json('PUT', { fields: input.fields }));
    try { await readIssue(key); return { ok: true }; }
    catch (error) { return { ok: true, warning: `تغییر ذخیره شد؛ بازخوانی ناموفق: ${error.message}` }; }
  }));
  ipcMain.handle('jira:transition', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key);
    const meta = await request(`rest/api/2/issue/${key}/transitions?expand=transitions.fields`);
    const transition = meta.transitions?.find((item) => String(item.id) === String(input.transitionId));
    if (!transition) throw new Error('گذار انتخاب‌شده دیگر مجاز نیست.');
    validateFields(input.fields || {}, transition.fields || {});
    for (const [id, field] of Object.entries(transition.fields || {})) {
      if (field.required && !field.hasDefaultValue && input.fields?.[id] == null) throw new Error(`فیلد ${field.name} برای تغییر وضعیت ضروری است.`);
    }
    await unchanged(key, input.expectedUpdated);
    await request(`rest/api/2/issue/${key}/transitions`, json('POST', { transition: { id: transition.id }, fields: input.fields || {} }));
    try { await readIssue(key); return { ok: true }; }
    catch (error) { return { ok: true, warning: `وضعیت تغییر کرد؛ بازخوانی ناموفق: ${error.message}` }; }
  }));
  ipcMain.handle('jira:add-comment', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key);
    const body = String(input.body || '').trim();
    if (!body) throw new Error('متن کامنت خالی است.');
    const comment = await request(`rest/api/2/issue/${key}/comment`, json('POST', { body }));
    try { await readIssue(key); return { id: comment.id }; }
    catch (error) { return { id: comment.id, warning: `کامنت ثبت شد؛ بازخوانی ناموفق: ${error.message}` }; }
  }));
  ipcMain.handle('jira:user-options', async (_event, input) => {
    const key = input.key ? keyOf(input.key) : '';
    const project = input.project ? projectKey(input.project) : '';
    if (!key && !project) throw new Error('پروژه یا کلید لازم است.');
    const params = new URLSearchParams({ username: String(input.query || ''), maxResults: '50', ...(key ? { issueKey: key } : { project }) });
    return request(`rest/api/2/user/${input.fieldId === 'assignee' ? 'assignable/' : ''}search?${params}`);
  });
  ipcMain.handle('jira:field-options', async (_event, input) => {
    const query = String(input.query || '').slice(0, 200);
    const key = input.key ? keyOf(input.key) : '';
    const project = input.project ? projectKey(input.project) : '';
    let fields;
    if (key) fields = (await request(`rest/api/2/issue/${key}/editmeta`)).fields || {};
    else {
      if (!project || !input.issueType) throw new Error('پروژه و نوع تسک لازم است.');
      const entry = await createMetadata(db, request, project, input.issueType);
      fields = entry.issuetypes?.find((type) => String(type.id) === String(input.issueType))?.fields || {};
    }
    const field = fields[input.fieldId];
    if (!field) throw new Error('این فیلد در فرم جاری موجود نیست.');
    const config = getConfig(db);
    const mappedSemantic = config.fieldMappings?.find((mapping) => mapping.providerFieldId === input.fieldId && (!mapping.projectKey || mapping.projectKey === project) && (!mapping.issueTypeId || mapping.issueTypeId === String(input.issueType || '')))?.semanticKey;
    const isSprintField = mappedSemantic === 'sprint' || /sprint/i.test(field.schema?.custom || '');
    const isEpicField = mappedSemantic === 'epicLink' || /epic-link/i.test(field.schema?.custom || '');
    if (field.autoCompleteUrl && !isEpicField && !isSprintField && input.fieldId !== 'parent') {
      const base = new URL(getConfig(db).jiraUrl.replace(/\/$/, '') + '/');
      const target = new URL(field.autoCompleteUrl, base);
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname + 'rest/')) throw new Error('مسیر انتخابگر Jira معتبر نیست.');
      target.searchParams.set(target.searchParams.has('username') ? 'username' : 'query', query);
      target.searchParams.set('maxResults', '50');
      const resource = target.pathname.slice(base.pathname.length) + target.search;
      const page = await request(resource);
      const items = Array.isArray(page) ? page : page.suggestions || page.values || page.users || (page.sections || []).flatMap((section) => section.issues || []);
      return items.map((item) => typeof item === 'string' ? { value: item, label: item } : { ...item, label: item.displayName || item.name || item.value || item.key || item.label });
    }
    if (isSprintField) {
      const routes = config.boardRoutes || [];
      const options = [];
      for (const route of routes) {
        let startAt = 0;
        for (;;) {
          const page = await request(`rest/agile/1.0/board/${encodeURIComponent(route.boardId)}/sprint?state=active,future&startAt=${startAt}&maxResults=50`);
          const values = page.values || [];
          options.push(...values.map((sprint) => ({ id: String(sprint.id), name: sprint.name, label: `${sprint.name} · ${route.team}`, boardId: route.boardId })));
          startAt += values.length;
          if (page.isLast || Number.isFinite(Number(page.total)) && startAt >= Number(page.total) || !values.length) break;
        }
      }
      return Array.from(new Map(options.filter((item) => !query || item.label.toLowerCase().includes(query.toLowerCase())).map((item) => [item.id, item])).values());
    }
    if (isEpicField || input.fieldId === 'parent') {
      const clauses = [];
      if (isEpicField) clauses.push('issuetype = Epic');
      if (input.fieldId === 'parent' && project) clauses.push(`project = "${project}"`);
      if (query) {
        const escaped = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        clauses.push(/^[A-Z][A-Z0-9_]*-\d+$/i.test(query) ? `key = "${query.toUpperCase()}"` : `summary ~ "${escaped}"`);
      }
      const params = new URLSearchParams({ jql: clauses.join(' AND ') + ' ORDER BY updated DESC', fields: 'summary,issuetype', maxResults: '50' });
      const page = await request(`rest/api/2/search?${params}`);
      return (page.issues || []).map((issue) => ({ key: issue.key, label: `${issue.key} · ${issue.fields.summary}` }));
    }
    return field.allowedValues || [];
  });
  ipcMain.handle('jira:link-types', () => request('rest/api/2/issueLinkType'));
  ipcMain.handle('jira:link-issue', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key); const target = keyOf(input.target);
    if (key === target) throw new Error('تسک را به خودش لینک نکنید.');
    const types = await request('rest/api/2/issueLinkType');
    const type = types.issueLinkTypes?.find((item) => String(item.id) === String(input.typeId));
    if (!type) throw new Error('نوع ارتباط معتبر نیست.');
    const issue = await request(`rest/api/2/issue/${key}?fields=issuelinks`);
    if (!(issue.fields.issuelinks || []).some((link) => String(link.type?.id) === String(type.id) && link.outwardIssue?.key === target)) {
      await request('rest/api/2/issueLink', json('POST', { type: { name: type.name }, inwardIssue: { key }, outwardIssue: { key: target } }));
    }
    try { await readIssue(key); await readIssue(target); return { ok: true }; }
    catch (error) { return { ok: true, warning: `ارتباط در Jira ثبت شد؛ بازخوانی ناموفق: ${error.message}` }; }
  }));
  // Product artifacts remain local, but their association is visible as a Jira comment.
  ipcMain.handle('jira:link-records', (_event, input) => exclusive(keyOf(input?.key), async () => {
    const key = keyOf(input.key);
    await request(`rest/api/2/issue/${key}?fields=project`);
    const ids = [...new Set(input.recordIds || [])];
    const records = ids.map((id) => db.prepare('SELECT * FROM product_records WHERE id=? AND archived_at IS NULL').get(String(id)));
    if (records.some((record) => !record || !['decision', 'meeting', 'outcome', 'request', 'action'].includes(record.kind))) throw new Error('ثبت مرتبط معتبر نیست.');
    const fresh = records.filter((record) => {
      const payload = JSON.parse(record.payload_json);
      return !(payload.relatedIssueKeys || payload.linkedIssueKeys || []).includes(key);
    });
    if (!fresh.length) return { ok: true };
    await request(`rest/api/2/issue/${key}/comment`, json('POST', { body: `ارتباطات Axiloom:\n${fresh.map((record) => `${record.kind} | ${record.title} | ${record.id}`).join('\n')}` }));
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of fresh) {
        const before = JSON.parse(record.payload_json);
        const after = { ...before, relatedIssueKeys: [...new Set([...(before.relatedIssueKeys || before.linkedIssueKeys || []), key])] };
        const now = new Date().toISOString();
        db.prepare('UPDATE product_records SET payload_json=?,updated_at=? WHERE id=?').run(JSON.stringify(after), now, record.id);
        db.prepare('INSERT INTO record_events(record_id,event_type,occurred_at,payload_json) VALUES(?,?,?,?)').run(record.id, 'linked', now, JSON.stringify({ before, after, jiraKey: key }));
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { ok: true };
  }));
}
module.exports = { registerJiraManagement };
