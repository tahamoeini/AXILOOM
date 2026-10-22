import { useMemo, useState } from 'react';
import { Download, FileDown, Info, LineChart, UsersRound } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import Analytics from '../components/Analytics';
import DashboardLayout from '../components/DashboardLayout';
import type { ExportReport, Snapshot } from '../types';
import { createReportScope } from '../reporting';
import { DataTable, MultiSelect, MetricCard, SectionHeading, StatusBadge, formatDate, formatNumber, formatPercent } from '../components/Primitives';

type Mode = 'sprints' | 'people';
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

function exportReport(snapshot: Snapshot, rows: Array<Record<string, any>>, mode: Mode, filters: Record<string, string[] | string>, summaryOnly = false): ExportReport {
  const metadata = mode === 'sprints'
    ? ['teamId', 'team', 'teamPath', 'sprintId', 'sprintName', 'state', 'sprintOrder', 'startDate', 'endDate', 'calendarDays', 'workingDays']
    : ['teamId', 'team', 'teamPath', 'assigneeKey', 'assignee', 'sprintId', 'sprintName', 'sprintOrder', 'startDate', 'endDate', 'calendarDays', 'workingDays'];
  const labels: Record<string, string> = {
    teamId: 'شناسهٔ تیم', team: 'تیم', teamPath: 'مسیر سلسله‌مراتب تیم', sprintId: 'Sprint ID', sprintName: 'Sprint', state: 'وضعیت', sprintOrder: 'ترتیب Sprint',
    startDate: 'شروع', endDate: 'پایان', calendarDays: 'روز تقویمی', workingDays: 'روز کاری',
    assigneeKey: 'شناسهٔ فرد', assignee: 'فرد',
    completedStoryPointCoverage: 'پوشش امتیاز تکمیل‌شده', estimateAccuracyCoverage: 'پوشش دقت تخمین',
  };
  const summaryKeys = mode === 'sprints'
    ? ['scopeIssues', 'scopeSP', 'plannedSP', 'adhocSP', 'committedSP', 'completedIssues', 'completedSP', 'plannedCompletionRateSP', 'completionRateSP', 'scopeChurnRate', 'outgoingCarryoverIssues', 'carryoverRateSP', 'loggedHours', 'capacityHours', 'utilization', 'medianCycleTimeDays', 'estimateAccuracy', 'forecastPlannableSP', 'forecastConfidence', 'storyPointCoverage', 'completedStoryPointCoverage', 'timeDataCoverage', 'estimateAccuracyCoverage']
    : ['scopeIssues', 'scopeSP', 'completedIssues', 'completedSP', 'plannedIssues', 'adhocIssues', 'outgoingCarryoverIssues', 'loggedHours', 'capacityHours', 'utilization', 'medianCycleTimeDays', 'estimateAccuracy', 'forecastPlannableSP', 'forecastConfidence', 'storyPointCoverage', 'completedStoryPointCoverage', 'timeDataCoverage', 'estimateAccuracyCoverage'];
  const metricKeys = summaryOnly ? summaryKeys : Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
    .filter((key) => !metadata.includes(key) && rows.some((row) => row[key] === null || ['string', 'number', 'boolean'].includes(typeof row[key])));
  const formatHeader = (key: string) => labels[key] || key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  const valueFor = (row: Record<string, any>, key: string) => {
    const value = row[key];
    if (key === 'teamPath' && Array.isArray(value)) return value.join(' / ');
    return value === undefined || value === null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : value;
  };
  const reportRows = rows.map((row) => [...metadata.map((key) => valueFor(row, key)), ...metricKeys.map((key) => valueFor(row, key))]);
  const dataSheet = { name: mode === 'sprints' ? 'Sprint Metrics' : 'Person Metrics', rows: [[...metadata.map(formatHeader), ...metricKeys.map(formatHeader)], ...reportRows] };
  const summaryMetrics: Array<[string, string]> = mode === 'sprints'
    ? [['scopeIssues', 'Issues in sprint scope'], ['completedIssues', 'Completed issues'], ['scopeSP', 'Story points in scope'], ['plannedSP', 'Planned story points'], ['adhocSP', 'Unplanned story points'], ['completedSP', 'Completed story points'], ['loggedHours', 'Logged hours proxy'], ['capacityHours', 'Configured capacity hours']]
    : [['assignedIssues', 'Assigned issues'], ['completedIssues', 'Completed issues'], ['assignedSP', 'Assigned story points'], ['completedSP', 'Completed story points'], ['loggedHours', 'Logged hours proxy'], ['capacityHours', 'Configured capacity hours']];
  const summarySheet = { name: 'Report Summary', rows: [['Metric', 'Value', 'Rows with value', 'Filtered rows'], ...summaryMetrics.map(([key, label]) => {
    const values = rows.map((row) => row[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
    return [label, values.length ? values.reduce((total, value) => total + value, 0) : '', values.length, rows.length];
  })] };
  const qualitySheet = { name: 'Data Quality', rows: [
    ['شدت', 'کد', 'تعداد', 'توضیح'],
    ...snapshot.quality.findings.map((finding) => [finding.severity, finding.code, finding.count, finding.message]),
    [], ['فیلد', 'موجود در پاسخ', 'غایب', 'null', 'آرایهٔ خالی', 'موجود'],
    ...Object.entries(snapshot.quality.fieldCoverage).map(([field, coverage]) => [field, coverage.returned, coverage.missing, coverage.null, coverage.emptyArray, coverage.present]),
    [], ['شواهد تاریخی', 'تعداد'],
    ['Issue revisions', snapshot.quality.evidence.issueRevisions], ['Changelog events', snapshot.quality.evidence.issueHistoryEvents],
    ['Sprint revisions', snapshot.quality.evidence.sprintRevisions], ['Local link events', snapshot.quality.evidence.localLinkEvents],
    ['Issue-sprint relationships without team attribution', snapshot.summary.unmappedTeamRelationCount],
  ] };
  const title = mode === 'sprints' ? 'تحویل اسپرینت و تیم' : 'تحلیل تیم و فرد';
  return {
    fileName: `Axiloom-${mode === 'sprints' ? 'delivery' : 'people'}${summaryOnly ? '-summary' : ''}`,
    title: summaryOnly ? `${title} · خلاصه` : title,
    subtitle: `${formatNumber(snapshot.summary.issueCount, 0)} issue محلی · ${formatNumber(snapshot.summary.unmappedTeamRelationCount, 0)} رابطهٔ issue-sprint بدون تیم از جمع‌های تیمی کنار گذاشته شده · XLSX شامل ${formatNumber(metricKeys.length, 0)} ستون متریک است. ساعات از delta تاریخچهٔ timespent به‌دست می‌آیند و worklog دقیق نیست.`,
    scope: createReportScope(snapshot, {
      view: mode === 'sprints' ? 'Team and sprint delivery' : 'Team and person delivery',
      semantics: 'report-wide', filters,
      filterLabels: { team: 'Teams', sprintId: 'Sprints', person: 'People', from: 'Sprint start from', to: 'Sprint start through' },
      primaryRowCount: rows.length, matchingRowCount: rows.length,
      notes: ['Workspace-level data-quality counts are not narrowed by these filters.', 'Time spent is estimated from changelog deltas and is not a Jira worklog.'],
    }),
    sheets: summaryOnly ? [summarySheet, dataSheet] : [summarySheet, dataSheet, qualitySheet],
  };
}

export default function Delivery({ snapshot, openSprint }: { snapshot: Snapshot; openSprint: (sprintId: string) => void }) {
  const [mode, setMode] = useState<Mode>('sprints');
  const [team, setTeam] = useState<string[]>([]);
  const [sprintId, setSprintId] = useState<string[]>([]);
  const [person, setPerson] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const inDateRange = (row: Record<string, any>) => (!from || !to || from <= to) && (!from || String(row.startDate || '').slice(0, 10) >= from) && (!to || String(row.startDate || '').slice(0, 10) <= to);
  const sprintRows = useMemo(() => snapshot.sprintMetrics.filter((row) => (!team.length || team.includes(row.team)) && (!sprintId.length || sprintId.includes(row.sprintId)) && inDateRange(row)).sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)), [snapshot.sprintMetrics, team, sprintId, from, to]);
  const personRows = useMemo(() => snapshot.people.filter((row) => (!team.length || team.includes(row.team)) && (!sprintId.length || sprintId.includes(row.sprintId)) && (!person.length || person.includes(row.assigneeKey)) && inDateRange(row)).sort((a, b) => a.team.localeCompare(b.team) || a.assignee.localeCompare(b.assignee) || a.sprintId.localeCompare(b.sprintId)), [snapshot.people, team, sprintId, person, from, to]);
  const displayed = mode === 'sprints' ? sprintRows : personRows;
  const sum = (key: string) => {
    const values = sprintRows.map((row) => row[key]).filter((value) => typeof value === 'number' && Number.isFinite(value));
    return { value: values.length ? values.reduce((total, value) => total + value, 0) : null, covered: values.length, total: sprintRows.length };
  };
  const sumCombined = (keys: string[]) => {
    const values = sprintRows.flatMap((row) => keys.every((key) => typeof row[key] === 'number' && Number.isFinite(row[key]))
      ? [keys.reduce((total, key) => total + Number(row[key]), 0)] : []);
    return { value: values.length ? values.reduce((total, value) => total + value, 0) : null, covered: values.length, total: sprintRows.length };
  };
  const displaySum = (metric: ReturnType<typeof sum>, suffix = '') => metric.value === null ? '—'
    : `${formatNumber(metric.value)}${suffix}${metric.covered < metric.total ? ` · ${metric.covered}/${metric.total} rows` : ''}`;
  const compositionRows = sprintRows.filter((row) => row.plannedSP != null || row.adhocSP != null);
  const compositionLabels = compositionRows.map((row) => `${row.team} · ${row.sprintName} · #${row.sprintId}`);
  const chartNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const compositionData = {
    labels: compositionLabels,
    datasets: [
      { label: 'کل Planned', data: compositionRows.map((row) => chartNumber(row.plannedSP)), backgroundColor: '#b9ded8', borderRadius: 3 },
      { label: 'Planned انجام‌شده', data: compositionRows.map((row) => chartNumber(row.completedPlannedSP)), backgroundColor: '#168b89', borderRadius: 3 },
      { label: 'کل Ad hoc', data: compositionRows.map((row) => chartNumber(row.adhocSP)), backgroundColor: '#f0d8b6', borderRadius: 3 },
      { label: 'Ad hoc انجام‌شده', data: compositionRows.map((row) => chartNumber(row.completedAdhocSP)), backgroundColor: '#d89545', borderRadius: 3 },
    ],
  };
  const compositionOptions = {
    indexAxis: 'y' as const, responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { position: 'bottom' as const, rtl: true, labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { rtl: true, callbacks: { label: (context: any) => `${context.dataset.label}: ${formatNumber(context.parsed.x)} SP` } } },
    scales: { x: { beginAtZero: true, title: { display: true, text: 'Story Point' } }, y: { ticks: { autoSkip: false } } },
  };
  const exportCurrent = async (pdf = false) => {
    const filters = { team, sprintId, ...(mode === 'people' ? { person } : {}), from, to };
    const report = exportReport(snapshot, displayed, mode, filters, pdf);
    if (pdf) await window.axiloom.exportPdf(report); else await window.axiloom.exportXlsx(report);
  };

  return <>
    <section className="panel filter-panel">
          <div className="filter-caption"><span className="filter-mark"><LineChart size={17} /></span><div><b>فیلتر گزارش</b><small>فیلتر، ردیف‌های گزارش را محدود می‌کند؛ متریک هر Sprint در مرز واقعی همان Sprint محاسبه شده است.</small></div></div>
      <div className="filter-controls">
        <MultiSelect label="تیم‌ها" value={team} options={snapshot.teams.map((value) => ({ value, label: value }))} onChange={(value) => { setTeam(value); setSprintId([]); }} />
        <MultiSelect label="اسپرینت‌ها" value={sprintId} options={Array.from(new Map(snapshot.sprintMetrics.filter((row) => !team.length || team.includes(row.team)).map((row) => [String(row.sprintId), { value: String(row.sprintId), label: `${row.sprintName} · ${row.team}` }])).values())} onChange={setSprintId} />
        {mode === 'people' && <MultiSelect label="افراد" value={person} options={Array.from(new Map(snapshot.people.filter((row) => !team.length || team.includes(row.team)).map((row) => [row.assigneeKey, { value: row.assigneeKey, label: `${row.assignee} · ${row.assigneeKey}` }])).values())} onChange={setPerson} />}
        <label>شروع از<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>شروع تا<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="filter-actions"><button className="button tiny secondary" onClick={() => exportCurrent(false)}><FileDown size={15} /> XLSX کامل</button><button className="button tiny secondary" onClick={() => exportCurrent(true)}><Download size={15} /> PDF خلاصه</button></div>
      </div>
    </section>

    {from && to && from > to && <p className="form-error">تاریخ پایان باید پس از تاریخ شروع باشد.</p>}
    {snapshot.summary.unmappedTeamRelationCount > 0 && <div className="callout warning compact-callout"><span>{formatNumber(snapshot.summary.unmappedTeamRelationCount, 0)} رابطهٔ issue-sprint به‌دلیل نبود تخصیص معتبر از جمع‌های تیمی کنار گذاشته شده است. جزئیات را در کیفیت داده بررسی کنید.</span></div>}
    <div className="subtabs">
      <button className={mode === 'sprints' ? 'active' : ''} onClick={() => setMode('sprints')}><LineChart size={15} /> تیم و اسپرینت</button>
      <button className={mode === 'people' ? 'active' : ''} onClick={() => setMode('people')}><UsersRound size={15} /> تحلیل فردی</button>
      <span className="subtabs-count">{formatNumber(displayed.length, 0)} ردیف</span>
    </div>

    <DashboardLayout storageKey="delivery" widgets={[
      { id: 'analytics', title: 'تحلیل روند تیم و اسپرینت', content: <Analytics key={mode} rows={displayed} people={mode === 'people'} openSprint={openSprint} /> },
      ...(mode === 'sprints' ? [
      { id: 'composition', title: 'Planned و Ad hoc', content: <section className="panel"><SectionHeading title="تعهد و تحویل Planned / Ad hoc" hint="در هر Team × Sprint، کل Planned با Planned انجام‌شده و کل Ad hoc با Ad hoc انجام‌شده جفت شده‌اند. این جفت‌ها نسبت و اختلاف را بدون حدسِ باقی‌مانده نشان می‌دهند." />
        <div className="metric-grid six composition-summary"><MetricCard label="کل Planned" value={displaySum(sum('plannedSP'), ' SP')} tone="teal" /><MetricCard label="Planned انجام‌شده" value={displaySum(sum('completedPlannedSP'), ' SP')} tone="teal" /><MetricCard label="کل Ad hoc" value={displaySum(sum('adhocSP'), ' SP')} tone="amber" /><MetricCard label="Ad hoc انجام‌شده" value={displaySum(sum('completedAdhocSP'), ' SP')} tone="amber" /><MetricCard label="کل دامنه" value={displaySum(sumCombined(['plannedSP', 'adhocSP']), ' SP')} /><MetricCard label="کل انجام‌شده" value={displaySum(sumCombined(['completedPlannedSP', 'completedAdhocSP']), ' SP')} tone="blue" /></div>
        {compositionRows.length ? <div className="composition-bar-scroll"><div className="composition-bar-canvas" style={{ height: `${Math.max(300, Math.min(1200, compositionRows.length * 34 + 100))}px` }}><Bar data={compositionData} options={compositionOptions} /></div></div> : <div className="chart-empty">برای Team × Sprint انتخابی SP برنامه و Ad hoc موجود نیست.</div>}
        <div className="callout info compact-callout">برای هر Team × Sprint، چهار مقدار جدا دیده می‌شود. کارت‌های بالای نمودار هم کل Planned، Planned انجام‌شده، کل Ad hoc، Ad hoc انجام‌شده، مجموع دامنه و مجموع تحویل را در فیلتر انتخابی جمع می‌کنند.</div>
      </section> },
      { id: 'flow', title: 'شاخص‌های جریان', content: <section className="panel"><SectionHeading title="شاخص‌های جریان برای هر Team × Sprint" hint="این نما در عرض کامل قرار می‌گیرد تا نام اسپرینت و ستون‌های کیفیت، مصرف، بازگشایی و پیش‌بینی بدون فشردگی خوانده شوند." />
        <DataTable headers={['تیم', 'اسپرینت', 'ثبات Scope', 'مصرف ظرفیت', 'بازگشایی', 'پوشش SP', 'پوشش زمان', 'پوشش تخمین/زمان', 'Forecast', 'سابقه Forecast']} rows={sprintRows.map((row) => [row.team, <button className="sprint-detail-link table-sprint-link" onClick={() => openSprint(String(row.sprintId))}>{row.sprintName}<small>#{row.sprintId} · جزئیات</small></button>, formatPercent(row.scopeStability), formatPercent(row.utilization), formatPercent(row.reopenedIssueRate), formatPercent(row.storyPointCoverage), formatPercent(row.timeDataCoverage), formatPercent(row.estimateAccuracyCoverage), row.forecastMethod || '—', `${row.forecastConfidence || 'ناموجود'} · ${formatNumber(Number(row.forecastHistorySprints || 0), 0)}`])} empty="پس از انتخاب تیم و import اسپرینت، شاخص‌های جریان نمایش داده می‌شوند." />
      </section> },
      ] : []),
    ]} />

    <section className="panel table-panel">
      <SectionHeading title={mode === 'sprints' ? 'تحویل در سطح اسپرینت' : 'بار و جریان هر فرد'} hint={mode === 'people' ? 'آخرین assignee Jira برای تخصیص issue استفاده شده است؛ شاخص‌ها برای coaching و تشخیص گلوگاه‌اند.' : 'تخصیص تیم در مرز Sprint از نگاشت‌های فعال بازسازی می‌شود؛ موارد مبهم یا بدون نگاشت در کیفیت داده باقی می‌مانند.'} />
      {mode === 'sprints' ? <DataTable headers={['تیم', 'اسپرینت', 'وضعیت', 'Scope', 'Planned SP', 'Ad hoc SP', 'تحویل SP', 'Scope اضافه / حذف', 'Carryover', 'Logged h', 'ظرفیت h', 'مصرف', 'زمان چرخه', 'بازگشایی', 'Forecast', 'کیفیت داده']} rows={sprintRows.map((row) => [<b className="team-name">{row.team}</b>, <button className="sprint-detail-link table-sprint-link" onClick={() => openSprint(String(row.sprintId))}>{row.sprintName}<small>#{row.sprintId} · جزئیات و تاریخچه</small></button>, <StatusBadge value={row.state} />, `${formatNumber(row.scopeIssues, 0)} / ${formatNumber(row.scopeSP)}`, formatNumber(row.plannedSP), formatNumber(row.adhocSP), formatNumber(row.completedSP), `${formatNumber(row.scopeAddedSP)} / ${formatNumber(row.scopeRemovedSP)}`, `${formatNumber(row.outgoingCarryoverIssues, 0)} · ${formatPercent(row.carryoverRateSP)}`, formatNumber(row.loggedHours), formatNumber(row.capacityHours), formatPercent(row.utilization), row.medianCycleTimeDays === null ? '—' : `${formatNumber(row.medianCycleTimeDays)} روز`, formatPercent(row.reopenedIssueRate), <span>{formatNumber(row.forecastPlannableSP)} SP <small className="table-sub">{row.forecastConfidence || '—'}</small></span>, <span>{formatPercent(row.storyPointCoverage)} SP <small className="table-sub">{formatPercent(row.completedStoryPointCoverage)} تکمیل · {formatPercent(row.timeDataCoverage)} زمان · {formatPercent(row.estimateAccuracyCoverage)} دقت{row.capacityEstimateReason ? <span className="table-sub"> · {row.capacityEstimateReason}</span> : null}</small></span>])} empty="اسپرینت با نگاشت تیم از مسیر board، component، project یا override قابل گزارش می‌شود." /> : <DataTable headers={['تیم', 'فرد', 'Sprint', 'کار', 'SP تخصیص', 'تکمیل', 'SP تحویل', 'Planned / Ad hoc', 'Carryover', 'Logged h', 'ظرفیت h', 'مصرف ظرفیت', 'زمان چرخه', 'دقت تخمین', 'پوشش']} rows={personRows.map((row) => [<b className="team-name">{row.team}</b>, <span className="person-cell"><b>{row.assignee}</b><small>{row.assigneeKey || 'شناسه در دسترس نیست'}</small></span>, <button className="sprint-detail-link table-sprint-link" onClick={() => openSprint(String(row.sprintId))}>{row.sprintName}<small>#{row.sprintId} · جزئیات و تاریخچه</small></button>, formatNumber(row.assignedIssues, 0), formatNumber(row.assignedSP), formatNumber(row.completedIssues, 0), formatNumber(row.completedSP), `${formatNumber(row.plannedIssues, 0)} / ${formatNumber(row.adhocIssues, 0)}`, formatNumber(row.outgoingCarryoverIssues, 0), formatNumber(row.loggedHours), formatNumber(row.capacityHours), <span>{formatPercent(row.utilization)}{row.capacityEstimateReason ? <small className="table-sub">{row.capacityEstimateReason}</small> : null}</span>, row.medianCycleTimeDays === null ? '—' : `${formatNumber(row.medianCycleTimeDays)} روز`, formatPercent(row.estimateAccuracy), `${formatPercent(row.storyPointCoverage)} SP · ${formatPercent(row.timeDataCoverage)} زمان · ${formatPercent(row.estimateAccuracyCoverage)} دقت`])} empty="پس از ورود changelog و تخصیص‌های Jira، تحلیل فردی نمایش داده می‌شود." />}
    </section>
    <div className="callout info"><Info size={16} /><span><b>تعریف ساعت:</b> timespent از deltaهای changelog برآورد می‌شود و worklog دقیق نیست. ظرفیت از تقویم پیکربندی‌شده، منطقهٔ زمانی، ساعات کاری، تعطیلات و تخصیص‌های فردی محاسبه می‌شود. اگر تقویم، مرز تاریخ یا تخصیص معتبر در دسترس نباشد، دلیل ناموجود یا تقریبی بودن ظرفیت در ردیف گزارش نمایش داده می‌شود.</span></div>
  </>;
}
