import { useEffect, useState } from 'react';
import type { AppConfig, IssueDetails, ProductRecord, Snapshot } from '../types';
import JiraIssueEditor from './JiraIssueEditor';
import { DataTable, IssueKey, MultiSelect, formatDate, formatNumber } from './Primitives';
import { serializeAttachmentSelection } from '../jira-attachments';

export default function JiraManagement({ details, snapshot, config, live, reload, refresh, openIssue, notify, deleted }: {
  details: IssueDetails; snapshot: Snapshot; config: AppConfig | null; live: boolean; reload: () => Promise<void>; refresh: () => Promise<void>; openIssue: (key: string) => void; notify: (message: string) => void; deleted: () => void;
}) {
  const [editor, setEditor] = useState<any>(null); const [transitions, setTransitions] = useState<any[]>([]);
  const [body, setBody] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState(''); const [types, setTypes] = useState<any[]>([]); const [typeId, setTypeId] = useState('');
  const [caps, setCaps] = useState<{ permissions: Record<string, boolean>; user: Record<string, any> } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ comment?: any } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [editingComment, setEditingComment] = useState<any>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [recordIds, setRecordIds] = useState<string[]>([]);
  const [recordOptions, setRecordOptions] = useState<ProductRecord[]>([]);
  const [recordOptionQuery, setRecordOptionQuery] = useState('');
  const [recordLinkUnknown, setRecordLinkUnknown] = useState(false);
  const [related, setRelated] = useState<ProductRecord[]>([]);
  const fields = details.raw.fields || {};
  const comments = fields.comment?.comments || [];
  useEffect(() => {
    let active = true;
    window.axiloom.listRecords({ kinds: ['objective', 'decision', 'meeting', 'outcome', 'action', 'request'], query: recordOptionQuery, limit: 100, includeHistory: false })
      .then((result) => { if (active) setRecordOptions(result.items); })
      .catch(() => { if (active) setRecordOptions([]); });
    return () => { active = false; };
  }, [recordOptionQuery, snapshot]);
  useEffect(() => {
    let active = true;
    window.axiloom.listRecords({ relatedIssueKey: details.key, limit: 250, includeHistory: false })
      .then((result) => { if (active) setRelated(result.items); })
      .catch(() => { if (active) setRelated([]); });
    return () => { active = false; };
  }, [details.key, snapshot]);
  useEffect(() => {
    let active = true;
    setCaps(null);
    if (live) window.axiloom.getJiraCapabilities(details.key).then((value) => { if (active) setCaps(value); }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [live, details.key, details.raw.fields?.updated]);
  const canComment = (comment: any, action: 'EDIT' | 'DELETE') => caps && (caps.permissions[`${action}_ALL_COMMENTS`] || caps.permissions[`${action}_OWN_COMMENTS`] && ['key', 'name', 'accountId'].some((id) => caps.user[id] && caps.user[id] === comment.author?.[id]));
  async function removeIssue() {
    const confirmation = deleteConfirmation;
    if (confirmation !== details.key) return;
    setBusy(true); setError('');
    try { await window.axiloom.deleteJiraIssue({ key: details.key, expectedUpdated: fields.updated, confirmation }); deleted(); notify(`${details.key} از Jira حذف شد؛ نسخهٔ محلی فقط برای سابقه نگهداری می‌شود.`); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'حذف انجام نشد.'); }
    finally { setBusy(false); }
  }
  async function perform(work: () => Promise<any>, success: string, reread = true) {
    setBusy(true); setError('');
    try { const result = await work(); notify(result?.warning || success); if (reread) await reload(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'عملیات انجام نشد.'); }
    finally { setBusy(false); }
  }
  async function linkSelectedRecords() {
    setBusy(true); setError(''); setRecordLinkUnknown(false);
    try {
      const result = await window.axiloom.linkJiraRecords({ key: details.key, recordIds });
      notify(result?.warning || 'پیوندهای ثبت محصول ذخیره شدند.'); await reload(); await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'عملیات انجام نشد.';
      setError(message);
      if (/outcome is unknown|outcome is still unknown/i.test(message)) setRecordLinkUnknown(true);
    } finally { setBusy(false); }
  }
  async function confirmRecordLinkRetry() {
    const confirmation = window.prompt('Check Jira for this exact Axiloom reference marker. Type the sentence below only if no matching marker exists.\n\nI checked Jira and no matching Axiloom reference exists');
    if (confirmation !== 'I checked Jira and no matching Axiloom reference exists') return;
    try {
      await window.axiloom.confirmJiraRecordLinkRetry({ key: details.key, recordIds, confirmation });
      setRecordLinkUnknown(false); setError('Retry enabled after your Jira check. The next attempt will reconcile the marker again before sending.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Retry confirmation failed.'); }
  }
  return <section className="issue-detail-section"><h3>مدیریت تسک واقعی Jira</h3>
    <div className="jira-management-actions"><button className="button secondary" disabled={busy} onClick={() => perform(reload, 'نسخهٔ تازهٔ Jira دریافت شد.', false)}>بازخوانی از Jira</button>
      <button className="button primary" disabled={busy || !live || !caps?.permissions.EDIT_ISSUES} onClick={() => setEditor({})}>ویرایش فیلدها</button>
      <button className="button secondary" disabled={busy || !live} onClick={() => perform(async () => { const meta = await window.axiloom.getEditMeta(details.key); setTransitions(meta.transitions); }, 'گذارهای مجاز دریافت شدند.', false)}>دریافت وضعیت‌های مجاز</button><button className="button secondary" disabled={busy || !live || !caps?.permissions.DELETE_ISSUES} onClick={() => { setDeleteTarget({}); setDeleteConfirmation(''); }}>حذف دائمی تسک</button></div>
    {!live && <p className="muted-copy">نمایش نسخهٔ محلی؛ برای ویرایش و تغییر وضعیت، ابتدا از Jira بازخوانی کنید.</p>}
    {transitions.length > 0 && <div className="jira-management-actions">{transitions.map((item) => <button key={item.id} className="button secondary" disabled={busy || !live} onClick={() => setEditor({ transition: item })}>{item.name} → {item.to?.name}</button>)}</div>}
    <h3>توضیحات</h3><pre className="jira-description">{typeof fields.description === 'object' ? JSON.stringify(fields.description, null, 2) : fields.description || 'توضیحی ثبت نشده است.'}</pre>
    <h3>کامنت‌ها · {formatNumber(comments.length, 0)} از {formatNumber(Number(fields.comment?.total || comments.length), 0)}</h3>
    <DataTable headers={['نویسنده', 'تاریخ', 'متن', 'عملیات']} rows={comments.map((comment: any) => [comment.author?.displayName || comment.author?.name || '—', formatDate(comment.created), <pre className="jira-description">{typeof comment.body === 'object' ? JSON.stringify(comment.body, null, 2) : comment.body}</pre>, <span className="row-actions">{typeof comment.body === 'string' && canComment(comment, 'EDIT') && <button className="button tiny secondary" disabled={busy || !live} onClick={() => { setEditingComment(comment); setCommentDraft(comment.body); }}>ویرایش</button>}{canComment(comment, 'DELETE') && <button className="button tiny secondary" disabled={busy || !live} onClick={() => { setDeleteTarget({ comment }); setDeleteConfirmation(''); }}>حذف</button>}</span>])} />
    {editingComment && <div className="change-review"><h3>ویرایش کامنت {editingComment.id}</h3><pre className="jira-description">متن قبلی: {editingComment.body}</pre><textarea aria-label="متن جدید کامنت" rows={4} value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} /><button className="button secondary" disabled={busy} onClick={() => setEditingComment(null)}>انصراف</button><button className="button primary" disabled={busy || !commentDraft.trim()} onClick={() => {
      if (!window.confirm(`متن کامنت ${editingComment.id} به متن زیر تغییر کند؟\n${commentDraft}`)) return;
      void perform(async () => { const result = await window.axiloom.editJiraComment({ key: details.key, commentId: String(editingComment.id), expectedUpdated: editingComment.updated, expectedBody: editingComment.body, body: commentDraft }); setEditingComment(null); return result; }, 'کامنت ویرایش شد.');
    }}>تأیید و ذخیرهٔ کامنت</button></div>}
    <label className="form-field">کامنت جدید<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} /></label><button className="button primary" disabled={busy || !body.trim() || !live || !caps?.permissions.ADD_COMMENTS} onClick={() => {
      if (!window.confirm(`کامنت زیر برای ${details.key} در Jira ثبت شود؟\n${body}`)) return;
      void perform(async () => { const result = await window.axiloom.addJiraComment({ key: details.key, body }); setBody(''); return result; }, 'کامنت در Jira ثبت شد.');
    }}>ثبت کامنت در Jira</button>
    <h3>پیوست‌ها</h3><DataTable headers={['نام فایل', 'اندازه (بایت)', 'ایجاد', 'نوع']} rows={(fields.attachment || []).map((file: any) => [file.filename, file.size, formatDate(file.created), file.mimeType])} />
    <label className="form-field">افزودن پیوست<input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} /></label><button className="button secondary" disabled={busy || !live || !files.length} onClick={() => {
      if (!window.confirm(`فایل‌های ${files.map((file) => file.name).join('، ')} به ${details.key} ارسال شوند؟`)) return;
      void perform(async () => { const result = await window.axiloom.uploadJiraAttachments({ key: details.key, files: await serializeAttachmentSelection(files) }); setFiles([]); return result; }, 'پیوست‌ها ارسال شدند.');
    }}>ارسال پیوست</button>
    <h3>ایجاد ارتباط در Jira</h3><p>نوع ارتباط و تسک مقصد را بررسی کنید. ارتباط در هر دو تسک Jira قابل مشاهده است.</p>
    <div className="issue-link-form"><label>کلید مقصد<input value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} placeholder="PROJECT-123" /></label>
      <button className="button secondary" disabled={busy} onClick={() => perform(async () => { const result = await window.axiloom.getJiraLinkTypes(); setTypes(result.issueLinkTypes); }, 'انواع ارتباط دریافت شد.', false)}>دریافت انواع ارتباط</button>
      <label>نوع ارتباط<select value={typeId} onChange={(e) => setTypeId(e.target.value)}><option value="">انتخاب کنید</option>{types.map((type) => <option key={type.id} value={type.id}>{type.outward || type.name}</option>)}</select></label>
      <button className="button primary" disabled={busy || !typeId || !target} onClick={() => { if (window.confirm(`ارتباط ${details.key} ← ${types.find((type) => type.id === typeId)?.outward} ← ${target} در Jira ثبت شود؟`)) void perform(() => window.axiloom.linkJiraIssue({ key: details.key, target, typeId }), 'ارتباط در Jira ثبت شد.'); }}>ثبت ارتباط</button></div>
    <><h3>پیوند ثبت‌های محصول</h3><p>ثبت‌های انتخاب‌شده به این issue متصل می‌شوند؛ Axiloom این ارتباط را در فضای محلی ثبت می‌کند و جزئیات آن را در قالب کامنت به Jira می‌فرستد.</p>
      <label className="form-field">جست‌وجوی ثبت محصولی<input value={recordOptionQuery} onChange={(event) => setRecordOptionQuery(event.target.value)} placeholder="عنوان یا جزئیات ثبت را بنویسید" /></label>
      <MultiSelect label="ثبت‌های مرتبط" value={recordIds} showSelectionChips options={recordOptions.map((record) => ({ value: record.id, label: `${({ objective: 'هدف', decision: 'تصمیم', meeting: 'جلسه', outcome: 'خروجی', request: 'درخواست', action: 'تعهد' } as Record<string, string>)[record.kind]} · ${record.title}` }))} onChange={setRecordIds} />
      <button className="button primary" disabled={busy || !recordIds.length} onClick={() => { if (window.confirm('ارتباط این ثبت‌ها با issue و کامنت متناظر در Jira ثبت شود؟')) void linkSelectedRecords(); }}>ثبت ارتباطات انتخاب‌شده</button>
      {recordLinkUnknown && <button className="button secondary" disabled={busy} onClick={() => void confirmRecordLinkRetry()}>I checked Jira; allow a new link attempt</button>}</>
    {related.length > 0 && <DataTable headers={['نوع', 'عنوان', 'شناسه', 'تعهد مرتبط']} rows={related.map((record) => [record.kind, record.title, record.id, <IssueKey value={details.key} onOpen={openIssue} />])} />}
    {deleteTarget && <div className="modal-backdrop jira-editor-backdrop"><section className="record-modal" role="dialog" aria-modal="true" aria-label="تأیید حذف دائمی"><h2>{deleteTarget.comment ? `حذف کامنت ${deleteTarget.comment.id}` : `حذف تسک ${details.key}`}</h2><p>این عملیات اطلاعات را از Jira حذف می‌کند و قابل بازگشت از این برنامه نیست.</p>{deleteTarget.comment && <pre className="jira-description">{typeof deleteTarget.comment.body === 'string' ? deleteTarget.comment.body : JSON.stringify(deleteTarget.comment.body)}</pre>}<label className="form-field">برای تأیید، عبارت <b dir="ltr">{deleteTarget.comment ? `${details.key}/${deleteTarget.comment.id}` : details.key}</b> را وارد کنید.<input autoFocus dir="ltr" value={deleteConfirmation} disabled={busy} onChange={(e) => setDeleteConfirmation(e.target.value)} /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>انصراف</button><button className="button primary" disabled={busy || deleteConfirmation !== (deleteTarget.comment ? `${details.key}/${deleteTarget.comment.id}` : details.key)} onClick={() => {
      if (!deleteTarget.comment) { void removeIssue(); return; }
      const comment = deleteTarget.comment;
      void perform(async () => {
        const result = await window.axiloom.deleteJiraComment({ key: details.key, commentId: String(comment.id), expectedUpdated: comment.updated, expectedBody: comment.body, confirmation: deleteConfirmation });
        setDeleteTarget(null); setDeleteConfirmation(''); return result;
      }, 'کامنت حذف شد.');
    }}>{busy ? 'در حال حذف…' : 'تأیید حذف دائمی'}</button></div></section></div>}
    {error && <p className="form-error">{error}</p>}
    {editor && <JiraIssueEditor issueKey={details.key} current={fields} expectedUpdated={fields.updated} transition={editor.transition} config={config} close={() => setEditor(null)} saved={async (_key, warning) => { notify(warning || 'تغییرات در Jira ثبت شد.'); await reload(); await refresh(); }} />}
  </section>;
}
