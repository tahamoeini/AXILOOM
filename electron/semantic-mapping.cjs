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

function selectMapping(issue, config, semanticKey) {
  const context = issueContext(issue);
  const matches = (Array.isArray(config?.fieldMappings) ? config.fieldMappings : [])
    .filter((binding) => binding.semanticKey === semanticKey
      && (!binding.projectKey || binding.projectKey.toUpperCase() === context.projectKey)
      && (!binding.issueTypeId || binding.issueTypeId === context.issueTypeId));
  return matches.sort((left, right) => {
    const score = (binding) => Number(Boolean(binding.projectKey)) * 2 + Number(Boolean(binding.issueTypeId));
    return score(right) - score(left);
  })[0] || null;
}

function transformValue(value, transform) {
  if (value === undefined || value === null) return null;
  if (transform === 'number') {
    if (value === '') return null;
    const number = Number(value);
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
  if (transform === 'boolean') return Boolean(value);
  return value;
}

function resolveSemanticValue(issue, config, semanticKey) {
  const binding = selectMapping(issue, config, semanticKey);
  if (!binding) return null;
  const value = issue?.fields?.[binding.providerFieldId];
  return transformValue(value, binding.transform);
}

function resolveSemanticFields(issue, config) {
  return Object.fromEntries(Object.keys(SEMANTIC_NAMES).map((key) => [key, resolveSemanticValue(issue, config, key)]));
}

function semanticHistoryField(item, config, issue) {
  const providerIds = [item?.fieldId, item?.field].filter(Boolean).map(String);
  for (const binding of config?.fieldMappings || []) {
    if (providerIds.includes(String(binding.providerFieldId))) return SEMANTIC_NAMES[binding.semanticKey] || '';
  }
  const field = String(item?.field || '').trim().toLowerCase();
  if (GENERIC_HISTORY_ALIASES.has(field)) return GENERIC_HISTORY_ALIASES.get(field);
  for (const binding of config?.fieldMappings || []) {
    const configuredName = String(binding.providerFieldName || '').trim().toLowerCase();
    if (configuredName && configuredName === field) return SEMANTIC_NAMES[binding.semanticKey] || '';
  }
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
  resolveSemanticValue,
  resolveSemanticFields,
  semanticHistoryField,
  configuredCompletedStatuses,
  isIssueDone,
  transformValue,
};
