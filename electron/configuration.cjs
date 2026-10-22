const { createHash } = require('node:crypto');

const { validateNetworkAccess } = require('./jira-providers.cjs');
const DEFAULT_RECORD_TEMPLATES = require('../shared/record-templates.json');

const CONFIG_SCHEMA_VERSION = 4;
const SEMANTIC_KEYS = new Set([
  'storyPoints', 'sprint', 'epicLink', 'epicName', 'team', 'workClassification',
  'issueTags', 'requester', 'department', 'productOwner', 'loggedTime',
]);
const TRANSFORMS = new Set(['identity', 'number', 'text', 'option-label', 'id-list', 'boolean']);

const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  configurationRevision: 0,
  migrationStatus: 'unconfigured',
  migrationWarnings: [],
  organization: { name: '', locale: 'en-US', timeZone: 'UTC' },
  workspaceName: '',
  sourceInstance: { id: '', provider: 'offline-json', displayName: '', endpoint: '', networkAccess: { mode: 'private', approvedAddresses: [] } },
  jiraUrl: '',
  projects: [],
  projectRoles: { productIntake: [], technicalDelivery: [], commitments: [] },
  teams: [],
  boardRoutes: [],
  teamAssignments: { projects: [], components: [], issueOverrides: [] },
  fieldMappings: [],
  workClassifications: [],
  issueTypeClassifications: [],
  workflows: {
    delivery: {
      backlogStatuses: [], readyStatuses: [], startedStatuses: [], blockedStatuses: [], reviewStatuses: [],
      completedStatuses: [], cancelledStatuses: [], completionStatusCategories: ['done'], resolutionCompletes: true, milestones: [],
    },
    intake: {
      backlogStatuses: [], readyStatuses: [], startedStatuses: [], blockedStatuses: [], reviewStatuses: [],
      completedStatuses: [], cancelledStatuses: [], completionStatusCategories: ['done'], resolutionCompletes: true, milestones: [],
    },
    commitment: {
      backlogStatuses: [], readyStatuses: [], startedStatuses: [], blockedStatuses: [], reviewStatuses: [],
      entryStatuses: [], completedStatuses: [], cancelledStatuses: [], completionStatusCategories: ['done'], resolutionCompletes: true, milestones: [],
    },
  },
  calendar: { configured: false, timeZone: 'UTC', workingDays: [], hoursPerDay: 8, holidays: [], workIntervals: [] },
  modules: {
    delivery: false,
    portfolio: false,
    objectives: false,
    productIntelligence: false,
    productIntake: false,
    commitments: false,
    businessSprint: false,
    outcomes: false,
    organizationAnalytics: false,
  },
  hoursPerDay: 8,
  doneStatuses: [],
  adhocTag: '',
  planningLookback: 5,
  predictabilityLookback: 5,
  minForecastCoverage: 0.7,
  minimumTimeDataCoverage: 0.7,
  capacityWarning: 0.9,
  capacityCritical: 1,
  adhocHoursWarning: 0.3,
  capacityOverrides: [],
  stakeholderContactPoints: [],
  recordTemplates: DEFAULT_RECORD_TEMPLATES,
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value, limit = 200) {
  return String(value ?? '').trim().slice(0, limit);
}

function stringList(value, limit = 500) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => asString(entry, limit)).filter(Boolean))];
}

function normalizeRecordTemplates(input, defaults) {
  if (input !== undefined) assert(Array.isArray(input), 'Record templates must be an array.');
  (Array.isArray(input) ? input : []).forEach((template) => {
    assert(isRecord(template), 'Record templates must be objects.');
    if (template.enabled !== undefined) assert(typeof template.enabled === 'boolean', `Record template ${template.kind || ''} enabled must be boolean.`);
    if (template.fields !== undefined) {
      assert(Array.isArray(template.fields), `Fields for record template ${template.kind || ''} must be an array.`);
      template.fields.forEach((field) => {
        assert(isRecord(field), `Fields for record template ${template.kind || ''} must be objects.`);
        if (field.required !== undefined) assert(typeof field.required === 'boolean', `Required state for field ${field.key || ''} must be boolean.`);
        if (field.options !== undefined) assert(Array.isArray(field.options), `Options for field ${field.key || ''} must be an array.`);
        if (field.referenceKinds !== undefined) assert(Array.isArray(field.referenceKinds), `Reference kinds for field ${field.key || ''} must be an array.`);
      });
    }
  });
  const supplied = Array.isArray(input) ? input.filter(isRecord) : [];
  const suppliedByKind = new Map(supplied.map((template) => [asString(template.kind, 40).toLowerCase(), template]));
  const normalized = defaults.map((base) => {
    const override = suppliedByKind.get(base.kind) || {};
    const overrideFields = Array.isArray(override.fields) ? override.fields.filter(isRecord) : [];
    const overrideFieldsByKey = new Map(overrideFields.map((field) => [asString(field.key, 80), field]));
    const fields = base.fields.map((baseField) => ({ ...baseField, ...(overrideFieldsByKey.get(baseField.key) || {}) }));
    const knownKeys = new Set(base.fields.map((field) => field.key));
    overrideFields.forEach((field) => { if (!knownKeys.has(asString(field.key, 80))) fields.push(field); });
    return {
      ...base,
      ...override,
      kind: base.kind,
      label: asString(override.label ?? base.label, 160),
      group: asString(override.group ?? base.group, 40),
      enabled: override.enabled === undefined ? base.enabled !== false : override.enabled,
      fields: fields.filter(isRecord).map((field) => ({
        key: asString(field.key, 80),
        label: asString(field.label, 160),
        type: asString(field.type || 'text', 32),
        required: Boolean(field.required),
        options: stringList(field.options, 160),
        referenceKinds: stringList(field.referenceKinds, 40).map((kind) => kind.toLowerCase()),
      })),
    };
  });
  const defaultKinds = new Set(defaults.map((template) => template.kind));
  supplied.forEach((template) => {
    const kind = asString(template.kind, 40).toLowerCase();
    if (!kind || defaultKinds.has(kind)) return;
    normalized.push({
      kind,
      label: asString(template.label, 160),
      group: asString(template.group || 'custom', 40),
      enabled: template.enabled === undefined ? true : template.enabled,
      fields: (Array.isArray(template.fields) ? template.fields : []).filter(isRecord).map((field) => ({
        key: asString(field.key, 80), label: asString(field.label, 160), type: asString(field.type || 'text', 32),
        required: Boolean(field.required), options: stringList(field.options, 160),
        referenceKinds: stringList(field.referenceKinds, 40).map((referenceKind) => referenceKind.toLowerCase()),
      })),
    });
  });
  return normalized;
}

function stableLegacyTeamId(name) {
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 12);
  return `team-${hash}`;
}

function stableLegacySourceId(endpoint) {
  const hash = createHash('sha256').update(String(endpoint || '')).digest('hex').slice(0, 16);
  return `source-${hash}`;
}

function normalizeConfig(input = {}) {
  if (!isRecord(input)) throw new Error('Configuration must be an object.');
  const hasSchemaVersion = Object.hasOwn(input, 'schemaVersion');
  const inputSchemaVersion = hasSchemaVersion ? input.schemaVersion : 0;
  if (hasSchemaVersion && (typeof inputSchemaVersion !== 'number' || !Number.isSafeInteger(inputSchemaVersion) || inputSchemaVersion < 0)) {
    throw new Error('Configuration schema version must be a non-negative integer.');
  }
  if (inputSchemaVersion > CONFIG_SCHEMA_VERSION) {
    throw new Error(`Configuration schema version ${inputSchemaVersion} is newer than the supported version ${CONFIG_SCHEMA_VERSION}.`);
  }
  const legacy = inputSchemaVersion < 1;
  const sourceTeams = Array.isArray(input.teams) ? input.teams : [];
  const teams = sourceTeams.filter(isRecord).map((team) => ({
    id: asString(team.id, 80),
    name: asString(team.name, 160),
    aliases: stringList(team.aliases, 160),
    parentTeamId: asString(team.parentTeamId, 80),
    activeFrom: asString(team.activeFrom, 32),
    activeTo: asString(team.activeTo, 32),
  }));
  const teamById = new Map(teams.filter((team) => team.id).map((team) => [team.id, team]));
  const teamByName = new Map(teams.filter((team) => team.name).map((team) => [team.name.toLocaleLowerCase(), team]));
  const boardRoutes = (Array.isArray(input.boardRoutes) ? input.boardRoutes : []).filter(isRecord).map((route) => {
    const boardId = asString(route.boardId, 80);
    let teamId = asString(route.teamId, 80);
    const legacyName = asString(route.team, 160);
    if (!teamId && legacyName) {
      let team = teamByName.get(legacyName.toLocaleLowerCase());
      if (!team) {
        team = { id: stableLegacyTeamId(legacyName), name: legacyName, aliases: [], parentTeamId: '', activeFrom: '', activeTo: '' };
        teams.push(team);
        teamById.set(team.id, team);
        teamByName.set(team.name.toLocaleLowerCase(), team);
      }
      teamId = team.id;
    }
    return {
      boardId, teamId, team: teamById.get(teamId)?.name || legacyName,
      activeFrom: asString(route.activeFrom, 32), activeTo: asString(route.activeTo, 32),
    };
  });
  const assignmentInput = isRecord(input.teamAssignments) ? input.teamAssignments : {};
  const teamAssignments = {
    projects: (Array.isArray(assignmentInput.projects) ? assignmentInput.projects : []).filter(isRecord).map((item) => ({
      projectKey: asString(item.projectKey, 80).toUpperCase(), teamId: asString(item.teamId, 80),
      activeFrom: asString(item.activeFrom, 32), activeTo: asString(item.activeTo, 32),
    })),
    components: (Array.isArray(assignmentInput.components) ? assignmentInput.components : []).filter(isRecord).map((item) => ({
      projectKey: asString(item.projectKey, 80).toUpperCase(), componentId: asString(item.componentId, 80),
      componentName: asString(item.componentName, 160), teamId: asString(item.teamId, 80),
      activeFrom: asString(item.activeFrom, 32), activeTo: asString(item.activeTo, 32),
    })),
    issueOverrides: (Array.isArray(assignmentInput.issueOverrides) ? assignmentInput.issueOverrides : []).filter(isRecord).map((item) => ({
      issueKey: asString(item.issueKey, 120).toUpperCase(), teamId: asString(item.teamId, 80),
      activeFrom: asString(item.activeFrom, 32), activeTo: asString(item.activeTo, 32),
    })),
  };
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const organization = { ...defaults.organization, ...(isRecord(input.organization) ? input.organization : {}) };
  const jiraUrl = asString(input.jiraUrl, 2000);
  const sourceInput = { ...defaults.sourceInstance, ...(isRecord(input.sourceInstance) ? input.sourceInstance : {}) };
  const networkInput = isRecord(sourceInput.networkAccess) ? sourceInput.networkAccess : {};
  const explicitSource = isRecord(input.sourceInstance);
  const projectRoles = { ...defaults.projectRoles, ...(isRecord(input.projectRoles) ? input.projectRoles : {}) };
  const workflowsInput = isRecord(input.workflows) ? input.workflows : {};
  const workflows = {};
  for (const scope of Object.keys(defaults.workflows)) {
    if (isRecord(workflowsInput[scope]) && Object.hasOwn(workflowsInput[scope], 'resolutionCompletes')
      && typeof workflowsInput[scope].resolutionCompletes !== 'boolean') {
      throw new Error(`Workflow resolution policy in ${scope} must be boolean.`);
    }
    workflows[scope] = { ...defaults.workflows[scope], ...(isRecord(workflowsInput[scope]) ? workflowsInput[scope] : {}) };
    for (const key of Object.keys(workflows[scope])) {
      workflows[scope][key] = key === 'milestones'
        ? Array.isArray(workflows[scope][key]) ? workflows[scope][key].filter(isRecord).map((milestone) => ({
          id: asString(milestone.id, 80), label: asString(milestone.label, 160), statuses: stringList(milestone.statuses, 160),
        })) : []
        : key === 'resolutionCompletes'
          ? typeof workflows[scope][key] === 'boolean' ? workflows[scope][key] : true
          : stringList(workflows[scope][key], 160);
    }
  }
  if (legacy && !workflowsInput.delivery && Array.isArray(input.doneStatuses)) {
    workflows.delivery.completedStatuses = stringList(input.doneStatuses, 160);
  }
  const calendar = { ...defaults.calendar, ...(isRecord(input.calendar) ? input.calendar : {}) };
  calendar.workingDays = Array.isArray(calendar.workingDays) ? calendar.workingDays.map(Number) : [];
  calendar.holidays = stringList(calendar.holidays, 10);
  if (Array.isArray(calendar.workIntervals)) assert(calendar.workIntervals.every(isRecord), 'Calendar work intervals must be objects.');
  calendar.workIntervals = (Array.isArray(calendar.workIntervals) ? calendar.workIntervals : []).map((interval) => ({
    start: asString(interval.start, 5), end: asString(interval.end, 5),
    ...(Array.isArray(interval.weekdays) ? { weekdays: interval.weekdays.map(Number) } : {}),
  }));
  const modules = { ...defaults.modules, ...(isRecord(input.modules) ? input.modules : {}) };
  const fieldMappings = (Array.isArray(input.fieldMappings) ? input.fieldMappings : []).filter(isRecord).map((binding) => ({
    semanticKey: asString(binding.semanticKey, 80),
    providerFieldId: asString(binding.providerFieldId, 120),
    providerFieldName: asString(binding.providerFieldName, 200),
    projectKey: asString(binding.projectKey, 80).toUpperCase(),
    issueTypeId: asString(binding.issueTypeId, 80),
    transform: asString(binding.transform || 'identity', 40),
  }));
  const workClassifications = (Array.isArray(input.workClassifications) ? input.workClassifications : []).filter(isRecord).map((item) => ({
    id: asString(item.id, 80),
    label: asString(item.label, 160),
    aliases: stringList(item.aliases, 160),
    minimumShare: item.minimumShare === null || item.minimumShare === undefined || item.minimumShare === '' ? null : Number(item.minimumShare),
    maximumShare: item.maximumShare === null || item.maximumShare === undefined || item.maximumShare === '' ? null : Number(item.maximumShare),
  }));
  const issueTypeClassifications = (Array.isArray(input.issueTypeClassifications) ? input.issueTypeClassifications : []).filter(isRecord).map((item) => ({
    issueTypeId: asString(item.issueTypeId, 80),
    classification: asString(item.classification, 80),
  }));
  const capacityOverrides = [];
  if (Array.isArray(input.capacityOverrides)) assert(input.capacityOverrides.every(isRecord), 'Capacity overrides must be objects.');
  (Array.isArray(input.capacityOverrides) ? input.capacityOverrides : []).forEach((item) => {
    const legacyTeamName = asString(item.team, 160);
    let teamId = asString(item.teamId, 80);
    if (!teamId && legacyTeamName) {
      let team = teamByName.get(legacyTeamName.toLocaleLowerCase());
      if (!team) {
        team = { id: stableLegacyTeamId(legacyTeamName), name: legacyTeamName, aliases: [], parentTeamId: '', activeFrom: '', activeTo: '' };
        teams.push(team);
        teamById.set(team.id, team);
        teamByName.set(team.name.toLocaleLowerCase(), team);
      }
      teamId = team.id;
    }
    capacityOverrides.push({
      teamId, sprintId: asString(item.sprintId, 80), assigneeKey: asString(item.assigneeKey, 160), assignee: asString(item.assignee, 200),
      activeFrom: asString(item.activeFrom, 32), activeTo: asString(item.activeTo, 32),
      overrideWorkingDays: item.overrideWorkingDays === null || item.overrideWorkingDays === undefined || item.overrideWorkingDays === '' ? null : Number(item.overrideWorkingDays),
      allocation: item.allocation === null || item.allocation === undefined || item.allocation === '' ? 1 : Number(item.allocation),
    });
  });
  const next = {
    ...defaults,
    ...input,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    configurationRevision: Math.max(0, Math.floor(Number(input.configurationRevision) || 0)),
    organization: {
      name: asString(organization.name, 200),
      locale: asString(organization.locale || 'en-US', 40),
      timeZone: asString(organization.timeZone || calendar.timeZone || 'UTC', 80),
    },
    workspaceName: asString(input.workspaceName, 200),
    jiraUrl,
    sourceInstance: {
      id: asString(sourceInput.id || (jiraUrl ? stableLegacySourceId(jiraUrl) : ''), 80),
      provider: asString(jiraUrl ? 'jira-datacenter' : (explicitSource ? sourceInput.provider : 'offline-json'), 40),
      displayName: asString(sourceInput.displayName || organization.name, 160),
      endpoint: asString(jiraUrl || sourceInput.endpoint, 2000),
      networkAccess: {
        mode: asString(networkInput.mode || 'private', 24),
        approvedAddresses: stringList(networkInput.approvedAddresses, 64),
      },
    },
    projects: stringList(input.projects, 80).map((key) => key.toUpperCase()),
    projectRoles: Object.fromEntries(Object.keys(defaults.projectRoles).map((role) => [role, stringList(projectRoles[role], 80).map((key) => key.toUpperCase())])),
    teams,
    boardRoutes,
    teamAssignments,
    fieldMappings,
    workClassifications,
    issueTypeClassifications,
    recordTemplates: normalizeRecordTemplates(input.recordTemplates, defaults.recordTemplates),
    capacityOverrides,
    workflows,
    calendar: {
      ...calendar,
      configured: Boolean(calendar.configured),
      timeZone: asString(calendar.timeZone || 'UTC', 80),
      hoursPerDay: Number(calendar.hoursPerDay ?? input.hoursPerDay ?? 8),
    },
    modules: Object.fromEntries(Object.keys(defaults.modules).map((key) => [key, Boolean(modules[key])])),
    doneStatuses: stringList(input.doneStatuses ?? workflows.delivery.completedStatuses, 160),
    migrationStatus: legacy && input.migrationStatus === undefined ? 'review-required' : asString(input.migrationStatus || 'unconfigured', 40),
    migrationWarnings: legacy && !Array.isArray(input.migrationWarnings)
      ? ['Review field, workflow, team, and calendar mappings before enabling analytical modules.']
      : stringList(input.migrationWarnings, 500),
  };
  // Old profile properties remain only in the preserved source profile and revision history.
  for (const key of ['businessAssigneeLines', 'requestingDepartmentLinks', 'developmentTargetMin', 'operationTargetMax', 'regulatoryTargetMax']) delete next[key];
  if (['businessAssigneeLines', 'requestingDepartmentLinks', 'developmentTargetMin', 'operationTargetMax', 'regulatoryTargetMax'].some((key) => Object.hasOwn(input, key))) {
    next.migrationWarnings = [...new Set([...next.migrationWarnings, 'Legacy organization-specific attribution and allocation rules were retained in the source profile; configure generic teams, fields, and work classifications before enabling reports.'])];
    if (next.migrationStatus === 'configured') next.migrationStatus = 'review-required';
  }
  return next;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertActiveDates(value, label) {
  for (const key of ['activeFrom', 'activeTo']) {
    const date = String(value[key] || '');
    if (!date) continue;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === date, `${label} ${key} must be a valid ISO date.`);
  }
  assert(!value.activeFrom || !value.activeTo || value.activeFrom <= value.activeTo,
    `${label} activeFrom must not be later than activeTo.`);
}

function rangesOverlap(left, right) {
  const leftStart = left.activeFrom || '0000-01-01';
  const leftEnd = left.activeTo || '9999-12-31';
  const rightStart = right.activeFrom || '0000-01-01';
  const rightEnd = right.activeTo || '9999-12-31';
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function validateAssignmentSet(items, scopeKey, label) {
  items.forEach((item, index) => {
    assertActiveDates(item, label);
    for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
      const other = items[otherIndex];
      assert(scopeKey(item) !== scopeKey(other) || !rangesOverlap(item, other),
        `${label} has overlapping effective dates for ${scopeKey(item)}.`);
    }
  });
}

function validateTeamAssignments(config) {
  const teamIds = new Set(config.teams.map((team) => team.id));
  const validateReference = (item, label) => assert(teamIds.has(item.teamId), `${label} references an unknown team.`);
  config.teamAssignments.projects.forEach((item) => {
    assert(config.projects.includes(item.projectKey), `Project team assignment references an unselected project: ${item.projectKey}`);
    validateReference(item, `Project ${item.projectKey}`);
  });
  validateAssignmentSet(config.teamAssignments.projects, (item) => item.projectKey, 'Project team assignment');
  config.teamAssignments.components.forEach((item) => {
    assert(config.projects.includes(item.projectKey), `Component team assignment references an unselected project: ${item.projectKey}`);
    assert(item.componentId || item.componentName, 'Component team assignments need a component ID or name.');
    validateReference(item, `Component ${item.componentId || item.componentName}`);
  });
  validateAssignmentSet(config.teamAssignments.components,
    (item) => `${item.projectKey}|${item.componentId || item.componentName.toLocaleLowerCase('en-US')}`, 'Component team assignment');
  config.teamAssignments.issueOverrides.forEach((item) => {
    assert(/^[A-Z][A-Z0-9_]*-\d+$/.test(item.issueKey), `Invalid issue key in team override: ${item.issueKey}`);
    assert(config.projects.includes(item.issueKey.split('-')[0]), `Issue team override references an unselected project: ${item.issueKey}`);
    validateReference(item, `Issue ${item.issueKey}`);
  });
  validateAssignmentSet(config.teamAssignments.issueOverrides, (item) => item.issueKey, 'Issue team override');
}

function validateConfig(input) {
  const config = normalizeConfig(input);
  if (config.jiraUrl) {
    let parsed;
    try { parsed = new URL(config.jiraUrl); } catch { throw new Error('Jira URL is invalid.'); }
    assert(parsed.protocol === 'https:', 'Jira URL must use HTTPS.');
    assert(!parsed.username && !parsed.password, 'Credentials must not be embedded in the Jira URL.');
    assert(!parsed.search && !parsed.hash, 'Jira URL must not contain a query or fragment.');
  }
  assert(['offline-json', 'jira-datacenter'].includes(config.sourceInstance.provider), `Unsupported source provider: ${config.sourceInstance.provider}`);
  if (config.jiraUrl) assert(config.sourceInstance.provider === 'jira-datacenter', 'A Jira URL requires the Jira Data Center source adapter.');
  validateNetworkAccess(config.sourceInstance.networkAccess);
  if (config.sourceInstance.provider === 'offline-json') {
    assert(config.sourceInstance.networkAccess.mode === 'private' && config.sourceInstance.networkAccess.approvedAddresses.length === 0,
      'Offline JSON sources cannot configure live Jira network access.');
  }
  assert(config.sourceInstance.id.length <= 80, 'Source instance ID is too long.');
  if (config.sourceInstance.endpoint) {
    let endpoint;
    try { endpoint = new URL(config.sourceInstance.endpoint); } catch { throw new Error('Source instance endpoint is invalid.'); }
    assert(endpoint.protocol === 'https:', 'Source instance endpoint must use HTTPS.');
    assert(!endpoint.username && !endpoint.password, 'Credentials must not be embedded in the source endpoint.');
    assert(!endpoint.search && !endpoint.hash, 'Source endpoint must not contain a query or fragment.');
  }
  assert(config.projects.length <= 500, 'At most 500 projects may be configured.');
  config.projects.forEach((key) => assert(/^[A-Z][A-Z0-9_]*$/.test(key), `Invalid project key: ${key}`));

  const templateKinds = new Set();
  const fieldTypes = new Set(['text', 'textarea', 'date', 'enum', 'recordRef', 'issueRef', 'issueRefList', 'number', 'boolean']);
  assert(config.recordTemplates.length <= 100, 'At most 100 product record templates may be configured.');
  config.recordTemplates.forEach((template) => {
    assert(/^[a-z][a-z0-9_-]{0,39}$/.test(template.kind), `Invalid record template key: ${template.kind}`);
    assert(!templateKinds.has(template.kind), `Duplicate record template key: ${template.kind}`);
    templateKinds.add(template.kind);
    assert(template.label.length > 0, `Record template ${template.kind} needs a label.`);
    assert(/^[a-z][a-z0-9_-]{0,39}$/.test(template.group), `Invalid register group for ${template.kind}.`);
    assert(typeof template.enabled === 'boolean', `Record template ${template.kind} enabled must be boolean.`);
    assert(template.fields.length <= 200, `Record template ${template.kind} has too many fields.`);
    const fieldKeys = new Set();
    template.fields.forEach((field) => {
      assert(/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(field.key), `Invalid field key in record template ${template.kind}.`);
      assert(!fieldKeys.has(field.key), `Duplicate field ${field.key} in record template ${template.kind}.`);
      fieldKeys.add(field.key);
      assert(field.label.length > 0, `Field ${field.key} in ${template.kind} needs a label.`);
      assert(fieldTypes.has(field.type), `Unsupported field type ${field.type} in ${template.kind}.${field.key}.`);
      assert(typeof field.required === 'boolean', `Required state for ${template.kind}.${field.key} must be boolean.`);
      assert(field.options.length <= 100 && new Set(field.options).size === field.options.length, `Options for ${template.kind}.${field.key} must be unique and limited to 100.`);
      if (field.type === 'enum') assert(field.options.length > 0, `Enum field ${template.kind}.${field.key} needs at least one option.`);
      else assert(field.options.length === 0, `Only enum fields can define options (${template.kind}.${field.key}).`);
      if (field.type === 'recordRef') {
        assert(field.referenceKinds.length > 0, `Record reference ${template.kind}.${field.key} needs at least one target kind.`);
        field.referenceKinds.forEach((referenceKind) => assert(templateKinds.has(referenceKind) || config.recordTemplates.some((candidate) => candidate.kind === referenceKind), `Record reference ${template.kind}.${field.key} targets unknown kind ${referenceKind}.`));
      } else assert(field.referenceKinds.length === 0, `Only record references can define target kinds (${template.kind}.${field.key}).`);
    });
  });

  const teamIds = new Set();
  config.teams.forEach((team) => {
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(team.id), 'Every team needs a stable ID.');
    assert(team.name.length > 0, `Team ${team.id} needs a display name.`);
    assert(team.parentTeamId !== team.id, `Team ${team.id} cannot be its own parent.`);
    assert(!team.parentTeamId || config.teams.some((candidate) => candidate.id === team.parentTeamId), `Team ${team.id} references an unknown parent team.`);
    assert(!teamIds.has(team.id), `Duplicate team ID: ${team.id}`);
    assertActiveDates(team, `Team ${team.id}`);
    teamIds.add(team.id);
  });
  config.teams.forEach((team) => {
    const visited = new Set([team.id]);
    let parent = team.parentTeamId;
    while (parent) {
      assert(!visited.has(parent), `Team hierarchy contains a cycle at ${parent}.`);
      visited.add(parent);
      parent = config.teams.find((candidate) => candidate.id === parent)?.parentTeamId || '';
    }
  });
  const teamLabels = new Map();
  config.teams.forEach((team) => {
    for (const label of [team.name, ...team.aliases]) {
      const normalized = label.trim().toLocaleLowerCase('en-US');
      if (!normalized) continue;
      const existingTeamId = teamLabels.get(normalized);
      assert(!existingTeamId || existingTeamId === team.id, `Team label "${label}" is ambiguous between configured teams.`);
      teamLabels.set(normalized, team.id);
    }
  });
  const capacityOverrideKeys = [];
  config.capacityOverrides.forEach((item) => {
    assert(item.teamId && item.assigneeKey, 'Capacity overrides need a stable team ID and assignee key.');
    assert(config.teams.some((team) => team.id === item.teamId), `Capacity override references an unknown team ID: ${item.teamId}`);
    assert(item.sprintId || item.activeFrom || item.activeTo, 'Capacity overrides need a sprint ID or an effective date range.');
    assertActiveDates(item, `Capacity override for ${item.teamId}`);
    const duplicate = capacityOverrideKeys.find((existing) => existing.teamId === item.teamId
      && existing.assigneeKey === item.assigneeKey && (!existing.sprintId || !item.sprintId || existing.sprintId === item.sprintId)
      && rangesOverlap(existing, item));
    assert(!duplicate, `Overlapping capacity overrides for ${item.teamId} and ${item.assigneeKey}.`);
    capacityOverrideKeys.push(item);
    assert(item.overrideWorkingDays === null || Number.isFinite(item.overrideWorkingDays) && item.overrideWorkingDays >= 0 && item.overrideWorkingDays <= 366, 'Override working days must be between 0 and 366.');
    assert(Number.isFinite(item.allocation) && item.allocation >= 0 && item.allocation <= 1, 'Capacity allocation must be between 0 and 1.');
  });
  config.boardRoutes.forEach((route) => {
    assert(/^\d+$/.test(route.boardId), `Invalid board ID: ${route.boardId}`);
    assert(teamIds.has(route.teamId), `Board ${route.boardId} references an unknown team.`);
    assertActiveDates(route, `Board ${route.boardId} route`);
    route.team = config.teams.find((team) => team.id === route.teamId).name;
  });
  validateAssignmentSet(config.boardRoutes, (route) => route.boardId, 'Board team route');
  validateTeamAssignments(config);

  for (const [role, projects] of Object.entries(config.projectRoles)) {
    projects.forEach((key) => assert(config.projects.includes(key), `Project role ${role} references an unselected project: ${key}`));
  }
  const bindingKeys = new Set();
  config.fieldMappings.forEach((binding) => {
    assert(SEMANTIC_KEYS.has(binding.semanticKey), `Unknown semantic field: ${binding.semanticKey}`);
    assert(/^[A-Za-z][A-Za-z0-9_-]{0,119}$/.test(binding.providerFieldId), `Invalid provider field ID: ${binding.providerFieldId}`);
    assert(!binding.projectKey || config.projects.includes(binding.projectKey), `Field mapping references an unselected project: ${binding.projectKey}`);
    assert(TRANSFORMS.has(binding.transform), `Unsupported transform for ${binding.semanticKey}.`);
    const key = [binding.semanticKey, binding.projectKey, binding.issueTypeId].join('|');
    assert(!bindingKeys.has(key), `Duplicate field mapping scope for ${binding.semanticKey}.`);
    bindingKeys.add(key);
  });

  const workClassificationIds = new Set();
  config.workClassifications.forEach((item) => {
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(item.id), 'Every work classification needs a stable ID.');
    assert(item.label.length > 0, `Work classification ${item.id} needs a label.`);
    assert(!workClassificationIds.has(item.id), `Duplicate work classification ID: ${item.id}`);
    workClassificationIds.add(item.id);
    for (const key of ['minimumShare', 'maximumShare']) {
      if (item[key] !== null) assert(Number.isFinite(item[key]) && item[key] >= 0 && item[key] <= 1, `${key} for ${item.id} must be between 0 and 1.`);
    }
    if (item.minimumShare !== null && item.maximumShare !== null) assert(item.minimumShare <= item.maximumShare, `Work classification ${item.id} has a minimum above its maximum.`);
  });
  const issueTypeIds = new Set();
  config.issueTypeClassifications.forEach((item) => {
    assert(item.issueTypeId.length > 0 && item.classification.length > 0, 'Issue type classifications need an issue type and classification.');
    assert(!issueTypeIds.has(item.issueTypeId), `Issue type ${item.issueTypeId} has more than one classification.`);
    issueTypeIds.add(item.issueTypeId);
  });

  for (const [scope, workflow] of Object.entries(config.workflows)) {
    for (const key of Object.keys(workflow).filter((name) => name !== 'milestones')) {
      if (key === 'resolutionCompletes') {
        assert(typeof workflow[key] === 'boolean', `Workflow resolution policy in ${scope} must be boolean.`);
        continue;
      }
      workflow[key].forEach((status) => assert(status.length <= 160, `Workflow status in ${scope} is too long.`));
    }
    assert(Array.isArray(workflow.milestones), `Workflow milestones for ${scope} must be a list.`);
  }
  for (const timeZone of [config.calendar.timeZone, config.organization.timeZone]) {
    try { new Intl.DateTimeFormat('en', { timeZone }); }
    catch { throw new Error(`Unknown time zone: ${timeZone}`); }
  }
  assert(config.calendar.workingDays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6), 'Calendar weekdays must be integers from 0 to 6.');
  assert(new Set(config.calendar.workingDays).size === config.calendar.workingDays.length, 'Calendar weekdays must be unique.');
  assert(Number.isFinite(config.calendar.hoursPerDay) && config.calendar.hoursPerDay > 0 && config.calendar.hoursPerDay <= 24, 'Calendar hours per day must be greater than 0 and at most 24.');
  if (config.calendar.configured) assert(config.calendar.workingDays.length > 0, 'A configured calendar needs at least one working day.');
  config.calendar.holidays.forEach((day) => {
    const parsed = new Date(`${day}T00:00:00Z`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day, `Invalid holiday date: ${day}`);
  });
  config.calendar.workIntervals.forEach((interval) => {
    assert(isRecord(interval) && /^\d{2}:\d{2}$/.test(interval.start || '') && /^\d{2}:\d{2}$/.test(interval.end || ''), 'Calendar work intervals need start and end times in HH:MM format.');
    const start = Number(interval.start.slice(0, 2)) * 60 + Number(interval.start.slice(3));
    const end = Number(interval.end.slice(0, 2)) * 60 + Number(interval.end.slice(3));
    assert(start >= 0 && start < 1440 && end > start && end <= 1440, 'Calendar work interval boundaries are invalid.');
    if (interval.weekdays !== undefined) {
      assert(Array.isArray(interval.weekdays) && interval.weekdays.length > 0, 'Calendar work intervals need at least one weekday when scoped.');
      assert(interval.weekdays.every((day) => Number.isInteger(day) && config.calendar.workingDays.includes(day)), 'Calendar work interval weekdays must be configured working days.');
      assert(new Set(interval.weekdays).size === interval.weekdays.length, 'Calendar work interval weekdays must be unique.');
    }
  });
  for (let leftIndex = 0; leftIndex < config.calendar.workIntervals.length; leftIndex += 1) {
    const left = config.calendar.workIntervals[leftIndex];
    const leftStart = Number(left.start.slice(0, 2)) * 60 + Number(left.start.slice(3));
    const leftEnd = Number(left.end.slice(0, 2)) * 60 + Number(left.end.slice(3));
    for (const right of config.calendar.workIntervals.slice(leftIndex + 1)) {
      const rightStart = Number(right.start.slice(0, 2)) * 60 + Number(right.start.slice(3));
      const rightEnd = Number(right.end.slice(0, 2)) * 60 + Number(right.end.slice(3));
      const weekdays = (interval) => interval.weekdays || config.calendar.workingDays;
      const overlapsOnDay = weekdays(left).some((day) => weekdays(right).includes(day));
      assert(!overlapsOnDay || leftEnd <= rightStart || rightEnd <= leftStart, 'Calendar work intervals must not overlap on the same weekday.');
    }
  }
  for (const [scope, workflow] of Object.entries(config.workflows)) {
    const ids = new Set();
    workflow.milestones.forEach((milestone) => {
      assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(milestone.id), `Workflow milestone in ${scope} needs a stable ID.`);
      assert(milestone.label.length > 0, `Workflow milestone ${milestone.id} needs a label.`);
      assert(milestone.statuses.length > 0, `Workflow milestone ${milestone.id} needs at least one status.`);
      assert(!ids.has(milestone.id), `Duplicate workflow milestone ID: ${milestone.id}`);
      ids.add(milestone.id);
    });
  }

  for (const [key, enabled] of Object.entries(config.modules)) assert(typeof enabled === 'boolean', `Module setting ${key} must be boolean.`);
  if (config.modules.delivery) {
    assert(config.projectRoles.technicalDelivery.length > 0, 'Delivery intelligence needs at least one technical delivery project.');
    assert(hasTeamAttribution(config), 'Delivery intelligence needs at least one configured team attribution source.');
    assert(config.fieldMappings.some((binding) => binding.semanticKey === 'sprint'), 'Delivery intelligence needs a sprint field mapping.');
  }
  if (config.modules.portfolio) assert(config.projectRoles.technicalDelivery.length > 0, 'Portfolio needs at least one technical delivery project.');
  if (config.modules.productIntake) assert(config.projectRoles.productIntake.length > 0, 'Product intake needs at least one product intake project.');
  if (config.modules.commitments) assert(config.projectRoles.commitments.length > 0, 'Commitments needs at least one commitment project.');
  if (config.modules.businessSprint) {
    assert(config.modules.commitments && config.projectRoles.commitments.length > 0, 'Sprint commitments need the commitments module and a commitment project.');
    assert(config.fieldMappings.some((binding) => binding.semanticKey === 'storyPoints'), 'Sprint commitments need a story-points mapping.');
    assert(config.fieldMappings.some((binding) => binding.semanticKey === 'sprint'), 'Sprint commitments need a sprint mapping.');
    assert(config.workflows.commitment.entryStatuses.length > 0, 'Sprint commitments need commitment entry statuses.');
    assert(hasTeamAttribution(config), 'Sprint commitments need at least one configured team attribution source.');
  }
  if (config.modules.organizationAnalytics) {
    assert(config.projectRoles.productIntake.length > 0, 'Organization analytics needs an intake project.');
    assert(config.fieldMappings.some((binding) => binding.semanticKey === 'department'), 'Organization analytics needs a department field mapping.');
  }
  for (const key of ['minForecastCoverage', 'minimumTimeDataCoverage', 'capacityWarning', 'capacityCritical', 'adhocHoursWarning']) {
    const value = Number(config[key]);
    assert(Number.isFinite(value) && value >= 0 && value <= 1, `${key} must be between 0 and 1.`);
  }
  for (const key of ['planningLookback', 'predictabilityLookback']) {
    const value = Number(config[key]);
    assert(Number.isInteger(value) && value >= 1 && value <= 20, `${key} must be an integer from 1 to 20.`);
  }
  return config;
}

function hasTeamAttribution(config) {
  return config.boardRoutes.length > 0
    || (config.teams.length > 0 && config.fieldMappings.some((binding) => binding.semanticKey === 'team'))
    || config.teamAssignments.projects.length > 0
    || config.teamAssignments.components.length > 0
    || config.teamAssignments.issueOverrides.length > 0;
}

function configurationFingerprint(config) {
  const normalized = validateConfig(config);
  normalized.configurationRevision = 0;
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function sourceIdentityKey(input) {
  const config = normalizeConfig(input);
  const endpoint = String(config.jiraUrl || config.sourceInstance.endpoint || '').trim();
  let normalizedEndpoint = endpoint;
  if (endpoint) {
    try { normalizedEndpoint = new URL(endpoint).toString().replace(/\/$/, ''); }
    catch { /* Config validation reports malformed source endpoints to the caller. */ }
  }
  return createHash('sha256').update(JSON.stringify([
    config.sourceInstance.provider,
    config.sourceInstance.id,
    normalizedEndpoint,
    config.sourceInstance.provider === 'offline-json' ? config.sourceInstance.displayName.trim().toLocaleLowerCase('en-US') : '',
  ])).digest('hex');
}

module.exports = { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, SEMANTIC_KEYS, normalizeConfig, validateConfig, configurationFingerprint, sourceIdentityKey };
