import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, FileDown, Filter, GitBranch, Layers3, Search, TicketCheck } from 'lucide-react';
import type { AppConfig, ExportReport, IssueListFilters, IssueListResult, Snapshot } from '../types';
import { createReportScope } from '../reporting';
import { DataTable, IssueKey, MetricCard, ProgressBar, SectionHeading, StatusBadge, formatDate, formatNumber } from '../components/Primitives';
import EpicDetailModal from '../components/EpicDetailModal';

export default function Portfolio({ snapshot, config, openIssue }: { snapshot: Snapshot; config: AppConfig | null; openIssue: (key: string) => void }) {
  const [project, setProject] = useState('');
  const [teamId, setTeamId] = useState('');
  const [issueType, setIssueType] = useState('');
  const [workflowScope, setWorkflowScope] = useState<'all' | 'delivery' | 'intake' | 'commitment'>('all');
  const [status, setStatus] = useState('');
  const [epic, setEpic] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tab, setTab] = useState<'epics' | 'issues'>('epics');
  const [issueOptions, setIssueOptions] = useState<{projects:string[];issueTypes:string[];statuses:string[];epics:Array<{key:string;summary:string}>}>({projects:[],issueTypes:[],statuses:[],epics:[]});
  const [issueList, setIssueList] = useState<IssueListResult>({items:[],total:0,doneCount:0,openCount:0,withoutAssignee:0,withEpicLink:0,offset:0,limit:50,hasMore:false});
  const [issueStats, setIssueStats] = useState<{issueCount:number;openCount:number;epicLinkedCount:number}>({issueCount:snapshot.summary.issueCount,openCount:0,epicLinkedCount:0});
  const [issueOffset, setIssueOffset] = useState(0);
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState('');
  const [selectedEpic, setSelectedEpic] = useState<{ key: string; summary?: string; epicName?: string } | null>(null);
  const selectedWorkflowScope = workflowScope === 'all' ? undefined : workflowScope;
  const issueFilters = useMemo<IssueListFilters>(() => ({ project, issueType, status, epic, query, createdFrom: from, createdTo: to, workflowScope: selectedWorkflowScope }),
    [project, issueType, status, epic, query, from, to, selectedWorkflowScope]);

  useEffect(() => {
    let active = true;
    window.axiloom.getIssueFilterOptions()
      .then((options) => { if (active) setIssueOptions(options); })
      .catch((error) => { if (active) setIssueError(error instanceof Error ? error.message : 'فیلترهای issue خوانده نشدند.'); });
    return () => { active = false; };
  }, [snapshot.summary.issueCount, snapshot.summary.lastIssueUpdate]);

  useEffect(() => {
    if (tab !== 'issues') return;
    let active = true;
    setIssueLoading(true); setIssueError('');
    const timer = setTimeout(() => {
      window.axiloom.listIssues({ ...issueFilters, offset: issueOffset, limit: 50, sortBy: 'key' }).then((result) => {
        if (active) {
          setIssueList(result);
          setIssueStats({ issueCount: result.total, openCount: result.openCount, epicLinkedCount: result.withEpicLink });
        }
      })
        .catch((error) => { if (active) setIssueError(error instanceof Error ? error.message : 'فهرست issue خوانده نشد.'); })
        .finally(() => { if (active) setIssueLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [tab, issueFilters, query, issueOffset, snapshot.summary.issueCount, snapshot.summary.lastIssueUpdate]);

  const filteredIssues = issueList.items;
  const filteredEpics = useMemo(() => snapshot.epics.filter((item) => (!project || item.project === project)
    && (!teamId || (item.teamGroups || []).some((group: any) => group.teamId === teamId))
    && (!query || `${item.key} ${item.summary} ${item.epicName}`.toLowerCase().includes(query.toLowerCase()))), [snapshot.epics, project, teamId, query]);
  const active = issueStats.openCount;
  const mapped = issueStats.epicLinkedCount;
  const intakeCount = snapshot.summary.projectCounts.filter((item) => config?.projectRoles.productIntake?.includes(item.project)).reduce((sum, item) => sum + item.count, 0);
  const makeReport = (allIssues: Array<Record<string, any>>): ExportReport => {
    const epicSheet = { name: 'Epics', rows: [['Epic Key', 'نام', 'پروژه', 'وضعیت', 'مالک', 'آیتم مرتبط', 'آیتم تکمیل', 'SP فرزند', 'پروژه‌های فنی', 'تیم‌های دارای فرزند', 'ثبت محصول متصل'], ...filteredEpics.map((row) => [row.key, row.summary || row.epicName, row.project, row.status, row.assignee, row.childrenCount, row.childrenDone, row.childStoryPoints, row.technicalProjects.join(', '), (row.teamGroups || []).map((group: any) => `${group.team} (${group.issueCount})`).join(', '), row.linkedProducts.length])] };
    const issueSheet = { name: 'Issues', rows: [['Key', 'عنوان', 'پروژه', 'نوع', 'وضعیت', 'مسئول', 'Story Point', 'Epic Link', 'Created', 'Updated'], ...allIssues.map((row) => [row.key, row.summary, row.project, row.issueType, row.status, row.assignee, row.points, row.epicLink, row.created, row.updated])] };
    const activeRows = tab === 'epics' ? filteredEpics.length : allIssues.length;
    return {
      fileName: `Axiloom-portfolio-${tab}`,
      title: tab === 'epics' ? 'Portfolio · filtered Epics' : 'Portfolio · filtered issues',
      subtitle: `${formatNumber(activeRows, 0)} rows from the active Portfolio tab. Each Epic uses reported child-issue attribution.`,
      scope: createReportScope(snapshot, {
        view: tab === 'epics' ? 'Portfolio Epics' : 'Portfolio issues', semantics: 'active-tab',
        filters: tab === 'epics'
          ? { project, teamId: config?.teams.find((team) => team.id === teamId)?.name || '', query }
          : { ...issueFilters, workflowScope: workflowScope === 'all' ? 'All configured project roles' : workflowScope },
        filterLabels: { project: 'Project', teamId: 'Delivery team', issueType: 'Issue type', status: 'Status', epic: 'Epic', query: 'Search', createdFrom: 'Created from', createdTo: 'Created through', workflowScope: 'Workflow scope' },
        primaryRowCount: activeRows, matchingRowCount: activeRows,
        notes: ['Workspace-level data-quality counts are not narrowed by these filters.'],
      }),
      sheets: tab === 'epics' ? [epicSheet] : [issueSheet],
    };
  };
  async function exportFiltered(format:'xlsx'|'pdf') {
    const all: Array<Record<string, any>> = [];
    let offset = 0; let total = issueList.total;
    if (tab === 'issues') do {
      const result = await window.axiloom.listIssues({ ...issueFilters, offset, limit: 250, sortBy: 'key' });
      all.push(...result.items); total = result.total; offset += result.items.length;
      if (!result.items.length) break;
    } while (offset < total);
    const report = makeReport(all);
    await (format === 'xlsx' ? window.axiloom.exportXlsx(report) : window.axiloom.exportPdf(report));
  }

  function setFilter(update: () => void) { setIssueOffset(0); update(); }

  return <>
    {tab === 'issues' ? <section className="metric-grid four">
      <MetricCard label="Epicهای Jira" value={formatNumber(snapshot.summary.epicCount, 0)} hint="Workspace-wide; not narrowed by issue filters." tone="blue" icon={<Layers3 size={16} />} />
      <MetricCard label="پروندهٔ باز" value={formatNumber(active, 0)} hint={`${formatNumber(issueStats.issueCount, 0)} issues matching current filters`} tone="teal" icon={<TicketCheck size={16} />} />
      <MetricCard label="Epic Link معتبر در خروجی" value={formatNumber(mapped, 0)} hint="Matches the active issue filters." tone="purple" icon={<GitBranch size={16} />} />
      <MetricCard label="پروژه‌های intake" value={formatNumber(intakeCount, 0)} hint="Workspace-wide project-role count; not narrowed by filters." tone="amber" icon={<Filter size={16} />} />
    </section> : <div className="callout info">Epic filters, table rows, and exports share the same project, team, and search scope. Data-quality context remains workspace-wide.</div>}

    <section className="panel portfolio-filter">
      <div className="filter-caption"><span className="filter-mark"><Search size={16} /></span><div><b>جست‌وجو و برش داده</b><small>{tab === 'epics' ? 'Epic table and export: project, delivery team, and search.' : 'Issue table, matching counts, and export: project, workflow scope, type, status, Epic, and created dates.'}</small></div></div>
      <div className="portfolio-controls">
        <label className="search-field"><span>متن یا کلید Jira</span><div><Search size={15} /><input value={query} onChange={(event) => setFilter(() => setQuery(event.target.value))} placeholder="کلید یا بخشی از عنوان" /></div></label>
        <label>پروژه<select value={project} onChange={(event) => setFilter(() => setProject(event.target.value))}><option value="">همه</option>{issueOptions.projects.map((value) => <option key={value}>{value}</option>)}</select></label>
        {tab === 'issues' && <label>سیاست Workflow<select value={workflowScope} onChange={(event) => setFilter(() => setWorkflowScope(event.target.value as typeof workflowScope))}><option value="all">ترکیب نقش‌های پروژه</option><option value="delivery">تحویل</option><option value="intake">درخواست محصول</option><option value="commitment">تعهد</option></select></label>}
        {tab === 'epics' && <label>تیم تحویل<select value={teamId} onChange={(event) => setFilter(() => setTeamId(event.target.value))}><option value="">همهٔ تیم‌ها</option>{(config?.teams || []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
        {tab === 'issues' && <label>Epic<select value={epic} onChange={(event) => setFilter(() => setEpic(event.target.value))}><option value="">همهٔ Epicها</option>{issueOptions.epics.map((item) => <option key={item.key} value={item.key}>{item.key} · {item.summary}</option>)}</select></label>}
        {tab === 'issues' && <label>نوع کار<select value={issueType} onChange={(event) => setFilter(() => setIssueType(event.target.value))}><option value="">همه</option>{issueOptions.issueTypes.map((value) => <option key={value}>{value}</option>)}</select></label>}
        {tab === 'issues' && <label>وضعیت<select value={status} onChange={(event) => setFilter(() => setStatus(event.target.value))}><option value="">همه</option>{issueOptions.statuses.map((value) => <option key={value}>{value}</option>)}</select></label>}
        {tab === 'issues' && <label>ایجاد از<input type="date" value={from} onChange={(event) => setFilter(() => setFrom(event.target.value))} /></label>}
        {tab === 'issues' && <label>تا<input type="date" value={to} onChange={(event) => setFilter(() => setTo(event.target.value))} /></label>}
        <div className="filter-actions"><button className="button tiny secondary" onClick={() => void exportFiltered('xlsx')}><FileDown size={15} /> XLSX · {tab === 'epics' ? 'Filtered Epics' : 'All matching issues'}</button><button className="button tiny secondary" onClick={() => void exportFiltered('pdf')}><Download size={15} /> PDF · {tab === 'epics' ? 'Filtered Epics' : 'All matching issues'}</button></div>
      </div>
      {issueError && <p className="form-error" role="alert">{issueError}</p>}
    </section>

    <div className="subtabs"><button className={tab === 'epics' ? 'active' : ''} onClick={() => setTab('epics')}><Layers3 size={15} /> Epic و پرتفوی</button><button className={tab === 'issues' ? 'active' : ''} onClick={() => setTab('issues')}><TicketCheck size={15} /> پرونده‌های Jira</button><span className="subtabs-count">{tab === 'epics' ? filteredEpics.length : issueList.total} ردیف{tab === 'issues' ? ' در نتیجهٔ فیلتر' : ` از ${snapshot.epics.length}`}</span></div>

    {tab === 'epics' ? <section className="panel table-panel">
      <SectionHeading title="Epicها" hint="Parent and child links use Jira's configured mapping. Team counts include distinct linked children; one issue can appear under different teams across sprints." />
      <DataTable headers={['Epic', 'نام / عنوان', 'پروژه', 'وضعیت', 'مالک', 'آیتم‌های فرزند', 'تیم‌های تحویل', 'پروژه‌های delivery', 'رابطهٔ ثبت محصول', 'گزارش']} rows={filteredEpics.map((item) => [<IssueKey value={item.key} onOpen={openIssue} />, <span className="row-title">{item.summary || item.epicName || 'بدون نام'}</span>, <span className="project-chip">{item.project}</span>, <StatusBadge value={item.status} />, item.assignee, <span><b>{item.childrenDone}/{item.childrenCount}</b><ProgressBar value={item.childrenCount ? item.childrenDone / item.childrenCount : null} /></span>, (item.teamGroups || []).length ? item.teamGroups.map((group: any) => <span className="project-chip" key={group.teamId}>{group.team} · {formatNumber(group.issueCount, 0)}</span>) : '—', item.technicalProjects.length ? item.technicalProjects.map((project: string) => <span className="project-chip" key={project}>{project}</span>) : '—', item.linkedProducts.length ? item.linkedProducts.map((link: any) => <span className="linked-product" key={link.id}>{link.kind} · {link.title}</span>) : <span className="muted-copy">No linked record</span>, <button className="button tiny secondary" onClick={() => setSelectedEpic({ key: String(item.key), summary: item.summary, epicName: item.epicName })}>گزارش و تسک‌ها</button>])} empty="Epicی در دادهٔ واردشده نیست." />
    </section> : <section className="panel table-panel">
      <SectionHeading title="Issueهای واردشده" hint="متن خام از Jira می‌آید؛ اطلاعات شخصی و شرح کامل issue در این فهرست نمایش داده نمی‌شود." />
      <DataTable headers={['Key', 'عنوان', 'پروژه', 'نوع', 'وضعیت', 'مسئول فعلی', 'SP', 'Epic Link', 'Sprint ID', 'بروزرسانی']} rows={filteredIssues.map((item) => [<IssueKey value={item.key} onOpen={openIssue} />, <span className="row-title">{item.summary || '—'}</span>, <span className="project-chip">{item.project}</span>, item.issueType, <StatusBadge value={item.status} />, item.assignee, formatNumber(item.points), item.epicLink ? <IssueKey value={item.epicLink} onOpen={openIssue} /> : '—', item.currentSprintIds.length ? item.currentSprintIds.join('، ') : '—', formatDate(item.updated)])} empty="Issueای با این فیلترها پیدا نشد." serverPagination={{offset:issueList.offset,limit:issueList.limit,total:issueList.total,loading:issueLoading,onPageChange:setIssueOffset}} />

    </section>}
    <div className="callout info"><GitBranch size={15} /><span>Relationships use Jira links or issue keys explicitly stored in product records. Similar titles do not create a link.</span></div>
    {selectedEpic && <EpicDetailModal epic={selectedEpic} snapshot={snapshot} adhocTag={config?.adhocTag || 'Ad hoc'} close={() => setSelectedEpic(null)} openIssue={openIssue} />}
  </>;
}
