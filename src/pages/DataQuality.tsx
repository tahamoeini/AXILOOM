import { AlertTriangle, CheckCircle2, CircleHelp, Database, Download, FileDown, FileWarning, History, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { AppConfig, ExportReport, Snapshot } from '../types';
import { DataTable, MetricCard, SectionHeading, StatusBadge, formatDate, formatNumber } from '../components/Primitives';
import { createReportScope } from '../reporting';

const SEMANTIC_LABELS: Record<string, string> = {
  storyPoints: 'Story points', sprint: 'Sprint membership', epicLink: 'Parent or epic link', epicName: 'Epic name',
  team: 'Team attribution', workClassification: 'Work classification', issueTags: 'Issue tags', requester: 'Requester',
  department: 'Department', productOwner: 'Product owner', loggedTime: 'Logged time',
};

export default function DataQuality({ snapshot, config }: { snapshot: Snapshot; config: AppConfig | null }) {
  const [exportError, setExportError] = useState('');
  const warnings = snapshot.quality.findings.filter((finding) => finding.severity === 'warning');
  const infos = snapshot.quality.findings.filter((finding) => finding.severity !== 'warning');
  async function exportQuality(format: 'xlsx' | 'pdf') {
    const report: ExportReport = {
      fileName: 'Axiloom-data-quality', title: 'Data quality and evidence coverage',
      subtitle: `${formatNumber(snapshot.summary.issueCount, 0)} imported issues · quality counts apply to this workspace.`,
      scope: createReportScope(snapshot, {
        view: 'Data quality', semantics: 'view-specific', primaryRowCount: snapshot.quality.findings.length,
        matchingRowCount: snapshot.summary.issueCount,
        notes: ['Coverage, findings, evidence counts, and import runs are workspace-level and are not filterable by report date or project.'],
      }),
      sheets: [
        { name: 'Findings', rows: [['Severity', 'Code', 'Count', 'Interpretation'], ...snapshot.quality.findings.map((finding) => [finding.severity, finding.code, finding.count, finding.message])] },
        { name: 'Field Coverage', rows: [['Field', 'Returned', 'Present', 'Invalid', 'Empty string', 'Null', 'Empty array', 'Missing', 'Unmapped'], ...Object.entries(snapshot.quality.fieldCoverage).map(([field, coverage]) => [field, coverage.returned, coverage.present, coverage.invalid, coverage.emptyString, coverage.null, coverage.emptyArray, coverage.missing, coverage.unmapped])] },
        { name: 'Evidence', rows: [['Evidence type', 'Count'], ['Issue revisions', snapshot.quality.evidence.issueRevisions], ['Changelog events', snapshot.quality.evidence.issueHistoryEvents], ['Sprint revisions', snapshot.quality.evidence.sprintRevisions], ['Local link events', snapshot.quality.evidence.localLinkEvents], ['Product relationship events', snapshot.quality.evidence.recordRelationshipEvents], ['Incomplete histories', snapshot.quality.incompleteHistories], ['Issues without history', snapshot.quality.issuesWithoutHistory], ['Conflicts', snapshot.quality.conflicts], ['Unknown fields', snapshot.quality.unknownFields.length], ['Unmapped issue-sprint relationships', snapshot.summary.unmappedTeamRelationCount]] },
        { name: 'Import Runs', rows: [['Started', 'Finished', 'Files or source', 'Added', 'Updated', 'Duplicates', 'Conflicts', 'Sprints added', 'Sprints updated', 'Skipped'], ...snapshot.importRuns.map((run) => [run.startedAt || '', run.finishedAt || '', Array.isArray(run.files) ? run.files.join(', ') : 'Jira', run.issuesAdded || 0, run.issuesUpdated || 0, run.duplicates || 0, run.conflicts || 0, run.sprintsAdded || 0, run.sprintsUpdated || 0, run.skipped || 0])] },
      ],
    };
    try {
      setExportError('');
      await (format === 'xlsx' ? window.axiloom.exportXlsx(report) : window.axiloom.exportPdf(report));
    } catch (error) { setExportError(error instanceof Error ? error.message : 'Data quality export failed.'); }
  }
  return <>
    <div className="filter-actions"><button className="button tiny secondary" onClick={() => void exportQuality('xlsx')}><FileDown size={15} /> XLSX</button><button className="button tiny secondary" onClick={() => void exportQuality('pdf')}><Download size={15} /> PDF</button></div>
    {exportError && <p className="form-error" role="alert">{exportError}</p>}
    <div className="metric-grid four">
      <MetricCard label="Issueهای بدون تاریخچه" value={formatNumber(snapshot.quality.issuesWithoutHistory, 0)} hint="گزارش تاریخی محدود می‌شود" tone={snapshot.quality.issuesWithoutHistory ? 'amber' : 'teal'} icon={<History size={16} />} />
      <MetricCard label="Changelog ناقص" value={formatNumber(snapshot.quality.incompleteHistories, 0)} hint="total از رکوردهای دریافت‌شده بیشتر است" tone={snapshot.quality.incompleteHistories ? 'red' : 'teal'} icon={<FileWarning size={16} />} />
      <MetricCard label="تعارض‌های ثبت‌شده" value={formatNumber(snapshot.quality.conflicts, 0)} hint="نسخه‌ها یا شناسه‌های ناسازگار" tone={snapshot.quality.conflicts ? 'amber' : 'teal'} icon={<ShieldAlert size={16} />} />
      <MetricCard label="فیلد ناشناخته" value={formatNumber(snapshot.quality.unknownFields.length, 0)} hint="دادهٔ خام حفظ شده است" tone={snapshot.quality.unknownFields.length ? 'purple' : 'teal'} icon={<Database size={16} />} />
    </div>

    <div className="metric-grid four">
      <MetricCard label="نسخه‌های Issue" value={formatNumber(snapshot.quality.evidence.issueRevisions, 0)} hint="Snapshotهای تغییرناپذیر import و sync" tone="blue" icon={<Database size={16} />} />
      <MetricCard label="رویدادهای changelog" value={formatNumber(snapshot.quality.evidence.issueHistoryEvents, 0)} hint="رویدادهای یکتای تاریخچهٔ Jira" tone="purple" icon={<History size={16} />} />
      <MetricCard label="نسخه‌های Sprint" value={formatNumber(snapshot.quality.evidence.sprintRevisions, 0)} hint="نسخه‌های ورودی و همگام‌سازی هر Sprint" tone="teal" icon={<Database size={16} />} />
      <MetricCard label="رخدادهای پیوند محلی" value={formatNumber(snapshot.quality.evidence.localLinkEvents, 0)} hint="ایجاد، ویرایش و برداشتن پیوندهای ثبت‌شده" tone="amber" icon={<History size={16} />} />
    </div>

    <div className="dashboard-grid quality-grid">
      <section className="panel">
        <SectionHeading title="هشدارها و پوشش" hint="هر یافته منبع، دامنه و اثرش بر تفسیر شاخص را مشخص می‌کند." />
        {warnings.length ? <div className="quality-list">{warnings.map((finding, index) => <article className="quality-row warning" key={`${finding.code}-${index}`}><span className="quality-icon"><AlertTriangle size={16} /></span><div><b>{finding.message}</b><small>{finding.code}</small></div><strong>{formatNumber(finding.count, 0)}</strong></article>)}</div> : <div className="all-clear"><CheckCircle2 size={20} /><div><b>هشدار ساختاری ثبت نشده</b><small>این وضعیت به‌معنای کامل‌بودن همهٔ فیلدهای انتخابی نیست؛ جدول پوشش را هم ببینید.</small></div></div>}
        {infos.length > 0 && <div className="quality-list info-list">{infos.map((finding, index) => <article className="quality-row info" key={`${finding.code}-${index}`}><span className="quality-icon"><CircleHelp size={16} /></span><div><b>{finding.message}</b><small>{finding.code}</small></div><strong>{formatNumber(finding.count, 0)}</strong></article>)}</div>}
      </section>
      <section className="panel quality-rules">
        <SectionHeading title="قواعد تفسیر داده" hint="null، فیلد غایب و آرایهٔ خالی یک معنا ندارند." />
        <div className="rule-row"><b>فیلد غایب</b><span>در export انتخاب نشده یا در این Issue projection نشده است.</span></div>
        <div className="rule-row"><b>null</b><span>فیلد ارسال شده اما مقداری برای آن ثبت نشده است.</span></div>
        <div className="rule-row"><b>[]</b><span>آرایه ارسال شده و در این snapshot عضوی ندارد.</span></div>
        <div className="rule-row"><b>timeSpent</b><span>delta تاریخچه یک proxy است؛ جایگزین worklog دقیق Jira نمی‌شود.</span></div>
        <div className="rule-row"><b>زمان</b><span>مقدار اصلی و offset تاریخ نگه داشته می‌شود؛ نمایش با منطقهٔ زمانی پیکربندی‌شده انجام می‌شود.</span></div>
        <div className="rule-row"><b>رابطهٔ والد / Epic</b><span>فقط کلید یا رابطهٔ صریح منبع استفاده می‌شود؛ شباهت عنوان رابطه ایجاد نمی‌کند.</span></div>
      </section>
    </div>

    <section className="panel table-panel">
      <SectionHeading title="پوشش فیلدهای کلیدی" hint={`${formatNumber(snapshot.summary.issueCount, 0)} Issue در فضای محلی بررسی شده‌اند.`} />
      <DataTable headers={['فیلد', 'برگشتی', 'مقدار دارد', 'نامعتبر', 'رشتهٔ خالی', 'null', 'آرایهٔ خالی', 'غایب', 'بدون نگاشت']} rows={Object.entries(snapshot.quality.fieldCoverage).map(([field, coverage]) => {
        const semantic = config?.fieldMappings.find((mapping) => mapping.semanticKey === field)?.semanticKey;
        return [semantic ? SEMANTIC_LABELS[semantic] || semantic : ({ assignee: 'Assignee', status: 'Status', project: 'Project', components: 'Components', issuetype: 'Issue type' } as Record<string, string>)[field] || field, formatNumber(coverage.returned, 0), formatNumber(coverage.present, 0), formatNumber(coverage.invalid, 0), formatNumber(coverage.emptyString, 0), formatNumber(coverage.null, 0), formatNumber(coverage.emptyArray, 0), formatNumber(coverage.missing, 0), formatNumber(coverage.unmapped, 0)];
      })} empty="بعد از import ساختار داده اینجا دیده می‌شود." />
      {snapshot.quality.unknownFields.length > 0 && <div className="unknown-fields"><b>کلیدهای ناشناخته حفظ‌شده</b><div>{snapshot.quality.unknownFields.map((field) => <code key={field}>{field}</code>)}</div></div>}
    </section>

    <section className="panel table-panel">
      <SectionHeading title="سوابق Import و همگام‌سازی" hint="صفحه‌های هم‌پوشان dedupe می‌شوند؛ import جدید، دادهٔ قبلی را به‌صورت مخفی حذف نمی‌کند." />
      <DataTable headers={['شروع', 'پایان', 'فایل‌ها / منبع', 'Issue جدید', 'بروزرسانی', 'تکراری', 'تعارض', 'Sprint جدید', 'Sprint بروزشده', 'ردشده']} rows={snapshot.importRuns.map((run) => [formatDate(run.startedAt), formatDate(run.finishedAt), Array.isArray(run.files) ? run.files.join('، ') : 'Jira', formatNumber(run.issuesAdded, 0), formatNumber(run.issuesUpdated, 0), formatNumber(run.duplicates, 0), formatNumber(run.conflicts, 0), formatNumber(run.sprintsAdded, 0), formatNumber(run.sprintsUpdated, 0), formatNumber(run.skipped, 0)])} empty="هنوز ورودی Jira ثبت نشده است." />
    </section>
    <div className="callout info"><Database size={15} /><span>مقادیر خام issue، changelog، envelope و فیلدهای ناشناخته در SQLite باقی می‌مانند. این صفحه از حذف یا تبدیل خاموش nullها جلوگیری می‌کند.</span></div>
  </>;
}
