import { useEffect, useState, type FormEvent } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';
import type { ProductRecord, RecordKind } from '../types';
import { formatDate } from './Primitives';

interface FieldSpec { key: string; label: string; type?: 'select' | 'textarea' | 'date'; options?: string[]; hint?: string; required?: boolean }

const SPECS: Record<RecordKind, FieldSpec[]> = {
  objective: [
    { key: 'ownerName', label: 'Objective owner' }, { key: 'startAt', label: 'Start date', type: 'date' },
    { key: 'dueAt', label: 'Target date', type: 'date' }, { key: 'status', label: 'Status', type: 'select', options: ['Proposed', 'Active', 'On Hold', 'Complete', 'Cancelled'] },
    { key: 'strategicTheme', label: 'Strategic theme' }, { key: 'expectedImpact', label: 'Expected impact', type: 'textarea' },
    { key: 'rationale', label: 'Rationale and context', type: 'textarea' }, { key: 'primaryIssueKey', label: 'Primary Jira issue' },
    { key: 'relatedIssueKeysText', label: 'Related Jira issues' }, { key: 'evidence', label: 'Evidence or reference', type: 'textarea' },
  ],
  action: [
    { key: 'ownerName', label: 'مالک پیگیری' }, { key: 'ownerKey', label: 'شناسهٔ مالک' }, { key: 'dueAt', label: 'موعد', type: 'date' },
    { key: 'followupAt', label: 'پیگیری بعدی', type: 'date' }, { key: 'status', label: 'وضعیت', type: 'select', options: ['Open', 'In Progress', 'Waiting', 'Done', 'Closed'] },
    { key: 'priority', label: 'اهمیت', type: 'select', options: ['عادی', 'بالا', 'فوری'] }, { key: 'requester', label: 'درخواست‌دهنده' },
    { key: 'expectedOutput', label: 'خروجی مورد انتظار', type: 'textarea' }, { key: 'dependency', label: 'وابستگی / منتظر چه کسی هستیم؟', type: 'textarea' },
    { key: 'primaryIssueKey', label: 'Issue اصلی مرتبط', hint: 'کلید Jira را صریح وارد کنید؛ ارتباط خودکار ساخته نمی‌شود.' },
    { key: 'relatedIssueKeysText', label: 'Issueهای مرتبط', hint: 'کلیدهای Jira را با کاما جدا کنید.' },
    { key: 'objectiveId', label: 'Objective', type: 'select' },
    { key: 'meetingId', label: 'شناسهٔ جلسه' }, { key: 'decisionId', label: 'شناسهٔ تصمیم' }, { key: 'evidence', label: 'مدرک / لینک' },
    { key: 'sourceText', label: 'متن منبع خام', type: 'textarea' }, { key: 'notes', label: 'یادداشت پیگیری', type: 'textarea' },
  ],
  request: [
    { key: 'requester', label: 'درخواست‌دهنده' }, { key: 'department', label: 'واحد / تیم' }, { key: 'ownerName', label: 'مالک محصول' }, { key: 'objectiveId', label: 'Objective', type: 'select' },
    { key: 'status', label: 'وضعیت', type: 'select', options: ['Backlog', 'In Analysis', 'Waiting for Reply', 'Ready to Plan', 'In Delivery', 'Done', 'Rejected'] },
    { key: 'priority', label: 'اولویت', type: 'select', options: ['عادی', 'بالا', 'فوری'] }, { key: 'dueAt', label: 'موعد مورد انتظار', type: 'date' },
    { key: 'expectedOutput', label: 'خروجی مورد نیاز', type: 'textarea' }, { key: 'waitingFor', label: 'در انتظار پاسخ از', hint: 'تأخیر انتظار خودکار به مالک محصول نسبت داده نمی‌شود.' },
    { key: 'externalReference', label: 'شناسه / لینک مرجع بیرونی' },
    { key: 'primaryIssueKey', label: 'Issue اصلی مرتبط' }, { key: 'relatedIssueKeysText', label: 'Issueهای مرتبط', hint: 'کلیدهای Jira را صریح وارد کنید و با کاما جدا کنید.' },
    { key: 'evidence', label: 'مدرک / منبع', type: 'textarea' }, { key: 'notes', label: 'توضیحات و تاریخچهٔ پیگیری', type: 'textarea' },
  ],
  decision: [
    { key: 'decisionDate', label: 'تاریخ تصمیم', type: 'date', required: true }, { key: 'decisionMaker', label: 'تصمیم‌گیر' },
    { key: 'status', label: 'وضعیت', type: 'select', options: ['Active', 'Implemented', 'Superseded'] },
    { key: 'outcome', label: 'تصمیم / خروجی مصوب', type: 'textarea', required: true }, { key: 'rationale', label: 'دلیل و زمینه', type: 'textarea' },
    { key: 'primaryIssueKey', label: 'Issue اصلی مرتبط' }, { key: 'relatedIssueKeysText', label: 'Issueهای مرتبط' }, { key: 'objectiveId', label: 'Objective', type: 'select' }, { key: 'meetingId', label: 'شناسهٔ جلسه' }, { key: 'actionId', label: 'Action مسئول اجرا' },
    { key: 'evidence', label: 'مدرک / توضیح', type: 'textarea' }, { key: 'supersededBy', label: 'جایگزین Decision ID' },
  ],
  meeting: [
    { key: 'startAt', label: 'زمان شروع', type: 'date' }, { key: 'endAt', label: 'زمان پایان', type: 'date' },
    { key: 'meetingType', label: 'نوع جلسه', type: 'select', options: ['Meeting', 'Triage', 'Review', 'Committee', '1:1 / Other'] },
    { key: 'participants', label: 'شرکت‌کنندگان', type: 'textarea' }, { key: 'location', label: 'مکان / بستر' }, { key: 'objectiveId', label: 'Objective', type: 'select' },
    { key: 'relatedIssueKeysText', label: 'Issueهای مرتبط در Jira' },
    { key: 'evidence', label: 'مدرک / یادداشت جلسه', type: 'textarea' }, { key: 'calendarUid', label: 'شناسهٔ ICS' },
  ],
  outcome: [
    { key: 'primaryIssueKey', label: 'Issue اصلی مرتبط' }, { key: 'relatedIssueKeysText', label: 'Issueهای مرتبط در Jira' }, { key: 'objectiveId', label: 'Objective', type: 'select' }, { key: 'hypothesis', label: 'Outcome / فرضیه', type: 'textarea', required: true },
    { key: 'metric', label: 'سنجه' }, { key: 'unit', label: 'واحد' }, { key: 'baseline', label: 'Baseline' }, { key: 'target', label: 'Target' }, { key: 'actual', label: 'Actual' },
    { key: 'ownerName', label: 'مالک Outcome' }, { key: 'reviewDate', label: 'تاریخ بازبینی', type: 'date' },
    { key: 'status', label: 'وضعیت', type: 'select', options: ['Unknown', 'In Progress', 'Achieved', 'Not Achieved'] },
    { key: 'confidence', label: 'اطمینان', type: 'select', options: ['نامعلوم', 'کم', 'متوسط', 'زیاد'] },
    { key: 'evidence', label: 'مدرک', type: 'textarea' }, { key: 'notes', label: 'یادداشت / تصمیم بعدی', type: 'textarea' },
  ],
  stakeholder: [
    { key: 'name', label: 'نام ذی‌نفع', required: true }, { key: 'department', label: 'واحد / تیم' }, { key: 'role', label: 'نقش' },
    { key: 'ownerName', label: 'مسئول ارتباط' }, { key: 'contact', label: 'راه ارتباطی' }, { key: 'externalReference', label: 'شناسه / لینک مرجع بیرونی' },
    { key: 'notes', label: 'یادداشت' , type: 'textarea' },
  ],
};

const TITLES: Record<RecordKind, string> = { objective: 'هدف محصول', action: 'تعهد و پیگیری', request: 'درخواست محصول', decision: 'تصمیم مدیریتی', meeting: 'جلسه', outcome: 'Outcome', stakeholder: 'ذی‌نفع' };

function localInputValue(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function storedValue(field: FieldSpec, value: unknown) {
  if (field.type !== 'date' || !value) return String(value ?? '');
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : String(value);
}

export default function RecordEditor({ kind, record, jiraUrl, close, save, meetingOptions = [], decisionOptions = [], actionOptions = [], objectiveOptions = [] }: {
  kind: RecordKind;
  record?: ProductRecord;
  jiraUrl: string;
  close: () => void;
  save: (kind: RecordKind, title: string, payload: Record<string, unknown>, id?: string) => Promise<void>;
  meetingOptions?: Array<{ id: string; title: string }>;
  decisionOptions?: Array<{ id: string; title: string }>;
  actionOptions?: Array<{ id: string; title: string }>;
  objectiveOptions?: Array<{ id: string; title: string }>;
}) {
  const fields = SPECS[kind];
  const [title, setTitle] = useState(record?.title || '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const source = record?.payload || {};
    const initial: Record<string, string> = {};
    fields.forEach((field) => {
      const value = source[field.key];
      if (field.key.endsWith('KeysText')) {
        const existing = Array.isArray(source.relatedIssueKeys) ? source.relatedIssueKeys
          : [...(Array.isArray(source.linkedIssueKeys) ? source.linkedIssueKeys as string[] : []), ...(Array.isArray(source.businessIssueKeys) ? source.businessIssueKeys as string[] : []), ...(Array.isArray(source.technicalIssueKeys) ? source.technicalIssueKeys as string[] : [])];
        initial[field.key] = Array.from(new Set(existing.map(String))).join(', ');
      } else initial[field.key] = field.type === 'date' ? localInputValue(value) : String(value ?? '');
    });
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const optionsByField: Record<string, Array<{ id: string; title: string }>> = { meetingId: meetingOptions, decisionId: decisionOptions, actionId: actionOptions, objectiveId: objectiveOptions };
  const jiraKeys = Array.from(new Set([
    record?.payload.primaryIssueKey,
    ...(Array.isArray(record?.payload.relatedIssueKeys) ? record.payload.relatedIssueKeys : []),
    record?.payload.businessEpicKey,
    record?.payload.businessIssueKey,
    ...(Array.isArray(record?.payload.businessIssueKeys) ? record.payload.businessIssueKeys : []),
    ...(Array.isArray(record?.payload.technicalIssueKeys) ? record.payload.technicalIssueKeys : []),
    ...(Array.isArray(record?.payload.linkedIssueKeys) ? record.payload.linkedIssueKeys : []),
  ].map((value) => String(value || '').trim().toUpperCase()).filter((value) => /^[A-Z][A-Z0-9_]*-\d+$/.test(value))));

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) close(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [saving, close]);

  function update(key: string, value: string) { setValues((current) => ({ ...current, [key]: value })); }

  async function openInJira(issueKey: string) {
    setError('');
    try { await window.axiloom.openJiraIssue(issueKey); }
    catch (openError) { setError(openError instanceof Error ? openError.message : `بازکردن ${issueKey} در Jira ناموفق بود.`); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const missing = fields.find((field) => field.required && !values[field.key]?.trim());
    if (!title.trim() && !values.hypothesis && !values.name) { setError('عنوان را وارد کنید.'); return; }
    if (missing) { setError(`فیلد «${missing.label}» ضروری است.`); return; }
    const primaryIssueKey = String(values.primaryIssueKey || '').trim().toUpperCase();
    if (primaryIssueKey && !/^[A-Z][A-Z0-9_]*-\d+$/.test(primaryIssueKey)) { setError('کلید Issue اصلی باید از قالب PROJECT-123 پیروی کند.'); return; }
    const payload: Record<string, unknown> = { ...(record?.payload || {}) };
    fields.forEach((field) => {
      if (field.key === 'relatedIssueKeysText') payload.relatedIssueKeys = Array.from(new Set(values[field.key].split(/[,،\s]+/).map((key) => key.toUpperCase()).filter((key) => /^[A-Z][A-Z0-9_]*-\d+$/.test(key))));
      else if (field.key === 'primaryIssueKey') payload.primaryIssueKey = primaryIssueKey;
      else payload[field.key] = storedValue(field, values[field.key]);
    });
    if (kind === 'decision' && !values.outcome.trim()) { setError('ثبت تصمیم باید شامل خروجی مصوب باشد.'); return; }
    if (kind === 'outcome' && values.status === 'Achieved' && (!values.ownerName || !values.metric || !values.target || !values.actual || !values.evidence)) {
      payload.verificationState = 'Unverified claim';
    }
    setSaving(true);
    try { await save(kind, title.trim() || String(payload.hypothesis || payload.name || TITLES[kind]), payload, record?.id); close(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'ثبت ذخیره نشد.'); }
    finally { setSaving(false); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section className="record-modal" role="dialog" aria-modal="true" aria-label={`${record ? 'ویرایش' : 'ثبت'} ${TITLES[kind]}`}>
      <div className="modal-heading"><div><span className="eyebrow">فضای محلی · {TITLES[kind]}</span><h2>{record ? 'ویرایش ثبت' : `ثبت ${TITLES[kind]}`}</h2></div><button className="icon-button" onClick={close} disabled={saving} aria-label="بستن"><X size={18} /></button></div>
      {jiraKeys.length > 0 && <div className="record-jira-links" aria-label="Issueهای مرتبط در Jira"><span>Jira مرتبط</span>{jiraKeys.map((key) => <button type="button" key={key} className="button tiny secondary jira-record-link" onClick={() => void openInJira(key)} disabled={!jiraUrl} title={jiraUrl ? `بازکردن ${key} در Jira` : 'ابتدا آدرس Jira را در تنظیمات ذخیره کنید'}><ExternalLink size={12} /><b dir="ltr">{key}</b></button>)}</div>}
      <form onSubmit={submit}>
        <label className="form-field full"><span>{kind === 'decision' ? 'عنوان تصمیم' : kind === 'meeting' ? 'عنوان جلسه' : kind === 'outcome' ? 'عنوان کوتاه' : 'عنوان'}{kind === 'decision' && <i>ضروری</i>}</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="عنوان را کوتاه و قابل پیگیری بنویسید" /></label>
        <div className="form-grid">{fields.map((field) => { const options = optionsByField[field.key] || []; return <label className={`form-field ${field.type === 'textarea' ? 'full' : ''}`} key={field.key}><span>{field.label}{field.required && <i>ضروری</i>}</span>
          {options.length ? <select value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)}><option value="">بدون رابطه</option>{values[field.key] && !options.some((option) => option.id === values[field.key]) && <option value={values[field.key]}>شناسهٔ قبلی · {values[field.key]}</option>}{options.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select>
            : field.type === 'textarea' ? <textarea value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} rows={3} />
            : field.type === 'select' ? <select value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)}><option value="">انتخاب کنید</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
              : <input type={field.type === 'date' ? 'datetime-local' : 'text'} value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} />}
          {field.hint && <small className="field-hint">{field.hint}</small>}
        </label>; })}</div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><span>در تاریخچهٔ محلی ثبت می‌شود.</span><button type="button" className="button secondary" onClick={close} disabled={saving}>انصراف</button><button className="button primary" disabled={saving}><Check size={16} />{saving ? 'در حال ذخیره…' : 'ذخیره'}</button></div>
      </form>
      {record?.history?.length ? <details className="record-history"><summary>سابقهٔ تغییرات · {record.history.length.toLocaleString()} رویداد اخیر</summary><ol>{record.history.map((event, index) => <li key={`${event.occurredAt}-${index}`}><div><b>{event.eventType === 'created' ? 'ایجاد شد' : event.eventType === 'archived' ? 'بایگانی شد' : 'ویرایش شد'}</b><time>{formatDate(event.occurredAt)}</time></div><details><summary>جزئیات ثبت‌شده</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></li>)}</ol></details> : null}
    </section>
  </div>;
}

export { SPECS, TITLES };
