export type PageId = 'overview' | 'delivery' | 'portfolio' | 'business' | 'objectives' | 'requests' | 'actions' | 'decisions' | 'meetings' | 'outcomes' | 'stakeholders' | 'quality' | 'settings' | 'definitions';
export type RecordKind = 'objective' | 'action' | 'request' | 'decision' | 'meeting' | 'outcome' | 'stakeholder';

export interface ProductRecord {
  id: string;
  kind: RecordKind;
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  history?: Array<{ eventType: string; occurredAt: string; payload: Record<string, unknown> }>;
}

export interface Snapshot {
  summary: {
    issueCount: number;
    projectCounts: Array<{ project: string; count: number }>;
    epicCount: number;
    sprintCount: number;
    reportableSprints: number;
    relationCount: number;
    warningCount: number;
    issuesWithoutAssignee: number;
    lastIssueUpdate: string | null;
    openActions: number;
    openRequests: number;
    decisions: number;
    outcomes: number;
  };
  teams: string[];
  projects: string[];
  sprintMetrics: Array<Record<string, any>>;
  people: Array<Record<string, any>>;
  issues: Array<Record<string, any>>;
  issueTotal: number;
  epics: Array<Record<string, any>>;
  records: ProductRecord[];
  links: Array<Record<string, any>>;
  business: {
    summary: Record<string, number>;
    issues: Array<Record<string, any>>;
    statuses: Array<{ key: string; count: number }>;
    components: Array<Record<string, any>>;
    assignees: Array<Record<string, any>>;
    componentAssignees: Array<Record<string, any>>;
    agingBuckets: Array<{ key: string; count: number }>;
    monthly: Array<{ month: string; created: number; completed: number }>;
    ageMethod: string;
  };
  jiraIssueLinks: Array<Record<string, any>>;
  localIssueLinks: Array<Record<string, any>>;
  quality: {
    findings: Array<{ severity: string; code: string; count: number; message: string }>;
    fieldCoverage: Record<string, { returned: number; missing: number; null: number; emptyArray: number; present: number }>;
    unknownFields: string[];
    incompleteHistories: number;
    issuesWithoutHistory: number;
    conflicts: number;
    evidence: { issueRevisions: number; issueHistoryEvents: number; sprintRevisions: number; localLinkEvents: number };
  };
  importRuns: Array<Record<string, any>>;
}

export interface IssueListFilters {
  project?: string; issueType?: string; status?: string; priority?: string; assignee?: string;
  epic?: string; component?: string; sprintId?: string; query?: string; createdFrom?: string; createdTo?: string;
  done?: boolean; offset?: number; limit?: number; sortBy?: 'key' | 'created' | 'updated' | 'summary' | 'status' | 'project';
  sortDirection?: 'asc' | 'desc';
}

export interface IssueListResult {
  items: Array<Record<string, any>>;
  total: number; doneCount: number; openCount: number; withoutAssignee: number; withEpicLink: number;
  offset: number; limit: number; hasMore: boolean;
}

export interface IssueFilterOptions {
  projects: string[]; issueTypes: string[]; statuses: string[]; priorities: string[]; components: string[];
  epics: Array<{ key: string; summary: string }>;
}

export interface BusinessBoardFilters {
  query?: string; component?: string; assignee?: string; status?: string; priority?: string;
  createdFrom?: string; createdTo?: string; offset?: number; limit?: number; includeAggregates?: boolean;
}

export interface BusinessBoardReport {
  items: Array<Record<string, any>>;
  total: number; offset: number; limit: number; hasMore: boolean;
  aggregates: {
    total: number; openCount: number; doneCount: number; linkedCount: number; withoutOwner: number;
    withStatusAge: number; withoutStatusAgeOpen: number; statusSinceCount: number; epicCount: number;
    withoutComponent: number; uniqueDeliveryKeyCount: number;
    statuses: Array<{ key: string; count: number }>;
    components: Array<{ key: string; total: number; open: number; done: number; linked: number; assigneeCount: number }>;
    assignees: Array<{ key: string; name: string; total: number; open: number; done: number; linked: number }>;
    componentAssignees: Array<{ component: string; key: string; name: string; total: number; open: number; done: number }>;
    aging: Array<{ key: string; count: number }>;
    monthly: Array<{ month: string; created: number; completed: number }>;
    departments: Array<{ key: string; total: number; open: number; done: number; assignees: number }>;
    productOwners: Array<{ key: string; total: number; open: number; done: number; assignees: number }>;
    organizationMonthly: Array<{ level: 'productOwner' | 'department'; key: string; month: string; created: number; completed: number }>;
    matchingRecordIds: string[];
  };
}

export interface BusinessSprintOption {
  id: string; name: string; boardId: string; teamRoute: string; state: string;
  startDate: string; endDate: string; startAt: string; endAt: string;
  hasActualStart: boolean; hasActualEnd: boolean;
}

export interface BusinessSprintTeamReport {
  team: string;
  committedCount: number; committedSP: number; committedMissingSPCount: number;
  addedCount: number; addedSP: number; addedMissingSPCount: number;
  inScopeAtEndCount: number; completedCount: number; completedSP: number; exitCount: number;
  pointIncreaseSP: number; pointDecreaseSP: number;
  milestones: Record<string, { label: string; count: number; storyPoints: number; missingStoryPoints: number }>;
}

export interface BusinessSprintReport {
  sprint: BusinessSprintOption;
  targetTeams: string[];
  teams: BusinessSprintTeamReport[];
  items: Array<Record<string, any>>;
  unmapped: { count: number; committedCount: number; addedCount: number; missingSPCount: number; items: Array<Record<string, any>> };
  otherTeamCount: number;
  coverage: { historyCompleteCount: number; historyIncompleteCount: number; startUnverifiedCount: number; endUnverifiedCount: number };
}

export interface JiraRoute {
  boardId: string;
  teamId: string;
  team?: string;
}

export interface CapacityOverride {
  team: string;
  sprintId: string;
  assigneeKey: string;
  assignee: string;
  overrideWorkingDays: number | null;
  allocation: number;
}
export interface WorkflowMilestone { id: string; label: string; statuses: string[] }
export interface WorkflowConfiguration { milestones: WorkflowMilestone[]; [key: string]: any }

export interface StakeholderContactPoint {
  id: string;
  name: string;
  role: string;
  department: string;
  email: string;
  phone: string;
  notes: string;
}

export interface AppConfig {
  schemaVersion: number;
  configurationRevision: number;
  migrationStatus: string;
  migrationWarnings: string[];
  organization: { name: string; locale: string; timeZone: string };
  workspaceName: string;
  sourceInstance: {
    id: string;
    provider: 'offline-json' | 'jira-datacenter';
    displayName: string;
    endpoint: string;
    networkAccess: { mode: 'private' | 'public-pinned'; approvedAddresses: string[] };
  };
  jiraUrl: string;
  projects: string[];
  projectRoles: Record<string, string[]>;
  teams: Array<{ id: string; name: string; aliases: string[]; activeFrom: string; activeTo: string }>;
  boardRoutes: JiraRoute[];
  fieldMappings: Array<{ semanticKey: string; providerFieldId: string; providerFieldName: string; projectKey: string; issueTypeId: string; transform: string }>;
  workClassifications: Array<{ id: string; label: string; aliases: string[]; minimumShare: number | null; maximumShare: number | null }>;
  issueTypeClassifications: Array<{ issueTypeId: string; classification: string }>;
  workflows: Record<string, WorkflowConfiguration>;
  calendar: { configured: boolean; timeZone: string; workingDays: number[]; hoursPerDay: number; holidays: string[]; workIntervals: Array<Record<string, any>> };
  modules: Record<string, boolean>;
  hoursPerDay: number;
  doneStatuses: string[];
  adhocTag: string;
  planningLookback: number;
  predictabilityLookback: number;
  minForecastCoverage: number;
  minimumTimeDataCoverage: number;
  capacityWarning: number;
  capacityCritical: number;
  adhocHoursWarning: number;
  unspecifiedOpTypeWarning: number;
  capacityOverrides: CapacityOverride[];
  stakeholderContactPoints: StakeholderContactPoint[];
  hasSavedPat?: boolean;
}

export interface JiraFieldMeta {
  name: string; required?: boolean; hasDefaultValue?: boolean; defaultValue?: any;
  schema?: { type?: string; items?: string; custom?: string }; operations?: string[];
  allowedValues?: any[]; autoCompleteUrl?: string;
}
export interface JiraCatalog {
  fields: { value: any[]; updatedAt: string } | null;
  projects: { value: Array<{ id: string; key: string; name: string }>; updatedAt: string } | null;
  issueTypes: { value: any[]; updatedAt: string } | null;
  warnings: string[];
}
export interface AxiloomApi {
  getJiraCatalog: (refresh?: boolean) => Promise<JiraCatalog>;
  getJiraFieldOptions: (input: { key?: string; project?: string; issueType?: string; fieldId: string; query: string }) => Promise<any[]>;
  getJiraCapabilities: (key: string) => Promise<{ permissions: Record<string, boolean>; user: { key?: string; name?: string; accountId?: string } }>;
  getCurrentUser: () => Promise<{ key?: string; name?: string; accountId?: string; displayName?: string } | null>;
  editJiraComment: (input: { key: string; commentId: string; body: string; expectedBody: string; expectedUpdated: string }) => Promise<{ ok: boolean; warning?: string }>;
  deleteJiraComment: (input: { key: string; commentId: string; expectedBody: string; expectedUpdated: string; confirmation: string }) => Promise<{ ok: boolean; warning?: string }>;
  deleteJiraIssue: (input: { key: string; expectedUpdated: string; confirmation: string }) => Promise<{ ok: boolean }>;
  uploadJiraAttachments: (input: { key: string; files: Array<{ name: string; type: string; bytes: Uint8Array }> }) => Promise<{ ok: boolean; warning?: string }>;

  getLiveIssue: (key: string, includeActivity?: boolean) => Promise<IssueDetails>;
  getEditMeta: (key: string) => Promise<{ fields: Record<string, JiraFieldMeta>; transitions: any[] }>;
  getCreateMeta: (project: string) => Promise<{ id: string; key: string; issuetypes: Array<{ id: string; name: string; fields: Record<string, JiraFieldMeta> }> }>;
  createJiraIssue: (input: { project: string; issueType: string; fields: Record<string, any> }) => Promise<{ key: string; warning?: string }>;
  updateJiraIssue: (input: { key: string; expectedUpdated: string; fields: Record<string, any> }) => Promise<{ ok: boolean; warning?: string }>;
  transitionJiraIssue: (input: { key: string; expectedUpdated: string; transitionId: string; fields: Record<string, any> }) => Promise<{ ok: boolean; warning?: string }>;
  addJiraComment: (input: { key: string; body: string }) => Promise<{ id: string; warning?: string }>;
  getJiraUsers: (input: { key?: string; project?: string; query: string; fieldId?: string }) => Promise<any[]>;
  getJiraLinkTypes: () => Promise<{ issueLinkTypes: any[] }>;
  linkJiraIssue: (input: { key: string; target: string; typeId: string }) => Promise<{ ok: boolean; warning?: string }>;
  linkJiraRecords: (input: { key: string; recordIds: string[] }) => Promise<{ ok: boolean }>;

  getSnapshot: (filters?: Record<string, unknown>) => Promise<Snapshot>;
  listIssues: (filters?: IssueListFilters) => Promise<IssueListResult>;
  getIssueFilterOptions: (project?: string) => Promise<IssueFilterOptions>;
  getIssueOverviewStats: () => Promise<{ issueCount:number; openCount:number; epicLinkedCount:number; issuesWithoutAssignee:number; lastIssueUpdate:string|null; projectCounts:Array<{project:string;count:number}> }>;
  getCalendarPeriodReport: (filters: { projects?:string[]; from?:string; to?:string; previousFrom?:string; previousTo?:string }) => Promise<{ created:number; completed:number; completedWithoutResolution:number; previousCreated:number|null; previousCompleted:number|null; monthly:Array<{month:string;created:number;completed:number}> }>;
  getBusinessBoardReport: (filters?: BusinessBoardFilters) => Promise<BusinessBoardReport>;
  getBusinessSprints: () => Promise<BusinessSprintOption[]>;
  getBusinessSprintReport: (filters: { sprintId: string }) => Promise<BusinessSprintReport>;
  listSprintIssues: (sprintId:string, offset?:number, limit?:number) => Promise<IssueListResult>;
  getConfig: () => Promise<AppConfig>;
  validateConfig: (config: AppConfig) => Promise<AppConfig>;
  getConfigurationHistory: () => Promise<Array<{ revision: number; schemaVersion: number; fingerprint: string; eventType: string; createdAt: string }>>;
  importConfigProfile: () => Promise<{ canceled: boolean; profile?: AppConfig; dryRun?: boolean }>;
  exportConfigProfile: () => Promise<{ canceled?: boolean; filePath?: string }>;
  getWorkspaceInfo: () => Promise<{ id: string; name: string; path: string; warning: string; workspaces: Array<{ id: string; name: string; active: boolean; path: string; createdAt: string }> }>;
  createWorkspace: (name: string) => Promise<{ id: string; name: string; path: string; workspaces: Array<{ id: string; name: string; active: boolean; path: string; createdAt: string }> }>;
  activateWorkspace: (id: string) => Promise<{ id: string; name: string; path: string; workspaces: Array<{ id: string; name: string; active: boolean; path: string; createdAt: string }> }>;
  getIssueDetails: (key: string, includeActivity?: boolean) => Promise<IssueDetails | null>;
  getIssueActivity: (key:string,offset?:number,limit?:number) => Promise<{
    key:string;
    history:{histories:Array<Record<string,any>>;total:number;available:number;offset:number;limit:number;hasMore:boolean;complete:boolean};
    comments:{items:Array<Record<string,any>>;total:number;available:number;offset:number;limit:number;hasMore:boolean};
    worklogs:{items:Array<Record<string,any>>;total:number;available:number;offset:number;limit:number;hasMore:boolean};
  } | null>;
  getSprintDetails: (sprintId: string) => Promise<SprintDetails | null>;
  openJiraIssue: (key: string) => Promise<{ opened: boolean }>;
  openJiraSprint: (input: { sprintId: string; boardId: string }) => Promise<{ opened: boolean }>;
  saveLocalIssueLink: (input: { intakeIssueKey: string; deliveryIssueKey: string; relationship?: string; note?: string }) => Promise<Record<string, any>>;
  removeLocalIssueLink: (id: string) => Promise<{ ok: boolean }>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  beginImport: (sourceName: string) => Promise<{ runId: string; sourceInstanceId: string; sourceName: string }>;
  registerImportFile: (metadata: Record<string, unknown>) => Promise<{ ok: boolean }>;
  importIssueBatch: (items: unknown[], source: string) => Promise<Record<string, number>>;
  importSprintBatch: (items: unknown[], source: string) => Promise<Record<string, number>>;
  finishImport: (note?: string | null) => Promise<{ issueCount: number }>;
  saveRecord: (record: { id?: string; kind: RecordKind; title: string; payload: Record<string, unknown> }) => Promise<ProductRecord>;
  archiveRecord: (id: string) => Promise<{ ok: boolean }>;
  backup: () => Promise<{ canceled?: boolean; filePath?: string }>;
  restore: () => Promise<{ canceled?: boolean; restored?: boolean }>;
  exportXlsx: (report: ExportReport) => Promise<{ canceled?: boolean; filePath?: string }>;
  exportPdf: (report: ExportReport) => Promise<{ canceled?: boolean; filePath?: string }>;
  usePat: (token: string, save: boolean) => Promise<{ connected: boolean; saved: boolean }>;
  forgetPat: () => Promise<{ connected: boolean; saved: boolean }>;
  createPat: (username: string, password: string, name: string, expiryDays: number, save: boolean) => Promise<{ created: boolean; token: string | null; metadata: Record<string, string>; saved: { connected: boolean; saved: boolean } }>;
  listPats: () => Promise<Array<{ id: string; name: string; createdAt: string; expiresAt: string }>>;
  revokePat: (tokenId: string) => Promise<{ revoked: boolean }>;
  testJira: () => Promise<{ ok: boolean; displayName: string; account: string }>;
  startSync: (resume: boolean) => Promise<{ started: boolean }>;
  cancelSync: () => Promise<{ requested: boolean }>;
  getSourceProviderCapabilities: () => Promise<{ id: string; label: string; authentication: string; capabilities: Record<string, boolean> }>;
  onImportProgress: (callback: (progress: Record<string, any>) => void) => () => void;
  onJiraProgress: (callback: (progress: Record<string, any>) => void) => () => void;
}

export interface IssueDetails {
  key: string;
  project: string;
  raw: Record<string, any>;
  sourceFile: string | null;
  importedAt: string;
  historyComplete: boolean;
  historyTotal: number;
  revisions: Array<Record<string, any>>;
  localLinks: Array<Record<string, any>>;
  linkEvents: Array<Record<string, any>>;
}

export interface SprintDetails {
  id: string;
  boardId: string | null;
  team: string | null;
  state: string | null;
  startDate: string | null;
  endDate: string | null;
  activatedDate: string | null;
  completeDate: string | null;
  sourceFile: string | null;
  importedAt: string;
  raw: Record<string, any>;
  revisions: Array<{ revisionId: number; importedAt: string; sourceFile: string | null; snapshotHash: string; raw: Record<string, any> | null }>;
}

export interface ExportReport {
  fileName: string;
  title: string;
  subtitle?: string;
  sheets: Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>;
}

declare global {
  interface Window { axiloom: AxiloomApi }
}
