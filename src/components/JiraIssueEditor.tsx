import { useEffect, useState } from 'react';
import type { AppConfig, JiraFieldMeta } from '../types';
import JiraFields, { describeJiraValue, validateJiraValues } from './JiraFields';

export default function JiraIssueEditor({ issueKey, project: initialProject, current = {}, expectedUpdated = '', transition, config, close, saved }: {
  issueKey?: string; project?: string; current?: Record<string, any>; expectedUpdated?: string; transition?: any;
  config?: AppConfig | null;
  close: () => void; saved: (key: string, warning?: string) => Promise<void>;
}) {
  const [project, setProject] = useState(initialProject || '');
  const [projects, setProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [comment, setComment] = useState('');
  const [metadata, setMetadata] = useState<Record<string, JiraFieldMeta>>({});
  const [types, setTypes] = useState<any[]>([]); const [type, setType] = useState('');
  const [values, setValues] = useState<Record<string, any>>(current); const [changed, setChanged] = useState<Record<string, any>>({});
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [review, setReview] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (!issueKey && !transition) { setTypes([]); setType(''); setMetadata({}); setValues({}); setChanged({}); setFiles([]); setComment(''); }
    (async () => {
      try {
        if (transition) { if (active) { setMetadata(transition.fields || {}); setValues({}); setChanged({}); } }
        else if (issueKey) { const meta = await window.axiloom.getEditMeta(issueKey); if (active) setMetadata(meta.fields); }
        else if (project) { const meta = await window.axiloom.getCreateMeta(project); if (active) { setTypes(meta.issuetypes); setType(''); setMetadata({}); setValues({}); setChanged({}); } }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'متادیتا دریافت نشد.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [issueKey, project, transition]);
  useEffect(() => {
    if (issueKey || initialProject) return;
    let active = true;
    window.axiloom.getJiraCatalog(true).then((catalog) => {
      if (!active) return;
      setProjects(catalog.projects?.value || []);
      if (catalog.warnings.length) setError(catalog.warnings.join('؛ '));
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [issueKey, initialProject]);
  function chooseType(id: string) {
    if ((Object.keys(changed).length || files.length || comment) && !window.confirm('با تغییر نوع تسک، مقادیر فرم پاک می‌شوند. ادامه می‌دهید؟')) return;
    setType(id); const fields = types.find((item) => item.id === id)?.fields || {}; setMetadata(fields);
    const defaults = Object.fromEntries(Object.entries(fields as Record<string, JiraFieldMeta>).filter(([key, meta]) => !['project', 'issuetype', 'comment', 'attachment', 'issuelinks'].includes(key) && meta.defaultValue !== undefined).map(([key, meta]) => [key, meta.defaultValue]));
    setFiles([]); setComment('');
    setValues(defaults); setChanged(defaults); setReview(false);
  }
  function cancel() { if (!busy && (!Object.keys(changed).length && !files.length && !comment || window.confirm('تغییرات ذخیره نشده کنار گذاشته شود؟'))) close(); }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!busy && (!Object.keys(changed).length && !files.length && !comment || window.confirm('تغییرات ذخیره نشده کنار گذاشته شود؟'))) close();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [busy, changed, close, files, comment]);
  async function submit() {
    setError('');
    const payload = issueKey && !transition ? changed : values;
    const validation = validateJiraValues(metadata, payload, !issueKey || Boolean(transition));
    if (validation) { setError(validation); return; }
    if (!issueKey && !type) { setError('نوع تسک را انتخاب کنید.'); return; }
    if (issueKey && !transition && !Object.keys(changed).length) { setError('تغییری وجود ندارد.'); return; }
    if (!review) { setReview(true); return; }
    setBusy(true);
    try {
      let key = issueKey || ''; let warning: string | undefined;
      if (transition) { const result = await window.axiloom.transitionJiraIssue({ key, transitionId: transition.id, expectedUpdated, fields: changed }); warning = result.warning; }
      else if (issueKey) { const result = await window.axiloom.updateJiraIssue({ key, expectedUpdated, fields: changed }); warning = result.warning; }
      else {
        const result = await window.axiloom.createJiraIssue({ project, issueType: type, fields: values }); key = result.key; warning = result.warning;
        const warnings = warning ? [warning] : [];
        if (comment.trim()) {
          try { const response = await window.axiloom.addJiraComment({ key, body: comment }); if (response.warning) warnings.push(response.warning); }
          catch (e) { warnings.push(`تسک ${key} ایجاد شد؛ ثبت کامنت کامل نشد: ${e instanceof Error ? e.message : ''}`); }
        }
        if (files.length) {
          try { const response = await window.axiloom.uploadJiraAttachments({ key, files: await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }))) }); if (response.warning) warnings.push(response.warning); }
          catch (e) { warnings.push(`تسک ${key} ایجاد شد؛ ارسال پیوست کامل نشد: ${e instanceof Error ? e.message : ''}`); }
        }
        warning = warnings.join('؛ ') || undefined;
      }
      // Mutation succeeded: close before refresh so a refresh error cannot cause resubmission.
      close(); await saved(key, warning);
    } catch (e) { setError(e instanceof Error ? e.message : 'عملیات ذخیره نشد.'); setReview(false); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop jira-editor-backdrop"><section className="record-modal" role="dialog" aria-modal="true" aria-label="فرم Jira"><div className="modal-heading"><h2>{transition ? `تغییر وضعیت به ${transition.to?.name || transition.name}` : issueKey ? `ویرایش ${issueKey}` : `ایجاد تسک در ${project}`}</h2><button className="button secondary" disabled={busy} onClick={cancel}>بستن</button></div>
    {!issueKey && !initialProject && <label className="form-field">پروژه<select value={project} disabled={busy || review} onChange={(e) => { if (!Object.keys(changed).length && !files.length && !comment || window.confirm('با تغییر پروژه، مقادیر فرم پاک می‌شوند. ادامه می‌دهید؟')) setProject(e.target.value); }}><option value="">انتخاب پروژهٔ قابل دسترس</option>{projects.map((item) => <option key={item.key} value={item.key}>{item.key} · {item.name}</option>)}</select></label>}
    {loading ? <p>دریافت فیلدها و دسترسی‌های واقعی Jira…</p> : <>
      {!issueKey && <label className="form-field">نوع تسک<select value={type} onChange={(e) => chooseType(e.target.value)}><option value="">انتخاب کنید</option>{types.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
      {!review ? <><JiraFields metadata={metadata} values={values} issueKey={issueKey} project={project} issueType={type} config={config} onChange={(id, value) => { setValues((v) => ({ ...v, [id]: value })); setChanged((v) => ({ ...v, [id]: value })); }} />{!issueKey && type && <>{metadata.comment && <label className="form-field">کامنت اولیه<textarea value={comment} onChange={(e) => setComment(e.target.value)} /></label>}{metadata.attachment && <label className="form-field">پیوست‌های اولیه<input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label>}</>}</> : <div className="change-review"><h3>مرور پیش از ارسال به Jira</h3>{!issueKey && <p>پروژه: {project} · نوع: {types.find((item) => item.id === type)?.name}</p>}{comment && <p>کامنت اولیه: {comment}</p>}{files.length > 0 && <p>پیوست‌ها: {files.map((file) => file.name).join('، ')}</p>}{Object.entries(changed).map(([id, value]) => <p key={id}><b>{metadata[id]?.name || id}</b>{issueKey && <del>{describeJiraValue(current[id])}</del>}<span>{describeJiraValue(Array.isArray(value) ? value.map((item) => metadata[id]?.allowedValues?.find((option) => option.id != null && String(option.id) === String(item?.id)) || item) : metadata[id]?.allowedValues?.find((option) => option.id != null && String(option.id) === String(value?.id)) || value)}</span></p>)}{transition && <p>وضعیت: {current.status?.name} ← {transition.to?.name || transition.name}</p>}<p>پس از تأیید، این تغییرات روی Jira اعمال می‌شوند.</p></div>}
      {error && <p className="form-error">{error}</p>}<div className="modal-actions">{review && <button className="button secondary" disabled={busy} onClick={() => setReview(false)}>بازگشت به ویرایش</button>}<button className="button primary" disabled={busy || loading || !issueKey && !type} onClick={submit}>{busy ? 'در حال ارسال…' : review ? 'تأیید و ارسال به Jira' : 'مرور تغییرات'}</button></div>
    </>}
  </section></div>;
}
