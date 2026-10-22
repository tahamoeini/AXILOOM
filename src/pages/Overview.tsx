import PeriodAnalytics from '../components/PeriodAnalytics';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarClock, CircleHelp, GitBranch, ListTodo, Rocket, ShieldCheck, Sparkles, Target, TicketCheck } from 'lucide-react';
import type { AppConfig, PageId, Snapshot } from '../types';
import DashboardLayout from '../components/DashboardLayout';
import { DataTable, EmptyState, IssueKey, MetricCard, ProgressBar, SectionHeading, StatusBadge, formatDate, formatNumber, formatPercent } from '../components/Primitives';

export default function Overview({ snapshot, config, goTo, openIssue }: { snapshot: Snapshot; config: AppConfig | null; goTo: (page: PageId) => void; openIssue: (key: string) => void }) {
  const [recentIssues,setRecentIssues]=useState<Array<Record<string,any>>>([]);
  const [currentUser,setCurrentUser]=useState<{key?:string;name?:string;accountId?:string;displayName?:string}|null>(null);
  const [followUpProject,setFollowUpProject]=useState('all');
  const followUpProjects = Array.from(new Set([...(config?.projectRoles.productIntake || []), ...(config?.projectRoles.commitments || [])]));
  const [followUpError,setFollowUpError]=useState('');
  const latest = useMemo(() => {
    const map = new Map<string, Record<string, any>>();
    snapshot.sprintMetrics.forEach((metric) => {
      const existing = map.get(metric.team);
      if (!existing || Date.parse(metric.startDate) > Date.parse(existing.startDate)) map.set(metric.team, metric);
    });
    return Array.from(map.values());
  }, [snapshot.sprintMetrics]);
  useEffect(()=>{ let active=true; window.axiloom.getCurrentUser().then((user)=>{if(active)setCurrentUser(user);}).catch(()=>{if(active)setCurrentUser(null);}); return()=>{active=false;}; },[snapshot.summary.lastIssueUpdate]);
  useEffect(()=>{
    let active=true; const assignee=currentUser?.key||currentUser?.name||currentUser?.accountId;
    if(!assignee){setRecentIssues([]);setFollowUpError('برای فهرست پیگیری‌های شخصی، اتصال Jira و هویت کاربر جاری لازم است.');return()=>{active=false;};}
    if (!followUpProjects.length) { setRecentIssues([]); setFollowUpError('No intake or commitment projects are configured yet.'); return () => { active = false; }; }
    setFollowUpError(''); const projects=followUpProject==='all'?followUpProjects:[followUpProject];
    Promise.all(projects.map((project)=>window.axiloom.listIssues({project,assignee,done:false,limit:25,sortBy:'updated',sortDirection:'desc'})))
      .then((results)=>{if(active)setRecentIssues(results.flatMap((result)=>result.items).sort((a,b)=>Date.parse(b.updated||'')-Date.parse(a.updated||'')).slice(0,15));})
      .catch((error)=>{if(active){setRecentIssues([]);setFollowUpError(error instanceof Error?error.message:'پیگیری‌های فردی از Jira خوانده نشدند.');}});
    return()=>{active=false;};
  },[currentUser,followUpProject,followUpProjects.join('|'),snapshot.summary.issueCount,snapshot.summary.lastIssueUpdate]);
  const projectTotal = Math.max(1, ...snapshot.summary.projectCounts.map((item) => item.count));
  const ready = snapshot.summary.issueCount > 0 || snapshot.records.length > 0;

  if (!ready) return <>
    <div className="welcome-panel"><div className="welcome-content"><span className="welcome-kicker"><Sparkles size={15} /> فضای کاری آماده است</span><h2>گزارش Jira و پیگیری‌های محصول، یک‌جا</h2><p>خروجی issue و sprint را وارد کنید یا Jira داخلی را در تنظیمات وصل کنید. محاسبه‌ها روی همین رایانه انجام می‌شوند.</p><div className="welcome-actions"><button className="button primary" onClick={() => document.querySelector<HTMLInputElement>('input[type=file]')?.click()}><TicketCheck size={16} /> ورود فایل‌های Jira</button><button className="button secondary" onClick={() => goTo('settings')}>تنظیم اتصال Jira <ArrowLeft size={15} /></button></div></div><div className="welcome-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-core"><Rocket size={34} /></div><span className="art-node node-one"><GitBranch size={16} /></span><span className="art-node node-two"><Target size={16} /></span><span className="art-node node-three"><ListTodo size={16} /></span></div></div>
    <div className="intro-grid"><article><span className="intro-icon teal"><TicketCheck size={18} /></span><h3>گزارش فنی</h3><p>تعهد، scope change، carryover، چرخه، work classification و forecast را از دادهٔ خام و نگاشت‌شده بسازید.</p><button onClick={() => goTo('delivery')}>نمای تحویل <ArrowLeft size={14} /></button></article><article><span className="intro-icon blue"><GitBranch size={18} /></span><h3>رابطهٔ کارها</h3><p>درخواست محصول را صریح به Epic یا issue فنی متصل کنید و تحویل را دنبال کنید.</p><button onClick={() => goTo('requests')}>درخواست‌ها <ArrowLeft size={14} /></button></article><article><span className="intro-icon amber"><ShieldCheck size={18} /></span><h3>قابل بررسی</h3><p>منبع، پوشش تاریخچه، فیلدهای ناموجود و تعارض‌های import کنار گزارش دیده می‌شوند.</p><button onClick={() => goTo('quality')}>کیفیت داده <ArrowLeft size={14} /></button></article></div>
  </>;

  return <>
    <DashboardLayout storageKey="overview" widgets={[
      {id:'period-analytics',title:'تحلیل بازه‌ای',content:<PeriodAnalytics snapshot={snapshot} />},
      {id:'overview-metrics',title:'شاخص‌های کلی',content:<section className="metric-grid six">
      <MetricCard label="پرونده‌های Jira" value={formatNumber(snapshot.summary.issueCount, 0)} hint={`${formatNumber(snapshot.summary.projectCounts.length, 0)} پروژه`} tone="blue" icon={<TicketCheck size={17} />} />
      <MetricCard label="اسپرینت‌های قابل تحلیل" value={formatNumber(snapshot.summary.reportableSprints, 0)} hint={`${formatNumber(snapshot.summary.sprintCount, 0)} اسپرینت واردشده`} tone="teal" icon={<CalendarClock size={17} />} />
      <MetricCard label="پیگیری‌های باز" value={formatNumber(snapshot.summary.openActions, 0)} hint={`${formatNumber(snapshot.summary.decisions, 0)} تصمیم ثبت‌شده`} tone="amber" icon={<ListTodo size={17} />} />
      <MetricCard label="درخواست‌های باز" value={formatNumber(snapshot.summary.openRequests, 0)} hint={`${formatNumber(snapshot.summary.outcomes, 0)} پیامد ثبت‌شده`} tone="purple" icon={<Target size={17} />} />
      <MetricCard label="رابطهٔ issue-sprint" value={formatNumber(snapshot.summary.relationCount, 0)} hint="برای محاسبهٔ تحویل" tone="blue" icon={<GitBranch size={17} />} />
      <MetricCard label="هشدارهای داده" value={formatNumber(snapshot.summary.warningCount, 0)} hint={snapshot.quality.incompleteHistories ? `${formatNumber(snapshot.quality.incompleteHistories, 0)} تاریخچهٔ ناقص` : 'پوشش ورودی'} tone={snapshot.summary.warningCount ? 'red' : 'teal'} icon={<CircleHelp size={17} />} />
      </section>},
      {id:'latest-delivery',title:'آخرین تحویل هر تیم',content:<section className="panel sprint-panel">
        <SectionHeading title="آخرین تحویل هر تیم" hint="نسبت‌های تحویل همراه با forecast و سطح اطمینان خوانده شوند." action={<button className="text-link" onClick={() => goTo('delivery')}>تحلیل کامل <ArrowLeft size={14} /></button>} />
        {latest.length ? <DataTable headers={['تیم', 'اسپرینت', 'تکمیل برنامه', 'Scope تکمیل', 'Carryover', 'Forecast', 'اطمینان']} rows={latest.map((metric) => [
          <b className="team-name">{metric.team}</b>, <span>{metric.sprintName}</span>, formatPercent(metric.plannedCompletionRateSP), formatPercent(metric.completionRateSP), formatPercent(metric.carryoverRateSP), `${formatNumber(metric.forecastPlannableSP, 1)} SP`, <span className={`confidence ${String(metric.forecastConfidence).toLowerCase().replaceAll(' ', '-')}`}>{metric.forecastConfidence || 'نامشخص'}</span>,
        ])} /> : <EmptyState title="هنوز اسپرینت قابل تحلیل نیست" detail="دادهٔ issue و sprint وارد کنید و در تنظیمات board را به تیم گزارش‌دهنده نگاشت کنید." action={<button className="button small secondary" onClick={() => goTo('settings')}>نگاشت بردها</button>} />}
      </section>},
      {id:'project-coverage',title:'پوشش پروژه‌ها',content:<section className="panel distribution-panel">
        <SectionHeading title="پوشش پروژه‌ها" hint="تعداد issueهای موجود در فضای محلی" />
        {snapshot.summary.projectCounts.length ? <div className="project-bars">{snapshot.summary.projectCounts.map((row) => <div className="project-bar" key={row.project}><div><b>{row.project}</b><span>{formatNumber(row.count, 0)}</span></div><ProgressBar value={row.count / projectTotal} tone="teal" /></div>)}</div> : <p className="muted-copy">پس از ورود دادهٔ Jira، پوشش پروژه‌ها نمایش داده می‌شود.</p>}
        <div className="panel-footnote"><Sparkles size={14} /> Projects and configured product roles are shown alongside Jira Epic coverage.</div>
      </section>},
      {id:'personal-followups',title:'پیگیری‌های باز من',content:<section className="panel">
        <SectionHeading title="پیگیری‌های باز من" hint={`Open issues in configured intake and commitment projects assigned to ${currentUser?.displayName || currentUser?.name || 'the current user'}.`} action={<button className="text-link" onClick={() => goTo('actions')}>All commitments <ArrowLeft size={14} /></button>} />
        <div className="table-tools"><label>پروژه<select value={followUpProject} onChange={(event)=>setFollowUpProject(event.target.value)}><option value="all">All configured roles</option>{followUpProjects.map((project) => <option key={project} value={project}>{project}</option>)}</select></label><span className="muted-copy">{currentUser?.displayName||currentUser?.name||currentUser?.key||currentUser?.accountId||'کاربر Jira'}</span></div>
        {followUpError&&<p className="callout info">{followUpError}</p>}
        {recentIssues.length ? <DataTable headers={['پروژه','Issue','عنوان','مسئول','وضعیت','موعد']} rows={recentIssues.map((issue)=>[issue.project,<IssueKey value={issue.key} onOpen={openIssue}/>,issue.summary,issue.assignee,<StatusBadge value={issue.status}/>,formatDate(issue.dueDate)])} /> : <EmptyState title="پیگیری باز تخصیص‌یافته پیدا نشد" detail="Open issues are loaded from configured intake and commitment projects and sorted by their latest update." />}
      </section>},
      {id:'product-outcomes',title:'اتصال محصول به تحویل',content:<section className="panel outcomes-panel">
        <SectionHeading title="اتصال محصول به تحویل" hint="فقط رابطه‌هایی که کاربر صریحاً ثبت کرده است." action={<button className="text-link" onClick={() => goTo('requests')}>مشاهدهٔ درخواست‌ها <ArrowLeft size={14} /></button>} />
        {snapshot.links.length ? <div className="link-summary">{snapshot.links.slice(0, 5).map((link) => <div className="link-row" key={link.recordId}><span className="link-type">{link.kind === 'request' ? 'درخواست' : 'Action'}</span><div><b>{link.title}</b><small className="issue-key-list">{link.keys.length ? link.keys.map((key: string) => <IssueKey key={key} value={key} onOpen={openIssue} />) : 'بدون لینک Jira'}</small><small className="table-sub">{link.linkedSprintNames?.slice(-2).join(' · ') || 'بدون Sprint تاریخی'}</small></div><span className="link-count">{link.linkedDoneCount}/{link.linkedIssues.length}<small>{link.linkedSprintCount} Sprint · تکمیل</small></span></div>)}</div> : <div className="relationship-note"><GitBranch size={19} /><div><b>لینک خودکار ساخته نمی‌شود</b><p>کلید Jira یا Epic را صریحاً در درخواست یا Action ثبت کنید تا جریان فنی و محصول کنار هم دیده شود.</p></div></div>}
        <div className="panel-footnote"><CircleHelp size={14} /> Workflow status labels do not create or imply a product decision.</div>
      </section>},
    ]} />
  </>;
}
