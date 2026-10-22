import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Database, ExternalLink, GitBranch, History, Link2, Plus, Trash2, X } from 'lucide-react';
import JiraManagement from './JiraManagement';
import type { IssueDetails, Snapshot } from '../types';
import { DataTable, IssueKey, StatusBadge, formatDate, formatNumber, formatTime } from './Primitives';

function formatValue(value: unknown) {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function localTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? `${formatDate(value)} · ${formatTime(value)}` : value || '—';
}

function recordKeys(record: Snapshot['records'][number]) {
  const payload = record.payload;
  return [payload.primaryIssueKey, payload.businessEpicKey, payload.businessIssueKey,
    ...(Array.isArray(payload.relatedIssueKeys) ? payload.relatedIssueKeys : []),
    ...(Array.isArray(payload.businessIssueKeys) ? payload.businessIssueKeys : []),
    ...(Array.isArray(payload.linkedIssueKeys) ? payload.linkedIssueKeys : []),
    ...(Array.isArray(payload.technicalIssueKeys) ? payload.technicalIssueKeys : [])]
    .filter(Boolean).map((key) => String(key).toUpperCase());
}

export default function IssueDetailModal({ issueKey, jiraUrl, config, snapshot, close, openIssue, refresh, notify }: {
  issueKey: string;
  jiraUrl: string;
  config: import('../types').AppConfig | null;
  snapshot: Snapshot;
  close: () => void;
  openIssue: (key: string) => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [live, setLive] = useState(false);
  const [details, setDetails] = useState<IssueDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityData,setActivityData]=useState<any>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'links' | 'activity' | 'fields' | 'jira'>('summary');
  const [error, setError] = useState('');
  const [relatedKey, setRelatedKey] = useState('');
  const [linkNote, setLinkNote] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  const loadDetails = useCallback(async (includeActivity = false) => {
    setLoading(true);
    setLive(false);
    setError('');
    setActivityData(null);
    setActivityLoaded(false);
    try {
      const value = await window.axiloom.getIssueDetails(issueKey, includeActivity);
      setDetails(value);
      setActivityLoaded(Boolean(value && includeActivity));
      if (!value) setError('این کلید در دادهٔ محلی پیدا نشد.');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'جزئیات Jira خوانده نشد.');
    } finally { setLoading(false); }
  }, [issueKey]);

  useEffect(() => { void loadDetails(); }, [loadDetails]);
  async function loadLive(includeActivity = false) {
    const value = await window.axiloom.getLiveIssue(issueKey, includeActivity);
    setDetails(value); setLive(true);
    if (includeActivity) {
      const raw = value.raw || {};
      const history = raw.changelog || {};
      const comment = raw.fields?.comment || {};
      const worklog = raw.fields?.worklog || {};
      setActivityData({
        hasMore: false,
        history: { histories: history.histories || [], total: Number(history.total || 0), available: (history.histories || []).length, offset: 0, limit: (history.histories || []).length, hasMore: false, complete: Boolean(value.historyComplete) },
        comments: { items: comment.comments || [], total: Number(comment.total || 0), available: (comment.comments || []).length, offset: 0, limit: (comment.comments || []).length, hasMore: false },
        worklogs: { items: worklog.worklogs || [], total: Number(worklog.total || 0), available: (worklog.worklogs || []).length, offset: 0, limit: (worklog.worklogs || []).length, hasMore: false },
      });
      setActivityLoaded(true);
    } else {
      const localActivity = await window.axiloom.getIssueActivity(issueKey, 0, 50);
      setActivityData(localActivity ? { ...localActivity, hasMore: Boolean(localActivity.history.hasMore || localActivity.comments.hasMore || localActivity.worklogs.hasMore) } : null);
      setActivityLoaded(Boolean(localActivity));
    }
  }
  async function selectTab(tab: typeof activeTab) {
    setActiveTab(tab);
    if (tab === 'fields') { setActivityLoaded(true); return; }
    if (tab === 'jira') { setActivityLoaded(true); return; }
    if (tab !== 'activity' || activityLoaded || !details) return;
    setActivityLoading(true);
    setError('');
    try {
      const value = await window.axiloom.getIssueActivity(issueKey,0,50);
      if (!value) throw new Error('این issue دیگر در دادهٔ محلی موجود نیست.');
      setActivityData({ ...value, hasMore: Boolean(value.history.hasMore || value.comments.hasMore || value.worklogs.hasMore) });
      setActivityLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تاریخچه و کامنت‌ها خوانده نشدند.');
    } finally { setActivityLoading(false); }
  }
  async function loadMoreActivity() {
    if(!activityData?.hasMore && !activityData?.history?.hasMore && !activityData?.comments?.hasMore && !activityData?.worklogs?.hasMore)return;
    const offset=activityData.history.offset+activityData.history.limit;
    setActivityLoading(true); setError('');
    try {
      const next=await window.axiloom.getIssueActivity(issueKey,offset,50);
      if(!next)throw new Error('این issue دیگر در دادهٔ محلی موجود نیست.');
      setActivityData((current:any)=>({...next,hasMore:Boolean(next.history.hasMore||next.comments.hasMore||next.worklogs.hasMore),history:{...next.history,histories:[...(current?.history?.histories||[]),...next.history.histories]},comments:{...next.comments,items:[...(current?.comments?.items||[]),...next.comments.items]},worklogs:{...next.worklogs,items:[...(current?.worklogs?.items||[]),...next.worklogs.items]}}));
    }catch(e){setError(e instanceof Error?e.message:'ادامهٔ تاریخچه خوانده نشد.');}
    finally{setActivityLoading(false);}
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !savingLink) close(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [savingLink, close]);

  const fields = details?.raw?.fields || {};
  const changelog = details?.raw?.changelog || {};
  const histories = Array.isArray(activityData?.history?.histories) ? activityData.history.histories : [];
  const comments = activityData?.comments?.items || [];
  const worklogs = activityData?.worklogs?.items || [];
  const directJiraLinks = Array.isArray(fields.issuelinks) ? fields.issuelinks.flatMap((link: any) => {
    const rows = [];
    if (link?.outwardIssue?.key) rows.push({ id: `${link.id}-out`, key: link.outwardIssue.key, relationship: link.type?.outward || link.type?.name || 'مرتبط', summary: link.outwardIssue.fields?.summary || '' });
    if (link?.inwardIssue?.key) rows.push({ id: `${link.id}-in`, key: link.inwardIssue.key, relationship: link.type?.inward || link.type?.name || 'مرتبط', summary: link.inwardIssue.fields?.summary || '' });
    return rows;
  }) : [];
  const linkedByOtherSide = snapshot.jiraIssueLinks.filter((link) => link.sourceKey === issueKey || link.targetKey === issueKey).map((link) => ({
    id: link.id,
    key: link.sourceKey === issueKey ? link.targetKey : link.sourceKey,
    relationship: link.relationship,
    summary: '',
  }));
  const jiraLinks = Array.from(new Map([...directJiraLinks, ...linkedByOtherSide].map((link) => [`${link.key}|${link.relationship}`, link])).values());
  const relatedRecords = useMemo(() => snapshot.records.filter((record) => recordKeys(record).includes(issueKey)), [snapshot.records, issueKey]);
  const productLinkedKeys = Array.from(new Set(relatedRecords.flatMap((record) => recordKeys(record)).filter((key) => key !== issueKey)));

  async function addLink(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSavingLink(true);
    try {
      const intakeProjects = config?.projectRoles.productIntake || [];
      const deliveryProjects = config?.projectRoles.technicalDelivery || [];
      const currentProject = String(fields.project?.key || details?.project || '').toUpperCase();
      const targetProject = relatedKey.split('-')[0]?.toUpperCase();
      if (intakeProjects.includes(currentProject) && deliveryProjects.includes(currentProject)) throw new Error('This project has both intake and delivery roles; use a product record link to disambiguate.');
      const intakeIssueKey = intakeProjects.includes(currentProject) ? issueKey : relatedKey;
      const deliveryIssueKey = deliveryProjects.includes(currentProject) ? issueKey : relatedKey;
      if (!intakeProjects.includes(currentProject) && !deliveryProjects.includes(currentProject)) throw new Error('Assign this project to the product-intake or technical-delivery role before creating local cross-links.');
      if (intakeProjects.includes(currentProject) && !deliveryProjects.some((project) => project.toUpperCase() === targetProject)
        || deliveryProjects.includes(currentProject) && !intakeProjects.some((project) => project.toUpperCase() === targetProject)) throw new Error('The related issue must belong to the opposite configured project role.');
      await window.axiloom.saveLocalIssueLink({ intakeIssueKey, deliveryIssueKey, relationship: 'implements', note: linkNote });
      setRelatedKey('');
      setLinkNote('');
      await Promise.all([loadDetails(activityLoaded), refresh()]);
      notify('ارتباط محلی محصول و تحویل ثبت شد؛ Jira تغییر نکرد.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ارتباط ذخیره نشد.');
    } finally { setSavingLink(false); }
  }

  async function removeLink(id: string) {
    await window.axiloom.removeLocalIssueLink(id);
    await Promise.all([loadDetails(activityLoaded), refresh()]);
    notify('ارتباط محلی برداشته شد و سابقهٔ آن باقی ماند.');
  }

  async function openInJira() {
    setError('');
    try { await window.axiloom.openJiraIssue(issueKey); }
    catch (openError) { setError(openError instanceof Error ? openError.message : 'بازکردن Issue در Jira ناموفق بود.'); }
  }

  const currentProject = String(fields.project?.key || details?.project || '').toUpperCase();
  const hasIntakeRole = (config?.projectRoles.productIntake || []).some((project) => project.toUpperCase() === currentProject);
  const hasDeliveryRole = (config?.projectRoles.technicalDelivery || []).some((project) => project.toUpperCase() === currentProject);
  const semanticValue = (semanticKey: string) => {
    const mapping = (config?.fieldMappings || []).filter((item) => item.semanticKey === semanticKey && (!item.projectKey || item.projectKey.toUpperCase() === currentProject) && (!item.issueTypeId || item.issueTypeId === String(fields.issuetype?.id || '')))
      .sort((a, b) => Number(Boolean(b.projectKey)) + Number(Boolean(b.issueTypeId)) - Number(Boolean(a.projectKey)) - Number(Boolean(a.issueTypeId)))[0];
    return mapping?.providerFieldId ? fields[mapping.providerFieldId] : undefined;
  };
  const epicValue = semanticValue('epicLink');
  const epicKey = typeof epicValue === 'object' ? epicValue.key || epicValue.value : epicValue;
  return <div className="modal-backdrop issue-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingLink) close(); }}>
    <section className="record-modal issue-detail-modal" role="dialog" aria-modal="true" aria-label={`جزئیات ${issueKey}`}>
      <div className="modal-heading issue-detail-heading"><div><span className="eyebrow">Jira · پروندهٔ محلی</span><h2><IssueKey value={issueKey} onOpen={openIssue} /> {fields.summary || ''}</h2><div className="issue-detail-subtitle"><StatusBadge value={fields.status?.name || 'نامشخص'} /><span>{fields.project?.key || details?.project || '—'} · {fields.issuetype?.name || '—'}</span><span>بروزرسانی {formatDate(fields.updated || '')}</span></div></div><div className="issue-detail-heading-actions"><button type="button" className="button tiny secondary jira-entity-open" onClick={() => void openInJira()} disabled={!jiraUrl} title={jiraUrl ? 'بازکردن این Issue در Jira' : 'ابتدا آدرس Jira را در تنظیمات ذخیره کنید'} aria-label={`بازکردن ${issueKey} در Jira`}><ExternalLink size={13} /> Jira</button><button className="icon-button" onClick={close} aria-label="بستن"><X size={18} /></button></div></div>
      {loading ? <div className="modal-loading"><span className="spinner" />در حال خواندن اطلاعات پایهٔ این issue…</div> : error && !details ? <div className="callout amber"><AlertCircle size={16} />{error}<button className="button secondary" onClick={async () => { setLoading(true); try { await loadLive(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'دریافت از Jira ناموفق بود.'); } finally { setLoading(false); } }}>دریافت از Jira</button></div> : <>
        {details && <nav className="issue-detail-tabs" role="tablist" aria-label="بخش‌های جزئیات issue">{([
          ['summary', 'اطلاعات'], ['links', 'ارتباطات'], ['activity', 'فعالیت و سابقه'], ['fields', 'همهٔ فیلدها'], ['jira', 'مدیریت Jira'],
        ] as Array<[typeof activeTab, string]>).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? 'active' : ''} onClick={() => void selectTab(tab)}>{label}</button>)}</nav>}
        {error && details && <p className="form-error" role="alert">{error}</p>}
        {activityLoading && <div className="modal-loading compact"><span className="spinner small" />در حال دریافت سابقه و کامنت‌های همین issue…</div>}
        {details && activeTab === 'jira' && activityLoaded && <JiraManagement key={issueKey} details={details} snapshot={snapshot} config={config} live={live} reload={loadLive} refresh={refresh} openIssue={openIssue} notify={notify} deleted={close} />}
        {activeTab === 'summary' && <section className="issue-detail-grid">
          <div><span>مسئول فعلی</span><b>{fields.assignee?.displayName || fields.assignee?.name || 'تخصیص‌نیافته'}</b></div>
          <div><span>Reporter</span><b>{fields.reporter?.displayName || fields.reporter?.name || '—'}</b></div>
          <div><span>Component / تیم</span><b>{(fields.components || []).map((item: any) => item.name).filter(Boolean).join('، ') || '—'}</b></div>
          <div><span>Epic Link</span><b>{epicKey ? <IssueKey value={String(epicKey)} onOpen={openIssue} /> : fields.parent?.key ? <IssueKey value={String(fields.parent.key)} onOpen={openIssue} /> : '—'}</b></div>
          <div><span>{config?.fieldMappings.find((item) => item.semanticKey === 'storyPoints' && (!item.projectKey || item.projectKey.toUpperCase() === currentProject))?.semanticKey || 'Story Points'}</span><b>{formatNumber(semanticValue('storyPoints'))}</b></div>
          <div><span>اولویت</span><b>{fields.priority?.name || '—'}</b></div>
          <div><span>ایجاد</span><b>{formatDate(fields.created || '')}</b></div>
          <div><span>حل / انتشار</span><b>{formatDate(fields.resolutiondate || '')}</b></div>
        </section>}

        {activeTab === 'links' && <>
        {(hasIntakeRole || hasDeliveryRole) && <section className="issue-detail-section">
          <h3><GitBranch size={15} /> پیوند صریح محصول و تحویل</h3>
          <p>این پیوند فقط در فضای محلی Axiloom ثبت می‌شود و هیچ تغییری در Jira نمی‌دهد. کلید مقصد باید از نقش پروژهٔ مقابل باشد.</p>
          <form className="issue-link-form" onSubmit={addLink}><label>کلید Issue مرتبط<input value={relatedKey} onChange={(event) => setRelatedKey(event.target.value.toUpperCase())} placeholder="PROJECT-123" required /></label><label>یادداشت ارتباط<input value={linkNote} onChange={(event) => setLinkNote(event.target.value)} placeholder="اختیاری" /></label><button className="button small primary" disabled={savingLink}><Plus size={15} />{savingLink ? 'در حال ذخیره' : 'ثبت پیوند'}</button></form>
          {error && <p className="form-error">{error}</p>}
        </section>}

        <section className="issue-detail-section">
          <h3><Link2 size={15} /> پیوندهای موجود</h3>
          {jiraLinks.length || details?.localLinks.length || productLinkedKeys.length ? <div className="issue-link-list">
            {jiraLinks.map((link: any) => <div key={link.id}><span className="link-source jira">Jira · {link.relationship}</span><IssueKey value={String(link.key).toUpperCase()} onOpen={openIssue} /><span>{link.summary}</span></div>)}
            {details?.localLinks.map((link: any) => <div key={link.id}><span className="link-source local">محلی · {link.relationship}</span><IssueKey value={link.intake_issue_key || link.business_issue_key} onOpen={openIssue} /><IssueKey value={link.delivery_issue_key || link.technical_issue_key} onOpen={openIssue} /><span>{link.note || '—'}</span><button className="row-action archive" title="برداشتن پیوند محلی" onClick={() => removeLink(link.id)}><Trash2 size={14} /></button></div>)}
            {productLinkedKeys.map((key) => <div key={`product:${key}`}><span className="link-source record">Product record</span><IssueKey value={key} onOpen={openIssue} /><span>این issue به یک ثبت محصولی صریح وصل شده است.</span></div>)}
          </div> : <p className="empty-inline">برای این پرونده پیوند issue یا ثبت محصول پیدا نشد.</p>}
          {details && (hasIntakeRole || hasDeliveryRole) && <div className="issue-link-history"><b>سابقهٔ پیوندهای محلی</b>{details.linkEvents.length ? details.linkEvents.slice(0, 20).map((event: any, index: number) => <span key={`${event.linkId}-${index}`}>{event.eventType === 'removed' ? 'برداشته شد' : event.eventType === 'created' ? 'ایجاد شد' : 'ویرایش شد'} · {localTime(event.occurredAt)}</span>) : <small>هنوز پیوند محلی ثبت نشده است.</small>}</div>}
        </section></>}

        {activeTab === 'activity' && activityLoaded && <>
        <section className="issue-detail-section">
          <div className="section-heading"><div><h3><History size={15} /> تاریخچهٔ تغییرات Jira</h3><p>نسخهٔ محلی صفحه‌ای خوانده می‌شود؛ دریافت تاریخچهٔ کامل از Jira فقط با درخواست شما انجام می‌شود.</p></div><button className="button tiny secondary" disabled={activityLoading} onClick={async () => { setActivityLoading(true); setError(''); try { await loadLive(true); } catch (e) { setError(e instanceof Error ? e.message : 'دریافت کامل فعالیت از Jira ناموفق بود.'); } finally { setActivityLoading(false); } }}>{activityLoading ? 'در حال دریافت…' : 'دریافت کامل از Jira'}</button></div>
          <div className={`callout ${activityData?.history?.complete ? 'info' : 'amber'}`}><History size={15} /><span>{activityData?.history?.complete ? `تاریخچهٔ changelog کامل است؛ ${formatNumber(activityData.history.total,0)} رویداد.` : `پوشش changelog کامل نیست یا تأیید نشده است: ${formatNumber(activityData?.history?.total ?? details?.historyTotal, 0)} رویداد اعلام شده و ${formatNumber(activityData?.history?.available ?? histories.length, 0)} رویداد محلی در دسترس است.`}</span></div>
          <DataTable headers={['زمان', 'کاربر', 'فیلد', 'مقدار قبلی', 'مقدار جدید']} rows={histories.flatMap((history: any) => (history.items || []).map((item: any) => [localTime(history.created), history.author?.displayName || history.author?.name || 'Jira', item.field || 'فیلد', formatValue(item.fromString ?? item.from), formatValue(item.toString ?? item.to)]))} empty="تاریخچهٔ تغییری در دادهٔ فعلی موجود نیست." />
          {activityData?.hasMore||activityData?.history?.hasMore||activityData?.comments?.hasMore||activityData?.worklogs?.hasMore ? <button className="button secondary" disabled={activityLoading} onClick={()=>void loadMoreActivity()}>{activityLoading?'در حال خواندن…':'نمایش رویدادهای قدیمی‌تر'}</button> : null}
          <h3>کامنت‌های ثبت‌شده در دادهٔ محلی</h3>
          <DataTable headers={['زمان','نویسنده','کامنت']} rows={comments.map((comment:any)=>[localTime(comment.created||''),comment.author?.displayName||comment.author?.name||'Jira',typeof comment.body==='string'?comment.body:JSON.stringify(comment.body)])} empty="کامنتی در نسخهٔ محلی این issue ثبت نشده است." />
          {activityData?.comments?.total>activityData?.comments?.available&&<p className="data-source-note">Jira تعداد {formatNumber(activityData.comments.total,0)} کامنت را اعلام کرده، اما فقط {formatNumber(activityData.comments.available,0)} کامنت در دادهٔ محلی موجود است. بازخوانی زندهٔ Jira برای ادامه لازم است.</p>}
          {worklogs.length>0&&<><h3>زمان‌های ثبت‌شده</h3><DataTable headers={['شروع','نویسنده','مدت','توضیح']} rows={worklogs.map((worklog:any)=>[localTime(worklog.started||''),worklog.author?.displayName||worklog.author?.name||'—',worklog.timeSpent||worklog.timeSpentSeconds||'—',worklog.comment||'—'])}/></>}

        </section>

        <section className="issue-detail-section">
          <h3><Database size={15} /> نسخه‌های واردشده</h3>
          <DataTable headers={['آخرین تغییر Jira', 'زمان ثبت محلی', 'منبع', 'پوشش تاریخچه']} rows={(details?.revisions || []).map((revision: any) => [formatDate(revision.updatedAt || ''), localTime(revision.importedAt), revision.sourceFile || 'همگام‌سازی Jira', revision.historyComplete ? 'کامل' : `${formatNumber(revision.historyCount, 0)} / ${formatNumber(revision.historyTotal, 0)}`])} />
          <small className="data-source-note">آخرین منبع: {details?.sourceFile || 'همگام‌سازی Jira'} · {localTime(details?.importedAt || '')}</small>
        </section>

        </>}

        {details && activeTab === 'fields' && activityLoaded && <><section className="issue-detail-section"><h3>همهٔ فیلدها و نوع داده</h3><DataTable headers={['شناسه', 'نام Jira', 'نوع', 'نوع اعضا / افزونه', 'مقدار']} rows={Object.entries(fields).map(([id, value]) => [id, details.raw.names?.[id] || id, details.raw.schema?.[id]?.type || 'نامشخص', details.raw.schema?.[id]?.items || details.raw.schema?.[id]?.custom || '—', <pre className="jira-description">{formatValue(value)}</pre>])} /></section><details className="issue-raw"><summary>تمام فیلدهای خام و ناشناختهٔ Jira</summary><pre>{JSON.stringify(details.raw, null, 2)}</pre></details></>}
      </>}
    </section>
  </div>;
}
