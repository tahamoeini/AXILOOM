import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Archive, CalendarPlus, Check, Clock3, Download, FileDown, FileUp, GitBranch, Plus, Search, UsersRound } from 'lucide-react';
import RecordEditor from '../components/RecordEditor';
import type { AppConfig, ExportReport, PageId, ProductRecord, ProductRelationship, RecordKind, RecordTemplate, Snapshot } from '../types';
import BusinessOrgAnalytics from '../components/BusinessOrgAnalytics';
import { DataTable, EmptyState, IssueKey, SectionHeading, StatusBadge, formatDate, formatNumber } from '../components/Primitives';

const PAGE_KIND: Partial<Record<PageId, RecordKind>> = { objectives: 'objective', requests: 'request', actions: 'action', decisions: 'decision', meetings: 'meeting', outcomes: 'outcome', stakeholders: 'stakeholder' };
const PAGE_NAMES: Partial<Record<PageId, string>> = { objectives: 'هدف‌های محصول', requests: 'درخواست‌ها', actions: 'تعهدها و پیگیری‌ها', decisions: 'تصمیم‌های ثبت‌شده', meetings: 'جلسه‌ها و خروجی‌ها', outcomes: 'Outcomeها', stakeholders: 'ذی‌نفعان' };

function parseIcsDate(value: string, timezone = '', defaultTimeZone = 'UTC') {
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!match) return value;
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  if (match[7]) return new Date(`${local}Z`).toISOString();
  const effectiveTimeZone = timezone || defaultTimeZone || 'UTC';
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  let instant = target;
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: effectiveTimeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
      const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
      const represented = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
      const difference = target - represented;
      instant += difference;
      if (difference === 0) return new Date(instant).toISOString();
    }
    throw new Error(`The local calendar time does not exist in ${effectiveTimeZone}.`);
  } catch (error) { throw new Error(error instanceof Error ? error.message : 'The ICS timezone could not be resolved.'); }
}

function parseCalendar(text: string, defaultTimeZone = 'UTC') {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;
  lines.forEach((line) => {
    if (line === 'BEGIN:VEVENT') { current = {}; return; }
    if (line === 'END:VEVENT' && current) { events.push(current); current = null; return; }
    if (!current) return;
    const colon = line.indexOf(':');
    if (colon < 0) return;
    const keyWithParams = line.slice(0, colon);
    const [key, ...params] = keyWithParams.split(';');
    const timezone = params.find((parameter) => parameter.startsWith('TZID='))?.slice(5) || '';
    const raw = line.slice(colon + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
    const normalizedKey = key.toUpperCase();
    const normalizedValue = normalizedKey.startsWith('DTSTART') || normalizedKey.startsWith('DTEND') ? parseIcsDate(raw, timezone, defaultTimeZone) : raw;
    current[normalizedKey] = normalizedKey === 'ATTENDEE' ? [current[normalizedKey], normalizedValue].filter(Boolean).join('، ') : normalizedValue;
  });
  return events.filter((event) => event.UID || event.SUMMARY).map((event) => {
    const startAt = event.DTSTART || '';
    const uid = event.UID || `${event.SUMMARY}:${startAt}`;
    const relatedIssueKeys = [...new Set((event.DESCRIPTION || '').toUpperCase().match(/\b[A-Z][A-Z0-9_]*-\d+\b/g) || [])];
    const id = `meeting:${uid}`.replace(/[^\w:.-]/g, '_').slice(0, 240);
    return {
      id,
      kind: 'meeting' as const,
      title: event.SUMMARY || 'جلسهٔ بدون عنوان',
      payload: {
        startAt, endAt: event.DTEND || '', meetingType: 'Meeting', participants: event.ATTENDEE || '', location: event.LOCATION || '',
        relatedIssueKeys, evidence: event.DESCRIPTION || '', calendarUid: uid,
      },
    };
  });
}

function recordKeys(record: ProductRecord) {
  return [record.payload.primaryIssueKey, record.payload.issueKey, record.payload.requestKey, record.payload.productKey, record.payload.businessEpicKey, record.payload.businessIssueKey, ...(Array.isArray(record.payload.issueKeys) ? record.payload.issueKeys as string[] : []), ...(Array.isArray(record.payload.businessIssueKeys) ? record.payload.businessIssueKeys as string[] : []), ...(Array.isArray(record.payload.technicalIssueKeys) ? record.payload.technicalIssueKeys as string[] : []), ...(Array.isArray(record.payload.linkedIssueKeys) ? record.payload.linkedIssueKeys as string[] : []), ...(Array.isArray(record.payload.relatedIssueKeys) ? record.payload.relatedIssueKeys as string[] : [])].filter(Boolean).map(String);
}

function issueReferences(keys: string[], openIssue: (key: string) => void) {
  const unique = Array.from(new Set(keys));
  return <span className="issue-key-list">{unique.map((key, index) => <span key={`${key}-${index}`}><IssueKey value={key} onOpen={openIssue} />{index < unique.length - 1 ? ' · ' : ''}</span>)}</span>;
}

export default function ProductWork({ page, snapshot, config, setConfig, jiraUrl, createRecord, saveRecord, archiveRecord, refresh, notify, openIssue, pendingRecord, clearPending }: {
  page: PageId;
  snapshot: Snapshot;
  config: AppConfig | null;
  setConfig: (config: AppConfig) => void;
  jiraUrl: string;
  createRecord: (kind: RecordKind, record?: ProductRecord) => void;
  saveRecord: (kind: RecordKind, title: string, payload: Record<string, unknown>, id?: string) => Promise<void>;
  archiveRecord: (record: ProductRecord) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (text: string) => void;
  openIssue: (key: string) => void;
  pendingRecord?: { kind: RecordKind; record?: ProductRecord; nonce: number } | null;
  clearPending?: () => void;
}) {
  const [strategyKind, setStrategyKind] = useState<RecordKind>('objective');
  const [editor, setEditor] = useState<{ kind: RecordKind; record?: ProductRecord } | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const icsInput = useRef<HTMLInputElement>(null);
  const strategyTemplates = (config?.recordTemplates || []).filter((template) => template.enabled && template.group === 'strategy');
  const targetKind = page === 'objectives' && strategyTemplates.length
    ? (strategyTemplates.some((template) => template.kind === strategyKind) ? strategyKind : strategyTemplates[0].kind)
    : PAGE_KIND[page] || 'request';
  const activeTemplate = (config?.recordTemplates || []).find((template) => template.kind === targetKind && template.enabled);

  useEffect(() => {
    if (!pendingRecord) return;
    const strategyRecord = page === 'objectives' && strategyTemplates.some((template) => template.kind === pendingRecord.kind);
    if (pendingRecord.kind !== targetKind && !strategyRecord) return;
    if (strategyRecord) setStrategyKind(pendingRecord.kind);
    setEditor({ kind: pendingRecord.kind, record: pendingRecord.record });
    clearPending?.();
  }, [pendingRecord, targetKind, strategyTemplates, page, clearPending]);

  const allRecords = snapshot.records.filter((record) => record.kind === targetKind);
  const records = useMemo(() => allRecords.filter((record) => (!query || `${record.title} ${JSON.stringify(record.payload)}`.toLowerCase().includes(query.toLowerCase())) && (!status || String(record.payload.status || '') === status)), [allRecords, query, status]);
  const linkMap = new Map(snapshot.links.map((link) => [link.recordId, link]));
  const dueSoon = allRecords.filter((record) => record.payload.dueAt && !['Done', 'Closed', 'Resolved', 'Rejected'].includes(String(record.payload.status)));
  const relatedRecords = snapshot.links.filter((link) => link.kind === 'request' || link.kind === 'action');
  const statuses = Array.from(new Set(allRecords.map((record) => String(record.payload.status || '')).filter(Boolean))).sort();
  const objectiveOptions = snapshot.records.filter((record) => record.kind === 'objective').map((record) => ({ id: record.id, title: record.title }));

  const saveRelationship = async (input: Parameters<typeof window.axiloom.saveRecordRelationship>[0]) => {
    await window.axiloom.saveRecordRelationship(input);
    await refresh();
    notify('ارتباط صریح همراه با مدرک و مبدأ ثبت شد.');
  };
  const archiveRelationship = async (relationship: ProductRelationship) => {
    if (!window.confirm(`ارتباط «${relationship.sourceLabel} → ${relationship.targetLabel}» از نمایش فعال خارج شود؟ سابقهٔ آن باقی می‌ماند.`)) return;
    await window.axiloom.archiveRecordRelationship(relationship.id);
    await refresh();
    notify('ارتباط بایگانی شد و سابقهٔ آن حفظ شد.');
  };
  const exportRelationships = async () => {
    const result = await window.axiloom.exportRecordRelationships();
    if (result.filePath) notify(`رابطه‌ها در ${result.filePath} خروجی گرفته شدند.`);
  };

  const saveCurrent = async (kind: RecordKind, title: string, payload: Record<string, unknown>, id?: string) => {
    await saveRecord(kind, title, payload, id);
  };

  async function importIcs(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      const events = parseCalendar(await file.text(), config?.organization.timeZone || 'UTC');
      if (!events.length) throw new Error('فایل ICS رویداد جلسه‌ای نداشت.');
      for (const meeting of events) await window.axiloom.saveRecord(meeting);
      await refresh();
      notify(`${formatNumber(events.length, 0)} جلسه از فایل محلی ICS ثبت شد.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'فایل ICS خوانده نشد.');
    } finally { setImporting(false); }
  }

  function rowsForPage(): ReactNode[][] {
    if (page === 'objectives') return records.map((record) => {
      const relationCount = snapshot.relationships.filter((relationship) =>
        (relationship.sourceType === 'record' && relationship.sourceId === record.id)
        || (relationship.targetType === 'record' && relationship.targetId === record.id)).length;
      return [String((config?.recordTemplates || []).find((template) => template.kind === record.kind)?.label || record.kind),
        <b className="row-title">{record.title}</b>, String(record.payload.ownerName || '—'),
        <StatusBadge value={String(record.payload.status || 'Proposed')} />, formatDate(String(record.payload.dueAt || '')),
        `${formatNumber(relationCount, 0)} audited links`, actions(record)];
    });
    if (targetKind === 'action') return records.map((record) => {
      const due = String(record.payload.dueAt || '');
      const overdue = due && Date.parse(due) < Date.now() && !['Done', 'Closed', 'Resolved'].includes(String(record.payload.status));
      const linked = linkMap.get(record.id);
      return [<b className="row-title">{record.title}</b>, String(record.payload.ownerName || record.payload.ownerKey || 'بدون مالک'), String(record.payload.requester || '—'), formatDate(due), <StatusBadge value={String(record.payload.status || 'Open')} />, String(record.payload.dependency || '—'), <span className={overdue ? 'overdue-age' : ''}>{overdue ? 'موعد گذشته' : linked ? <>{linked.linkedDoneCount}/{linked.linkedIssues.length} Jira{linked.linkedSprintNames?.length ? <small className="table-sub">{linked.linkedSprintNames.slice(-2).join(' · ')}</small> : null}</> : '—'}<div>{issueReferences(recordKeys(record), openIssue)}</div></span>, actions(record)];
    });
    if (targetKind === 'request') return records.map((record) => {
      const created = Date.parse(record.createdAt);
      const age = Number.isFinite(created) ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null;
      const linked = linkMap.get(record.id);
      return [<b className="row-title">{record.title}</b>, `${String(record.payload.requester || '—')}${record.payload.department ? ` · ${String(record.payload.department)}` : ''}`, String(record.payload.ownerName || '—'), <StatusBadge value={String(record.payload.status || 'Backlog')} />, String(record.payload.priority || '—'), String(record.payload.waitingFor || record.payload.externalReference || '—'), `${formatNumber(age, 0)} روز مشاهده‌شده`, linked ? <span>{linked.linkedDoneCount}/{linked.linkedIssues.length} · {linked.linkedSprintCount} Sprint{linked.linkedSprintNames?.length ? <small className="table-sub">{linked.linkedSprintNames.slice(-2).join(' · ')}</small> : null}<div>{issueReferences(recordKeys(record), openIssue)}</div></span> : issueReferences(recordKeys(record), openIssue), actions(record)];
    });
    if (targetKind === 'decision') return records.map((record) => [<b className="row-title">{record.title}</b>, record.payload.decisionDate ? formatDate(String(record.payload.decisionDate)) : '—', String(record.payload.decisionMaker || '—'), record.payload.primaryIssueKey || record.payload.businessEpicKey ? <IssueKey value={String(record.payload.primaryIssueKey || record.payload.businessEpicKey)} onOpen={openIssue} /> : '—', String(record.payload.meetingId || '—'), <StatusBadge value={String(record.payload.status || 'Active')} />, String(record.payload.outcome || '—'), actions(record)]);
    if (targetKind === 'meeting') return records.sort((a, b) => String(b.payload.startAt || '').localeCompare(String(a.payload.startAt || ''))).map((record) => {
      const decisions = snapshot.records.filter((item) => item.kind === 'decision' && item.payload.meetingId === record.id).length;
      const actionsCount = snapshot.records.filter((item) => item.kind === 'action' && item.payload.meetingId === record.id).length;
      return [formatDate(String(record.payload.startAt || '')), <b className="row-title">{record.title}</b>, String(record.payload.meetingType || 'Meeting'), String(record.payload.participants || '—'), issueReferences(recordKeys(record), openIssue), `${formatNumber(decisions, 0)} تصمیم`, `${formatNumber(actionsCount, 0)} Action`, actions(record)];
    });
    if (targetKind === 'outcome') return records.map((record) => [record.payload.primaryIssueKey || record.payload.businessEpicKey ? <IssueKey value={String(record.payload.primaryIssueKey || record.payload.businessEpicKey)} onOpen={openIssue} /> : '—', String(objectiveOptions.find((item) => item.id === record.payload.objectiveId)?.title || '—'), <b className="row-title">{record.title}</b>, record.payload.metric ? `${String(record.payload.metric)}${record.payload.unit ? ` · ${String(record.payload.unit)}` : ''}` : '—', String(record.payload.baseline || '—'), String(record.payload.target || '—'), String(record.payload.actual || '—'), String(record.payload.ownerName || '—'), record.payload.reviewDate ? formatDate(String(record.payload.reviewDate)) : '—', <span className={record.payload.verificationState === 'Unverified claim' ? 'text-warning' : ''}>{String(record.payload.verificationState || record.payload.status || 'Unknown')}</span>, actions(record)]);
    return records.map((record) => [record.title, String(record.payload.department || '—'), String(record.payload.role || '—'), String(record.payload.ownerName || '—'), String(record.payload.externalReference || '—'), actions(record)]);
  }

  function actions(record: ProductRecord) {
    return <span className="row-actions"><button className="row-action" onClick={() => setEditor({ kind: targetKind, record })} title="ویرایش">ویرایش</button><button className="row-action archive" onClick={() => archiveRecord(record)} title="بایگانی"><Archive size={14} /></button></span>;
  }

  function exportProductReport(summaryOnly = false) {
    const valueCell = (value: unknown): string | number | boolean => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      return JSON.stringify(value);
    };
    const payloadKeys = Array.from(new Set(records.flatMap((record) => Object.keys(record.payload)))).sort();
    const recordSheet = {
      name: PAGE_NAMES[page] || 'Product Records',
      rows: [
        ['شناسه', 'عنوان', 'نوع ثبت', 'ایجاد', 'آخرین تغییر', ...payloadKeys],
        ...records.map((record) => [record.id, record.title, record.kind, record.createdAt, record.updatedAt, ...payloadKeys.map((key) => valueCell(record.payload[key]) as string | number | boolean)]),
      ],
    };
    const deliveryRows: Array<Array<string | number | boolean>> = [['ثبت محصولی', 'نوع ثبت', 'Issue', 'پروژه', 'وضعیت Jira', 'مسئول فعلی', 'Epic Link', 'تیم', 'Sprint', 'State', 'کار مرتبط', 'کار تکمیل', 'SP تکمیل', 'ساعت changelog']];
    records.forEach((record) => {
      const linked = linkMap.get(record.id);
      if (!linked?.linkedIssues.length) {
        deliveryRows.push([record.title, record.kind, '—', '—', '—', '—', '—', '—', 'بدون Sprint تاریخی', 0, 0, 0, 0, 0]);
        return;
      }
      linked.linkedIssues.forEach((issue: Record<string, any>) => {
        const sprints = (linked.linkedSprintDeliveries || []).filter((sprint: Record<string, any>) => sprint.issueKeys.includes(issue.key));
        if (!sprints.length) deliveryRows.push([record.title, record.kind, issue.key, issue.project, issue.status, issue.assignee, issue.epicLink || '', '—', 'بدون Sprint تاریخی', 0, 0, 0, 0, 0]);
        sprints.forEach((sprint: Record<string, any>) => deliveryRows.push([
          record.title, record.kind, issue.key, issue.project, issue.status, issue.assignee, issue.epicLink || '', sprint.team,
          sprint.sprintName, sprint.state, sprint.issueCount, sprint.completedIssueKeys.includes(issue.key) ? 1 : 0,
          sprint.completedIssueKeys.includes(issue.key) ? Number(issue.points || 0) : 0, Number(sprint.loggedHours || 0),
        ]));
      });
    });
    const historySheet = {
      name: 'Change History',
      rows: [['شناسهٔ ثبت', 'نوع', 'عنوان', 'رویداد', 'زمان', 'جزئیات قبل / بعد'], ...records.flatMap((record) => (record.history || []).map((event) => [record.id, record.kind, record.title, event.eventType, event.occurredAt, JSON.stringify(event.payload)]))],
    };
    const report: ExportReport = {
      fileName: `Axiloom-${targetKind}-management${summaryOnly ? '-summary' : ''}`,
      title: PAGE_NAMES[page] || 'گزارش مدیریت محصول',
      subtitle: 'ثبت‌های محلی و پیوندهای صریح Jira؛ تحویل تاریخی از عضویت Issue-Sprint و ساعت از deltaهای changelog محاسبه شده است.',
      sheets: summaryOnly ? [recordSheet, { name: 'Jira Links', rows: deliveryRows }] : [recordSheet, { name: 'Jira Delivery', rows: deliveryRows }, historySheet],
    };
    return summaryOnly ? window.axiloom.exportPdf(report) : window.axiloom.exportXlsx(report);
  }

  const headers = page === 'objectives' ? ['نوع ثبت', 'عنوان', 'مسئول', 'وضعیت', 'موعد', 'ارتباطات صریح', '']
    : targetKind === 'action' ? ['تعهد', 'مالک', 'درخواست‌دهنده', 'موعد', 'وضعیت', 'وابستگی / انتظار', 'پیگیری Jira', '']
    : targetKind === 'request' ? ['درخواست محصول', 'درخواست‌دهنده / واحد', 'مالک محصول', 'وضعیت', 'اهمیت', 'مرجع بیرونی', 'سن مشاهده‌شده', 'تحویل مرتبط', '']
      : targetKind === 'decision' ? ['عنوان تصمیم', 'تاریخ', 'تصمیم‌گیر', 'Jira related', 'جلسه', 'وضعیت', 'تصمیم صریح', '']
        : targetKind === 'meeting' ? ['تاریخ', 'جلسه', 'نوع', 'شرکت‌کنندگان', 'Jira مرتبط', 'تصمیم', 'Action', '']
          : targetKind === 'outcome' ? ['Issue مرتبط', 'Objective', 'Outcome / فرضیه', 'سنجه', 'Baseline', 'Target', 'Actual', 'مالک', 'بازبینی', 'اعتبار', '']
            : ['ذی‌نفع', 'واحد', 'نقش', 'مسئول ارتباط', 'مرجع بیرونی', ''];
  const title = page === 'objectives' ? `Product / Initiative / Objective · ${activeTemplate?.label || 'Register'}` : PAGE_NAMES[page] || 'مدیریت محصول';

  return <>
    {(page === 'requests' || page === 'stakeholders') && <BusinessOrgAnalytics snapshot={snapshot} config={config} setConfig={setConfig} editor={page === 'stakeholders'} />}
    {targetKind === 'decision' && <div className="callout amber"><Check size={16} /><span><b>ثبت تصمیم رسمی:</b> فقط تصمیم مصوب را در این بخش ثبت کنید. «Ready For Decision» صف آمادهٔ تحلیل محصول است و تصمیم مدیریتی به حساب نمی‌آید.</span></div>}
    {targetKind === 'request' && <div className="callout info"><Clock3 size={16} /><span>سن این درخواست، عمر مشاهده‌شده از زمان ثبت در فضای محلی است؛ تا وقتی SLA و پوشش منبع مشخص نشده، نقض SLA گزارش نمی‌شود. پاسخ بیرونی یا انتظار UAT به مالک محصول نسبت داده نمی‌شود.</span></div>}
    {targetKind === 'meeting' && <div className="callout info"><CalendarPlus size={16} /><span>جلسه‌ها فقط از ICS محلی یا ثبت دستی می‌آیند؛ اتصال به Google Calendar انجام نمی‌شود. تصمیم و Action را جداگانه به شناسهٔ جلسه وصل کنید.</span></div>}

    <section className="panel product-toolbar">
      <div className="product-toolbar-title"><span className="filter-mark"><UsersRound size={16} /></span><div><b>{title}</b><small>{formatNumber(allRecords.length, 0)} ثبت فعال در فضای محلی</small></div></div>
      <div className="product-toolbar-actions">
        {page === 'objectives' && strategyTemplates.map((template) => <button key={template.kind} className={`button tiny ${targetKind === template.kind ? 'primary' : 'secondary'}`} onClick={() => setStrategyKind(template.kind)}>{template.label}</button>)}
        <label className="compact-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجو در عنوان و جزئیات" /></label>
        <select className="compact-select" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">همهٔ وضعیت‌ها</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select>
        {targetKind === 'meeting' && <><input ref={icsInput} type="file" accept="text/calendar,.ics" hidden onChange={(event) => { importIcs(event.target.files?.[0]); event.currentTarget.value = ''; }} /><button className="button secondary" onClick={() => icsInput.current?.click()} disabled={importing}><FileUp size={15} />{importing ? 'در حال خواندن…' : 'ورود ICS'}</button></>}
        <button className="button tiny secondary" onClick={() => void exportRelationships()} title="Export active record and Jira relationships with provenance"><GitBranch size={14} /> Export relationships</button>
        <button className="button tiny secondary" onClick={() => exportProductReport(false)}><FileDown size={14} /> XLSX</button><button className="button tiny secondary" onClick={() => exportProductReport(true)}><Download size={14} /> PDF</button>
        <button className="button primary" onClick={() => createRecord(targetKind)}><Plus size={16} /> ثبت {activeTemplate?.label || targetKind}</button>
      </div>
    </section>

    {['action', 'request'].includes(targetKind) && relatedRecords.length > 0 && <section className="panel linked-flow-panel"><SectionHeading title="مسیر ثبت‌شده تا Jira" hint="این اتصال فقط از کلیدهایی ساخته شده که شما به‌صراحت ثبت کرده‌اید." />
      <div className="linked-flow-list">{relatedRecords.slice(0, 6).map((link) => <div className="linked-flow-row" key={link.recordId}><GitBranch size={15} /><b>{link.title}</b>{issueReferences(link.keys, openIssue)}<small>{link.linkedDoneCount}/{link.linkedIssues.length} issue تکمیل · {link.linkedDeliveredSP || 0} SP · {link.linkedSprintNames?.join('، ') || 'بدون Sprint تاریخی'}</small></div>)}</div>
    </section>}

    <section className="panel table-panel">
      <SectionHeading title={page === 'objectives' ? `${activeTemplate?.label || 'Product'} register` : activeTemplate?.label || PAGE_NAMES[page] || 'Product register'} hint={targetKind === 'meeting' ? 'شناسهٔ ICS و تاریخ، import تکراری را به همان ثبت وصل می‌کنند.' : targetKind === 'decision' ? 'Decision ID، جلسه، Jira issues and commitments در سابقهٔ محلی قابل پیگیری‌اند.' : undefined} />
      {records.length ? <DataTable headers={headers} rows={rowsForPage()} /> : <EmptyState title={`No ${activeTemplate?.label || targetKind} records`} detail={targetKind === 'meeting' ? 'فایل ICS محلی وارد کنید یا جلسه را دستی ثبت کنید.' : 'ثبت جدید به‌صورت محلی ذخیره می‌شود و پس از اجرای دوباره باقی می‌ماند.'} action={<button className="button small primary" onClick={() => createRecord(targetKind)}><Plus size={15} /> ثبت مورد جدید</button>} />}
    </section>

    {targetKind === 'action' && dueSoon.length > 0 && <div className="callout amber"><Clock3 size={15} /><span>{formatNumber(dueSoon.length, 0)} تعهد موعد مشخص دارد. اگر وضعیت انتظار از پاسخ بیرونی است، مسئول پاسخ و وابستگی را ثبت کنید تا تأخیر به فرد محصول نسبت داده نشود.</span></div>}
    {editor && <RecordEditor kind={editor.kind} template={(config?.recordTemplates || []).find((item) => item.kind === editor.kind)} record={editor.record} jiraUrl={jiraUrl} close={() => setEditor(null)} save={saveCurrent} recordOptions={snapshot.records} relationships={snapshot.relationships} onSaveRelationship={saveRelationship} onArchiveRelationship={archiveRelationship} />}
  </>;
}
