import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { EpicReportResult, Snapshot } from '../types';
import { DataTable, IssueKey, MetricCard, SectionHeading, StatusBadge, formatNumber, formatPercent } from './Primitives';

export default function EpicDetailModal({ epic, snapshot, adhocTag, close, openIssue }: {
  epic: { key: string; summary?: string; epicName?: string }; snapshot: Snapshot; adhocTag: string; close: () => void; openIssue: (key: string) => void;
}) {
  const [report, setReport] = useState<EpicReportResult | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [close]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    window.axiloom.getEpicReport({ epic: epic.key, adhocTag, offset, limit: 50 })
      .then((value) => {
        if (!active) return;
        if (value.total > 0 && offset >= value.total) { setOffset(Math.floor((value.total - 1) / value.limit) * value.limit); return; }
        setReport(value);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Epic report could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [epic.key, snapshot, adhocTag, offset]);
  const summary = report?.summary;
  const totalSP = summary?.totalSP || 0;
  const doneSP = summary?.doneSP || 0;
  const adhocSP = summary?.adhocSP || 0;
  const adhocDoneSP = summary?.adhocDoneSP || 0;
  const projects = (report?.projects || []).map((item) => [item.project, item.count, item.done, formatNumber(item.points), formatNumber(item.donePoints), `${item.adhocCount} · ${formatPercent(item.count ? item.adhocCount / item.count : null)}`, `${formatNumber(item.adhocPoints)} · ${formatPercent(item.points ? item.adhocPoints / item.points : null)}`]);
  const teams = (report?.teams || []).map((item) => [item.team, item.count, item.done, formatNumber(item.points), formatNumber(item.donePoints)]);
  const issues = (report?.items || []).map((issue) => [<IssueKey value={issue.key} onOpen={openIssue} />, issue.summary, issue.project, issue.components?.join('، ') || '—', <StatusBadge value={issue.status} />, issue.isDone ? 'بله' : 'خیر', issue.assignee, formatNumber(issue.points), issue.workClassification || '—', issue.requester || '—', issue.department || '—', (issue.currentSprintIds || []).join('، ') || '—']);
  return <div className="modal-backdrop issue-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="record-modal issue-detail-modal epic-detail-modal" role="dialog" aria-modal="true" aria-label={`گزارش ${epic.key}`}>
      <header className="modal-heading"><div><span className="eyebrow">Epic · Portfolio Intelligence</span><h2><IssueKey value={epic.key} onOpen={openIssue} /> {epic.summary || epic.epicName || ''}</h2><small>تسک‌ها و شاخص‌های scope از اطلاعات Jira و گزارش‌های Axiloom</small></div><button className="icon-button" onClick={close} aria-label="بستن"><X size={17} /></button></header>
      {error && <p className="form-error">{error}</p>}
      {loading ? <div className="modal-loading">در حال گردآوری تسک‌های Epic…</div> : <>
        <div className="metric-grid six epic-metrics"><MetricCard label="تسک‌های فرزند" value={formatNumber(summary?.total || 0, 0)} /><MetricCard label="تکمیل‌شده" value={formatNumber(summary?.done || 0, 0)} tone="teal" /><MetricCard label="باز" value={formatNumber((summary?.total || 0) - (summary?.done || 0), 0)} tone="amber" /><MetricCard label="کل SP" value={formatNumber(totalSP)} /><MetricCard label="SP تکمیل‌شده" value={formatNumber(doneSP)} tone="blue" /><MetricCard label="نرخ تکمیل SP" value={formatPercent(totalSP ? doneSP / totalSP : null)} tone="teal" /></div>
        <div className="metric-grid four epic-metrics"><MetricCard label="Planned · SP انجام‌شده / کل" value={`${formatNumber(doneSP - adhocDoneSP)} / ${formatNumber(totalSP - adhocSP)}`} tone="teal" /><MetricCard label="Ad hoc · SP انجام‌شده / کل" value={`${formatNumber(adhocDoneSP)} / ${formatNumber(adhocSP)}`} tone="amber" /><MetricCard label="سهم Ad hoc" value={`${formatNumber(summary?.adhocCount || 0, 0)} تسک · ${formatPercent(summary?.total ? (summary?.adhocCount || 0) / summary.total : null)}`} hint={`${formatPercent(totalSP ? adhocSP / totalSP : null)} از کل SP`} tone="purple" /><MetricCard label="تسک بدون SP" value={`${formatNumber(summary?.withoutSP || 0, 0)} · ${formatPercent(summary?.total ? (summary?.withoutSP || 0) / summary.total : null)}`} tone="red" /></div>
        <section className="issue-detail-section"><SectionHeading title="جریان به تفکیک پروژهٔ Jira" hint="تعداد و برآورد کار تکمیل‌شده، برچسب کار، و Story Pointها برای پروژه‌های پیکربندی‌شده جداگانه گزارش می‌شوند." /><DataTable headers={['پروژه', 'تسک', 'تکمیل', 'کل SP', 'SP تکمیل‌شده', 'کار برچسب‌خورده · تعداد / سهم', 'کار برچسب‌خورده · SP / سهم']} rows={projects} empty="پروژه‌ای برای این Epic پیدا نشد." /></section>
        <section className="issue-detail-section"><SectionHeading title="توزیع به تفکیک تیم / Component" hint="Component خام Jira؛ تعداد چند Component برای یک تسک در هر Component شمرده می‌شود." /><DataTable headers={['تیم / Component', 'تسک', 'تکمیل‌شده', 'کل SP', 'SP تکمیل‌شده']} rows={teams} empty="Componentی برای تسک‌های Epic ثبت نشده است." /></section>
        <section className="issue-detail-section"><SectionHeading title="تسک‌های Epic" hint="وضعیت تکمیل از سیاست Workflow پیکربندی‌شده برای همان پروژه می‌آید. فیلدهای گزارش نیز از نگاشت معنایی فعال استفاده می‌کنند." /><DataTable headers={['Issue', 'عنوان', 'پروژه', 'Component / تیم', 'وضعیت', 'تکمیل', 'مسئول', 'SP', 'طبقه‌بندی کار', 'درخواست‌دهنده', 'واحد', 'Sprint']} rows={issues} empty="Issueی به این Epic وصل نیست." serverPagination={report ? { offset: report.offset, limit: report.limit, total: report.total, loading, onPageChange: setOffset } : undefined} /></section>
        <p className="data-source-note">مقادیر فقط درون پروژه و نقش پیکربندی‌شده جمع می‌شوند؛ Story Point و ساعت ظرفیت واحدهای متفاوتی دارند و با هم جمع نمی‌شوند.</p>
      </>}
    </section>
  </div>;
}
