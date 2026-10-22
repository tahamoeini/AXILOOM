import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, Check, Download, KeyRound, LockKeyhole, Plus, RefreshCw, Server, Trash2, Upload, Wifi } from 'lucide-react';
import type { AppConfig, JiraCatalog, Snapshot } from '../types';
import { SectionHeading } from '../components/Primitives';

type Notice = { tone: 'success' | 'error' | 'info'; text: string };
type WorkspaceInfo = Awaited<ReturnType<typeof window.axiloom.getWorkspaceInfo>>;
type Mapping = AppConfig['fieldMappings'][number];

const semanticFields: Array<{ key: string; label: string; transform: string }> = [
  { key: 'storyPoints', label: 'Story points', transform: 'number' },
  { key: 'sprint', label: 'Sprint membership', transform: 'id-list' },
  { key: 'epicLink', label: 'Parent or epic link', transform: 'text' },
  { key: 'epicName', label: 'Epic name', transform: 'text' },
  { key: 'team', label: 'Team attribution', transform: 'option-label' },
  { key: 'workClassification', label: 'Work classification', transform: 'option-label' },
  { key: 'issueTags', label: 'Issue tags', transform: 'option-label' },
  { key: 'requester', label: 'Requester', transform: 'option-label' },
  { key: 'department', label: 'Department', transform: 'option-label' },
  { key: 'productOwner', label: 'Product owner', transform: 'option-label' },
  { key: 'loggedTime', label: 'Logged time', transform: 'number' },
];
const moduleFields: Array<{ key: string; label: string; description: string }> = [
  { key: 'delivery', label: 'Delivery intelligence', description: 'Sprint, team, person, flow, scope and capacity reports.' },
  { key: 'portfolio', label: 'Portfolio', description: 'Issue hierarchy and project-level delivery views.' },
  { key: 'objectives', label: 'Objectives', description: 'Local objective register with explicit request and outcome relationships.' },
  { key: 'productIntelligence', label: 'Product intelligence', description: 'Local objectives, requests, decisions, meetings, actions and outcomes.' },
  { key: 'productIntake', label: 'Product intake', description: 'Issue queue for projects assigned the product intake role.' },
  { key: 'commitments', label: 'Commitments', description: 'Issue queue for projects assigned the commitment role.' },
  { key: 'businessSprint', label: 'Sprint commitments', description: 'Optional sprint boundary report; requires commitment workflow and field mappings.' },
  { key: 'outcomes', label: 'Outcomes', description: 'Outcome records and explicit links to delivery evidence.' },
  { key: 'organizationAnalytics', label: 'Organization analytics', description: 'Grouping by configured department and team attribution.' },
];
const weekDays = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
];

export default function Settings({ config, setConfig, snapshot, refresh, notify, jiraProgress, isOnboarding = false }: {
  config: AppConfig | null;
  setConfig: (config: AppConfig) => void;
  snapshot: Snapshot;
  refresh: () => Promise<void>;
  notify: (notice: Notice) => void;
  jiraProgress: Record<string, any> | null;
  isOnboarding?: boolean;
}) {
  const [draft, setDraft] = useState<AppConfig | null>(config);
  const [catalog, setCatalog] = useState<JiraCatalog | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [working, setWorking] = useState('');
  const [token, setToken] = useState('');
  const [saveToken, setSaveToken] = useState(false);
  const [connection, setConnection] = useState<{ ok: boolean; displayName: string; account: string } | null>(null);

  useEffect(() => { if (config) setDraft(config); }, [config]);
  useEffect(() => {
    window.axiloom.getWorkspaceInfo().then(setWorkspaceInfo).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!draft?.jiraUrl) { setCatalog(null); return; }
    window.axiloom.getJiraCatalog(false).then(setCatalog).catch(() => undefined);
  }, [draft?.jiraUrl]);

  const projects = useMemo(() => Array.from(new Map([
    ...(catalog?.projects?.value || []).map((project) => [project.key, project.name] as const),
    ...((draft?.projects || []).map((key) => [key, key] as const)),
  ]).entries()).sort(([left], [right]) => left.localeCompare(right)), [catalog, draft?.projects]);
  if (!draft) return <div className="loading-screen">Loading workspace configuration…</div>;

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const updateSourceName = (displayName: string) => update('sourceInstance', { ...draft.sourceInstance, displayName });
  const updateRole = (role: string, projectKey: string, selected: boolean) => {
    const next = { ...draft.projectRoles };
    const current = next[role] || [];
    next[role] = selected ? [...new Set([...current, projectKey])] : current.filter((project) => project !== projectKey);
    update('projectRoles', next);
  };
  const updateWorkflow = (scope: string, key: string, value: string) => {
    const statuses = value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
    update('workflows', { ...draft.workflows, [scope]: { ...draft.workflows[scope], [key]: statuses } });
  };
  const updateMilestones = (scope: string, milestones: AppConfig['workflows'][string]['milestones']) => update('workflows', { ...draft.workflows, [scope]: { ...draft.workflows[scope], milestones } });
  const saveSettings = async () => {
    setWorking('save');
    try {
      const validated = await window.axiloom.validateConfig(draft);
      const saved = await window.axiloom.saveConfig(validated);
      setConfig(saved);
      setDraft(saved);
      await refresh();
      notify({ tone: 'success', text: `Configuration revision ${saved.configurationRevision} saved.` });
    } catch (error) {
      notify({ tone: 'error', text: error instanceof Error ? error.message : 'Configuration could not be saved.' });
    } finally { setWorking(''); }
  };
  const refreshMetadata = async () => {
    setWorking('metadata');
    try {
      const value = await window.axiloom.getJiraCatalog(true);
      setCatalog(value);
      notify({ tone: value.warnings.length ? 'info' : 'success', text: value.warnings.join(' · ') || 'Jira projects, fields and issue types were refreshed.' });
    } catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Jira metadata could not be loaded.' }); }
    finally { setWorking(''); }
  };
  const createWorkspace = async () => {
    const name = window.prompt('Name for the new isolated workspace:');
    if (!name?.trim()) return;
    setWorking('workspace');
    try {
      const result = await window.axiloom.createWorkspace(name);
      setWorkspaceInfo((current) => current ? { ...current, ...result, workspaces: result.workspaces } : current);
      await refresh();
      notify({ tone: 'success', text: `Workspace “${result.name}” is active.` });
    } catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Workspace could not be created.' }); }
    finally { setWorking(''); }
  };
  const activateWorkspace = async (id: string) => {
    if (id === workspaceInfo?.id) return;
    setWorking('workspace');
    try {
      const result = await window.axiloom.activateWorkspace(id);
      setWorkspaceInfo((current) => current ? { ...current, ...result, workspaces: result.workspaces } : current);
      await refresh();
      notify({ tone: 'success', text: `Workspace “${result.name}” is active.` });
    } catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Workspace could not be opened.' }); }
    finally { setWorking(''); }
  };
  const importProfile = async () => {
    setWorking('profile');
    try {
      const result = await window.axiloom.importConfigProfile();
      if (!result.canceled && result.profile) {
        const approved = window.confirm(`Profile passed validation at schema version ${result.profile.schemaVersion}. Load it as a draft for review? It will not be saved until you choose Save configuration.`);
        if (approved) setDraft({ ...draft, ...result.profile, workspaceName: draft.workspaceName });
      }
    } catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Profile validation failed.' }); }
    finally { setWorking(''); }
  };
  const exportProfile = async () => {
    setWorking('profile');
    try {
      const result = await window.axiloom.exportConfigProfile();
      if (!result.canceled) notify({ tone: 'success', text: 'Nonsecret configuration profile exported.' });
    } catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Profile export failed.' }); }
    finally { setWorking(''); }
  };
  const connect = async () => {
    setWorking('connection');
    try {
      const result = await window.axiloom.usePat(token, saveToken);
      setToken('');
      setConnection({ ok: result.connected, displayName: '', account: '' });
      notify({ tone: 'success', text: result.saved ? 'Credential encrypted with operating-system storage.' : 'Credential is held in memory for this session.' });
    } catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Connection could not be authenticated.' }); }
    finally { setWorking(''); }
  };
  const testConnection = async () => {
    setWorking('connection');
    try {
      const result = await window.axiloom.testJira();
      setConnection(result);
      notify({ tone: 'success', text: result.displayName ? `Connected as ${result.displayName}.` : 'Jira connection verified.' });
    } catch (error) { setConnection({ ok: false, displayName: '', account: '' }); notify({ tone: 'error', text: error instanceof Error ? error.message : 'Jira connection failed.' }); }
    finally { setWorking(''); }
  };
  const sync = async () => {
    setWorking('sync');
    try { await window.axiloom.startSync(false); notify({ tone: 'info', text: 'Read-only synchronization started.' }); }
    catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Synchronization did not start.' }); }
    finally { setWorking(''); }
  };
  const backup = async () => {
    setWorking('backup');
    try { const result = await window.axiloom.backup(); if (!result.canceled) notify({ tone: 'success', text: 'Workspace backup created. Active credentials are excluded.' }); }
    catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Backup failed.' }); }
    finally { setWorking(''); }
  };
  const restore = async () => {
    if (!window.confirm('Restore replaces the active workspace after integrity checks. A recoverable copy of the current file is retained. Continue?')) return;
    setWorking('restore');
    try { await window.axiloom.restore(); }
    catch (error) { notify({ tone: 'error', text: error instanceof Error ? error.message : 'Restore failed.' }); }
    finally { setWorking(''); }
  };
  const addTeam = () => update('teams', [...draft.teams, { id: `team-${crypto.randomUUID().slice(0, 8)}`, name: '', aliases: [], activeFrom: '', activeTo: '' }]);
  const updateTeam = (index: number, patch: Partial<AppConfig['teams'][number]>) => update('teams', draft.teams.map((team, current) => current === index ? { ...team, ...patch } : team));
  const addRoute = () => update('boardRoutes', [...draft.boardRoutes, { boardId: '', teamId: draft.teams[0]?.id || '' }]);
  const addMapping = (semanticKey: string) => {
    if (draft.fieldMappings.some((item) => item.semanticKey === semanticKey && !item.projectKey && !item.issueTypeId)) return;
    const semantic = semanticFields.find((item) => item.key === semanticKey)!;
    update('fieldMappings', [...draft.fieldMappings, { semanticKey, providerFieldId: '', providerFieldName: '', projectKey: '', issueTypeId: '', transform: semantic.transform }]);
  };
  const updateMapping = (index: number, patch: Partial<Mapping>) => update('fieldMappings', draft.fieldMappings.map((item, current) => current === index ? { ...item, ...patch } : item));
  const updateWorkClassification = (index: number, patch: Partial<AppConfig['workClassifications'][number]>) => update('workClassifications', draft.workClassifications.map((item, current) => current === index ? { ...item, ...patch } : item));
  const addWorkClassification = () => update('workClassifications', [...draft.workClassifications, { id: `class-${crypto.randomUUID().slice(0, 8)}`, label: '', aliases: [], minimumShare: null, maximumShare: null }]);
  const updateIssueTypeClassification = (index: number, patch: Partial<AppConfig['issueTypeClassifications'][number]>) => update('issueTypeClassifications', draft.issueTypeClassifications.map((item, current) => current === index ? { ...item, ...patch } : item));
  const statusText = (items: string[] | undefined) => (items || []).join(', ');

  return <main className="settings-page" dir={draft.organization.locale.toLowerCase().startsWith('fa') ? 'rtl' : 'ltr'}>
    {isOnboarding && <section className="panel onboarding-panel"><div className="onboarding-mark">A</div><div><span className="eyebrow">FROM DECISIONS TO DELIVERY</span><h2>Set up your Axiloom workspace</h2><p>Start with a local workspace, connect a supported Jira Data Center instance or import JSON, then configure projects, fields and workflow meaning before enabling reports.</p></div></section>}

    {draft.migrationStatus === 'review-required' && <div className="callout amber"><b>Legacy profile needs review.</b><span>{draft.migrationWarnings.join(' ') || 'Confirm project roles, field mappings, workflow states and calendar before enabling analytics.'}</span></div>}

    <section className="panel settings-panel">
      <SectionHeading title="Workspace" hint="Each workspace has a separate SQLite database, local records, credentials and report cache." />
      <div className="workspace-switcher">
        <label className="form-field"><span>Active workspace</span><select value={workspaceInfo?.id || ''} disabled={working === 'workspace'} onChange={(event) => activateWorkspace(event.target.value)}>{(workspaceInfo?.workspaces || []).map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}{workspace.active ? ' (active)' : ''}</option>)}</select></label>
        <button className="button secondary" onClick={createWorkspace} disabled={working === 'workspace'}><Plus size={15} /> New isolated workspace</button>
        <div className="workspace-path"><b>{workspaceInfo?.name || draft.workspaceName || 'My Workspace'}</b><code>{workspaceInfo?.path || 'Local path is loading'}</code></div>
      </div>
      {workspaceInfo?.warning && <p className="field-hint">{workspaceInfo.warning}</p>}
      <label className="form-field"><span>Workspace name</span><input value={draft.workspaceName} onChange={(event) => update('workspaceName', event.target.value)} maxLength={200} /></label>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Organization and display" hint="These values affect labels, dates and local calendar calculations. Source timestamps remain unchanged." />
      <div className="form-grid"><label className="form-field"><span>Organization name</span><input value={draft.organization.name} onChange={(event) => update('organization', { ...draft.organization, name: event.target.value })} /></label>
        <label className="form-field"><span>Locale</span><select value={draft.organization.locale} onChange={(event) => update('organization', { ...draft.organization, locale: event.target.value })}><option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option><option value="fa-IR">فارسی</option></select></label>
        <label className="form-field"><span>Display timezone</span><input value={draft.organization.timeZone} onChange={(event) => update('organization', { ...draft.organization, timeZone: event.target.value, ...(draft.calendar.configured ? {} : { timeZone: event.target.value }) })} placeholder="Europe/Berlin" /></label>
      </div>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Source connection" hint="Automatic sync is read-only. Issue mutations still require an explicit action and live Jira permission checks." />
      <div className="callout info"><LockKeyhole size={16} /><span>Supported here: HTTPS Jira Data Center with a personal access token, and offline Jira JSON imports. Jira Cloud OAuth is not implemented or claimed by this build.</span></div>
      <label className="form-field full"><span>Source name</span><input value={draft.sourceInstance.displayName} onChange={(event) => updateSourceName(event.target.value)} maxLength={160} placeholder="Jira instance or export name" /><small>Each workspace holds one Jira source. Confirm this name before importing; create a separate workspace for another source.</small></label>
      <label className="form-field full"><span>Jira base URL</span><input value={draft.jiraUrl} onChange={(event) => update('jiraUrl', event.target.value)} placeholder="https://jira.example.org" dir="ltr" autoComplete="url" /><small>Use HTTPS. Credentials, query strings and fragments are rejected.</small></label>
      <div className="connection-row"><span className={`connection-dot ${connection?.ok ? 'connected' : connection?.ok === false ? 'failed' : ''}`} /><b>{connection?.ok ? `Connected${connection.displayName ? ` · ${connection.displayName}` : ''}` : connection?.ok === false ? 'Connection failed' : draft.sourceInstance.displayName || 'Not verified'}</b>
        <button className="button secondary" onClick={refreshMetadata} disabled={!draft.jiraUrl || working === 'metadata'}><RefreshCw size={14} /> Discover projects and fields</button>
        <button className="button secondary" onClick={testConnection} disabled={!draft.jiraUrl || working === 'connection'}><Wifi size={14} /> Test connection</button>
        <button className="button secondary" onClick={sync} disabled={!draft.jiraUrl || !draft.hasSavedPat || working === 'sync'}><Server size={14} /> Sync read-only</button></div>
      {catalog && <p className="field-hint">{catalog.projects?.value.length || 0} projects · {catalog.fields?.value.length || 0} fields · {catalog.issueTypes?.value.length || 0} issue types</p>}
      <div className="auth-row"><label className="form-field"><span>Personal access token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Token is never included in the profile" autoComplete="new-password" /></label><label className="check-row"><input type="checkbox" checked={saveToken} onChange={(event) => setSaveToken(event.target.checked)} /><span>Encrypt with OS credential storage</span></label><button className="button secondary" onClick={connect} disabled={!token || working === 'connection'}><KeyRound size={15} /> Use token</button></div>
      {jiraProgress && <p className="field-hint">Sync: {jiraProgress.phase || 'running'} · {Number(jiraProgress.completed || 0).toLocaleString()} / {Number(jiraProgress.total || 0).toLocaleString()}</p>}
      {workspaceInfo?.workspaces && <p className="field-hint">Source identity: {draft.sourceInstance.id || 'assigned before the first import'} · {draft.sourceInstance.provider}</p>}
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Projects and roles" hint="Discover projects, select only those you intend to analyze, then assign logical roles. No project is built into Axiloom." />
      <div className="project-check-grid">{projects.map(([key, name]) => <label className="project-choice" key={key}><input type="checkbox" checked={draft.projects.includes(key)} onChange={(event) => update('projects', event.target.checked ? [...new Set([...draft.projects, key])] : draft.projects.filter((item) => item !== key))} /><span><b>{key}</b><small>{name}</small></span></label>)}</div>
      {!projects.length && <p className="empty-state">Discover Jira projects or add them after importing data.</p>}
      <div className="role-grid">{Object.entries({ productIntake: 'Product intake', technicalDelivery: 'Technical delivery', commitments: 'Commitments' }).map(([role, label]) => <fieldset key={role}><legend>{label}</legend>{draft.projects.map((project) => <label className="check-row" key={`${role}-${project}`}><input type="checkbox" checked={(draft.projectRoles[role] || []).includes(project)} onChange={(event) => updateRole(role, project, event.target.checked)} /><span>{project}</span></label>)}{!draft.projects.length && <small>Select projects first.</small>}</fieldset>)}</div>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Teams and boards" hint="Teams use stable local IDs. A board route assigns a sprint to one configured team." />
      <div className="team-list">{draft.teams.map((team, index) => <div className="team-row" key={team.id}><label className="form-field"><span>Stable ID</span><input value={team.id} onChange={(event) => updateTeam(index, { id: event.target.value })} /></label><label className="form-field"><span>Team name</span><input value={team.name} onChange={(event) => updateTeam(index, { name: event.target.value })} /></label><label className="form-field"><span>Aliases</span><input value={team.aliases.join(', ')} onChange={(event) => updateTeam(index, { aliases: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label><button className="icon-button" aria-label={`Remove team ${team.name || team.id}`} onClick={() => update('teams', draft.teams.filter((_, current) => current !== index))}><Trash2 size={15} /></button></div>)}
        <button className="button secondary" onClick={addTeam}><Plus size={14} /> Add team</button></div>
      <div className="route-list">{draft.boardRoutes.map((route, index) => <div className="team-row" key={`${index}-${route.boardId}`}><label className="form-field"><span>Board ID</span><input value={route.boardId} onChange={(event) => update('boardRoutes', draft.boardRoutes.map((item, current) => current === index ? { ...item, boardId: event.target.value } : item))} /></label><label className="form-field"><span>Team</span><select value={route.teamId} onChange={(event) => update('boardRoutes', draft.boardRoutes.map((item, current) => current === index ? { ...item, teamId: event.target.value } : item))}><option value="">Select team</option>{draft.teams.map((team) => <option key={team.id} value={team.id}>{team.name || team.id}</option>)}</select></label><button className="icon-button" aria-label="Remove board route" onClick={() => update('boardRoutes', draft.boardRoutes.filter((_, current) => current !== index))}><Trash2 size={15} /></button></div>)}<button className="button secondary" onClick={addRoute} disabled={!draft.teams.length}><Plus size={14} /> Map a board</button></div>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Semantic field mappings" hint="Map Jira fields to product meanings. Mapping changes create a configuration revision and rebuild derived projections; raw source snapshots stay unchanged." />
      <div className="mapping-list">{draft.fieldMappings.map((mapping, index) => {
        const semantic = semanticFields.find((item) => item.key === mapping.semanticKey);
        return <div className="mapping-row" key={`${mapping.semanticKey}-${mapping.projectKey}-${mapping.issueTypeId}-${index}`}>
          <label className="form-field"><span>Meaning</span><select value={mapping.semanticKey} onChange={(event) => { const picked = semanticFields.find((item) => item.key === event.target.value)!; updateMapping(index, { semanticKey: picked.key, transform: picked.transform }); }}>{semanticFields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="form-field"><span>Jira field</span><select value={mapping.providerFieldId} onChange={(event) => { const field = catalog?.fields?.value.find((item: any) => item.id === event.target.value); updateMapping(index, { providerFieldId: event.target.value, providerFieldName: field?.name || '' }); }}><option value="">Select discovered field</option>{(catalog?.fields?.value || []).map((field: any) => <option key={field.id} value={field.id}>{field.name} · {field.id}</option>)}</select></label>
          <label className="form-field"><span>Project scope</span><select value={mapping.projectKey} onChange={(event) => updateMapping(index, { projectKey: event.target.value })}><option value="">All selected projects</option>{draft.projects.map((project) => <option key={project}>{project}</option>)}</select></label>
          <label className="form-field"><span>Issue type scope</span><select value={mapping.issueTypeId} onChange={(event) => updateMapping(index, { issueTypeId: event.target.value })}><option value="">All issue types</option>{(catalog?.issueTypes?.value || []).map((type: any) => <option key={type.id} value={type.id}>{type.name} · {type.id}</option>)}</select></label>
          <small>{semantic?.transform} transform</small><button className="icon-button" aria-label="Remove field mapping" onClick={() => update('fieldMappings', draft.fieldMappings.filter((_, current) => current !== index))}><Trash2 size={15} /></button>
        </div>;
      })}</div>
      <div className="mapping-add-row"><label className="form-field"><span>Add meaning</span><select id="mapping-meaning">{semanticFields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><button className="button secondary" onClick={() => { const select = document.getElementById('mapping-meaning') as HTMLSelectElement; if (select?.value) addMapping(select.value); }}><Plus size={14} /> Add mapping</button></div>
      {!catalog?.fields?.value.length && <p className="field-hint">Connect to Jira and discover fields, or configure mappings from an offline JSON field catalog.</p>}
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Work and issue classifications" hint="Classification labels and targets are optional. Unmapped values remain unclassified and are shown as data quality gaps." />
      <div className="mapping-list">{draft.workClassifications.map((item, index) => <div className="mapping-row" key={item.id}>
        <label className="form-field"><span>Stable ID</span><input value={item.id} onChange={(event) => updateWorkClassification(index, { id: event.target.value })} /></label>
        <label className="form-field"><span>Label</span><input value={item.label} onChange={(event) => updateWorkClassification(index, { label: event.target.value })} /></label>
        <label className="form-field"><span>Aliases</span><input value={item.aliases.join(', ')} onChange={(event) => updateWorkClassification(index, { aliases: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="form-field"><span>Minimum capacity share</span><input type="number" min="0" max="1" step="0.01" value={item.minimumShare ?? ''} onChange={(event) => updateWorkClassification(index, { minimumShare: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <label className="form-field"><span>Maximum capacity share</span><input type="number" min="0" max="1" step="0.01" value={item.maximumShare ?? ''} onChange={(event) => updateWorkClassification(index, { maximumShare: event.target.value === '' ? null : Number(event.target.value) })} /></label>
        <button className="icon-button" aria-label={`Remove classification ${item.label || item.id}`} onClick={() => update('workClassifications', draft.workClassifications.filter((_, current) => current !== index))}><Trash2 size={15} /></button>
      </div>)}</div>
      <button className="button secondary" onClick={addWorkClassification}><Plus size={14} /> Add work classification</button>
      <SectionHeading title="Issue type classification" hint="Assign provider issue type IDs to one of the configured work classifications." />
      <div className="mapping-list">{draft.issueTypeClassifications.map((item, index) => <div className="mapping-row" key={`${item.issueTypeId}-${index}`}>
        <label className="form-field"><span>Issue type</span><select value={item.issueTypeId} onChange={(event) => updateIssueTypeClassification(index, { issueTypeId: event.target.value })}><option value="">Select discovered issue type</option>{(catalog?.issueTypes?.value || []).map((type: any) => <option key={type.id} value={type.id}>{type.name} · {type.id}</option>)}</select></label>
        <label className="form-field"><span>Classification</span><select value={item.classification} onChange={(event) => updateIssueTypeClassification(index, { classification: event.target.value })}><option value="">Select classification</option>{draft.workClassifications.map((value) => <option key={value.id} value={value.id}>{value.label || value.id}</option>)}</select></label>
        <button className="icon-button" aria-label="Remove issue type classification" onClick={() => update('issueTypeClassifications', draft.issueTypeClassifications.filter((_, current) => current !== index))}><Trash2 size={15} /></button>
      </div>)}</div>
      <button className="button secondary" onClick={() => update('issueTypeClassifications', [...draft.issueTypeClassifications, { issueTypeId: '', classification: '' }])}><Plus size={14} /> Map an issue type</button>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Workflow semantics" hint="Completion, start and commitment boundaries are configured per product role. Unmapped status names remain visible as unknown." />
      <div className="form-grid">{[
        ['delivery', 'Delivery', [['completedStatuses', 'Completed'], ['startedStatuses', 'Started'], ['blockedStatuses', 'Blocked'], ['cancelledStatuses', 'Cancelled']]],
        ['intake', 'Product intake', [['completedStatuses', 'Completed']]],
        ['commitment', 'Commitments', [['entryStatuses', 'Commitment entry'], ['completedStatuses', 'Completed']]],
      ].map(([scope, label, fields]: any) => <fieldset className="workflow-fieldset" key={scope}><legend>{label}</legend>{fields.map(([key, name]: string[]) => <label className="form-field" key={key}><span>{name} statuses</span><input value={statusText(draft.workflows[scope]?.[key])} onChange={(event) => updateWorkflow(scope, key, event.target.value)} placeholder="Comma-separated exact status names" /></label>)}</fieldset>)}</div>
      <div className="workflow-milestones">{(['delivery', 'intake', 'commitment'] as const).map((scope) => <fieldset className="workflow-fieldset" key={`${scope}-milestones`}><legend>{scope} milestones</legend>{(draft.workflows[scope]?.milestones || []).map((milestone, index) => <div className="team-row" key={milestone.id}>
        <label className="form-field"><span>Stable ID</span><input value={milestone.id} onChange={(event) => updateMilestones(scope, draft.workflows[scope].milestones.map((item, current) => current === index ? { ...item, id: event.target.value } : item))} /></label>
        <label className="form-field"><span>Label</span><input value={milestone.label} onChange={(event) => updateMilestones(scope, draft.workflows[scope].milestones.map((item, current) => current === index ? { ...item, label: event.target.value } : item))} /></label>
        <label className="form-field"><span>Exact statuses</span><input value={milestone.statuses.join(', ')} onChange={(event) => updateMilestones(scope, draft.workflows[scope].milestones.map((item, current) => current === index ? { ...item, statuses: event.target.value.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) } : item))} /></label>
        <button className="icon-button" aria-label={`Remove ${milestone.label || milestone.id}`} onClick={() => updateMilestones(scope, draft.workflows[scope].milestones.filter((_, current) => current !== index))}><Trash2 size={15} /></button>
      </div>)}<button className="button secondary" onClick={() => updateMilestones(scope, [...(draft.workflows[scope]?.milestones || []), { id: `milestone-${crypto.randomUUID().slice(0, 8)}`, label: '', statuses: [] }])}><Plus size={14} /> Add milestone</button></fieldset>)}</div>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Calendar and capacity" hint="Working-day estimates stay unavailable until a calendar is configured. Source timestamps are never rewritten." />
      <label className="check-row"><input type="checkbox" checked={draft.calendar.configured} onChange={(event) => update('calendar', { ...draft.calendar, configured: event.target.checked })} /><span>Enable working calendar</span></label>
      <div className="form-grid"><label className="form-field"><span>Calendar timezone</span><input value={draft.calendar.timeZone} onChange={(event) => update('calendar', { ...draft.calendar, timeZone: event.target.value })} placeholder="Europe/Berlin" /></label><label className="form-field"><span>Hours per working day</span><input type="number" min={0.25} max={24} step={0.25} value={draft.calendar.hoursPerDay} onChange={(event) => update('calendar', { ...draft.calendar, hoursPerDay: Number(event.target.value) })} /></label></div>
      <div className="weekday-list">{weekDays.map((day) => <label className="check-row" key={day.value}><input type="checkbox" checked={draft.calendar.workingDays.includes(day.value)} onChange={(event) => update('calendar', { ...draft.calendar, workingDays: event.target.checked ? [...new Set([...draft.calendar.workingDays, day.value])].sort() : draft.calendar.workingDays.filter((item) => item !== day.value) })} /><span>{day.label}</span></label>)}</div>
      <label className="form-field"><span>Holidays (ISO dates, comma-separated)</span><input value={draft.calendar.holidays.join(', ')} onChange={(event) => update('calendar', { ...draft.calendar, holidays: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="2026-12-25" /></label>
      <label className="form-field"><span>Unplanned-work tag (exact match)</span><input value={draft.adhocTag} onChange={(event) => update('adhocTag', event.target.value)} placeholder="Configure a Jira label if applicable" /></label>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Capacity overrides" hint="Optional overrides apply to one team, sprint and person. An empty working-day value uses the configured sprint calendar." />
      <div className="mapping-list">{draft.capacityOverrides.map((item, index) => <div className="mapping-row" key={`${item.team}-${item.sprintId}-${item.assigneeKey}-${index}`}>
        <label className="form-field"><span>Team</span><select value={item.team} onChange={(event) => update('capacityOverrides', draft.capacityOverrides.map((row, current) => current === index ? { ...row, team: event.target.value } : row))}><option value="">Select team</option>{draft.teams.map((team) => <option key={team.id} value={team.name}>{team.name}</option>)}</select></label>
        <label className="form-field"><span>Sprint ID</span><input value={item.sprintId} onChange={(event) => update('capacityOverrides', draft.capacityOverrides.map((row, current) => current === index ? { ...row, sprintId: event.target.value } : row))} /></label>
        <label className="form-field"><span>Assignee key</span><input value={item.assigneeKey} onChange={(event) => update('capacityOverrides', draft.capacityOverrides.map((row, current) => current === index ? { ...row, assigneeKey: event.target.value } : row))} /></label>
        <label className="form-field"><span>Assignee name</span><input value={item.assignee} onChange={(event) => update('capacityOverrides', draft.capacityOverrides.map((row, current) => current === index ? { ...row, assignee: event.target.value } : row))} /></label>
        <label className="form-field"><span>Working days</span><input type="number" min="0" max="366" step="0.25" value={item.overrideWorkingDays ?? ''} onChange={(event) => update('capacityOverrides', draft.capacityOverrides.map((row, current) => current === index ? { ...row, overrideWorkingDays: event.target.value === '' ? null : Number(event.target.value) } : row))} /></label>
        <label className="form-field"><span>Allocation (0–1)</span><input type="number" min="0" max="1" step="0.05" value={item.allocation} onChange={(event) => update('capacityOverrides', draft.capacityOverrides.map((row, current) => current === index ? { ...row, allocation: Number(event.target.value) } : row))} /></label>
        <button className="icon-button" aria-label="Remove capacity override" onClick={() => update('capacityOverrides', draft.capacityOverrides.filter((_, current) => current !== index))}><Trash2 size={15} /></button>
      </div>)}</div>
      <button className="button secondary" onClick={() => update('capacityOverrides', [...draft.capacityOverrides, { team: '', sprintId: '', assigneeKey: '', assignee: '', overrideWorkingDays: null, allocation: 1 }])}><Plus size={14} /> Add capacity override</button>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Modules" hint="Enable modules only after their required project roles, fields and workflow policies are configured." />
      <div className="module-grid">{moduleFields.map((module) => <label className="module-choice" key={module.key}><input type="checkbox" checked={Boolean(draft.modules[module.key])} onChange={(event) => update('modules', { ...draft.modules, [module.key]: event.target.checked })} /><span><b>{module.label}</b><small>{module.description}</small></span></label>)}</div>
    </section>

    <section className="panel settings-panel">
      <SectionHeading title="Profiles, data and recovery" hint="Profile files exclude credentials. Backups belong to the active workspace and can be validated before restore." />
      <div className="settings-actions"><button className="button secondary" onClick={importProfile} disabled={working === 'profile'}><Upload size={15} /> Import profile (dry run)</button><button className="button secondary" onClick={exportProfile} disabled={working === 'profile'}><Download size={15} /> Export profile</button><button className="button secondary" onClick={backup} disabled={working === 'backup'}><ArchiveRestore size={15} /> Back up</button><button className="button secondary" onClick={restore} disabled={working === 'restore'}><ArchiveRestore size={15} /> Restore</button></div>
      <div className="sync-facts"><div><span>Current issues</span><b>{snapshot.summary.issueCount.toLocaleString()}</b></div><div><span>Sprints</span><b>{snapshot.summary.sprintCount.toLocaleString()}</b></div><div><span>Last import</span><b>{snapshot.importRuns[0]?.startedAt ? new Date(snapshot.importRuns[0].startedAt).toLocaleString(draft.organization.locale) : '—'}</b></div><div><span>Configuration revision</span><b>{draft.configurationRevision}</b></div></div>
      <p className="field-hint">Profile export contains organization labels, endpoint and mapping choices. Review the file before sharing it.</p>
    </section>

    <div className="settings-savebar"><div><b>{draft.configurationRevision ? `Revision ${draft.configurationRevision}` : 'Unsaved configuration'}</b><small>Changes become active only after validation and save.</small></div><button className="button primary" onClick={saveSettings} disabled={working === 'save'}><Check size={16} />{working === 'save' ? 'Validating…' : 'Validate and save configuration'}</button></div>
  </main>;
}
