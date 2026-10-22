const { createHash } = require('node:crypto');

const CONFIG_SCHEMA_VERSION = 1;
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
  sourceInstance: { id: '', provider: 'offline-json', displayName: '', endpoint: '' },
  jiraUrl: '',
  projects: [],
  projectRoles: { productIntake: [], technicalDelivery: [], commitments: [] },
  teams: [],
  boardRoutes: [],
  fieldMappings: [],
  workClassifications: [],
  issueTypeClassifications: [],
  workflows: {
    delivery: { completedStatuses: [], startedStatuses: [], blockedStatuses: [], cancelledStatuses: [], milestones: [] },
    intake: { completedStatuses: [], milestones: [] },
    commitment: { entryStatuses: [], completedStatuses: [], milestones: [] },
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
  unspecifiedOpTypeWarning: 0.1,
  capacityOverrides: [],
  stakeholderContactPoints: [],
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
  const legacy = Number(input.schemaVersion || 0) < CONFIG_SCHEMA_VERSION;
  const sourceTeams = Array.isArray(input.teams) ? input.teams : [];
  const teams = sourceTeams.filter(isRecord).map((team) => ({
    id: asString(team.id, 80),
    name: asString(team.name, 160),
    aliases: stringList(team.aliases, 160),
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
        team = { id: stableLegacyTeamId(legacyName), name: legacyName, aliases: [], activeFrom: '', activeTo: '' };
        teams.push(team);
        teamById.set(team.id, team);
        teamByName.set(team.name.toLocaleLowerCase(), team);
      }
      teamId = team.id;
    }
    return { boardId, teamId, team: teamById.get(teamId)?.name || legacyName };
  });
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const organization = { ...defaults.organization, ...(isRecord(input.organization) ? input.organization : {}) };
  const jiraUrl = asString(input.jiraUrl, 2000);
  const sourceInput = { ...defaults.sourceInstance, ...(isRecord(input.sourceInstance) ? input.sourceInstance : {}) };
  const explicitSource = isRecord(input.sourceInstance);
  const projectRoles = { ...defaults.projectRoles, ...(isRecord(input.projectRoles) ? input.projectRoles : {}) };
  const workflowsInput = isRecord(input.workflows) ? input.workflows : {};
  const workflows = {};
  for (const scope of Object.keys(defaults.workflows)) {
    workflows[scope] = { ...defaults.workflows[scope], ...(isRecord(workflowsInput[scope]) ? workflowsInput[scope] : {}) };
    for (const key of Object.keys(workflows[scope])) {
      workflows[scope][key] = key === 'milestones'
        ? Array.isArray(workflows[scope][key]) ? workflows[scope][key].filter(isRecord).map((milestone) => ({
          id: asString(milestone.id, 80), label: asString(milestone.label, 160), statuses: stringList(milestone.statuses, 160),
        })) : []
        : stringList(workflows[scope][key], 160);
    }
  }
  if (legacy && !workflowsInput.delivery && Array.isArray(input.doneStatuses)) {
    workflows.delivery.completedStatuses = stringList(input.doneStatuses, 160);
  }
  const calendar = { ...defaults.calendar, ...(isRecord(input.calendar) ? input.calendar : {}) };
  calendar.workingDays = Array.isArray(calendar.workingDays) ? calendar.workingDays.map(Number) : [];
  calendar.holidays = stringList(calendar.holidays, 10);
  calendar.workIntervals = Array.isArray(calendar.workIntervals) ? calendar.workIntervals : [];
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
  const capacityOverrides = (Array.isArray(input.capacityOverrides) ? input.capacityOverrides : []).filter(isRecord).map((item) => ({
    team: asString(item.team, 160), sprintId: asString(item.sprintId, 80), assigneeKey: asString(item.assigneeKey, 160), assignee: asString(item.assignee, 200),
    overrideWorkingDays: item.overrideWorkingDays === null || item.overrideWorkingDays === undefined || item.overrideWorkingDays === '' ? null : Number(item.overrideWorkingDays),
    allocation: item.allocation === null || item.allocation === undefined || item.allocation === '' ? 1 : Number(item.allocation),
  }));
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
      endpoint: asString(sourceInput.endpoint || input.jiraUrl, 2000),
    },
    projects: stringList(input.projects, 80).map((key) => key.toUpperCase()),
    projectRoles: Object.fromEntries(Object.keys(defaults.projectRoles).map((role) => [role, stringList(projectRoles[role], 80).map((key) => key.toUpperCase())])),
    teams,
    boardRoutes,
    fieldMappings,
    workClassifications,
    issueTypeClassifications,
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
  assert(config.sourceInstance.id.length <= 80, 'Source instance ID is too long.');
  if (config.sourceInstance.endpoint) {
    try { new URL(config.sourceInstance.endpoint); } catch { throw new Error('Source instance endpoint is invalid.'); }
  }
  assert(config.projects.length <= 500, 'At most 500 projects may be configured.');
  config.projects.forEach((key) => assert(/^[A-Z][A-Z0-9_]*$/.test(key), `Invalid project key: ${key}`));

  const teamIds = new Set();
  config.teams.forEach((team) => {
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(team.id), 'Every team needs a stable ID.');
    assert(team.name.length > 0, `Team ${team.id} needs a display name.`);
    assert(!teamIds.has(team.id), `Duplicate team ID: ${team.id}`);
    teamIds.add(team.id);
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
  const capacityOverrideKeys = new Set();
  config.capacityOverrides.forEach((item) => {
    assert(item.team && item.sprintId && item.assigneeKey, 'Capacity overrides need a team, sprint ID, and assignee key.');
    assert(!config.teams.length || config.teams.some((team) => team.name === item.team), `Capacity override references an unknown team: ${item.team}`);
    const key = [item.team, item.sprintId, item.assigneeKey].join('|');
    assert(!capacityOverrideKeys.has(key), `Duplicate capacity override: ${key}`);
    capacityOverrideKeys.add(key);
    assert(item.overrideWorkingDays === null || Number.isFinite(item.overrideWorkingDays) && item.overrideWorkingDays >= 0 && item.overrideWorkingDays <= 366, 'Override working days must be between 0 and 366.');
    assert(Number.isFinite(item.allocation) && item.allocation >= 0 && item.allocation <= 1, 'Capacity allocation must be between 0 and 1.');
  });
  const boardIds = new Set();
  config.boardRoutes.forEach((route) => {
    assert(/^\d+$/.test(route.boardId), `Invalid board ID: ${route.boardId}`);
    assert(teamIds.has(route.teamId), `Board ${route.boardId} references an unknown team.`);
    assert(!boardIds.has(route.boardId), `Board ${route.boardId} has more than one team mapping.`);
    boardIds.add(route.boardId);
    route.team = config.teams.find((team) => team.id === route.teamId).name;
  });

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
  });
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
    assert(config.boardRoutes.length > 0, 'Delivery intelligence needs at least one board-to-team mapping.');
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
    assert(config.boardRoutes.length > 0, 'Sprint commitments need board-to-team mappings.');
  }
  if (config.modules.organizationAnalytics) {
    assert(config.projectRoles.productIntake.length > 0, 'Organization analytics needs an intake project.');
    assert(config.fieldMappings.some((binding) => binding.semanticKey === 'department'), 'Organization analytics needs a department field mapping.');
  }
  for (const key of ['minForecastCoverage', 'minimumTimeDataCoverage', 'capacityWarning', 'capacityCritical', 'adhocHoursWarning', 'unspecifiedOpTypeWarning']) {
    const value = Number(config[key]);
    assert(Number.isFinite(value) && value >= 0 && value <= 1, `${key} must be between 0 and 1.`);
  }
  for (const key of ['planningLookback', 'predictabilityLookback']) {
    const value = Number(config[key]);
    assert(Number.isInteger(value) && value >= 1 && value <= 20, `${key} must be an integer from 1 to 20.`);
  }
  return config;
}

function configurationFingerprint(config) {
  const normalized = validateConfig(config);
  normalized.configurationRevision = 0;
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

module.exports = { CONFIG_SCHEMA_VERSION, DEFAULT_CONFIG, SEMANTIC_KEYS, normalizeConfig, validateConfig, configurationFingerprint };
