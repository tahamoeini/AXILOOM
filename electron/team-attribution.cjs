function dateAt(timestamp) {
  const value = Number(timestamp);
  return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : '';
}

function isActiveAt(item, timestamp) {
  const date = dateAt(timestamp);
  return Boolean(date) && (!item.activeFrom || date >= item.activeFrom) && (!item.activeTo || date <= item.activeTo);
}

function resolveTeamById(config, teamId, timestamp) {
  const team = (config.teams || []).find((candidate) => candidate.id === teamId);
  return team && isActiveAt(team, timestamp) ? team : null;
}

function resolveTeamByLabel(config, label, timestamp) {
  const normalized = String(label || '').trim().toLocaleLowerCase('en-US');
  if (!normalized) return { team: null, status: 'blank' };
  const matches = (config.teams || []).filter((team) => [team.name, ...(team.aliases || [])]
    .some((candidate) => String(candidate).trim().toLocaleLowerCase('en-US') === normalized));
  const active = matches.filter((team) => isActiveAt(team, timestamp));
  if (active.length > 1) return { team: null, status: 'ambiguous' };
  if (active.length === 1) return { team: active[0], status: 'mapped' };
  return { team: null, status: matches.length ? 'inactive' : 'unmapped' };
}

function resolveAssignment(rules, predicate, config, timestamp) {
  const matches = (rules || []).filter(predicate);
  const active = matches.filter((rule) => isActiveAt(rule, timestamp));
  const candidates = [...new Set(active.map((rule) => rule.teamId))]
    .map((teamId) => resolveTeamById(config, teamId, timestamp)).filter(Boolean);
  if (candidates.length > 1) return { team: null, status: 'ambiguous' };
  if (candidates.length === 1) return { team: candidates[0], status: 'mapped' };
  return { team: null, status: matches.length ? 'inactive' : 'unmapped' };
}

function componentList(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === 'object' ? [value] : [];
}

function componentAssignment(issue, config, timestamp) {
  const projectKey = String(issue.fields?.project?.key || issue.project || '').toUpperCase();
  const components = componentList(issue.fields?.components);
  const rules = config.teamAssignments?.components || [];
  const matches = rules.filter((rule) => rule.projectKey === projectKey && components.some((component) => {
    if (rule.componentId) return String(component?.id || '') === rule.componentId;
    return String(component?.name || '').trim().toLocaleLowerCase('en-US') === rule.componentName.toLocaleLowerCase('en-US');
  }));
  return resolveAssignment(matches, () => true, config, timestamp);
}

function boardAssignment(sprint, config, timestamp) {
  const boardId = String(sprint?.boardId || '');
  const routes = config.boardRoutes || [];
  if (boardId) return resolveAssignment(routes, (route) => String(route.boardId) === boardId, config, timestamp);
  const legacy = resolveTeamByLabel(config, sprint?.teamRoute, timestamp);
  return legacy.status === 'blank' ? { team: null, status: 'unmapped' } : legacy;
}

function parentPath(config, team) {
  const parents = [];
  let current = team;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    parents.unshift(current.name);
    current = (config.teams || []).find((candidate) => candidate.id === current.parentTeamId);
  }
  return parents;
}

function resolveTeamAttribution(issue, sprint, config, teamValue, timestamp) {
  const fields = issue.fields || {};
  const projectKey = String(fields.project?.key || issue.project || issue.key?.split('-')[0] || '').toUpperCase();
  const issueKey = String(issue.key || '').toUpperCase();
  const assignments = config.teamAssignments || {};
  const issueOverride = resolveAssignment(assignments.issueOverrides,
    (rule) => rule.issueKey === issueKey, config, timestamp);
  const field = resolveTeamByLabel(config, teamValue, timestamp);
  const board = boardAssignment(sprint, config, timestamp);
  const components = componentAssignment(issue, config, timestamp);
  const project = resolveAssignment(assignments.projects, (rule) => rule.projectKey === projectKey, config, timestamp);
  const choices = [
    ['issue override', issueOverride],
    ['configured team field', field],
    ['board mapping', board],
    ['component mapping', components],
    ['project mapping', project],
  ].filter(([, value]) => value.team);
  const selected = choices[0] || null;
  const conflicts = selected
    ? choices.slice(1).filter(([, value]) => value.team.id !== selected[1].team.id).map(([source, value]) => ({ source, team: value.team.name }))
    : [];
  return {
    team: selected?.[1].team || null,
    teamId: selected?.[1].team.id || '',
    teamPath: selected ? parentPath(config, selected[1].team) : [],
    source: selected?.[0] || '',
    conflicts,
    fieldStatus: field.status,
    fieldValue: String(teamValue || '').trim(),
    issueOverrideStatus: issueOverride.status,
    componentStatus: components.status,
    projectStatus: project.status,
    boardStatus: board.status,
  };
}

function resolveBoardTeam(config, boardId, timestamp, teamRoute = '') {
  const result = resolveTeamAttribution({ fields: {} }, { boardId, teamRoute }, config, '', timestamp);
  return {
    team: result.source === 'board mapping' ? result.team : null,
    teamId: result.source === 'board mapping' ? result.teamId : '',
    teamPath: result.source === 'board mapping' ? result.teamPath : [],
    status: result.boardStatus,
  };
}

module.exports = { isActiveAt, resolveBoardTeam, resolveTeamAttribution };
