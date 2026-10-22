import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileDown, GitBranch, ListChecks, Search, Target, UsersRound } from 'lucide-react';
import type { AppConfig, BusinessBoardFilters, BusinessBoardReport, BusinessSprintOption, BusinessSprintReport, ExportReport, ProductRecord, RecordKind, Snapshot } from '../types';
import { createReportScope } from '../reporting';
import { DataTable, IssueKey, MetricCard, SectionHeading, StatusBadge, formatDate, formatNumber, formatPercent } from '../components/Primitives';

const emptyReport: BusinessBoardReport = {
  items: [], total: 0, offset: 0, limit: 50, hasMore: false,
  aggregates: { total: 0, openCount: 0, doneCount: 0, linkedCount: 0, withoutOwner: 0, withStatusAge: 0,
    withoutStatusAgeOpen: 0, statusSinceCount: 0, epicCount: 0, withoutComponent: 0, uniqueDeliveryKeyCount: 0,
    statuses: [], components: [], assignees: [], componentAssignees: [], aging: [], monthly: [], departments: [], productOwners: [], organizationMonthly: [], matchingRecordIds: [] },
};

function recordIssueKeys(record: ProductRecord) {
  const payload = record.payload || {};
  const values = [payload.primaryIssueKey, payload.relatedIssueKeys, payload.issueKey, payload.requestKey, payload.productKey, payload.businessEpicKey,
    payload.businessIssueKey, payload.issueKeys, payload.businessIssueKeys, payload.linkedIssueKeys,
    payload.relatedIssueKeys, payload.technicalIssueKeys];
  return Array.from(new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).map((value) => String(value).toUpperCase())));
}

export default function BusinessBoard({ snapshot, config, openIssue, createRecord }: {
  snapshot: Snapshot; config: AppConfig | null; openIssue: (key: string) => void;
  createRecord: (kind: RecordKind, record?: ProductRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [component, setComponent] = useState('');
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [report, setReport] = useState<BusinessBoardReport>(emptyReport);
  const [priorities, setPriorities] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sprints, setSprints] = useState<BusinessSprintOption[]>([]);
  const [sprintId, setSprintId] = useState('');
  const [sprintReport, setSprintReport] = useState<BusinessSprintReport | null>(null);
  const [sprintError, setSprintError] = useState('');
  const [sprintLoading, setSprintLoading] = useState(false);
  const intakeProject = config?.projectRoles.productIntake?.[0] || '';
  const filters: BusinessBoardFilters = useMemo(() => ({ query, component, assignee, status, priority, createdFrom: from, createdTo: to }),
    [query, component, assignee, status, priority, from, to]);
  const components = report.aggregates.components.map((row) => row.key).filter((key) => key !== 'بدون Component');
  const statuses = report.aggregates.statuses.map((row) => row.key);
  const milestones = config?.workflows.commitment.milestones || [];

  useEffect(() => {
    let active = true;
    if (!intakeProject) return () => { active = false; };
    window.axiloom.getIssueFilterOptions(intakeProject).then((options) => { if (active) setPriorities(options.priorities); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Filter options could not be loaded.'); });
    return () => { active = false; };
  }, [intakeProject, snapshot.summary.lastIssueUpdate]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      window.axiloom.getBusinessBoardReport({ ...filters, offset: page * 50, limit: 50 })
        .then((result) => { if (active) setReport(result); })
        .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Product intake report could not be loaded.'); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 220 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [filters, page, query, snapshot.summary.issueCount, snapshot.summary.lastIssueUpdate, config?.configurationRevision]);

  useEffect(() => {
    let active = true;
    if (!config?.modules.businessSprint) { setSprints([]); setSprintReport(null); return () => { active = false; }; }
    window.axiloom.getBusinessSprints().then((rows) => {
      if (!active) return;
      setSprints(rows); setSprintId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '');
    }).catch((reason) => { if (active) setSprintError(reason instanceof Error ? reason.message : 'Sprint list could not be loaded.'); });
    return () => { active = false; };
  }, [config?.modules.businessSprint, snapshot.summary.lastIssueUpdate, snapshot.summary.sprintCount]);

  useEffect(() => {
    let active = true;
    if (!sprintId || !config?.modules.businessSprint) { setSprintReport(null); return () => { active = false; }; }
    setSprintLoading(true); setSprintError('');
    window.axiloom.getBusinessSprintReport({ sprintId }).then((result) => { if (active) setSprintReport(result); })
      .catch((reason) => { if (active) setSprintError(reason instanceof Error ? reason.message : 'Commitment report could not be loaded.'); })
      .finally(() => { if (active) setSprintLoading(false); });
    return () => { active = false; };
  }, [sprintId, config?.configurationRevision, snapshot.summary.lastIssueUpdate]);

  async function loadAll() {
    const rows: Array<Record<string, any>> = [];
    let offset = 0, total = report.total;
    let first = report;
    do {
      const next = await window.axiloom.getBusinessBoardReport({ ...filters, offset, limit: 250, includeAggregates: offset === 0 });
      if (offset === 0) { first = next; total = next.total; }
      if (!next.items.length) break;
      rows.push(...next.items); offset += next.items.length;
    } while (offset < total);
    return { rows, aggregates: first.aggregates };
  }

  async function exportIntake(format: 'xlsx' | 'pdf') {
    const { rows, aggregates } = await loadAll();
    const payload: ExportReport = {
      fileName: 'Axiloom-Product-Intake', title: 'Product intake report',
      subtitle: rows.length + ' issues; relationships are explicit Jira links, local audited links, or keys recorded in product records.',
      scope: createReportScope(snapshot, {
        view: 'Product intake', semantics: 'report-wide', filters,
        filterLabels: { query: 'Search', component: 'Component', assignee: 'Assignee', status: 'Status', priority: 'Priority', createdFrom: 'Created from', createdTo: 'Created through' },
        primaryRowCount: rows.length, matchingRowCount: aggregates.total,
        notes: ['The export aggregates and issue rows use the same server-side filters.', 'Workspace-level data-quality counts are not narrowed by these filters.'],
      }),
      sheets: [
        { name: 'Summary', rows: [['Metric', 'Value'], ['Total', aggregates.total], ['Open', aggregates.openCount], ['Completed', aggregates.doneCount], ['Linked to delivery', aggregates.linkedCount], ['Without owner', aggregates.withoutOwner], [], ['Status', 'Count'], ...aggregates.statuses.map((item) => [item.key, item.count])] },
        { name: 'Intake', rows: [['Issue', 'Summary', 'Project', 'Type', 'Components', 'Assignee', 'Status', 'Priority', 'Created', 'Age days', 'Department', 'Product owner', 'Linked delivery'], ...rows.map((issue) => [issue.key, issue.summary, issue.project, issue.issueType, issue.components.join(', '), issue.assignee, issue.status, issue.priority, issue.created, issue.issueAgeDays ?? '', issue.department || '', issue.productOwner || '', issue.linkedTechnicalKeys.join(', ')])] },
        { name: 'Components', rows: [['Component', 'Total', 'Open', 'Completed', 'Linked'], ...aggregates.components.map((row) => [row.key, row.total, row.open, row.done, row.linked])] },
        { name: 'Departments', rows: [['Department', 'Total', 'Open', 'Completed', 'Assignees'], ...aggregates.departments.map((row) => [row.key, row.total, row.open, row.done, row.assignees])] },
      ],
    };
    await (format === 'xlsx' ? window.axiloom.exportXlsx(payload) : window.axiloom.exportPdf({ ...payload, sheets: payload.sheets.slice(0, 2) }));
  }

  async function exportSprint() {
    if (!sprintReport) return;
    const reportData: ExportReport = {
      fileName: 'Axiloom-Commitment-Sprint-' + sprintReport.sprint.id,
      title: 'Sprint commitment report · ' + sprintReport.sprint.name,
      subtitle: 'Commitment and milestone meaning comes from the active workflow policy. Missing history and points remain visible.',
      scope: createReportScope(snapshot, {
        view: 'Sprint commitment', semantics: 'view-specific',
        filters: { sprint: sprintReport.sprint.name, teams: sprintReport.teams.map((team) => team.team) },
        filterLabels: { sprint: 'Sprint', teams: 'Teams' },
        primaryRowCount: sprintReport.items.length, matchingRowCount: sprintReport.items.length,
        notes: ['Attribution findings are included in the export.', 'Missing history and story points remain explicit.'],
      }),
      sheets: [
        { name: 'Teams', rows: [['Team ID', 'Team', 'Committed issues', 'Committed SP', 'Missing SP', 'Added', 'Added SP', 'In scope at end', 'Completed', 'Completed SP', 'Exited', 'Point increase', 'Point decrease'], ...sprintReport.teams.map((team) => [team.teamId, team.team, team.committedCount, team.committedSP, team.committedMissingSPCount, team.addedCount, team.addedSP, team.inScopeAtEndCount, team.completedCount, team.completedSP, team.exitCount, team.pointIncreaseSP, team.pointDecreaseSP])] },
        { name: 'Milestones', rows: [['Team', 'Milestone', 'Reached', 'Story points', 'Missing story points'], ...sprintReport.teams.flatMap((team) => Object.entries(team.milestones).map(([id, value]) => [team.team, milestones.find((item) => item.id === id)?.label || value.label, value.count, value.storyPoints, value.missingStoryPoints]))] },
        { name: 'Issues', rows: [['Issue', 'Team ID', 'Team', 'Attribution', 'Committed', 'Added', 'Start status', 'End status', 'Start SP', 'End SP', 'Completed', 'History complete', 'Delivery issues'], ...sprintReport.items.map((item) => [item.key, item.teamId, item.team, item.teamSource, item.committed, item.addedDuring, item.startStatus, item.endStatus, item.startPoints ?? '', item.endPoints ?? '', item.completedInSprint, item.historyComplete, item.linkedIssueKeys.join(', ')])] },
        { name: 'Attribution quality', rows: [['Severity', 'Code', 'Issue', 'Finding'], ...sprintReport.attributionFindings.map((finding) => [finding.severity, finding.code, finding.issueKey, finding.message])] },
      ],
    };
    await window.axiloom.exportXlsx(reportData);
  }

  const matchingRecordCount = report.aggregates.matchingRecordIds.length;
  const openRequests = snapshot.business.summary.open || 0;
  const doneRequests = snapshot.business.summary.done || 0;

  return <>
    <section className="business-intro panel">
      <div><span className="eyebrow">PRODUCT INTAKE · JIRA</span><h2>From intake to delivery</h2>
        <p>Project roles define intake and delivery scope. Age is measured from issue creation; it does not represent an SLA or time in status.</p></div>
      <div className="business-intro-actions">
        <button className="button primary" onClick={() => createRecord('request')}><ListChecks size={15} /> New request</button>
        <button className="button secondary" onClick={() => createRecord('action')}><ListChecks size={15} /> New commitment</button>
        <button className="button secondary" onClick={() => void exportIntake('xlsx')}><FileDown size={15} /> XLSX</button>
        <button className="button secondary" onClick={() => void exportIntake('pdf')}><Download size={15} /> PDF</button>
      </div>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="metric-grid four">
      <MetricCard label="Open intake" value={formatNumber(openRequests, 0)} hint={formatNumber(report.aggregates.total, 0) + ' matching issues'} tone="blue" icon={<Target size={16} />} />
      <MetricCard label="Completed" value={formatNumber(doneRequests, 0)} hint="Configured workflow and Jira resolution" tone="teal" />
      <MetricCard label="Linked to delivery" value={formatNumber(report.aggregates.linkedCount, 0)} hint={formatNumber(report.aggregates.uniqueDeliveryKeyCount, 0) + ' linked delivery issues'} tone="purple" icon={<GitBranch size={16} />} />
      <MetricCard label="Without owner" value={formatNumber(report.aggregates.withoutOwner, 0)} hint="Assignee missing in source" tone={report.aggregates.withoutOwner ? 'amber' : 'teal'} icon={<UsersRound size={16} />} />
    </div>
    <section className="panel table-panel">
      <SectionHeading title="Product intake queue" hint="Use project, workflow, and field mappings from setup." action={<button className="button tiny secondary" onClick={() => { setQuery(''); setComponent(''); setAssignee(''); setStatus(''); setPriority(''); setFrom(''); setTo(''); setPage(0); }}>Reset filters</button>} />
      <div className="table-tools">
        <label className="search-field"><span>Search</span><div><Search size={15} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Issue key, title, owner or component" /></div></label>
        <label>Component<select value={component} onChange={(event) => { setComponent(event.target.value); setPage(0); }}><option value="">All</option>{components.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Assignee<select value={assignee} onChange={(event) => { setAssignee(event.target.value); setPage(0); }}><option value="">All</option><option value="unassigned">Unassigned</option>{report.aggregates.assignees.map((row) => row.key !== 'unassigned' && <option key={row.key} value={row.key}>{row.name}</option>)}</select></label>
        <label>Status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="">All</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Priority<select value={priority} onChange={(event) => { setPriority(event.target.value); setPage(0); }}><option value="">All</option>{priorities.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Created from<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(0); }} /></label>
        <label>Created to<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(0); }} /></label>
      </div>
      <DataTable headers={['Issue', 'Summary', 'Project', 'Component / team', 'Owner', 'Status', 'Priority', 'Age', 'Delivery links', 'Product records']}
        rows={report.items.map((issue) => [<IssueKey value={issue.key} onOpen={openIssue} />, issue.summary, issue.project,
          issue.components.join(', ') || '—', issue.assigneeKey ? issue.assignee : 'Unassigned', <StatusBadge value={issue.status} />, issue.priority || '—',
          issue.issueAgeDays === null ? '—' : formatNumber(issue.issueAgeDays, 0) + ' days',
          issue.linkedTechnicalKeys.length ? issue.linkedTechnicalKeys.map((key: string) => <IssueKey key={key} value={key} onOpen={openIssue} />) : '—',
          issue.linkedProducts.length ? issue.linkedProducts.map((record: any) => <span key={record.id}>{record.kind} · {record.title}<br /></span>) : '—'])}
        empty="No matching intake issues." serverPagination={{ offset: report.offset, limit: report.limit, total: report.total, loading, onPageChange: (value) => setPage(Math.floor(value / 50)) }} />
      {matchingRecordCount > 0 && <p className="data-source-note">{matchingRecordCount} explicitly related product record(s) are included in the current report.</p>}
    </section>
    {config?.modules.businessSprint && <section className="panel business-sprint-panel">
      <SectionHeading title="Sprint commitments" hint="Entry states and milestones follow the configured commitment workflow." action={<button className="button tiny secondary" disabled={!sprintReport} onClick={() => void exportSprint()}><FileDown size={15} /> Export</button>} />
      {sprintError && <p className="form-error" role="alert">{sprintError}</p>}
      <div className="table-tools"><label>Sprint<select value={sprintId} onChange={(event) => setSprintId(event.target.value)}>
        {!sprints.length && <option value="">No sprint with a valid boundary</option>}{sprints.map((item) => <option key={item.id} value={item.id}>{item.teamRoute || 'Team determined from issue mapping'} · {item.name} · #{item.id}</option>)}
      </select></label>{sprintReport && <span>{formatDate(sprintReport.sprint.startAt)} – {formatDate(sprintReport.sprint.endAt)}</span>}</div>
      {sprintLoading ? <div className="chart-empty">Rebuilding the sprint view from stored issue history…</div> : sprintReport && <>
        <div className="metric-grid four">
          <MetricCard label="Committed at start" value={formatNumber(sprintReport.teams.reduce((sum, team) => sum + team.committedCount, 0), 0)} hint={formatNumber(sprintReport.teams.reduce((sum, team) => sum + team.committedSP, 0)) + ' story points'} tone="blue" />
          <MetricCard label="Added during sprint" value={formatNumber(sprintReport.teams.reduce((sum, team) => sum + team.addedCount, 0), 0)} hint={formatNumber(sprintReport.teams.reduce((sum, team) => sum + team.addedSP, 0)) + ' story points'} tone="purple" />
          <MetricCard label="Completed" value={formatNumber(sprintReport.teams.reduce((sum, team) => sum + team.completedCount, 0), 0)} hint={formatNumber(sprintReport.teams.reduce((sum, team) => sum + team.completedSP, 0)) + ' story points'} tone="teal" />
          <MetricCard label="Unmapped" value={formatNumber(sprintReport.unmapped.count, 0)} hint="Team attribution unavailable" tone={sprintReport.unmapped.count ? 'amber' : 'teal'} />
        </div>
        {milestones.length > 0 && <DataTable headers={['Team', ...milestones.map((item) => item.label)]} rows={sprintReport.teams.map((team) => [team.team, ...milestones.map((item) => {
          const result = team.milestones[item.id]; return result ? formatNumber(result.count, 0) + ' · ' + formatNumber(result.storyPoints) + ' SP' : '—';
        })])} empty="No milestone evidence for this sprint." />}
        <DataTable headers={['Team', 'Committed', 'Added', 'In scope at end', 'Completed', 'Exited', 'SP increase / decrease']}
          rows={sprintReport.teams.map((team) => [team.team, formatNumber(team.committedCount, 0) + ' · ' + formatNumber(team.committedSP) + ' SP',
            formatNumber(team.addedCount, 0) + ' · ' + formatNumber(team.addedSP) + ' SP', formatNumber(team.inScopeAtEndCount, 0),
            formatNumber(team.completedCount, 0) + ' · ' + formatNumber(team.completedSP) + ' SP', formatNumber(team.exitCount, 0),
            '+' + formatNumber(team.pointIncreaseSP) + ' / −' + formatNumber(team.pointDecreaseSP)])} empty="No configured commitment issues were found in this sprint." />
        {sprintReport.coverage.historyIncompleteCount > 0 || sprintReport.unmapped.count > 0 || sprintReport.attributionFindings.length > 0 ? <div className="callout warning"><AlertTriangle size={15} /><span>{formatNumber(sprintReport.coverage.historyIncompleteCount, 0)} issue histories are incomplete; {formatNumber(sprintReport.unmapped.count, 0)} committed or added issues have no mapped team; {formatNumber(sprintReport.attributionFindings.length, 0)} attribution findings require review.</span></div> : null}
        {sprintReport.unmapped.count > 0 && <DataTable headers={['Excluded issue', 'Project', 'Source team value', 'Why excluded from team totals']}
          rows={sprintReport.unmapped.items.map((item) => [<IssueKey value={item.key} onOpen={openIssue} />, item.project, item.teamValue || '—', (item.teamAttributionFindings || []).map((finding: any) => finding.message).join(' ') || 'No active team source applies.'])}
          empty="No unmapped commitment issues." />}
        <DataTable headers={['Issue', 'Team ID', 'Team', 'Attribution', 'Committed', 'Added', 'Start status / SP', 'End status / SP', 'Completed', 'Milestones']}
          rows={sprintReport.items.map((item) => [<IssueKey value={item.key} onOpen={openIssue} />, item.teamId, item.team, item.teamSource,
            item.committed ? 'Yes' : 'No', item.addedDuring ? 'Yes' : 'No', (item.startStatus || '—') + ' · ' + formatNumber(item.startPoints) + ' SP',
            (item.endStatus || '—') + ' · ' + formatNumber(item.endPoints) + ' SP', item.completedInSprint ? 'Yes' : 'No',
            milestones.filter((milestone) => item.milestoneAt?.[milestone.id]).map((milestone) => milestone.label).join(', ') || '—'])}
          empty="No issue history matches this sprint and workflow policy." />
      </>}
    </section>}
  </>;
}
