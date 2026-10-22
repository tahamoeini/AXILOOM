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

function configuredCompletedStatuses(config, projectKey) {
  const project = String(projectKey || '').toUpperCase();
  const roles = config?.projectRoles || {};
  const workflows = config?.workflows || {};
  const output = new Set();
  const workflowKey = { technicalDelivery: 'delivery', productIntake: 'intake', commitments: 'commitment' };
  for (const [role, projects] of Object.entries(roles)) {
    if ((projects || []).includes(project)) {
      (workflows[workflowKey[role] || role]?.completedStatuses || []).forEach((status) => output.add(String(status).trim().toLocaleLowerCase('en-US')));
    }
  }
  return output;
}

function isIssueDone(issue, config) {
  const fields = issue?.fields || {};
  const projectKey = issueContext(issue).projectKey;
  const category = String(fields.status?.statusCategory?.key || '').toLowerCase();
  const resolutionDate = String(fields.resolutiondate || '');
  const statusName = String(fields.status?.name || '').trim().toLocaleLowerCase('en-US');
  return category === 'done' || Boolean(resolutionDate) || configuredCompletedStatuses(config, projectKey).has(statusName);
}

module.exports = {
  SEMANTIC_NAMES,
  issueContext,
  resolveSemanticBinding,
  resolveSemanticValue,
  resolveSemanticFields,
  semanticHistoryField,
  configuredCompletedStatuses,
  isIssueDone,
  transformValue,
};
