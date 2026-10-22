import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, CalendarDays, ClipboardList, Gauge, GitPullRequestArrow, Layers3, ListChecks, RefreshCw, Settings2, ShieldAlert, Target, Upload } from 'lucide-react';
import Layout from './components/Layout';
import Toast from './components/Toast';
const Overview = lazy(() => import('./pages/Overview'));
const Delivery = lazy(() => import('./pages/Delivery'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const ProductWork = lazy(() => import('./pages/ProductWork'));
const JiraWork = lazy(() => import('./pages/JiraWork'));
const Settings = lazy(() => import('./pages/Settings'));
const DataQuality = lazy(() => import('./pages/DataQuality'));
const Definitions = lazy(() => import('./pages/Definitions'));
const BusinessBoard = lazy(() => import('./pages/BusinessBoard'));
import JiraIssueEditor from './components/JiraIssueEditor';
import IssueDetailModal from './components/IssueDetailModal';
import SprintDetailModal from './components/SprintDetailModal';
import { formatNumber, setDisplayPreferences } from './components/Primitives';
import { PageId, RecordKind, Snapshot, AppConfig, ProductRecord } from './types';

const navigation: Array<{ id: PageId; label: string; group: string; icon: typeof Gauge }> = [
  { id: 'overview', label: 'نمای کلی', group: 'گزارش‌ها', icon: Gauge },
  { id: 'delivery', label: 'تحویل', group: 'گزارش‌ها', icon: BarChart3 },
  { id: 'portfolio', label: 'پرتفوی', group: 'گزارش‌ها', icon: Layers3 },
  { id: 'business', label: 'ورودی محصول', group: 'گزارش‌ها', icon: GitPullRequestArrow },
  { id: 'objectives', label: 'هدف‌ها', group: 'محصول', icon: Target },
  { id: 'requests', label: 'درخواست‌ها', group: 'محصول', icon: GitPullRequestArrow },
  { id: 'actions', label: 'تعهدها', group: 'محصول', icon: ListChecks },
  { id: 'decisions', label: 'تصمیم‌ها', group: 'محصول', icon: ClipboardList },
  { id: 'meetings', label: 'جلسه‌ها', group: 'محصول', icon: CalendarDays },
  { id: 'outcomes', label: 'پیامدها', group: 'محصول', icon: Target },
  { id: 'stakeholders', label: 'ذی‌نفعان', group: 'محصول', icon: GitPullRequestArrow },
  { id: 'quality', label: 'کیفیت داده', group: 'داده', icon: ShieldAlert },
  { id: 'definitions', label: 'تعریف شاخص‌ها', group: 'داده', icon: Activity },
  { id: 'settings', label: 'راه‌اندازی و تنظیمات', group: 'داده', icon: Settings2 },
];

function emptySnapshot(): Snapshot {
  return {
    summary: { issueCount: 0, projectCounts: [], epicCount: 0, sprintCount: 0, reportableSprints: 0, relationCount: 0, warningCount: 0, issuesWithoutAssignee: 0, lastIssueUpdate: null, openActions: 0, openRequests: 0, decisions: 0, outcomes: 0 },
    teams: [], projects: [], sprintMetrics: [], people: [], issues: [], issueTotal: 0, epics: [], records: [], links: [],
    business: { summary: {}, issues: [], statuses: [], components: [], assignees: [], componentAssignees: [], agingBuckets: [], monthly: [], ageMethod: '' }, jiraIssueLinks: [], localIssueLinks: [],
    quality: { findings: [], fieldCoverage: {}, unknownFields: [], incompleteHistories: 0, issuesWithoutHistory: 0, conflicts: 0, evidence: { issueRevisions: 0, issueHistoryEvents: 0, sprintRevisions: 0, localLinkEvents: 0 } }, importRuns: [],
  };
}

export default function App() {
  const [page, setPage] = useState<PageId>('overview');
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot());
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [importProgress, setImportProgress] = useState<Record<string, any> | null>(null);
  const [jiraProgress, setJiraProgress] = useState<Record<string, any> | null>(null);
  const [pendingRecord, setPendingRecord] = useState<{ kind: RecordKind; record?: ProductRecord; nonce: number } | null>(null);
  const [newJiraIssue, setNewJiraIssue] = useState(false);
  const [selectedIssueKey, setSelectedIssueKey] = useState('');
  const [selectedSprintId, setSelectedSprintId] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [nextSnapshot, nextConfig] = await Promise.all([window.axiloom.getSnapshot(), window.axiloom.getConfig()]);
    setSnapshot(nextSnapshot);
    setConfig(nextConfig);
    if (nextConfig.migrationStatus === 'unconfigured') setPage('settings');
    setBusy(false);
  }, []);

  useEffect(() => {
    reload().catch((error) => { setBusy(false); setNotice({ tone: 'error', text: error.message || 'فضای محلی باز نشد.' }); });
    const offImport = window.axiloom.onImportProgress(setImportProgress);
    const offJira = window.axiloom.onJiraProgress((progress) => {
      setJiraProgress(progress);
      if (progress.phase === 'done') { setNotice({ tone: 'success', text: 'همگام‌سازی Jira کامل شد.' }); reload(); }
      if (progress.phase === 'error') setNotice({ tone: 'error', text: progress.error || 'همگام‌سازی Jira ناموفق بود.' });
    });
    return () => { offImport(); offJira(); };
  }, [reload]);

  useEffect(() => {
    if (!config) return;
    document.documentElement.lang = config.organization.locale;
    document.documentElement.dir = config.organization.locale.toLowerCase().startsWith('fa') ? 'rtl' : 'ltr';
    setDisplayPreferences(config.organization.locale, config.organization.timeZone);
  }, [config?.organization.locale, config?.organization.timeZone]);

  const refresh = useCallback(async () => {
    await reload();
  }, [reload]);

  async function startJsonImport(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    let workerRef: Worker | null = null;
    setImportProgress({ phase: 'starting', fileName: '', completed: 0, total: selectedFiles.length });
    try {
      await window.axiloom.beginImport();
      const worker = new Worker(new URL('./workers/import.worker.ts', import.meta.url), { type: 'module' });
      workerRef = worker;
      const workerDone = new Promise<void>((resolve, reject) => {
        worker.onerror = (event) => reject(new Error(event.message || 'پردازش فایل import متوقف شد.'));
        worker.onmessage = async (event: MessageEvent<Record<string, any>>) => {
          const message = event.data;
          try {
            if (message.type === 'file') {
              await window.axiloom.registerImportFile(message.metadata);
              worker.postMessage({ type: 'ack', id: message.id });
            } else if (message.type === 'batch') {
              if (message.kind === 'issues') await window.axiloom.importIssueBatch(message.items, message.fileName);
              else await window.axiloom.importSprintBatch(message.items, message.fileName);
              setImportProgress((current) => ({ ...current, fileName: message.fileName, completed: message.completed, total: message.total, phase: message.kind }));
              worker.postMessage({ type: 'ack', id: message.id });
            } else if (message.type === 'done') resolve();
            else if (message.type === 'error') reject(new Error(message.message));
          } catch (error) {
            worker.postMessage({ type: 'ack', id: message.id, error: error instanceof Error ? error.message : 'ثبت batch ناموفق بود.' });
            reject(error);
          }
        };
      });
      worker.postMessage({ type: 'import', files: selectedFiles });
      await workerDone;
      const totals = await window.axiloom.finishImport();
      await reload();
      setNotice({ tone: 'success', text: `ورود تمام شد؛ ${formatNumber(totals.issueCount, 0)} پروندهٔ Jira در فضای محلی ثبت شد.` });
      setImportProgress(null);
      worker.terminate();
      workerRef = null;
    } catch (error) {
      workerRef?.terminate();
      try { await window.axiloom.finishImport(error instanceof Error ? error.message : 'Import نیمه‌تمام ماند.'); } catch { /* Partial pages remain resumable from the database. */ }
      await reload().catch(() => undefined);
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Import ناموفق بود؛ داده‌های ثبت‌شده باقی ماند.' });
      setImportProgress(null);
    }
  }

  async function createRecord(kind: RecordKind, title: string, payload: Record<string, unknown>, id?: string) {
    await window.axiloom.saveRecord({ id, kind, title, payload });
    await reload();
    setNotice({ tone: 'success', text: 'ثبت در فضای محلی ذخیره شد.' });
  }

  async function archiveRecord(record: ProductRecord) {
    if (!window.confirm(`«${record.title}» بایگانی شود؟ سابقهٔ آن در فضای محلی باقی می‌ماند.`)) return;
    await window.axiloom.archiveRecord(record.id);
    await reload();
    setNotice({ tone: 'success', text: 'ثبت بایگانی شد.' });
  }

  function openRecord(kind: RecordKind, record?: ProductRecord) {
    const destination: Record<RecordKind, PageId> = { objective: 'objectives', action: 'actions', request: 'requests', decision: 'decisions', meeting: 'meetings', outcome: 'outcomes', stakeholder: 'stakeholders' };
    setPage(destination[kind]);
    setPendingRecord({ kind, record, nonce: Date.now() });
  }

  function openIssue(key: string) {
    if (key) setSelectedIssueKey(String(key).trim().toUpperCase());
  }

  function openSprint(sprintId: string) {
    if (sprintId) setSelectedSprintId(String(sprintId).trim());
  }

  const pageContent = (contentPage: PageId) => {
    if (contentPage === 'overview') return <Overview snapshot={snapshot} config={config} goTo={setPage} openIssue={openIssue} />;
    if (contentPage === 'delivery') return <Delivery snapshot={snapshot} openSprint={openSprint} />;
    if (contentPage === 'portfolio') return <Portfolio snapshot={snapshot} config={config} openIssue={openIssue} />;
    if (contentPage === 'business') return <BusinessBoard snapshot={snapshot} config={config} openIssue={openIssue} createRecord={openRecord} />;
    if (contentPage === 'requests' || contentPage === 'actions') return <JiraWork key={contentPage} projects={contentPage === 'requests' ? config?.projectRoles.productIntake || [] : config?.projectRoles.commitments || []} intake={contentPage === 'requests'} config={config} snapshot={snapshot} openIssue={openIssue} refresh={refresh} notify={(text) => setNotice({ tone: 'info', text })} pending={pendingRecord} clearPending={() => setPendingRecord(null)} />;
    if (['objectives', 'decisions', 'meetings', 'outcomes', 'stakeholders'].includes(contentPage)) {
      return <ProductWork page={contentPage} snapshot={snapshot} config={config} setConfig={setConfig} jiraUrl={config?.jiraUrl || ''} createRecord={openRecord} saveRecord={createRecord} archiveRecord={archiveRecord} refresh={refresh} notify={(text) => setNotice({ tone: 'success', text })} openIssue={openIssue} pendingRecord={pendingRecord} clearPending={() => setPendingRecord(null)} />;
    }
    if (contentPage === 'quality') return <DataQuality snapshot={snapshot} config={config} />;
    if (contentPage === 'definitions') return <Definitions />;
    return <Settings config={config} setConfig={setConfig} snapshot={snapshot} refresh={refresh} notify={setNotice} jiraProgress={jiraProgress} isOnboarding={config?.migrationStatus === 'unconfigured'} />;
  };

  const enabledNavigation = config?.migrationStatus === 'unconfigured'
    ? navigation.filter((item) => item.id === 'settings')
    : navigation.filter((item) => item.id === 'settings' || item.id === 'quality' || item.id === 'definitions'
      || (item.id === 'overview')
      || (item.id === 'delivery' && config?.modules.delivery)
      || (item.id === 'portfolio' && config?.modules.portfolio)
      || (item.id === 'objectives' && config?.modules.objectives)
      || (item.id === 'business' && config?.modules.productIntake)
      || (item.id === 'requests' && config?.modules.productIntake)
      || (item.id === 'actions' && config?.modules.commitments)
      || (['decisions', 'meetings', 'stakeholders'].includes(item.id) && config?.modules.productIntelligence)
      || (item.id === 'outcomes' && (config?.modules.outcomes || config?.modules.productIntelligence)));
  const contentPage = enabledNavigation.some((item) => item.id === page) ? page : 'settings';
  const activeNav = navigation.find((item) => item.id === contentPage) || navigation[0];
  const direction = config?.organization.locale.toLowerCase().startsWith('fa') ? 'rtl' : 'ltr';

  const headerActions = (
    <>
      {config?.jiraUrl && <button className="button primary" onClick={() => setNewJiraIssue(true)}>ایجاد issue</button>}
      <button className="button secondary" onClick={() => fileInput.current?.click()}><Upload size={16} /> ورود JSON</button>
      <input ref={fileInput} type="file" multiple hidden onChange={(event) => { startJsonImport(event.target.files); event.currentTarget.value = ''; }} />
      <button className="icon-button" title="بازخوانی فضای محلی" onClick={() => refresh()}><RefreshCw size={17} /></button>
    </>
  );

  return (
    <>
      <Layout navigation={enabledNavigation} page={contentPage} setPage={setPage} title={activeNav.label} actions={headerActions} summary={snapshot.summary} loading={busy} direction={direction}>
        {busy ? <div className="loading-screen"><div className="spinner" />در حال خواندن فضای محلی…</div> : <Suspense fallback={<div className="loading-screen"><div className="spinner" />در حال آماده‌سازی این صفحه…</div>}>{pageContent(contentPage)}</Suspense>}
      </Layout>
      {notice && <Toast notice={notice} dismiss={() => setNotice(null)} />}
      {importProgress && <div className="import-ribbon"><span className="spinner small" /><span>{importProgress.fileName || 'آماده‌سازی ورود'} </span><span>{formatNumber(Number(importProgress.completed || 0), 0)} / {formatNumber(Number(importProgress.total || 0), 0)}</span></div>}
      {newJiraIssue && <JiraIssueEditor config={config} close={() => setNewJiraIssue(false)} saved={async (key, warning) => { setNotice({ tone: 'info', text: warning || `${key} ایجاد شد.` }); await reload(); openIssue(key); }} />}
      {selectedIssueKey && <IssueDetailModal key={selectedIssueKey} issueKey={selectedIssueKey} jiraUrl={config?.jiraUrl || ''} config={config} snapshot={snapshot} close={() => setSelectedIssueKey('')} openIssue={openIssue} refresh={refresh} notify={(text) => setNotice({ tone: 'success', text })} />}
      {selectedSprintId && <SprintDetailModal sprintId={selectedSprintId} jiraUrl={config?.jiraUrl || ''} snapshot={snapshot} close={() => setSelectedSprintId('')} openIssue={openIssue} />}
    </>
  );
}
