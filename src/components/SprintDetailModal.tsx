import { useEffect, useState } from 'react';
import { AlertCircle, Clock3, Database, ExternalLink, History, X } from 'lucide-react';
import type { IssueListResult, Snapshot, SprintDetails } from '../types';
import { DataTable, IssueKey, StatusBadge, formatDate, formatNumber, formatPercent, formatTime } from './Primitives';

function localTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${formatDate(value)} · ${formatTime(value)}`
    : value || '—';
}

export default function SprintDetailModal({ sprintId, jiraUrl, snapshot, close, openIssue }: {
  sprintId: string;
  jiraUrl: string;
  snapshot: Snapshot;
  close: () => void;
  openIssue: (key: string) => void;
}) {
  const [details, setDetails] = useState<SprintDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [issueList,setIssueList]=useState<IssueListResult>({items:[],total:0,doneCount:0,openCount:0,withoutAssignee:0,withEpicLink:0,offset:0,limit:50,hasMore:false});
  const [issueOffset,setIssueOffset]=useState(0); const [issuesLoading,setIssuesLoading]=useState(false);
  const [error, setError] = useState('');
  const metric = snapshot.sprintMetrics.find((row) => String(row.sprintId) === sprintId);
  const sprintIssues = issueList.items;

  async function openInJira() {
    setError('');
    try { await window.axiloom.openJiraSprint({ sprintId, boardId: String(details?.boardId || '') }); }
    catch (openError) { setError(openError instanceof Error ? openError.message : 'بازکردن Sprint در Jira ناموفق بود.'); }
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    window.axiloom.getSprintDetails(sprintId).then((value) => {
      if (active) { setDetails(value); if (!value) setError('این Sprint در دادهٔ محلی پیدا نشد.'); }
    }).catch((loadError) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'جزئیات Sprint خوانده نشد.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sprintId]);

  useEffect(()=>{
    let active=true; setIssuesLoading(true);
    window.axiloom.listSprintIssues(sprintId,issueOffset,50).then((value)=>{if(active)setIssueList(value);})
      .catch((e)=>{if(active)setError(e instanceof Error?e.message:'فهرست Issueهای این Sprint خوانده نشد.');})
      .finally(()=>{if(active)setIssuesLoading(false);});
    return()=>{active=false;};
  },[sprintId,issueOffset]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close]);

  return <div className="modal-backdrop issue-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="record-modal issue-detail-modal sprint-detail-modal" role="dialog" aria-modal="true" aria-label={`جزئیات Sprint ${sprintId}`}>
      <div className="modal-heading issue-detail-heading"><div><span className="eyebrow">Jira · تاریخچهٔ نسخه‌های Sprint</span><h2>{details?.raw?.name || metric?.sprintName || `Sprint ${sprintId}`} <code>#{sprintId}</code></h2><div className="issue-detail-subtitle"><StatusBadge value={details?.state || metric?.state || 'نامشخص'} /><span>{details?.team || metric?.team || 'بدون نگاشت تیم'} · Board {details?.boardId || '—'}</span></div></div><div className="issue-detail-heading-actions"><button type="button" className="button tiny secondary jira-entity-open" onClick={() => void openInJira()} disabled={!jiraUrl || !details?.boardId} title={!jiraUrl ? 'ابتدا آدرس Jira را در تنظیمات ذخیره کنید' : details?.boardId ? 'بازکردن این Sprint در Jira' : 'برای این Sprint، Board مرتبط ثبت نشده است'} aria-label={`بازکردن Sprint ${sprintId} در Jira`}><ExternalLink size={13} /> Jira</button><button className="icon-button" onClick={close} aria-label="بستن"><X size={18} /></button></div></div>
      {loading ? <div className="modal-loading"><span className="spinner" />در حال خواندن نسخه‌های Sprint…</div> : error && !details ? <div className="callout amber"><AlertCircle size={16} />{error}</div> : details && <>
        <section className="issue-detail-grid">
          <div><span>شروع برنامه‌ریزی</span><b>{formatDate(details.startDate || '')}</b></div>
          <div><span>پایان برنامه‌ریزی</span><b>{formatDate(details.endDate || '')}</b></div>
          <div><span>شروع واقعی</span><b>{formatDate(details.activatedDate || '')}</b></div>
          <div><span>پایان واقعی</span><b>{formatDate(details.completeDate || '')}</b></div>
          <div><span>نسخه‌های ثبت‌شده</span><b>{formatNumber(details.revisions.length, 0)}</b></div>
          <div><span>آخرین منبع</span><b>{details.sourceFile || 'همگام‌سازی Jira'}</b></div>
          {metric && <>
            <div><span>Planned / تحویل SP</span><b>{formatNumber(metric.plannedSP)} / {formatNumber(metric.completedSP)}</b></div>
            <div><span>تکمیل برنامه</span><b>{formatPercent(metric.plannedCompletionRateSP)}</b></div>
            <div><span>Scope issue</span><b>{formatNumber(metric.scopeIssues, 0)}</b></div>
            <div><span>Carryover</span><b>{formatNumber(metric.outgoingCarryoverIssues, 0)} · {formatPercent(metric.carryoverRateSP)}</b></div>
          </>}
        </section>

        {issueList.total > 0 && <section className="issue-detail-section">
          <h3><Clock3 size={15} /> Issueهای دارای این Sprint در خروجی فعلی</h3>
          <p>این فهرست بر اساس عضویت موجود در فیلد Sprint هر Issue است؛ تغییر عضویت تاریخی از changelog فنی محاسبه می‌شود.</p>
          <DataTable headers={['کلید', 'عنوان', 'وضعیت', 'مسئول', 'نوع']} rows={sprintIssues.map((issue) => [<IssueKey value={issue.key} onOpen={openIssue} />, issue.summary || '—', <StatusBadge value={issue.status} />, issue.assignee, issue.issueType])} serverPagination={{offset:issueOffset,limit:50,total:issueList.total,loading:issuesLoading,onPageChange:setIssueOffset}} />
        </section>}

        <section className="issue-detail-section">
          <h3><History size={15} /> تاریخچهٔ snapshotهای import و sync</h3>
          <p>هر نسخهٔ خام ورودی به‌صورت تغییرناپذیر ذخیره شده است. نسخه‌های تکراری با hash یکسان ادغام می‌شوند.</p>
          {details.revisions.length ? <div className="sprint-revisions">{details.revisions.map((revision) => <details key={revision.revisionId}>
            <summary><span>{revision.raw?.state || 'بدون وضعیت'} · {revision.raw?.name || `Sprint ${sprintId}`}</span><small>{localTime(revision.importedAt)} · {revision.sourceFile || 'Jira sync'}</small></summary>
            <pre>{JSON.stringify(revision.raw, null, 2)}</pre>
          </details>)}</div> : <p className="empty-inline">نسخهٔ قبلی برای این Sprint ثبت نشده است.</p>}
          <small className="data-source-note">آخرین ثبت محلی: {localTime(details.importedAt)}</small>
        </section>

        <details className="issue-raw"><summary><Database size={14} /> رکورد خام فعلی Sprint</summary><pre>{JSON.stringify(details.raw, null, 2)}</pre></details>
      </>}
    </section>
  </div>;
}
