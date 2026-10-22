const { getConfig } = require('./database.cjs');
const { resolveSemanticFields, semanticHistoryField } = require('./semantic-mapping.cjs');

function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function parseIds(value) {
  const ids = new Set();
  const visit = (item) => {
    if (item === null || item === undefined || item === '') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    if (typeof item === 'object') { if (item.id !== undefined) ids.add(String(item.id)); visit(item.value || item.name || ''); return; }
    const text = String(item);
    for (const match of text.matchAll(/\bid=(\d+)/g)) ids.add(match[1]);
    if (!text.includes('id=') && /^\d+$/.test(text.trim())) ids.add(text.trim());
  };
  visit(value);
  return ids;
}

function optionLabel(value) {
  if (Array.isArray(value)) return value.map(optionLabel).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return String(value.value || value.name || value.displayName || value.key || '');
  return String(value || '');
}

function statusEvents(issue, config) {
  const histories = Array.isArray(issue?.changelog?.histories) ? issue.changelog.histories : [];
  return histories.flatMap((history, historyIndex) => (history.items || []).map((item, itemIndex) => ({
    timeMs: Date.parse(history.created || ''),
    index: historyIndex,
    id: itemIndex,
    field: semanticHistoryField(item, config, issue),
    from: item.fromString !== undefined && item.fromString !== '' ? item.fromString : item.from,
    to: item.toString !== undefined && item.toString !== '' ? item.toString : item.to,
  }))).filter((event) => Number.isFinite(event.timeMs)).sort((a, b) => a.timeMs - b.timeMs || a.index - b.index || a.id - b.id);
}

function valueAt(current, events, field, atMs, parse = (value) => value) {
  let value = parse(current);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.timeMs > atMs && event.field === field) value = parse(event.from);
  }
  return value;
}

function membershipIntervals(issue, config) {
  const semantic = resolveSemanticFields(issue, config);
  const events = statusEvents(issue, config).filter((event) => event.field === 'sprint');
  const current = parseIds(semantic.sprint);
  const intervals = new Map();
  const open = new Map();
  const initial = events.length ? parseIds(events[0].from) : current;
  initial.forEach((id) => open.set(id, Date.parse(issue.fields?.created || '') || -Infinity));
  events.forEach((event) => {
    const before = parseIds(event.from);
    const after = parseIds(event.to);
    after.forEach((id) => { if (!before.has(id) && !open.has(id)) open.set(id, event.timeMs); });
    before.forEach((id) => {
      if (after.has(id) || !open.has(id)) return;
      if (!intervals.has(id)) intervals.set(id, []);
      intervals.get(id).push([open.get(id), event.timeMs]);
      open.delete(id);
    });
  });
  open.forEach((start, id) => { if (!intervals.has(id)) intervals.set(id, []); intervals.get(id).push([start, Infinity]); });
  current.forEach((id) => { if (!intervals.has(id)) intervals.set(id, [[Date.parse(issue.fields?.created || '') || -Infinity, Infinity]]); });
  return intervals;
}

function sprintBoundary(raw, nowMs = Date.now()) {
  const startMs = Date.parse(raw?.activatedDate || raw?.startDate || '');
  if (!Number.isFinite(startMs)) return null;
  let endMs = Date.parse(raw?.completeDate || '');
  if (!Number.isFinite(endMs)) {
    if (String(raw?.state || '').toLowerCase() === 'active') {
      const plannedEnd = Date.parse(raw?.endDate || '');
      endMs = Number.isFinite(plannedEnd) ? Math.min(nowMs, plannedEnd) : nowMs;
    } else endMs = Date.parse(raw?.endDate || '');
  }
  if (!Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, startDate: raw.activatedDate || raw.startDate || '', endDate: raw.completeDate || raw.endDate || '' };
}

function routeMapFor(config) {
  return new Map((config.boardRoutes || []).map((route) => [String(route.boardId), config.teams.find((team) => team.id === route.teamId)?.name || route.team || '']));
}

function listBusinessSprints(db) {
  const config = getConfig(db);
  if (!config.modules.businessSprint) return [];
  const routes = routeMapFor(config);
  const now = Date.now();
  return db.prepare('SELECT sprint_id,board_id,team_route,state,start_date,end_date,activated_date,complete_date,raw_json FROM jira_sprints ORDER BY start_date DESC,sprint_id DESC')
    .all().map((row) => {
      const raw = safeJson(row.raw_json, {});
      const teamRoute = routes.get(String(row.board_id)) || row.team_route || '';
      const boundary = sprintBoundary({ ...raw, id: row.sprint_id, state: row.state || raw.state,
        startDate: row.start_date || raw.startDate, endDate: row.end_date || raw.endDate,
        activatedDate: row.activated_date || raw.activatedDate, completeDate: row.complete_date || raw.completeDate }, now);
      if (!boundary || !teamRoute) return null;
      return { id: String(row.sprint_id), name: String(raw.name || 'Sprint ' + row.sprint_id), boardId: String(row.board_id || ''),
        teamRoute, state: String(row.state || raw.state || ''), startDate: boundary.startDate, endDate: boundary.endDate,
        startAt: new Date(boundary.startMs).toISOString(), endAt: new Date(boundary.endMs).toISOString(),
        hasActualStart: Boolean(row.activated_date || raw.activatedDate), hasActualEnd: Boolean(row.complete_date || raw.completeDate) };
    }).filter(Boolean).sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt) || a.id.localeCompare(b.id));
}

function makeIssueState(issue, sprintId, boundary, config) {
  const fields = issue.fields || {};
  const semantic = resolveSemanticFields(issue, config);
  const events = statusEvents(issue, config);
  const intervals = membershipIntervals(issue, config).get(String(sprintId.id)) || [];
  const overlaps = intervals.filter(([start, end]) => end > boundary.startMs && start < boundary.endMs);
  if (!overlaps.length) return null;
  const insideAt = (at) => overlaps.some(([start, end]) => start <= at && end > at);
  const statusAt = (at) => String(valueAt(fields.status?.name || '', events, 'status', at, (value) => String(value || '')) || '');
  const pointsAt = (at) => numberOrNull(valueAt(semantic.storyPoints, events, 'storyPoints', at, numberOrNull));
  const entryStatuses = new Set((config.workflows.commitment.entryStatuses || []).map(normalize));
  const completedStatuses = new Set((config.workflows.commitment.completedStatuses || []).map(normalize));
  const milestones = config.workflows.commitment.milestones || [];
  const startStatus = statusAt(boundary.startMs);
  const endStatus = statusAt(boundary.endMs);
  const committed = insideAt(boundary.startMs) && entryStatuses.has(normalize(startStatus));
  const milestoneAt = Object.fromEntries(milestones.map((milestone) => [milestone.id, null]));
  const transitions = events.filter((event) => event.field === 'status' && event.timeMs >= boundary.startMs && event.timeMs <= boundary.endMs);
  const entries = transitions.filter((event) => !entryStatuses.has(normalize(event.from)) && entryStatuses.has(normalize(event.to)));
  const exits = transitions.filter((event) => entryStatuses.has(normalize(event.from)) && !entryStatuses.has(normalize(event.to)));
  transitions.forEach((event) => {
    const milestone = milestones.find((item) => item.statuses.some((status) => normalize(status) === normalize(event.to)));
    if (milestone && !milestoneAt[milestone.id]) milestoneAt[milestone.id] = { at: new Date(event.timeMs).toISOString(), status: String(event.to || ''), storyPoints: pointsAt(event.timeMs) };
  });
  const createdMs = Date.parse(fields.created || '');
  const addedDuring = !committed && (entries.length > 0 || (Number.isFinite(createdMs) && createdMs > boundary.startMs && createdMs <= boundary.endMs && entryStatuses.has(normalize(endStatus))));
  const teamValue = optionLabel(valueAt(semantic.team, events, 'team', committed ? boundary.startMs : entries[0]?.timeMs || boundary.startMs, optionLabel)).trim();
  const matchingTeams = (config.teams || []).filter((team) => [team.name, ...(team.aliases || [])].some((label) => normalize(label) === normalize(teamValue)));
  const routeTeam = routeMapFor(config).get(String(sprintId.boardId || '')) || sprintId.teamRoute || '';
  const team = matchingTeams.length === 1 ? matchingTeams[0].name : routeTeam;
  const teamSource = matchingTeams.length === 1 ? 'configured team field' : routeTeam ? 'board route' : 'unmapped';
  const issueLinks = (fields.issuelinks || []).flatMap((link) => [link?.inwardIssue?.key, link?.outwardIssue?.key].filter(Boolean).map((key) => String(key).toUpperCase()));
  const boundaryHistoryComplete = issue.changelog?.historyComplete === undefined
    ? Number.isFinite(Number(issue.changelog?.total)) && Number(issue.changelog.total) <= (issue.changelog?.histories?.length || 0) + Number(issue.changelog?.startAt || 0)
    : Boolean(issue.changelog.historyComplete);
  const statusCompletion = transitions.find((event) => completedStatuses.has(normalize(event.to)));
  const completedInSprint = Boolean(statusCompletion || milestones.some((milestone) => milestoneAt[milestone.id]));
  return {
    key: String(issue.key || '').toUpperCase(), summary: String(fields.summary || ''), project: String(fields.project?.key || ''),
    team, teamSource, startStatus, endStatus, startPoints: pointsAt(boundary.startMs), endPoints: pointsAt(boundary.endMs),
    pointsDelta: pointsAt(boundary.startMs) !== null && pointsAt(boundary.endMs) !== null ? pointsAt(boundary.endMs) - pointsAt(boundary.startMs) : null,
    committed, addedDuring, addedPoints: addedDuring ? pointsAt(entries[0]?.timeMs || boundary.endMs) : null,
    inScopeAtEnd: insideAt(boundary.endMs) && entryStatuses.has(normalize(endStatus)),
    exitStatus: exits[0] ? String(exits[0].to || '') : '', completedInSprint,
    completedPoints: statusCompletion ? pointsAt(statusCompletion.timeMs) : completedInSprint ? pointsAt(boundary.endMs) : null,
    milestoneAt, milestonePoints: Object.fromEntries(Object.entries(milestoneAt).map(([key, value]) => [key, value?.storyPoints ?? null])),
    transitions: transitions.map((event) => ({ fromStatus: String(event.from || ''), toStatus: String(event.to || ''), at: new Date(event.timeMs).toISOString() })),
    linkedIssueKeys: Array.from(new Set(issueLinks)), historyComplete: boundaryHistoryComplete,
    startVerified: boundaryHistoryComplete || (Number.isFinite(Date.parse(fields.updated || '')) && Date.parse(fields.updated) <= boundary.startMs),
    endVerified: boundaryHistoryComplete || (Number.isFinite(Date.parse(fields.updated || '')) && Date.parse(fields.updated) <= boundary.endMs),
  };
}

function emptyTeamStats(team, milestones) {
  return { team, committedCount: 0, committedSP: 0, committedMissingSPCount: 0, addedCount: 0, addedSP: 0,
    addedMissingSPCount: 0, inScopeAtEndCount: 0, completedCount: 0, completedSP: 0, exitCount: 0,
    pointIncreaseSP: 0, pointDecreaseSP: 0, milestones: Object.fromEntries(milestones.map((item) => [item.id, { label: item.label, count: 0, storyPoints: 0, missingStoryPoints: 0 }])) };
}

function getBusinessSprintReport(db, filters = {}) {
  const config = getConfig(db);
  if (!config.modules.businessSprint) throw new Error('Enable and configure the commitment-sprint module before requesting this report.');
  const sprintId = String(filters.sprintId || '').trim();
  if (!/^\d+$/.test(sprintId)) throw new Error('Invalid sprint ID.');
  const row = db.prepare('SELECT sprint_id,board_id,team_route,state,start_date,end_date,activated_date,complete_date,raw_json FROM jira_sprints WHERE sprint_id=?').get(sprintId);
  if (!row) throw new Error('The selected sprint is not in the active workspace.');
  const rawSprint = safeJson(row.raw_json, {});
  const boundary = sprintBoundary({ ...rawSprint, state: row.state || rawSprint.state,
    startDate: row.start_date || rawSprint.startDate, endDate: row.end_date || rawSprint.endDate,
    activatedDate: row.activated_date || rawSprint.activatedDate, completeDate: row.complete_date || rawSprint.completeDate });
  if (!boundary) throw new Error('This sprint has no valid start and end boundary.');
  const routeTeam = routeMapFor(config).get(String(row.board_id)) || row.team_route || '';
  const sprint = { id: sprintId, boardId: String(row.board_id || ''), name: String(rawSprint.name || 'Sprint ' + sprintId), teamRoute: routeTeam,
    state: String(row.state || rawSprint.state || ''), startAt: new Date(boundary.startMs).toISOString(), endAt: new Date(boundary.endMs).toISOString(),
    hasActualStart: Boolean(row.activated_date || rawSprint.activatedDate), hasActualEnd: Boolean(row.complete_date || rawSprint.completeDate) };
  const projects = config.projectRoles.commitments || [];
  const rows = db.prepare('SELECT raw_json FROM jira_issues WHERE project_key IN (' + projects.map(() => '?').join(',') + ') ORDER BY issue_key').all(...projects);
  const states = rows.map((item) => safeJson(item.raw_json, null)).filter(Boolean)
    .map((issue) => makeIssueState(issue, sprint, boundary, config)).filter(Boolean);
  const teamNames = Array.from(new Set([routeTeam, ...states.map((item) => item.team), ...(config.teams || []).map((team) => team.name)].filter(Boolean))).sort();
  const teams = teamNames.map((team) => emptyTeamStats(team, config.workflows.commitment.milestones || []));
  const byTeam = new Map(teams.map((team) => [team.team, team]));
  const items = [];
  const unmapped = [];
  states.forEach((state) => {
    if (!state.committed && !state.addedDuring) return;
    if (!state.team || !byTeam.has(state.team)) { unmapped.push(state); return; }
    items.push(state);
    const team = byTeam.get(state.team);
    if (state.committed) { team.committedCount += 1; if (state.startPoints === null) team.committedMissingSPCount += 1; else team.committedSP += state.startPoints; }
    if (state.addedDuring) { team.addedCount += 1; if (state.addedPoints === null) team.addedMissingSPCount += 1; else team.addedSP += state.addedPoints; }
    if (state.inScopeAtEnd) team.inScopeAtEndCount += 1;
    if (state.completedInSprint) { team.completedCount += 1; if (state.completedPoints !== null) team.completedSP += state.completedPoints; }
    if (state.exitStatus) team.exitCount += 1;
    if (state.committed && state.pointsDelta !== null) {
      if (state.pointsDelta > 0) team.pointIncreaseSP += state.pointsDelta;
      if (state.pointsDelta < 0) team.pointDecreaseSP += Math.abs(state.pointsDelta);
    }
    Object.entries(state.milestoneAt).forEach(([id, value]) => {
      if (!value) return;
      const target = team.milestones[id];
      target.count += 1;
      if (value.storyPoints === null) target.missingStoryPoints += 1;
      else target.storyPoints += value.storyPoints;
    });
  });
  items.sort((a, b) => a.team.localeCompare(b.team) || a.key.localeCompare(b.key));
  return { sprint, targetTeams: teamNames, teams, items, unmapped: {
    count: unmapped.length, committedCount: unmapped.filter((item) => item.committed).length,
    addedCount: unmapped.filter((item) => item.addedDuring).length, missingSPCount: unmapped.filter((item) => item.committed ? item.startPoints === null : item.addedPoints === null).length,
    items: unmapped,
  }, otherTeamCount: 0, coverage: {
    historyCompleteCount: states.filter((item) => item.historyComplete).length,
    historyIncompleteCount: states.filter((item) => !item.historyComplete).length,
    startUnverifiedCount: states.filter((item) => !item.startVerified && (item.committed || item.addedDuring)).length,
    endUnverifiedCount: states.filter((item) => !item.endVerified && (item.committed || item.addedDuring)).length,
  } };
}

module.exports = { listBusinessSprints, getBusinessSprintReport };
