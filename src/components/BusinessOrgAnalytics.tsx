import { useEffect, useMemo, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Plus, Trash2 } from 'lucide-react';
import type { AppConfig, BusinessBoardReport, Snapshot, StakeholderContactPoint } from '../types';
import { DataTable, MetricCard, SectionHeading, formatNumber } from './Primitives';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
ChartJS.defaults.font.family = 'Vazirmatn, Tahoma, sans-serif';
type GroupLevel = 'department' | 'productOwner';
type GroupRow = { key: string; total: number; open: number; done: number; assignees: number };

export default function BusinessOrgAnalytics({ snapshot, config, setConfig, editor = false }: {
  snapshot: Snapshot; config: AppConfig | null; setConfig?: (value: AppConfig) => void; editor?: boolean;
}) {
  const [data, setData] = useState<BusinessBoardReport['aggregates'] | null>(null);
  const [error, setError] = useState('');
  const [level, setLevel] = useState<GroupLevel>('department');
  const [selected, setSelected] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactDepartment, setContactDepartment] = useState('');
  const [contactNotes, setContactNotes] = useState('');

  useEffect(() => {
    let active = true;
    window.axiloom.getBusinessBoardReport({ limit: 1, includeAggregates: true })
      .then((report) => { if (active) { setData(report.aggregates); setError(''); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Organizational report could not be loaded.'); });
    return () => { active = false; };
  }, [snapshot.summary.issueCount, snapshot.summary.lastIssueUpdate, config?.configurationRevision]);

  const departments: GroupRow[] = data?.departments || [];
  const productOwners: GroupRow[] = data?.productOwners || [];
  const groupRows = level === 'department' ? departments : productOwners;
  const selectedName = selected && groupRows.some((row) => row.key === selected) ? selected : groupRows[0]?.key || '';
  const trendRows = useMemo(() => (data?.organizationMonthly || [])
    .filter((row) => row.level === level && row.key === selectedName).sort((a, b) => a.month.localeCompare(b.month)), [data, level, selectedName]);
  const chartData = { labels: trendRows.map((row) => row.month), datasets: [
    { label: 'Created', data: trendRows.map((row) => row.created), borderColor: '#2463eb', backgroundColor: '#2463eb22', tension: .25, cubicInterpolationMode: 'monotone' as const },
    { label: 'Completed', data: trendRows.map((row) => row.completed), borderColor: '#069c88', backgroundColor: '#069c8822', tension: .25, cubicInterpolationMode: 'monotone' as const },
  ] };
  const chartOptions = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' as const, intersect: false },
    plugins: { legend: { position: 'bottom' as const, labels: { usePointStyle: true } } },
    scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } };
  const save = async (next: AppConfig) => {
    if (!setConfig) return;
    try { setConfig(await window.axiloom.saveConfig(next)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Local settings could not be saved.'); }
  };
  const addContact = () => {
    if (!config || !contactName.trim() || !contactDepartment) return;
    const point: StakeholderContactPoint = { id: crypto.randomUUID(), name: contactName.trim(), role: contactRole.trim(),
      department: contactDepartment, email: contactEmail.trim(), phone: contactPhone.trim(), notes: contactNotes.trim() };
    void save({ ...config, stakeholderContactPoints: [...(config.stakeholderContactPoints || []), point] });
    setContactName(''); setContactRole(''); setContactEmail(''); setContactPhone(''); setContactNotes('');
  };
  const removeContact = (id: string) => {
    if (config) void save({ ...config, stakeholderContactPoints: config.stakeholderContactPoints.filter((point) => point.id !== id) });
  };

  return <>
    <section className="panel org-analytics-panel">
      <SectionHeading title="Product intake by mapped department and owner" hint="Groups use configured Jira field mappings. Missing values remain visible as Unmapped in the report." />
      {error && <p className="form-error" role="alert">{error}</p>}
      {!config?.modules.organizationAnalytics && <div className="callout info">Enable organizational analytics and map a department field in setup to use this report.</div>}
      {config?.modules.organizationAnalytics && <>
        <div className="metric-grid four">
          <MetricCard label="Departments" value={formatNumber(departments.length, 0)} hint={formatNumber(data?.total || 0, 0) + ' intake issues'} tone="blue" />
          <MetricCard label="Product owners" value={formatNumber(productOwners.length, 0)} hint="From the mapped Jira field" tone="teal" />
          <MetricCard label="Open" value={formatNumber(data?.openCount || 0, 0)} tone="amber" />
          <MetricCard label="Completed" value={formatNumber(data?.doneCount || 0, 0)} tone="purple" />
        </div>
        <div className="org-analytics-grid">
          <section className="org-trend-panel">
            <div className="table-tools"><label>Group by<select value={level} onChange={(event) => { setLevel(event.target.value as GroupLevel); setSelected(''); }}>
              <option value="department">Department</option><option value="productOwner">Product owner</option>
            </select></label><label>Group<select value={selectedName} onChange={(event) => setSelected(event.target.value)}>
              {groupRows.map((row) => <option key={row.key} value={row.key}>{row.key}</option>)}
            </select></label></div>
            {trendRows.length ? <div className="org-trend-chart"><Line data={chartData} options={chartOptions} /></div> : <div className="chart-empty">No monthly history is available for this group.</div>}
          </section>
          <section><SectionHeading title={level === 'department' ? 'Department comparison' : 'Product owner comparison'} hint="Open and completed counts use the active intake workflow policy." />
            <DataTable headers={[level === 'department' ? 'Department' : 'Product owner', 'Total', 'Open', 'Completed', 'Assignees']}
              rows={groupRows.map((row) => [row.key, row.total, row.open, row.done, row.assignees])} empty="No mapped values are available for this filter." />
          </section>
        </div>
      </>}
    </section>
    {editor && config && <section className="panel org-editor-panel">
      <SectionHeading title="Local stakeholder contacts" hint="Contact details stay in this workspace and do not change Jira data." />
      <div className="org-contact-form">
        <label>Name<input value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
        <label>Role<input value={contactRole} onChange={(event) => setContactRole(event.target.value)} /></label>
        <label>Department<input value={contactDepartment} onChange={(event) => setContactDepartment(event.target.value)} /></label>
        <label>Email<input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label>
        <label>Phone<input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} /></label>
        <label>Notes<input value={contactNotes} onChange={(event) => setContactNotes(event.target.value)} /></label>
        <button className="button tiny secondary" onClick={addContact} disabled={!contactName.trim() || !contactDepartment}><Plus size={14} /> Add contact</button>
      </div>
      <DataTable headers={['Name', 'Role', 'Department', 'Email', 'Phone', 'Notes', '']}
        rows={(config.stakeholderContactPoints || []).map((point) => [point.name, point.role || '—', point.department, point.email || '—', point.phone || '—', point.notes || '—',
          <button className="row-action archive" onClick={() => removeContact(point.id)} aria-label="Remove contact"><Trash2 size={14} /></button>])}
        empty="No local contacts have been added." />
    </section>}
  </>;
}
