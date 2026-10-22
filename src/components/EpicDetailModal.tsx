import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { Snapshot } from '../types';
import { DataTable, IssueKey, MetricCard, SectionHeading, StatusBadge, formatNumber, formatPercent } from './Primitives';

export default function EpicDetailModal({ epic, snapshot, adhocTag, close, openIssue }: {
  epic: { key: string; summary?: string; epicName?: string }; snapshot: Snapshot; adhocTag: string; close: () => void; openIssue: (key: string) => void;
}) {
  const [issues, setIssues] = useState<Array<Record<string, any>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [close]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const all: Array<Record<string, any>> = []; let offset = 0; let total = 0;
        do {
          const page = await window.axiloom.listIssues({ epic: epic.key, offset, limit: 250, sortBy: 'key' });
          all.push(...page.items); total = page.total; offset += page.items.length;
          if (!page.items.length) break;
        } while (offset < total);
        if (active) setIssues(all);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : 'تسک‌های Epic خوانده نشدند.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [epic.key, snapshot.summary.lastIssueUpdate]);
  const done = issues.filter((issue) => issue.isDone);
  const totalSP = issues.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0);
  const doneSP = done.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0);
  const tag = String(adhocTag || 'Ad hoc').trim().toLocaleLowerCase();
  const adhoc = issues.filter((issue) => (issue.tags || []).some((value: string) => String(value).trim().toLocaleLowerCase() === tag));
  const adhocDone = adhoc.filter((issue) => issue.isDone);
  const isAdhoc = (issue: Record<string, any>) => (issue.tags || []).some((value: string) => String(value).trim().toLocaleLowerCase() === tag);
  const planned = issues.filter((issue) => !isAdhoc(issue));
  const plannedDone = planned.filter((issue) => issue.isDone);
  const projectRows = Array.from(new Set(issues.map((issue) => String(issue.project || 'نامشخص'))).values()).sort().map((project) => {
    const rows = issues.filter((issue) => String(issue.project || 'نامشخص') === project);
    const completed = rows.filter((issue) => issue.isDone);
    const adhocRows = rows.filter(isAdhoc);
    const adhocPoints = adhocRows.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0);
    return [project, rows.length, completed.length, formatNumber(rows.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0)), formatNumber(completed.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0)), `${adhocRows.length} · ${formatPercent(rows.length ? adhocRows.length / rows.length : null)}`, `${formatNumber(adhocPoints)} · ${formatPercent(rows.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0) ? adhocPoints / rows.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0) : null)}`];
  });
  const teams = useMemo(() => Array.from(new Set(issues.flatMap((issue) => issue.components?.length ? issue.components : [issue.project]))).sort(), [issues]);
  const byTeam = teams.map((team) => {
    const rows = issues.filter((issue) => issue.components?.includes(team) || (!issue.components?.length && issue.project === team));
    return [team, rows.length, rows.filter((issue) => issue.isDone).length, formatNumber(rows.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0)), formatNumber(rows.filter((issue) => issue.isDone).reduce((sum, issue) => sum + (Number(issue.points) || 0), 0))];
  });
  return <div className="modal-backdrop issue-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="record-modal issue-detail-modal epic-detail-modal" role="dialog" aria-modal="true" aria-label={`گزارش ${epic.key}`}>
      <header className="modal-heading"><div><span className="eyebrow">Epic · Portfolio Intelligence</span><h2><IssueKey value={epic.key} onOpen={openIssue} /> {epic.summary || epic.epicName || ''}</h2><small>تسک‌ها و شاخص‌های scope از اطلاعات Jira و گزارش‌های Axiloom</small></div><button className="icon-button" onClick={close} aria-label="بستن"><X size={17} /></button></header>
      {error && <p className="form-error">{error}</p>}
      {loading ? <div className="modal-loading">در حال گردآوری تسک‌های Epic…</div> : <>
        <div className="metric-grid six epic-metrics"><MetricCard label="تسک‌های فرزند" value={formatNumber(issues.length, 0)} /><MetricCard label="تکمیل‌شده" value={formatNumber(done.length, 0)} tone="teal" /><MetricCard label="باز" value={formatNumber(issues.length - done.length, 0)} tone="amber" /><MetricCard label="کل SP" value={formatNumber(totalSP)} /><MetricCard label="SP تکمیل‌شده" value={formatNumber(doneSP)} tone="blue" /><MetricCard label="نرخ تکمیل SP" value={formatPercent(totalSP ? doneSP / totalSP : null)} tone="teal" /></div>
        <div className="metric-grid four epic-metrics"><MetricCard label="Planned · SP انجام‌شده / کل" value={`${formatNumber(plannedDone.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0))} / ${formatNumber(planned.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0))}`} tone="teal" /><MetricCard label="Ad hoc · SP انجام‌شده / کل" value={`${formatNumber(adhocDone.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0))} / ${formatNumber(adhoc.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0))}`} tone="amber" /><MetricCard label="سهم Ad hoc" value={`${formatNumber(adhoc.length, 0)} تسک · ${formatPercent(issues.length ? adhoc.length / issues.length : null)}`} hint={`${formatPercent(totalSP ? adhoc.reduce((sum, issue) => sum + (Number(issue.points) || 0), 0) / totalSP : null)} از کل SP`} tone="purple" /><MetricCard label="تسک بدون SP" value={`${formatNumber(issues.filter((issue) => issue.points == null).length, 0)} · ${formatPercent(issues.length ? issues.filter((issue) => issue.points == null).length / issues.length : null)}`} tone="red" /></div>
        <section className="issue-detail-section"><SectionHeading title="جریان به تفکیک پروژهٔ Jira" hint="تعداد و برآورد کار تکمیل‌شده، برچسب کار، و Story Pointها برای پروژه‌های پیکربندی‌شده جداگانه گزارش می‌شوند." /><DataTable headers={['پروژه', 'تسک', 'تکمیل', 'کل SP', 'SP تکمیل‌شده', 'کار برچسب‌خورده · تعداد / سهم', 'کار برچسب‌خورده · SP / سهم']} rows={projectRows} empty="پروژه‌ای برای این Epic پیدا نشد." /></section>
        <section className="issue-detail-section"><SectionHeading title="توزیع به تفکیک تیم / Component" hint="Component خام Jira؛ تعداد چند Component برای یک تسک در هر Component شمرده می‌شود." /><DataTable headers={['تیم / Component', 'تسک', 'تکمیل‌شده', 'کل SP', 'SP تکمیل‌شده']} rows={byTeam} empty="Componentی برای تسک‌های Epic ثبت نشده است." /></section>
        <section className="issue-detail-section"><SectionHeading title="تسک‌های Epic" hint="وضعیت تکمیل از سیاست Workflow پیکربندی‌شده برای همان پروژه می‌آید. فیلدهای گزارش نیز از نگاشت معنایی فعال استفاده می‌کنند." /><DataTable headers={['Issue', 'عنوان', 'پروژه', 'Component / تیم', 'وضعیت', 'تکمیل', 'مسئول', 'SP', 'طبقه‌بندی کار', 'درخواست‌دهنده', 'واحد', 'Sprint']} rows={issues.map((issue) => [<IssueKey value={issue.key} onOpen={openIssue} />, issue.summary, issue.project, issue.components?.join('، ') || '—', <StatusBadge value={issue.status} />, issue.isDone ? 'بله' : 'خیر', issue.assignee, formatNumber(issue.points), issue.workClassification || '—', issue.requester || '—', issue.department || '—', (issue.currentSprintIds || []).join('، ') || '—'])} empty="Issueی به این Epic وصل نیست." /></section>
        <p className="data-source-note">مقادیر فقط درون پروژه و نقش پیکربندی‌شده جمع می‌شوند؛ Story Point و ساعت ظرفیت واحدهای متفاوتی دارند و با هم جمع نمی‌شوند.</p>
      </>}
    </section>
  </div>;
}
