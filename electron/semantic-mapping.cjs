const SEMANTIC_NAMES = Object.freeze({
  storyPoints: 'storyPoints',
  sprint: 'sprint',
  epicLink: 'epicLink',
  epicName: 'epicName',
  team: 'team',
  workClassification: 'workClassification',
  issueTags: 'issueTags',
  requester: 'requester',
  department: 'department',
  productOwner: 'productOwner',
  loggedTime: 'loggedTime',
});

const GENERIC_HISTORY_ALIASES = new Map([
  ['story points', 'storyPoints'], ['storypoints', 'storyPoints'],
  ['sprint', 'sprint'], ['team', 'team'],
  ['work classification', 'workClassification'], ['issue tags', 'issueTags'],
  ['status', 'status'], ['time spent', 'timespent'], ['timespent', 'timespent'],
  ['original estimate', 'timeoriginalestimate'], ['timeoriginalestimate', 'timeoriginalestimate'],
  ['remaining estimate', 'timeestimate'], ['timeestimate', 'timeestimate'],
]);

function issueContext(issue) {
  const fields = issue?.fields || {};
  return {
    projectKey: String(fields.project?.key || issue?.key?.split('-')[0] || '').toUpperCase(),
    issueTypeId: String(fields.issuetype?.id || ''),
  };
}

function mappingScopeScore(binding) {
  return Number(Boolean(binding.projectKey)) * 2 + Number(Boolean(binding.issueTypeId));
}

function mappingMatchesContext(binding, context) {
  return (!binding.projectKey || binding.projectKey.toUpperCase() === context.projectKey)
    && (!binding.issueTypeId || binding.issueTypeId === context.issueTypeId);
}

function orderedMappings(issue, config, predicate) {
  const context = issueContext(issue);
  return (Array.isArray(config?.fieldMappings) ? config.fieldMappings : [])
    .filter((binding) => predicate(binding) && mappingMatchesContext(binding, context))
    .sort((left, right) => mappingScopeScore(right) - mappingScopeScore(left));
}

function selectMapping(issue, config, semanticKey) {
  return orderedMappings(issue, config, (binding) => binding.semanticKey === semanticKey)[0] || null;
}

function resolveSemanticBinding(issue, config, semanticKey) {
  return selectMapping(issue, config, semanticKey);
}

function transformValue(value, transform) {
  if (value === undefined || value === null) return null;
  if (transform === 'number') {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const number = typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
      ? Number.NaN
      : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  if (transform === 'text') {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  }
  if (transform === 'option-label') {
    if (Array.isArray(value)) return value.map((item) => transformValue(item, 'option-label')).filter(Boolean);
    if (typeof value === 'object') return String(value.value ?? value.name ?? value.displayName ?? value.key ?? '').trim() || null;
    return String(value).trim() || null;
  }
  if (transform === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 0) return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLocaleLowerCase('en-US');
      if (normalized === '1' || normalized === 'true') return true;
      if (normalized === '0' || normalized === 'false') return false;
    }
    return null;
  }
  return value;
}

function resolveSemanticValue(issue, config, semanticKey) {
  const binding = resolveSemanticBinding(issue, config, semanticKey);
  if (!binding) return null;
  const value = issue?.fields?.[binding.providerFieldId];
  return transformValue(value, binding.transform);
}

function resolveSemanticFields(issue, config) {
  return Object.fromEntries(Object.keys(SEMANTIC_NAMES).map((key) => [key, resolveSemanticValue(issue, config, key)]));
}

function semanticHistoryField(item, config, issue) {
  const providerIds = [item?.fieldId, item?.field].filter(Boolean).map(String);
  const mappings = Array.isArray(config?.fieldMappings) ? config.fieldMappings : [];
  const rawField = String(item?.field || item?.fieldId || '');
  const configuredIds = mappings.filter((binding) => providerIds.includes(String(binding.providerFieldId)));
  if (configuredIds.length) {
    const matches = orderedMappings(issue, config, (binding) => providerIds.includes(String(binding.providerFieldId)));
    if (!matches.length) return rawField;
    const bestScore = mappingScopeScore(matches[0]);
    const semanticKeys = new Set(matches.filter((binding) => mappingScopeScore(binding) === bestScore).map((binding) => binding.semanticKey));
    return semanticKeys.size === 1 ? SEMANTIC_NAMES[[...semanticKeys][0]] || rawField : rawField;
  }
  const field = String(item?.field || '').trim().toLowerCase();
  const configuredNames = mappings.filter((binding) => String(binding.providerFieldName || '').trim().toLowerCase() === field && field);
  if (configuredNames.length) {
    const matches = orderedMappings(issue, config, (binding) => String(binding.providerFieldName || '').trim().toLowerCase() === field);
    if (!matches.length) return rawField;
    const bestScore = mappingScopeScore(matches[0]);
    const semanticKeys = new Set(matches.filter((binding) => mappingScopeScore(binding) === bestScore).map((binding) => binding.semanticKey));
    return semanticKeys.size === 1 ? SEMANTIC_NAMES[[...semanticKeys][0]] || rawField : rawField;
  }
  if (GENERIC_HISTORY_ALIASES.has(field)) return GENERIC_HISTORY_ALIASES.get(field);
  return field === 'status' ? 'status' : '';
}

const WORKFLOW_SCOPE_BY_ROLE = { technicalDelivery: 'delivery', delivery: 'delivery', productIntake: 'intake', intake: 'intake', commitments: 'commitment', commitment: 'commitment' };
const LIFECYCLE_STATUS_FIELDS = [
  ['backlogStatuses', 'backlog'], ['readyStatuses', 'ready'], ['startedStatuses', 'started'],
  ['blockedStatuses', 'blocked'], ['reviewStatuses', 'review'], ['completedStatuses', 'delivered'],
  ['cancelledStatuses', 'cancelled'], ['entryStatuses', 'committed'],
];
const DEFAULT_COMPLETION_POLICY = { completedStatuses: new Set(), completionStatusCategories: new Set(['done']), resolutionCompletes: true };

function normalizeWorkflowScope(scope) {
  const key = String(scope || '').trim();
  return Object.hasOwn(WORKFLOW_SCOPE_BY_ROLE, key) ? WORKFLOW_SCOPE_BY_ROLE[key] : '';
}

function workflowEntriesForProject(config, projectKey, scope = '') {
  const project = String(projectKey || '').trim().toUpperCase();
  if (!project) return [];
  const selectedScope = normalizeWorkflowScope(scope);
  const workflows = config?.workflows || {};
  return Object.entries(config?.projectRoles || {}).filter(([, projects]) => (projects || []).some((key) => String(key).toUpperCase() === project))
    .map(([role]) => ({ scope: normalizeWorkflowScope(role) || role, workflow: workflows[normalizeWorkflowScope(role) || role] }))
    .filter((entry) => (!selectedScope || entry.scope === selectedScope) && entry.workflow && typeof entry.workflow === 'object');
}

function workflowScopesForProject(config, projectKey) {
  return [...new Set(workflowEntriesForProject(config, projectKey).map((entry) => entry.scope))];
}

function completionPolicyForProject(config, projectKey, scope = '') {
  const entries = workflowEntriesForProject(config, projectKey, scope);
  if (!entries.length) return DEFAULT_COMPLETION_POLICY;
  const completedStatuses = new Set();
  const completionStatusCategories = new Set();
  let resolutionCompletes = false;
  entries.forEach(({ workflow }) => {
    (workflow.completedStatuses || []).forEach((status) => completedStatuses.add(String(status).trim().toLocaleLowerCase('en-US')));
    (workflow.completionStatusCategories === undefined ? ['done'] : workflow.completionStatusCategories)
      .forEach((category) => completionStatusCategories.add(String(category).trim().toLocaleLowerCase('en-US')));
    if (workflow.resolutionCompletes !== false) resolutionCompletes = true;
  });
  return { completedStatuses, completionStatusCategories, resolutionCompletes };
}

function configuredCompletedStatuses(config, projectKey, scope = '') {
  return completionPolicyForProject(config, projectKey, scope).completedStatuses;
}

function resolutionCompletesForProject(config, projectKey, scope = '') {
  return completionPolicyForProject(config, projectKey, scope).resolutionCompletes;
}

function statusCategoryCompletesForProject(config, projectKey, category, scope = '') {
  return completionPolicyForProject(config, projectKey, scope).completionStatusCategories.has(String(category || '').trim().toLocaleLowerCase('en-US'));
}

function hasLifecycleStatusMappings(config, projectKey, scope = '') {
  return workflowEntriesForProject(config, projectKey, scope).some(({ workflow }) => LIFECYCLE_STATUS_FIELDS
    .some(([field]) => Array.isArray(workflow[field]) && workflow[field].length > 0)
    || (Array.isArray(workflow.completionStatusCategories) && workflow.completionStatusCategories.length > 0));
}

function lifecycleStatusesForProject(config, projectKey, role, scope = '') {
  const field = LIFECYCLE_STATUS_FIELDS.find(([, lifecycleRole]) => lifecycleRole === role)?.[0];
  const output = new Set();
  if (!field) return output;
  workflowEntriesForProject(config, projectKey, scope).forEach(({ workflow }) => (workflow[field] || [])
    .forEach((status) => output.add(String(status).trim().toLocaleLowerCase('en-US'))));
  return output;
}

function lifecycleRolesForStatus(config, projectKey, statusName, statusCategory = '', hasResolution = false, scope = '') {
  const normalizedStatus = String(statusName || '').trim().toLocaleLowerCase('en-US');
  const entries = workflowEntriesForProject(config, projectKey, scope);
  const roles = new Set();
  entries.forEach(({ workflow }) => LIFECYCLE_STATUS_FIELDS.forEach(([field, role]) => {
    if ((workflow[field] || []).some((status) => String(status).trim().toLocaleLowerCase('en-US') === normalizedStatus)) roles.add(role);
  }));
  const completion = completionPolicyForProject(config, projectKey, scope);
  if (completion.completionStatusCategories.has(String(statusCategory || '').trim().toLocaleLowerCase('en-US'))
    || (hasResolution && completion.resolutionCompletes)) roles.add('delivered');
  return ['backlog', 'ready', 'started', 'blocked', 'review', 'delivered', 'cancelled', 'committed'].filter((role) => roles.has(role));
}

function isIssueDone(issue, config, scope = '') {
  const fields = issue?.fields || {};
  const projectKey = issueContext(issue).projectKey;
  const completion = completionPolicyForProject(config, projectKey, scope);
  const category = String(fields.status?.statusCategory?.key || '').trim().toLocaleLowerCase('en-US');
  const resolutionDate = String(fields.resolutiondate || '');
  const statusName = String(fields.status?.name || '').trim().toLocaleLowerCase('en-US');
  return completion.completionStatusCategories.has(category)
    || (completion.resolutionCompletes && Boolean(resolutionDate))
    || completion.completedStatuses.has(statusName);
}

module.exports = {
  SEMANTIC_NAMES,
  issueContext,
  resolveSemanticBinding,
  resolveSemanticValue,
  resolveSemanticFields,
  semanticHistoryField,
  normalizeWorkflowScope,
  workflowEntriesForProject,
  workflowScopesForProject,
  completionPolicyForProject,
  configuredCompletedStatuses,
  resolutionCompletesForProject,
  statusCategoryCompletesForProject,
  hasLifecycleStatusMappings,
  lifecycleStatusesForProject,
  lifecycleRolesForStatus,
  isIssueDone,
  transformValue,
};
