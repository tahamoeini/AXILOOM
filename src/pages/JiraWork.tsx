import { useEffect, useState } from 'react';
import { Download, FileDown, Search } from 'lucide-react';
import type { AppConfig, ExportReport, ProductRecord, Snapshot, IssueListResult } from '../types';
import JiraIssueEditor from '../components/JiraIssueEditor';
import { DataTable, IssueKey, MetricCard, SectionHeading, StatusBadge, formatDate, formatNumber } from '../components/Primitives';

const emptyList: IssueListResult = { items: [], total: 0, doneCount: 0, openCount: 0, withoutAssignee: 0, withEpicLink: 0, offset: 0, limit: 50, hasMore: false };
function recordKeys(record: ProductRecord) {
  const payload = record.payload || {};
  return Array.from(new Set([payload.primaryIssueKey, payload.issueKey, payload.requestKey, payload.productKey,
    payload.businessEpicKey, payload.businessIssueKey, payload.issueKeys, payload.businessIssueKeys,
    payload.linkedIssueKeys, payload.relatedIssueKeys, payload.technicalIssueKeys]
    .flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).map((value) => String(value).toUpperCase())));
}

export default function JiraWork({ projects, intake, config, snapshot, openIssue, refresh, notify, pending, clearPending }: {
  projects: string[]; intake: boolean; config: AppConfig | null; snapshot: Snapshot; openIssue: (key: string) => void;
  refresh: () => Promise<void>; notify: (message: string) => void;
  pending?: { kind: string; record?: ProductRecord; nonce: number } | null; clearPending: () => void;
}) {
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [handledNonce, setHandledNonce] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [project, setProject] = useState(projects[0] || '');
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<IssueListResult>(emptyList);
  const [stats, setStats] = useState<IssueListResult>(emptyList);
  const [statuses, setStatuses] = useState<string[]>([]);
  useEffect(() => { if (!projects.includes(project)) setProject(projects[0] || ''); }, [projects.join('|'), project]);
  const isIntake = intake;
  const kind = isIntake ? 'request' : 'action';
  const label = isIntake ? 'Product intake' : 'Commitments';
  const localRecords = snapshot.records.filter((record) => record.kind === kind);
  const triggered = pending?.kind === kind && pending.nonce !== handledNonce;

  useEffect(() => {
    let active = true;
    if (!project) { setStats(emptyList); setStatuses([]); return () => { active = false; }; }
    Promise.all([window.axiloom.listIssues({ project, limit: 1 }), window.axiloom.getIssueFilterOptions(project)])
      .then(([result, options]) => { if (active) { setStats(result); setStatuses(options.statuses); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Issue summary could not be loaded.'); });
    return () => { active = false; };
  }, [project, snapshot.summary.issueCount, snapshot.summary.lastIssueUpdate]);

  useEffect(() => {
    let active = true;
    if (!project) { setList(emptyList); setLoading(false); return () => { active = false; }; }
    setLoading(true); setError('');
    const timer = setTimeout(() => {
      window.axiloom.listIssues({ project, status, query, offset, limit: 50, sortBy: 'updated', sortDirection: 'desc' })
        .then((result) => { if (active) setList(result); })
        .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Issue list could not be loaded.'); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [project, status, query, offset, snapshot.summary.issueCount, snapshot.summary.lastIssueUpdate]);

  async function exportAll(format: 'xlsx' | 'pdf') {
    setError('');
    try {
      const issues: Array<Record<string, any>> = [];
      let nextOffset = 0, total = list.total;
      do {
        const result = await window.axiloom.listIssues({ project, status, query, offset: nextOffset, limit: 250, sortBy: 'updated', sortDirection: 'desc' });
        issues.push(...result.items); total = result.total; nextOffset += result.items.length;
        if (!result.items.length) break;
      } while (nextOffset < total);
      const report: ExportReport = {
        fileName: 'Axiloom-' + project, title: label + ' · ' + project,
        subtitle: total + ' Jira issues. Field values use the active semantic mappings.',
        sheets: [{ name: project, rows: [['Key', 'Summary', 'Type', 'Components', 'Assignee', 'Status', 'Priority', 'Created', 'Updated', 'Requester', 'Department', 'Product owner', 'Story points', 'Epic link'],
          ...issues.map((issue) => [issue.key, issue.summary, issue.issueType, issue.components.join(', '), issue.assignee, issue.status, issue.priority,
            issue.created, issue.updated, issue.requester || '', issue.department || '', issue.productOwner || '', issue.points ?? '', issue.epicLink || ''])] }],
      };
      await (format === 'xlsx' ? window.axiloom.exportXlsx(report) : window.axiloom.exportPdf(report));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Export failed.'); }
  }

  return <>
    <div className="table-tools issue-list-controls">
      <label>Project<select value={project} onChange={(event) => { setOffset(0); setProject(event.target.value); }}><option value="">Select a configured project</option>{projects.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
      <label className="search-field"><span>Search the project</span><div><Search size={15} /><input value={query} onChange={(event) => { setOffset(0); setQuery(event.target.value); }} placeholder="Key, title, or owner" /></div></label>
      <label>Status<select value={status} onChange={(event) => { setOffset(0); setStatus(event.target.value); }}><option value="">All statuses</option>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button className="button secondary" disabled={!project} onClick={async () => { try { await window.axiloom.startSync(false); notify('Jira synchronization started.'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Synchronization did not start.'); } }}>Sync Jira</button>
      <button className="button secondary" disabled={!project} onClick={() => void exportAll('xlsx')}><FileDown size={15} /> XLSX</button>
      <button className="button secondary" disabled={!project} onClick={() => void exportAll('pdf')}><Download size={15} /> PDF</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!project && <div className="callout info">Assign at least one project to this role in setup to browse Jira work.</div>}
    {project && <div className="callout info">This view reads project <b>{project}</b> using the role assigned in setup. Issue details, edit controls, and local product records remain separate and auditable.</div>}
    <div className="metric-grid four"><MetricCard label="Issues" value={formatNumber(stats.total, 0)} /><MetricCard label="Open" value={formatNumber(stats.openCount, 0)} tone="amber" /><MetricCard label="Completed" value={formatNumber(stats.doneCount, 0)} tone="teal" /><MetricCard label="Unassigned" value={formatNumber(stats.withoutAssignee, 0)} tone="red" /></div>
    <section className="panel table-panel">
      <SectionHeading title={project ? label + ' · ' + project : label} hint="Sorted by latest update; 50 issues per page. Completion follows configured workflow semantics and Jira resolution data."
        action={config?.jiraUrl && project ? <button className="button primary" onClick={() => setCreating(true)}>Create issue</button> : undefined} />
      <DataTable headers={['Key', 'Summary', 'Type', 'Components', 'Assignee', 'Requester', 'Department', 'Status', 'Priority', 'Created', 'Updated', 'Links', 'Details']}
        rows={list.items.map((issue) => [<IssueKey value={issue.key} onOpen={openIssue} />, issue.summary, issue.issueType, issue.components.join(', '), issue.assignee,
          issue.requester || '—', issue.department || '—', <StatusBadge value={issue.status} />, issue.priority || '—', formatDate(issue.created), formatDate(issue.updated),
          issue.issueLinks.map((link: any) => <IssueKey key={link.id + '-' + link.key} value={link.key} onOpen={openIssue} />),
          <button className="button tiny secondary" onClick={() => openIssue(issue.key)}>Open details</button>])}
        empty={project ? 'No issues have been imported for this project.' : 'No project is assigned to this role.'} serverPagination={{ offset, limit: 50, total: list.total, loading, onPageChange: setOffset }} />
    </section>
    {localRecords.length > 0 && <section className="panel table-panel"><SectionHeading title="Local product records" hint="These records are preserved separately from Jira issues." />
      <DataTable headers={['Title', 'Owner', 'Status', 'Related issues']} rows={localRecords.map((record) => [record.title, String(record.payload.ownerName || record.payload.ownerKey || '—'),
        String(record.payload.status || '—'), recordKeys(record).map((key) => <IssueKey key={key} value={key} onOpen={openIssue} />)])} />
    </section>}
    {(creating || triggered) && project && <JiraIssueEditor project={project} config={config} close={() => { setCreating(false); if (pending) setHandledNonce(pending.nonce); clearPending(); }}
      saved={async (key, warning) => { notify(warning || key + ' created in Jira.'); await refresh(); openIssue(key); }} />}
  </>;
}
