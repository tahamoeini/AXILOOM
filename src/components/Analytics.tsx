import { useMemo, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler } from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { DataTable, MetricCard, SectionHeading, formatDate, formatNumber, formatPercent } from './Primitives';

const COLORS = ['#2463eb', '#069c88', '#a65ee8', '#df9736', '#e15a79', '#237c99', '#859329'];
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler);
ChartJS.defaults.font.family = 'Vazirmatn, Tahoma, sans-serif';
const sum = (rows: any[], key: string) => rows.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
const ratio = (a: number, b: number) => b > 0 ? a / b : null;
const METRICS: Record<string, { label: string; unit: string; description: string; value: (rows: any[], people: boolean) => number | null }> = {
  completedSP: { label: 'امتیاز تحویل‌شده', unit: 'امتیاز', description: 'جمع امتیاز کارهایی که طبق مرز و قواعد تاریخی اسپرینت تکمیل شده‌اند.', value: (rows) => sum(rows, 'completedSP') },
  completedIssues: { label: 'تعداد تحویل', unit: 'رخداد تحویل', description: 'جمع تعداد تکمیل‌های منتسب به اسپرینت؛ تعداد کارهای یکتای کل دوره نیست.', value: (rows) => sum(rows, 'completedIssues') },
  plannedRate: { label: 'نرخ تحویل برنامه', unit: 'درصد', description: 'جمع امتیاز تکمیل‌شدهٔ برنامه تقسیم بر جمع امتیاز برنامه؛ میانگین سادهٔ درصدها نیست.', value: (rows) => ratio(sum(rows, 'completedPlannedSP'), sum(rows, 'plannedSP')) },
  completion: { label: 'نرخ تکمیل دامنه', unit: 'درصد', description: 'امتیاز تحویل‌شده تقسیم بر دامنهٔ امتیاز در ردیف‌های انتخابی؛ هر اسپرینت مرز مستقل دارد.', value: (rows, people) => ratio(sum(rows, 'completedSP'), sum(rows, people ? 'assignedSP' : 'scopeSP')) },
  utilization: { label: 'مصرف ظرفیت', unit: 'درصد', description: 'جمع ساعت تغییرات زمان ثبت‌شده تقسیم بر جمع ظرفیت همان ردیف‌ها؛ زمان ثبت‌شده، تخمین از تاریخچه است.', value: (rows) => ratio(sum(rows, 'loggedHours'), sum(rows, 'capacityHours')) },
  adhoc: { label: 'سهم کار پیش‌بینی‌نشده', unit: 'درصد', description: 'امتیاز کار پیش‌بینی‌نشده تقسیم بر امتیاز دامنهٔ انتخابی.', value: (rows, people) => ratio(sum(rows, 'adhocSP'), sum(rows, people ? 'assignedSP' : 'scopeSP')) },
  carryover: { label: 'انتقال کار ناتمام', unit: 'رخداد انتقال', description: 'جمع کارهای ناتمام خروجی هر اسپرینت؛ یک کار ممکن است در چند اسپرینت تکرار شود.', value: (rows) => sum(rows, 'outgoingCarryoverIssues') },
  hours: { label: 'زمان ثبت‌شده', unit: 'ساعت', description: 'مجموع اختلاف‌های زمان صرف‌شده در تاریخچهٔ تسک در پنجرهٔ هر اسپرینت.', value: (rows) => sum(rows, 'loggedHours') },
};
export function AnalyticChart({ title, series, points, percent = false, type = 'line', onPoint }: {
  title: string; series: Array<{ name: string; values: Array<number | null | undefined> }>; points: string[]; percent?: boolean; type?: 'line' | 'bar'; onPoint?: (index: number, seriesName: string) => void;
}) {
  const display = (value: number | null | undefined) => percent ? formatPercent(value, 1) : formatNumber(value);
  if (!points.length) return <p className="chart-empty">داده‌ای برای این انتخاب موجود نیست.</p>;
  const [hover, setHover] = useState<{ index: number; name: string } | null>(null);
  const data = { labels: points, datasets: series.map((item, index) => ({
    label: item.name, data: item.values.map((value) => typeof value === 'number' && Number.isFinite(value) ? value : null),
    borderColor: COLORS[index % COLORS.length], backgroundColor: type === 'bar' ? `${COLORS[index % COLORS.length]}bb` : `${COLORS[index % COLORS.length]}22`,
    borderWidth: 2.5, pointRadius: type === 'line' ? 3 : 0, pointHoverRadius: 6, spanGaps: false,
    tension: type === 'line' ? 0.25 : 0, cubicInterpolationMode: 'monotone' as const, fill: false,
    ...(type === 'bar' ? { borderRadius: 4, maxBarThickness: 26 } : {}),
  })) };
  const options = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    onHover: (_event: unknown, elements: Array<{ index: number; datasetIndex: number }>) => {
      if (elements[0]) setHover({ index: elements[0].index, name: series[elements[0].datasetIndex]?.name || '' });
    },
    onClick: (_event: unknown, elements: Array<{ index: number; datasetIndex: number }>) => {
      const point = elements[0]; if (point) onPoint?.(point.index, series[point.datasetIndex]?.name || '');
    },
    plugins: {
      legend: { display: true, position: 'bottom' as const, rtl: true, labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip: { rtl: true, callbacks: { label: (context: any) => `${context.dataset.label}: ${display(context.parsed.y)}` } },
      title: { display: false, text: title },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      y: { beginAtZero: true, max: percent ? 1 : undefined, ticks: { callback: (value: string | number) => display(Number(value)) }, grid: { color: '#e8edf3' } },
    },
  };
  return <div className="analytic-chart"><div className="analytic-chart-canvas" role="img" aria-label={title}>{type === 'line' ? <Line data={data} options={options} /> : <Bar data={data} options={options} />}</div>
    <p className="chart-readout" aria-live="polite">{hover ? `${points[hover.index]} · ${hover.name}: ${display(series.find((item) => item.name === hover.name)?.values[hover.index])}` : 'برای مقایسه، سری‌ها را از راهنمای نمودار روشن و خاموش کنید؛ انتخاب نقطه جزئیات اسپرینت را باز می‌کند.'}</p>
  </div>;
}
export default function Analytics({ rows, people, openSprint }: { rows: any[]; people: boolean; openSprint: (id: string) => void }) {
  const [metricKey, setMetricKey] = useState('completedSP'); const [chartType, setChartType] = useState<'line' | 'bar'>('line');
  const [grouping, setGrouping] = useState<'team' | 'person'>(people ? 'person' : 'team');
  const metric = METRICS[metricKey]; const percent = metric.unit === 'درصد';
  const groupKey = (row: any) => people && grouping === 'person' ? `${row.assignee} · ${row.team} · ${row.assigneeKey}` : row.team;
  const groups = useMemo(() => Array.from(new Set(rows.map(groupKey))).sort(), [rows, people, grouping]);
  const pointRows = useMemo(() => [...rows].sort((a, b) => Date.parse(a.startDate || '') - Date.parse(b.startDate || '') || String(a.team).localeCompare(String(b.team)) || String(a.sprintId).localeCompare(String(b.sprintId)) || String(a.assigneeKey || '').localeCompare(String(b.assigneeKey || ''))), [rows]);
  const sprintTimeKey = (row: any) => {
    const date = String(row.startDate || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : `unknown:${row.sprintId}`;
  };
  const timeline = useMemo(() => {
    const byDate = new Map<string, { key: string; label: string }>();
    pointRows.forEach((row) => {
      const key = sprintTimeKey(row);
      if (byDate.has(key)) return;
      const label = key.startsWith('unknown:') ? `بدون تاریخ · #${row.sprintId}`
        : formatDate(key);
      byDate.set(key, { key, label });
    });
    return [...byDate.values()].sort((a, b) => a.key.startsWith('unknown:') ? 1 : b.key.startsWith('unknown:') ? -1 : a.key.localeCompare(b.key));
  }, [pointRows]);
  const timeIndex = new Map(timeline.map((point, index) => [point.key, index]));
  const rankedRows = pointRows.map((row) => ({ ...row, comparisonRank: timeIndex.get(sprintTimeKey(row)) ?? 0 }));
  const points = timeline.map((point) => point.label);
  const rowsByGroupRank = useMemo(() => {
    const index = new Map<string, Map<number, any[]>>();
    for (const row of rankedRows) {
      const name = groupKey(row);
      const rank = Number(row.comparisonRank);
      let byRank = index.get(name);
      if (!byRank) { byRank = new Map(); index.set(name, byRank); }
      let groupRows = byRank.get(rank);
      if (!groupRows) { groupRows = []; byRank.set(rank, groupRows); }
      groupRows.push(row);
    }
    return index;
  }, [rankedRows, people, grouping]);
  const series = groups.map((name) => ({ name, values: points.map((_, rank) => {
    const subset = rowsByGroupRank.get(name)?.get(rank);
    return subset?.length ? metric.value(subset, people) : undefined;
  }) }));
  const comparisonCount = new Set(rows.map((row) => `${row.team}\u0000${row.sprintId}`)).size;
  const teamCount = new Set(rows.map((row) => String(row.team || ''))).size;
  const personCount = people ? new Set(rows.map((row) => `${row.team}\u0000${row.assigneeKey || row.assignee}`)).size : 0;
  const seriesCount = new Set(rows.map(groupKey)).size;
  const missingPoints = rows.filter((row) => row.storyPointCoverage == null || row.storyPointCoverage < 1).length;
  const overCapacity = rows.filter((row) => row.capacityHours > 0 && row.loggedHours > row.capacityHours).length;
  return <>
    <section className="metric-grid four"><MetricCard label="ترکیب‌های Team × Sprint" value={formatNumber(comparisonCount, 0)} hint="هر ترکیب مستقل در جدول باقی می‌ماند." tone="teal" /><MetricCard label={grouping === 'person' ? 'افراد در مقایسه' : 'تیم‌های مقایسه'} value={formatNumber(grouping === 'person' ? seriesCount : teamCount, 0)} hint="گروه‌بندی بر اساس تیم‌های پیکربندی‌شده" /><MetricCard label={people ? 'پوشش افراد' : 'پوشش ناقص Story Point'} value={formatNumber(people ? personCount : missingPoints, 0)} hint={people ? 'هر فرد در محدودهٔ تیم خودش' : 'ردیف‌هایی با پوشش ناقص یا ناموجود'} tone="purple" /><MetricCard label="ردیف‌های بالاتر از ظرفیت" value={formatNumber(overCapacity, 0)} hint="بر اساس همان انتخاب فیلترشده" tone="amber" /></section>
    <div className="callout info">{formatNumber(people ? rows.length : comparisonCount, 0)} {people ? 'ردیف فرد × Sprint' : 'ترکیب Team × Sprint'} در انتخاب فعلی؛ {formatNumber(missingPoints, 0)} ردیف با پوشش ناقص یا ناموجود امتیاز و {formatNumber(overCapacity, 0)} ردیف با ساعت ثبت‌شده بیشتر از ظرفیت. هیچ متریک تیم‌ها یا اسپرینت‌ها در کارت‌های خلاصه با هم جمع نشده است.</div>
    <section className="panel"><SectionHeading title="روند و مقایسهٔ عملکرد" hint="محور افقی تاریخ شروع Sprint است؛ خط هر تیم در تقویم مشترک دیده می‌شود و در فاصلهٔ بدون داده، خط شکسته می‌ماند." /><div className="table-tools"><label>شاخص<select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>{Object.entries(METRICS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><label>نمودار<select value={chartType} onChange={(e) => setChartType(e.target.value as 'line' | 'bar')}><option value="line">روند خطی</option><option value="bar">میله‌ای</option></select></label><label>مقایسه<select value={grouping} onChange={(e) => setGrouping(e.target.value as 'team' | 'person')}>{people && <option value="person">افراد در تیم‌ها</option>}<option value="team">تیم‌ها</option></select></label></div><p className="analytics-method">{metric.description} تاریخ‌ها به ترتیب زمانی روی یک محور مشترک قرار می‌گیرند؛ گروه‌بندی تیمی فقط تیم‌های انتخاب‌شده در تنظیمات را به کار می‌برد. جدول پایین ردیف مستقل هر Team × Sprint را نگه می‌دارد.</p>
      <AnalyticChart title={metric.label} series={series} points={points} percent={percent} type={chartType} onPoint={(i, seriesName) => { const row = rowsByGroupRank.get(seriesName)?.get(i)?.[0]; if (row) openSprint(String(row.sprintId)); }} />
    </section>
    <div className="dashboard-grid"><section className="panel"><SectionHeading title="مقایسهٔ مستقل Team × Sprint" hint={`${metric.label} · ${metric.unit}`} /><DataTable headers={['تیم', 'اسپرینت', metric.label, 'تحویل SP', 'برنامه SP', 'زمان ثبت‌شده', 'ظرفیت', 'مصرف ظرفیت']} rows={pointRows.map((row) => [row.team, `${row.sprintName} · #${row.sprintId}`, percent ? formatPercent(metric.value([row], people)) : formatNumber(metric.value([row], people)), formatNumber(row.completedSP), formatNumber(row.plannedSP), formatNumber(row.loggedHours), formatNumber(row.capacityHours), formatPercent(ratio(row.loggedHours, row.capacityHours))])} empty="برای مقایسه داده‌ای در انتخاب فعلی نیست." /></section><section className="panel"><SectionHeading title="ترکیب تحویل هر Team × Sprint" hint="نسبت برنامه‌ریزی‌شده و پیش‌بینی‌نشده در همان اسپرینت" /><DataTable headers={['تیم', 'اسپرینت', 'Planned SP', 'Ad hoc SP', 'تحویل Planned', 'تحویل Ad hoc']} rows={pointRows.map((row) => [row.team, `${row.sprintName} · #${row.sprintId}`, formatNumber(row.plannedSP), formatNumber(row.adhocSP), formatNumber(row.completedPlannedSP), formatNumber(row.completedAdhocSP)])} empty="ترکیب تحویل در انتخاب فعلی موجود نیست." /></section></div>
  </>;
}
