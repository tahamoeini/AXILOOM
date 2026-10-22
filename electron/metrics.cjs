const {
  resolveSemanticBinding, resolveSemanticFields, semanticHistoryField, transformValue, configuredCompletedStatuses, isIssueDone,
  resolutionCompletesForProject, statusCategoryCompletesForProject, hasLifecycleStatusMappings,
  lifecycleStatusesForProject, lifecycleRolesForStatus, workflowScopesForProject,
} = require('./semantic-mapping.cjs');
const { isActiveAt, resolveBoardTeam, resolveTeamAttribution } = require('./team-attribution.cjs');

const KNOWN_FIELDS = new Set([
  'assignee', 'components', 'created', 'issuelinks', 'priority', 'issuetype',
  'labels', 'project', 'resolutiondate', 'status', 'summary', 'timeestimate', 'timeoriginalestimate',
  'timespent', 'updated', 'description', 'reporter', 'parent', 'subtasks',
]);

const FIELD_ALIASES = new Map([
  ['sprint', 'sprint'], ['status', 'status'],
  ['story points', 'storyPoints'], ['storypoints', 'storyPoints'],
  ['issue tags', 'issueTags'], ['team', 'team'], ['work classification', 'workClassification'],
  ['timespent', 'timespent'], ['time spent', 'timespent'],
  ['timeoriginalestimate', 'timeoriginalestimate'], ['original estimate', 'timeoriginalestimate'],
  ['timeestimate', 'timeestimate'], ['remaining estimate', 'timeestimate'],
]);

function parseIds(value, fallback) {
  const ids = new Set();
  const parseOne = (item) => {
    if (item === null || item === undefined || item === '') return;
    if (typeof item === 'number') { ids.add(String(item)); return; }
    if (typeof item === 'object') {
      if (item.id !== undefined) ids.add(String(item.id));
      parseOne(item.value || item.name || '');
      return;
    }
    const text = String(item);
    for (const match of text.matchAll(/\bid=(\d+)/g)) ids.add(match[1]);
    if (!text.includes('id=')) {
      for (const token of text.split(/\s*,\s*/)) if (/^\d+$/.test(token.trim())) ids.add(token.trim());
    }
  };
  (Array.isArray(value) ? value : [value]).forEach(parseOne);
  if (!ids.size && fallback) parseOne(fallback);
  return ids;
}

function parseSprintName(value) {
  const match = String(value ?? '').match(/\bname=([^,\]]+)/);
  return match ? match[1].trim() : '';
}

function fieldName(name) {
  const raw = String(name || '').trim();
  return FIELD_ALIASES.get(raw.toLowerCase()) || raw;
}

function issueEvents(issue, config) {
  const histories = issue?.changelog?.histories || [];
  const events = [];
  histories.forEach((history) => {
    const timeMs = Date.parse(history.created || '');
    if (!Number.isFinite(timeMs)) return;
    (history.items || []).forEach((item, index) => events.push({
      id: `${history.id || history.created}-${index}`,
      historyId: String(history.id || ''),
      timeMs,
      field: semanticHistoryField(item, config, issue) || fieldName(item.field),
      from: item.from ?? null,
      fromString: item.fromString ?? '',
      to: item.to ?? null,
      toString: item.toString ?? '',
      author: history.author?.displayName || history.author?.name || '',
    }));
  });
  return events.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
}

function eventsFor(issue, field) {
  return issue.events.filter((event) => event.field === field);
}

function valueAt(issue, field, currentValue, atMs, parse = (value) => value) {
  let value = parse(currentValue);
  const events = eventsFor(issue, field);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].timeMs > atMs) value = parse(events[index].fromString !== '' ? events[index].fromString : events[index].from);
  }
  return value;
}

function statusName(fields) {
  return fields?.status?.name || '';
}

function getAssigneeKey(assignee) {
  return assignee?.accountId || assignee?.key || assignee?.name || '';
}

function currentTags(value) {
  if (Array.isArray(value)) return value.map((tag) => typeof tag === 'string' ? tag : tag?.value).filter(Boolean);
  if (value && typeof value === 'object') return [value.value].filter(Boolean);
  return [];
}

function configuredTeamPath(config, teamId) {
  const path = [];
  const visited = new Set();
  let team = (config.teams || []).find((candidate) => candidate.id === teamId);
  while (team && !visited.has(team.id)) {
    visited.add(team.id);
    path.unshift(team.name);
    team = (config.teams || []).find((candidate) => candidate.id === team.parentTeamId);
  }
  return path;
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? item?.value : item).filter(Boolean);
  if (value && typeof value === 'object') return [value.value].filter(Boolean);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((item) => typeof item === 'object' ? item?.value : item).filter(Boolean);
  } catch { /* Jira changelog option values are often plain display strings. */ }
  return trimmed.split(/\s*,\s*/).filter(Boolean);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSprintMemberships(issue) {
  const sprintEvents = eventsFor(issue, 'sprint');
  const intervals = new Map();
  const open = new Map();
  const currentSet = sprintEvents.length
    ? parseIds(sprintEvents[0].from, sprintEvents[0].fromString)
    : new Set(issue.currentSprintIds);
  currentSet.forEach((id) => open.set(id, issue.createdMs ?? -Infinity));
  sprintEvents.forEach((event) => {
    const before = parseIds(event.from, event.fromString);
    const after = parseIds(event.to, event.toString);
    after.forEach((id) => { if (!before.has(id) && !open.has(id)) open.set(id, event.timeMs); });
    before.forEach((id) => {
      if (after.has(id) || !open.has(id)) return;
      if (!intervals.has(id)) intervals.set(id, []);
      intervals.get(id).push([open.get(id), event.timeMs]);
      open.delete(id);
    });
  });
  open.forEach((start, id) => {
    if (!intervals.has(id)) intervals.set(id, []);
    intervals.get(id).push([start, Infinity]);
  });
  issue.currentSprintIds.forEach((id) => {
    if (!intervals.has(String(id))) intervals.set(String(id), [[issue.createdMs ?? -Infinity, Infinity]]);
  });
  return intervals;
}

function isDone(status, doneStatuses) {
  const current = String(status || '').trim().toLocaleLowerCase('en-US');
  const statuses = doneStatuses instanceof Set ? doneStatuses : new Set(Array.isArray(doneStatuses) ? doneStatuses : []);
  return [...statuses].some((value) => String(value).trim().toLocaleLowerCase('en-US') === current);
}

function exactTagAt(issue, atMs, expected) {
  const tags = valueAt(issue, 'issueTags', currentTags(issue.semantic.issueTags), atMs, parseTags);
  return tags.some((tag) => String(tag).trim() === expected);
}

function extractActualSprint(sprint, nowMs) {
  const startMs = Date.parse(sprint.activatedDate || sprint.startDate || '');
  if (!Number.isFinite(startMs)) return null;
  let endMs = Date.parse(sprint.completeDate || '');
  const state = String(sprint.state || '').toLowerCase();
  if (!Number.isFinite(endMs)) {
    if (state === 'active') {
      const plannedEnd = Date.parse(sprint.endDate || '');
      endMs = Number.isFinite(plannedEnd) ? Math.min(nowMs, plannedEnd) : nowMs;
    } else {
      endMs = Date.parse(sprint.endDate || '');
    }
  }
  if (!Number.isFinite(endMs) || endMs <= startMs) return null;
  return { startMs, endMs, hasActualStart: Boolean(sprint.activatedDate), hasActualEnd: Boolean(sprint.completeDate) };
}

function localDateParts(timestamp, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function workingDays(start, end, calendar) {
  if (!calendar?.configured) return null;
  const first = localDateParts(start, calendar.timeZone);
  const last = localDateParts(end, calendar.timeZone);
  let cursor = Date.UTC(first.year, first.month - 1, first.day);
  const endBoundary = Date.UTC(last.year, last.month - 1, last.day);
  if (endBoundary < cursor) return null;
  let count = 0;
  const weekdays = new Set(calendar.workingDays || []);
  const holidays = new Set(calendar.holidays || []);
  while (cursor < endBoundary) {
    const weekday = new Date(cursor).getUTCDay();
    const date = new Date(cursor).toISOString().slice(0, 10);
    if (weekdays.has(weekday) && !holidays.has(date)) count += 1;
    cursor += 86400000;
  }
  return count;
}

function inclusiveCalendarDays(start, end, timeZone = 'UTC') {
  const first = localDateParts(start, timeZone);
  const last = localDateParts(end, timeZone);
  const startDay = Date.UTC(first.year, first.month - 1, first.day);
  const endDay = Date.UTC(last.year, last.month - 1, last.day);
  return Math.max(1, Math.floor((endDay - startDay) / 86400000) + 1);
}

function safeDiv(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values) {
  const numbers = values.filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
}

function populationStandardDeviation(values) {
  const numbers = values.filter(Number.isFinite);
  if (!numbers.length) return null;
  const mean = average(numbers);
  return Math.sqrt(average(numbers.map((value) => (value - mean) ** 2)));
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function sumKnown(rows, getter) {
  const values = rows.map(getter).filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function sumZero(rows, getter) {
  return rows.reduce((sum, row) => sum + (Number(getter(row)) || 0), 0);
}

function makeRelation(issue, sprint, interval, config) {
  const overlapping = interval.filter(([start, end]) => end > sprint.window.startMs && start < sprint.window.endMs);
  if (!overlapping.length) return null;
  const firstEntryMs = Math.min(...overlapping.map(([start]) => Math.max(start, issue.createdMs ?? start)));
  const lastExitMs = Math.max(...overlapping.map(([, end]) => end));
  const atStart = overlapping.some(([start, end]) => start <= sprint.window.startMs && end > sprint.window.startMs);
  const atEnd = overlapping.some(([start, end]) => start < sprint.window.endMs && end >= sprint.window.endMs);
  const entryMs = atStart ? sprint.window.startMs : firstEntryMs;
  const statusStart = valueAt(issue, 'status', statusName(issue.fields), sprint.window.startMs, (value) => {
    if (value && typeof value === 'object') return value.name || '';
    return String(value || '');
  });
  const statusEnd = valueAt(issue, 'status', statusName(issue.fields), sprint.window.endMs, (value) => {
    if (value && typeof value === 'object') return value.name || '';
    return String(value || '');
  });
  const statusEndCategory = statusEnd === statusName(issue.fields) ? issue.fields.status?.statusCategory?.key || '' : '';
  const workflowScope = 'delivery';
  const resolutionAtEnd = resolutionCompletesForProject(config, issue.project, workflowScope)
    && Number.isFinite(Date.parse(issue.fields.resolutiondate || ''))
    && Date.parse(issue.fields.resolutiondate) <= sprint.window.endMs;
  const lifecycleRolesAtEnd = lifecycleRolesForStatus(config, issue.project, statusEnd, statusEndCategory, resolutionAtEnd, workflowScope);
  const doneStatuses = configuredCompletedStatuses(config, issue.project, workflowScope);
  const insideSprintMembership = (at) => overlapping.some(([start, end]) => start <= at && end > at);
  const doneEvents = eventsFor(issue, 'status').filter((event) => event.timeMs >= firstEntryMs && event.timeMs <= sprint.window.endMs
    && insideSprintMembership(event.timeMs) && isDone(event.toString, doneStatuses));
  let completionMs = doneEvents.length ? doneEvents[0].timeMs : null;
  const resolutionMs = resolutionCompletesForProject(config, issue.project, workflowScope) ? Date.parse(issue.fields.resolutiondate || '') : NaN;
  if (completionMs === null && Number.isFinite(resolutionMs) && resolutionMs >= firstEntryMs && resolutionMs <= sprint.window.endMs
    && insideSprintMembership(resolutionMs)) completionMs = resolutionMs;
  const currentStatusCompletesWithoutDate = atEnd && statusEnd === statusName(issue.fields)
    && statusCategoryCompletesForProject(config, issue.project, issue.fields.status?.statusCategory?.key || '', workflowScope);
  const completed = currentStatusCompletesWithoutDate || (completionMs !== null
    && (isDone(statusEnd, doneStatuses) || (Number.isFinite(resolutionMs) && resolutionMs >= firstEntryMs
      && resolutionMs <= sprint.window.endMs && insideSprintMembership(resolutionMs))));
  const startedStatuses = lifecycleStatusesForProject(config, issue.project, 'started', workflowScope);
  const inProgressEvents = eventsFor(issue, 'status').filter((event) => startedStatuses.has(String(event.toString).toLocaleLowerCase('en-US'))
    && completionMs !== null && event.timeMs >= firstEntryMs && event.timeMs <= completionMs && insideSprintMembership(event.timeMs));
  const reopenedCount = eventsFor(issue, 'status').filter((event) => event.timeMs >= sprint.window.startMs && event.timeMs <= sprint.window.endMs
    && insideSprintMembership(event.timeMs) && isDone(event.fromString, doneStatuses) && !isDone(event.toString, doneStatuses)).length;
  const tagAtEntry = exactTagAt(issue, entryMs, config.adhocTag);
  const tagAtEnd = exactTagAt(issue, Math.min(lastExitMs, sprint.window.endMs), config.adhocTag);
  const tagDuringSprint = tagAtEntry || tagAtEnd || eventsFor(issue, 'issueTags').some((event) => event.timeMs >= entryMs && event.timeMs <= Math.min(lastExitMs, sprint.window.endMs) && exactTagAt(issue, event.timeMs, config.adhocTag));
  const addedAfterStart = !atStart;
  const workType = tagDuringSprint || addedAfterStart ? 'Ad hoc' : 'Planned';
  const teamValue = valueAt(issue, 'team', issue.semantic.team, sprint.window.endMs, (value) => value && typeof value === 'object' ? value.value || value.name || '' : String(value || ''));
  const attribution = resolveTeamAttribution(issue, sprint, config, teamValue, sprint.window.endMs);
  const assignedTeam = attribution.team?.name || '';
  const teamFieldConflict = attribution.source === 'configured team field'
    && attribution.conflicts.some((conflict) => conflict.source === 'board mapping');
  const teamFieldAmbiguous = attribution.fieldValue && attribution.fieldStatus === 'ambiguous';
  const teamFieldUnmapped = attribution.fieldValue && attribution.fieldStatus === 'unmapped';
  const teamFieldInactive = attribution.fieldValue && attribution.fieldStatus === 'inactive';
  const classificationValue = valueAt(issue, 'workClassification', issue.semantic.workClassification, sprint.window.endMs, (value) => value && typeof value === 'object' ? value.value || value.name || '' : String(value || ''));
  const configuredClassification = (config.workClassifications || []).find((classification) => [classification.label, ...(classification.aliases || [])].some((label) => String(label).trim().toLocaleLowerCase('en-US') === String(classificationValue || '').trim().toLocaleLowerCase('en-US')));
  const workClassification = configuredClassification?.id || 'unclassified';
  const latestAssignee = issue.fields.assignee || null;
  const sp = numberOrNull(issue.semantic.storyPoints);
  const estimate = numberOrNull(issue.fields.timeoriginalestimate);
  const remaining = numberOrNull(issue.fields.timeestimate);
  const timeSpent = numberOrNull(issue.fields.timespent);
  const firstInProgress = inProgressEvents[0];
  const completedAt = completed ? completionMs : null;
  const changelog = issue.raw?.changelog || {};
  const currentHistoryCount = changelog.histories?.length || 0;
  const historyTotal = Number(changelog.total || 0);
  const hasHistoryTotal = changelog.total !== null && changelog.total !== undefined && Number.isFinite(Number(changelog.total));
  const historyComplete = changelog.historyComplete === undefined
    ? Boolean(hasHistoryTotal) && historyTotal <= currentHistoryCount + Number(changelog.startAt || 0)
    : Boolean(changelog.historyComplete);
  return {
    id: `${issue.key}|${sprint.id}`,
    issue,
    sprint,
    membershipIntervals: interval,
    team: assignedTeam,
    teamId: attribution.teamId,
    teamPath: attribution.teamPath,
    teamAttributionSource: attribution.source,
    teamAttributionConflicts: attribution.conflicts,
    teamFieldConflict,
    teamFieldAmbiguous,
    teamFieldUnmapped,
    teamFieldInactive,
    teamOverrideInactive: attribution.issueOverrideStatus === 'inactive',
    boardTeamInactive: attribution.boardStatus === 'inactive',
    boardTeamAmbiguous: attribution.boardStatus === 'ambiguous',
    componentTeamAmbiguous: attribution.componentStatus === 'ambiguous',
    componentTeamInactive: attribution.componentStatus === 'inactive',
    projectTeamAmbiguous: attribution.projectStatus === 'ambiguous',
    projectTeamInactive: attribution.projectStatus === 'inactive',
    assignee: latestAssignee,
    atStart,
    atEnd,
    added: !atStart,
    removed: !atEnd,
    workType,
    workTypeReason: tagAtEntry && addedAfterStart ? 'Exact Ad hoc tag at entry + entered after sprint start'
      : tagDuringSprint && addedAfterStart ? 'Exact Ad hoc tag during membership + entered after sprint start'
        : tagAtEntry ? 'Exact Ad hoc tag at entry'
          : tagDuringSprint ? 'Exact Ad hoc tag applied during sprint'
            : addedAfterStart ? 'Entered after actual sprint start' : 'Committed without exact Ad hoc tag',
    tagAtEntry,
    tagDuringSprint,
    issueClass: (config.issueTypeClassifications || []).find((entry) => entry.issueTypeId === String(issue.fields.issuetype?.id || ''))?.classification || 'unclassified',
    workClassification,
    statusStart,
    statusEnd,
    lifecycleRolesAtEnd,
    completed,
    completionMs: completedAt,
    incoming: false,
    carryoverCompleted: false,
    outgoing: false,
    completionAssignedElsewhere: false,
    carryoverStreak: 0,
    storyPointsAtEntry: valueAt(issue, 'storyPoints', sp, entryMs, numberOrNull),
    storyPointsAtEnd: valueAt(issue, 'storyPoints', sp, sprint.window.endMs, numberOrNull),
    estimateSecondsAtEntry: valueAt(issue, 'timeoriginalestimate', estimate, entryMs, numberOrNull),
    remainingSecondsAtEnd: valueAt(issue, 'timeestimate', remaining, sprint.window.endMs, numberOrNull),
    timeSpentSecondsAtEnd: valueAt(issue, 'timespent', timeSpent, sprint.window.endMs, numberOrNull),
    loggedSeconds: 0,
    cycleTimeDays: firstInProgress && completedAt !== null ? Math.max(0, (completedAt - firstInProgress.timeMs) / 86400000) : null,
    leadTimeDays: issue.createdMs !== null && completedAt !== null ? Math.max(0, (completedAt - issue.createdMs) / 86400000) : null,
    reopenedCount,
    hasReliableTimeData: timeSpent !== null || eventsFor(issue, 'timespent').length > 0,
    historyComplete,
    tagAtEnd,
  };
}

function scoreBundle(rows, sprint, config = {}) {
  const completed = rows.filter((row) => row.completed);
  const planned = rows.filter((row) => row.workType === 'Planned');
  const committed = rows.filter((row) => row.atStart);
  const adhoc = rows.filter((row) => row.workType === 'Ad hoc');
  const classifiedRows = rows.filter((row) => row.issueClass !== 'unclassified');
  const completedPlanned = completed.filter((row) => row.workType === 'Planned');
  const completedAdhoc = completed.filter((row) => row.workType === 'Ad hoc');
  const completedClassified = completed.filter((row) => row.issueClass !== 'unclassified');
  const incoming = rows.filter((row) => row.incoming);
  const carryCompleted = rows.filter((row) => row.carryoverCompleted);
  const outgoing = rows.filter((row) => row.outgoing);
  const added = rows.filter((row) => row.added);
  const removed = rows.filter((row) => row.removed);
  const points = (subset, atEnd = false) => sumZero(subset, (row) => atEnd ? row.storyPointsAtEnd : row.storyPointsAtEntry);
  const estimateHours = (subset) => sumZero(subset, (row) => (row.estimateSecondsAtEntry || 0) / 3600);
  const loggedHours = (subset) => sumZero(subset, (row) => row.loggedSeconds / 3600);
  const plannedSP = points(planned);
  const adhocSP = points(adhoc);
  const scopeSP = points(rows);
  const committedSP = points(committed);
  const completedSP = points(completed, true);
  const completedPlannedSP = points(completedPlanned, true);
  const completedAdhocSP = points(completedAdhoc, true);
  const addedSP = points(added);
  const removedSP = points(removed);
  const incomingSP = points(incoming);
  const outgoingSP = points(outgoing, true);
  const carryoverCompletedSP = points(carryCompleted, true);
  const completedEstimates = estimateHours(completed);
  const completedLogged = loggedHours(completed);
  const paired = completed.filter((row) => row.estimateSecondsAtEntry !== null && row.hasReliableTimeData);
  const pairedEstimate = estimateHours(paired);
  const pairedActual = loggedHours(paired);
  const accuracyDenominator = completedEstimates === null || completedLogged === null ? 0 : Math.max(completedEstimates, completedLogged);
  const estimateAccuracy = accuracyDenominator > 0 && completedEstimates > 0 && completedLogged > 0
    ? Math.min(completedEstimates, completedLogged) / accuracyDenominator : null;
  const plannedPaired = completedPlanned.filter((row) => row.estimateSecondsAtEntry !== null && row.hasReliableTimeData);
  const adhocPaired = completedAdhoc.filter((row) => row.estimateSecondsAtEntry !== null && row.hasReliableTimeData);
  const plannedBiasEstimateHours = estimateHours(plannedPaired);
  const plannedBiasLoggedHours = loggedHours(plannedPaired);
  const adhocBiasEstimateHours = estimateHours(adhocPaired);
  const adhocBiasLoggedHours = loggedHours(adhocPaired);
  const cycleTimes = completed.map((row) => row.cycleTimeDays).filter(Number.isFinite);
  const leadTimes = completed.map((row) => row.leadTimeDays).filter(Number.isFinite);
  const reopened = completed.filter((row) => row.reopenedCount > 0);
  const unfinishedAges = rows.filter((row) => !row.completed && Number.isFinite(row.issue.createdMs))
    .map((row) => (row.sprint.window.endMs - row.issue.createdMs) / 86400000)
    .filter((age) => Number.isFinite(age) && age >= 0);
  const workClassifications = Array.isArray(config.workClassifications) ? config.workClassifications : [];
  const classificationHours = Object.fromEntries(workClassifications.map((classification) => [classification.id, 0]));
  let unclassifiedHours = 0;
  rows.forEach((row) => {
    const hours = row.loggedSeconds / 3600;
    if (Object.hasOwn(classificationHours, row.workClassification)) classificationHours[row.workClassification] += hours;
    else unclassifiedHours += hours;
  });
  const allLogged = loggedHours(rows);
  const plannedLogged = loggedHours(planned);
  const adhocLogged = loggedHours(adhoc);
  const capacityHours = sprint.capacityHours ?? null;
  const timeCoverage = rows.filter((row) => row.hasReliableTimeData).length;
  const timeDataCoverage = safeDiv(timeCoverage, rows.length);
  const spCoverage = rows.filter((row) => row.storyPointsAtEntry !== null).length;
  const estimateCoverage = rows.filter((row) => row.estimateSecondsAtEntry !== null).length;
  const issueClassMetrics = Object.fromEntries(Array.from(new Set(rows.map((row) => row.issueClass))).map((classId) => [classId, {
    issues: rows.filter((row) => row.issueClass === classId).length,
    storyPoints: points(rows.filter((row) => row.issueClass === classId)),
    loggedHours: loggedHours(rows.filter((row) => row.issueClass === classId)),
    completedIssues: completed.filter((row) => row.issueClass === classId).length,
  }]));
  const scopeStability = scopeSP > 0 ? 1 - Math.min(1, (addedSP + removedSP) / scopeSP) : null;
  const plannedDeliveryRate = safeDiv(completedPlannedSP, plannedSP);
  const scopeCompletionRate = safeDiv(completedSP, scopeSP);
  const carryoverRate = safeDiv(outgoingSP, scopeSP);
  const reopenedIssueRate = safeDiv(reopened.length, completed.length);
  const bounded = (value) => value === null ? null : Math.max(0, Math.min(1, value));
  const requiredHealth = [plannedDeliveryRate, scopeCompletionRate, carryoverRate, scopeStability, reopenedIssueRate].every((value) => value !== null);
  const utilization = safeDiv(allLogged, capacityHours);
  const classificationResults = workClassifications.map((classification) => {
    const hours = classificationHours[classification.id] || 0;
    const shareOfLoggedTime = safeDiv(hours, allLogged);
    const shareOfCapacity = safeDiv(hours, capacityHours);
    const minimumShare = classification.minimumShare == null ? null : Number(classification.minimumShare);
    const maximumShare = classification.maximumShare == null ? null : Number(classification.maximumShare);
    return {
      id: classification.id, label: classification.label, hours, shareOfLoggedTime, shareOfCapacity,
      minimumShare, maximumShare,
      belowMinimum: minimumShare !== null && shareOfCapacity !== null ? Math.max(0, minimumShare - shareOfCapacity) : null,
      aboveMaximum: maximumShare !== null && shareOfCapacity !== null ? Math.max(0, shareOfCapacity - maximumShare) : null,
    };
  });
  const targetDeviations = classificationResults.flatMap((item) => [item.belowMinimum, item.aboveMaximum]).filter((value) => value !== null && value > 0.000001).length;
  const hasClassificationTargets = classificationResults.some((item) => item.minimumShare !== null || item.maximumShare !== null);
  const allocationStatus = timeDataCoverage === null || timeDataCoverage < Number(config.minimumTimeDataCoverage ?? 0.7)
    ? 'Insufficient Time Data'
    : !classificationResults.length ? 'Classification Not Configured'
      : !hasClassificationTargets ? 'No Classification Targets'
        : targetDeviations > 1 ? 'Multiple Deviations' : targetDeviations === 1 ? 'Single Deviation' : 'Within Target';
  const capacityWarning = Number(config.capacityWarning ?? 0.9);
  const capacityCritical = Number(config.capacityCritical ?? 1);
  const capacityStatus = capacityHours === null || capacityHours <= 0 ? 'Unavailable'
    : utilization >= capacityCritical ? 'Over Capacity' : utilization >= capacityWarning ? 'Near Capacity' : 'Within Threshold';
  const scopeChurnRate = committedSP > 0 ? (addedSP + removedSP) / committedSP : null;
  const estimateBias = pairedEstimate > 0 ? (pairedActual - pairedEstimate) / pairedEstimate : null;
  const plannedEstimateBias = plannedBiasEstimateHours > 0 ? (plannedBiasLoggedHours - plannedBiasEstimateHours) / plannedBiasEstimateHours : null;
  const adhocEstimateBias = adhocBiasEstimateHours > 0 ? (adhocBiasLoggedHours - adhocBiasEstimateHours) / adhocBiasEstimateHours : null;
  const negativeTimeAdjustments = sumZero(rows, (row) => row.negativeTimeAdjustmentCount || 0);
  const completedWithoutSP = completed.filter((row) => row.storyPointsAtEnd === null).length;
  const completedWithoutEstimate = completed.filter((row) => row.estimateSecondsAtEntry === null).length;
  const completedWithoutTime = completed.filter((row) => !row.hasReliableTimeData).length;
  const completedLoggedHours = completedLogged;
  const completedEstimateHours = completedEstimates;
  const hoursPerScopeSP = safeDiv(allLogged, scopeSP);
  const averageHoursPerCompletedSP = safeDiv(completedLogged, completedSP);
  const developmentProtectionRateRaw = null;

  return {
    scopeIssues: rows.length, scopeSP, plannedIssues: planned.length, plannedSP, adhocIssues: adhoc.length, adhocSP,
    committedIssues: committed.length, committedSP, scopeAddedIssues: added.length, scopeAddedSP: addedSP,
    scopeRemovedIssues: removed.length, scopeRemovedSP: removedSP, completedIssues: completed.length, completedSP,
    completedPlannedIssues: completedPlanned.length, completedPlannedSP, completedAdhocIssues: completedAdhoc.length, completedAdhocSP,
    completionRateIssues: safeDiv(completed.length, rows.length), completionRateSP: bounded(scopeCompletionRate),
    plannedCompletionRateIssues: safeDiv(completedPlanned.length, planned.length), plannedCompletionRateSP: bounded(plannedDeliveryRate),
    adHocShareIssues: safeDiv(adhoc.length, rows.length), adHocShareSP: safeDiv(adhocSP, scopeSP),
    adHocScopeShareIssues: safeDiv(adhoc.length, rows.length), adHocScopeShareSP: safeDiv(adhocSP, scopeSP),
    incomingCarryoverIssues: incoming.length, incomingCarryoverSP: incomingSP,
    carryoverCompletedIssues: carryCompleted.length, carryoverCompletedSP,
    outgoingCarryoverIssues: outgoing.length, outgoingCarryoverSP: outgoingSP,
    carryoverRateIssues: safeDiv(outgoing.length, rows.length), carryoverRateSP: bounded(carryoverRate), carryoverRecoveryRateSP: safeDiv(carryoverCompletedSP, incomingSP),
    carryoverRecoveryRateIssues: safeDiv(carryCompleted.length, incoming.length),
    averageCarryoverStreak: average(outgoing.map((row) => row.carryoverStreak)),
    maximumCarryoverStreak: outgoing.length ? Math.max(...outgoing.map((row) => row.carryoverStreak)) : null,
    carryoverOverOneSprintIssues: outgoing.filter((row) => row.carryoverStreak > 1).length,
    carryoverThreePlusSprintIssues: outgoing.filter((row) => row.carryoverStreak >= 3).length,
    averageUnfinishedAgeDays: average(unfinishedAges), maximumUnfinishedAgeDays: unfinishedAges.length ? Math.max(...unfinishedAges) : null,
    oldestOpenCarryoverAgeDays: unfinishedAges.length ? Math.max(...unfinishedAges) : null,
    scopeChurnRate, scopeStability: bounded(scopeStability), loggedHours: allLogged, scopeLoggedHours: allLogged,
    negativeTimeAdjustmentCount: negativeTimeAdjustments, negativeTimeAdjustments, capacityHours, utilization, capacityLoad: utilization,
    capacityStatus, remainingEstimateHoursAtEnd: sumZero(rows, (row) => (row.remainingSecondsAtEnd || 0) / 3600),
    timeSpentHoursAtEnd: sumZero(rows, (row) => (row.timeSpentSecondsAtEnd || 0) / 3600),
    originalEstimateHours: estimateHours(rows), estimateConsumed: safeDiv(completedLogged, completedEstimates), storyPointCoverage: safeDiv(spCoverage, rows.length), spEstimatedIssues: spCoverage,
    estimateCoverage: safeDiv(estimateCoverage, rows.length), timeDataCoverage,
    averageCycleTimeDays: average(cycleTimes), medianCycleTimeDays: median(cycleTimes),
    cycleTimeP75Days: percentile(cycleTimes, 0.75), cycleTimeP85Days: percentile(cycleTimes, 0.85),
    averageLeadTimeDays: average(leadTimes), medianLeadTimeDays: median(leadTimes), leadTimeP85Days: percentile(leadTimes, 0.85),
    reopenedIssues: reopened.length, reopenCount: sumZero(rows, (row) => row.reopenedCount), reopenedIssueRate: bounded(reopenedIssueRate),
    deliveryHealth: requiredHealth ? bounded(0.35 * bounded(plannedDeliveryRate) + 0.25 * bounded(scopeCompletionRate)
      + 0.2 * (1 - bounded(carryoverRate)) + 0.1 * bounded(scopeStability) + 0.1 * (1 - bounded(reopenedIssueRate))) : null,
    deliveryReliabilityIndex: requiredHealth ? bounded(0.35 * bounded(plannedDeliveryRate) + 0.25 * bounded(scopeCompletionRate)
      + 0.2 * (1 - bounded(carryoverRate)) + 0.1 * bounded(scopeStability) + 0.1 * (1 - bounded(reopenedIssueRate))) : null,
    estimateAccuracy, estimateBias, estimateBiasHours: pairedEstimate > 0 ? pairedActual - pairedEstimate : null,
    plannedEstimateBias, adhocEstimateBias, biasEstimateHours: pairedEstimate, biasLoggedHours: pairedActual,
    plannedBiasEstimateHours, plannedBiasLoggedHours, adhocBiasEstimateHours, adhocBiasLoggedHours,
    averageHoursPerCompletedSP, hoursPerScopeSP, committedToCompletedVelocityRate: safeDiv(completedSP, committedSP),
    adHocDoneSPShare: safeDiv(completedAdhocSP, completedSP), adHocCompletionRateSP: safeDiv(completedAdhocSP, adhocSP),
    adHocCompletionRateIssues: safeDiv(completedAdhoc.length, adhoc.length), plannedLoggedHours: plannedLogged,
    adHocLoggedHours: adhocLogged, plannedHoursShare: safeDiv(plannedLogged, allLogged), adHocHoursShare: safeDiv(adhocLogged, allLogged),
    plannedEstimateHours: estimateHours(planned), adHocEstimateHours: estimateHours(adhoc),
    completedPlannedEstimateHours: estimateHours(completedPlanned), completedAdhocEstimateHours: estimateHours(completedAdhoc),
    completedPlannedLoggedHours: loggedHours(completedPlanned), completedAdhocLoggedHours: loggedHours(completedAdhoc),
    completedEstimateHours, completedLoggedHours,
    bugIssues: null, bugSP: null, bugLoggedHours: null, bugShareIssues: null, bugShareSP: null, bugShareHours: null,
    completedBugIssues: null, completedBugSP: null, bugCompletionRateIssues: null, bugCompletionRateSP: null,
    normalIssues: null, normalSP: null, normalLoggedHours: null, normalShareIssues: null, normalShareSP: null, normalShareHours: null,
    completedNormalIssues: null, completedNormalSP: null, normalCompletionRateIssues: null, normalCompletionRateSP: null,
    issueClassMetrics,
    classificationHours, classificationResults, unclassifiedHours,
    classificationCoverage: rows.length ? classifiedRows.length / rows.length : null,
    devLoggedHours: null, opLoggedHours: null, regLoggedHours: null, regulatoryLoggedHours: null,
    unspecifiedLoggedHours: unclassifiedHours, unspecifiedOpTypeLoggedHours: null,
    devWorkMixShare: null, opWorkMixShare: null, regWorkMixShare: null, regulatoryWorkMixShare: null,
    unspecifiedWorkMixShare: safeDiv(unclassifiedHours, allLogged),
    unspecifiedOpTypeIssueShare: null, unspecifiedOpTypeHoursShare: safeDiv(unclassifiedHours, allLogged),
    devCapacityShare: null, opCapacityShare: null, regCapacityShare: null, regulatoryCapacityShare: null, unspecifiedCapacityShare: safeDiv(unclassifiedHours, capacityHours),
    developmentShortfall: null, operationExcess: null, regulatoryExcess: null,
    developmentProtectionRateRaw,
    developmentProtectionRate: null,
    operationCapConsumption: null, regulatoryCapConsumption: null,
    allocationStatus, capacityTargets: classificationResults.map(({ id, label, minimumShare, maximumShare }) => ({ id, label, minimumShare, maximumShare })),
    adhocHoursWarningThreshold: Number(config.adhocHoursWarning ?? 0.3),
    unspecifiedOpTypeWarningThreshold: Number(config.unspecifiedOpTypeWarning ?? 0.1),
    issuesWithoutAssignee: rows.filter((row) => !getAssigneeKey(row.assignee)).length,
    completedIssuesWithoutSP: completedWithoutSP, completedIssuesWithoutStoryPoints: completedWithoutSP,
    completedIssuesWithoutEstimate: completedWithoutEstimate, completedIssuesWithoutEstimates: completedWithoutEstimate,
    completedIssuesWithoutLoggedTime: completedWithoutTime,
  };
}

function buildIssueRows(rawIssues, config) {
  return rawIssues.map((issue) => {
    const fields = issue.fields || {};
    const semantic = resolveSemanticFields(issue, config);
    const currentSprintIds = Array.from(parseIds(semantic.sprint));
    const project = String(fields.project?.key || issue.project || issue.key?.split('-')[0] || '').toUpperCase();
    const currentStatus = String(fields.status?.name || '');
    const teamValue = jiraOptionLabel(semantic.team);
    const assignmentTime = Date.parse(fields.updated || fields.created || '') || Date.now();
    const attribution = resolveTeamAttribution(issue, {}, config, teamValue, assignmentTime);
    return {
      id: String(issue.id || ''),
      key: String(issue.key || '').toUpperCase(),
      project,
      summary: fields.summary || '',
      issueType: fields.issuetype?.name || 'Unknown',
      status: currentStatus,
      statusCategory: fields.status?.statusCategory?.key || '',
      lifecycleRoles: lifecycleRolesForStatus(config, project, currentStatus, fields.status?.statusCategory?.key || '', Boolean(fields.resolutiondate)),
      lifecycleRolesByScope: Object.fromEntries(['delivery', 'intake', 'commitment'].map((scope) => [scope,
        lifecycleRolesForStatus(config, project, currentStatus, fields.status?.statusCategory?.key || '', Boolean(fields.resolutiondate), scope)])),
      assigneeKey: getAssigneeKey(fields.assignee),
      assignee: fields.assignee?.displayName || fields.assignee?.name || 'تخصیص‌نیافته',
      created: fields.created || '',
      dueDate: fields.duedate || '',
      updated: fields.updated || '',
      resolutionDate: fields.resolutiondate || '',
      points: numberOrNull(semantic.storyPoints),
      originalEstimateSeconds: numberOrNull(fields.timeoriginalestimate),
      timeSpentSeconds: numberOrNull(fields.timespent),
      epicLink: typeof semantic.epicLink === 'string' ? semantic.epicLink.toUpperCase() : '',
      epicName: semantic.epicName || '',
      currentSprintIds,
      workClassification: jiraOptionLabel(semantic.workClassification),
      team: teamValue,
      teamId: attribution.teamId,
      teamPath: attribution.teamPath,
      teamAttributionSource: attribution.source,
      requester: jiraOptionLabel(semantic.requester),
      department: jiraOptionLabel(semantic.department),
      productOwner: jiraOptionLabel(semantic.productOwner),
      tags: currentTags(semantic.issueTags),
      components: (fields.components || []).map((component) => component?.name).filter(Boolean),
      priority: fields.priority?.name || '',
      labels: fields.labels || [],
      issueLinks: (fields.issuelinks || []).flatMap((link) => {
        const type = link?.type || {};
        const rows = [];
        if (link?.outwardIssue?.key) rows.push({ id: String(link.id || ''), key: String(link.outwardIssue.key).toUpperCase(), direction: 'outward', relationship: type.outward || type.name || 'relates to', summary: link.outwardIssue.fields?.summary || '' });
        if (link?.inwardIssue?.key) rows.push({ id: String(link.id || ''), key: String(link.inwardIssue.key).toUpperCase(), direction: 'inward', relationship: type.inward || type.name || 'relates to', summary: link.inwardIssue.fields?.summary || '' });
        return rows;
      }),
      isDone: isIssueDone(issue, config),
      isDoneByScope: Object.fromEntries(['delivery', 'intake', 'commitment'].map((scope) => [scope, isIssueDone(issue, config, scope)])),
      issueTypeId: String(fields.issuetype?.id || ''),
      issueClass: config.issueTypeClassifications?.find((entry) => entry.issueTypeId === String(fields.issuetype?.id || ''))?.classification || 'unclassified',
      raw: issue,
    };
  });
}

function buildDataQuality(rawIssues, rawSprints, importRuns, conflicts, config = {}) {
  const findings = [];
  const fieldCoverage = {};
  const rawCoverageFields = [
    ...['assignee', 'components', 'issuelinks', 'priority', 'resolutiondate'].map((id) => ({ id, key: id })),
  ];
  const semanticKeys = [...new Set((config.fieldMappings || []).map((binding) => binding.semanticKey))];
  const emptyCoverage = () => ({ returned: 0, missing: 0, null: 0, emptyArray: 0, emptyString: 0, present: 0, invalid: 0, unmapped: 0 });
  rawCoverageFields.forEach(({ key }) => { fieldCoverage[key] = emptyCoverage(); });
  semanticKeys.forEach((key) => { fieldCoverage[key] = emptyCoverage(); });
  const knownFields = new Set([...KNOWN_FIELDS, ...(config.fieldMappings || []).map((binding) => binding.providerFieldId)]);
  const semanticFieldAliases = new Map();
  const unknownFields = new Set();
  const unknownWorkflowStatuses = new Map();
  const unknownWorkflowHistory = new Map();
  const ambiguousWorkflowStatuses = new Map();
  const trackWorkflowStatus = (target, issue, status, category = '', hasResolution = false) => {
    const name = String(status || '').trim();
    if (!name) return;
    const project = String(issue.fields?.project?.key || issue.project || issue.key?.split('-')[0] || '').toUpperCase();
    workflowScopesForProject(config, project).forEach((scope) => {
      if (!hasLifecycleStatusMappings(config, project, scope)) return;
      const roles = lifecycleRolesForStatus(config, project, name, category, hasResolution, scope);
      const identity = `${scope}|${String(issue.key || issue.id || 'unknown').toUpperCase()}|${name.toLocaleLowerCase('en-US')}`;
      if (!roles.length) target.set(identity, `${scope}: ${name}`);
      else if (roles.length > 1) ambiguousWorkflowStatuses.set(identity, { name: `${scope}: ${name}`, roles });
    });
  };
  let incompleteHistories = 0;
  let issuesWithoutHistory = 0;
  let unparsableSprintValues = 0;
  rawIssues.forEach((issue) => {
    const fields = issue.fields || {};
    const currentStatus = String(fields.status?.name || '');
    trackWorkflowStatus(unknownWorkflowStatuses, issue, currentStatus, fields.status?.statusCategory?.key || '', Boolean(fields.resolutiondate));
    (issue.changelog?.histories || []).forEach((history) => (history.items || []).forEach((item) => {
      if (semanticHistoryField(item, config, issue) !== 'status') return;
      const from = item.fromString || (typeof item.from === 'string' && !/^\d+$/.test(item.from) ? item.from : '');
      const to = item.toString || (typeof item.to === 'string' && !/^\d+$/.test(item.to) ? item.to : '');
      trackWorkflowStatus(unknownWorkflowHistory, issue, from);
      trackWorkflowStatus(unknownWorkflowHistory, issue, to);
    }));
    Object.keys(fields).forEach((key) => { if (!knownFields.has(key)) unknownFields.add(key); });
    const bindingsByFieldId = new Map();
    semanticKeys.forEach((key) => {
      const binding = resolveSemanticBinding(issue, config, key);
      if (!binding) return;
      const keys = bindingsByFieldId.get(binding.providerFieldId) || [];
      keys.push(key);
      bindingsByFieldId.set(binding.providerFieldId, keys);
    });
    bindingsByFieldId.forEach((keys, providerFieldId) => {
      if (keys.length < 2) return;
      const semanticKeysForAlias = [...keys].sort();
      const aliasKey = `${providerFieldId}|${semanticKeysForAlias.join('|')}`;
      const alias = semanticFieldAliases.get(aliasKey) || { semanticKeys: semanticKeysForAlias, count: 0 };
      alias.count += 1;
      semanticFieldAliases.set(aliasKey, alias);
    });
    rawCoverageFields.forEach(({ id, key }) => {
      const target = fieldCoverage[key];
      if (!Object.prototype.hasOwnProperty.call(fields, id)) target.missing += 1;
      else {
        target.returned += 1;
        if (fields[id] === null) target.null += 1;
        else if (Array.isArray(fields[id]) && fields[id].length === 0) target.emptyArray += 1;
        else {
          target.present += 1;
          if (typeof fields[id] === 'string' && !fields[id].trim()) target.emptyString += 1;
        }
      }
    });
    semanticKeys.forEach((key) => {
      const target = fieldCoverage[key];
      const binding = resolveSemanticBinding(issue, config, key);
      if (!binding) { target.unmapped += 1; return; }
      if (!Object.prototype.hasOwnProperty.call(fields, binding.providerFieldId)) { target.missing += 1; return; }
      const value = fields[binding.providerFieldId];
      target.returned += 1;
      if (value === null || value === undefined) target.null += 1;
      else if (Array.isArray(value) && value.length === 0) target.emptyArray += 1;
      else {
        target.present += 1;
        const emptyString = typeof value === 'string' && !value.trim();
        if (emptyString) target.emptyString += 1;
        if (!emptyString && transformValue(value, binding.transform) === null) target.invalid += 1;
      }
    });
    if (!issue.changelog) issuesWithoutHistory += 1;
    else if (issue.changelog.historyComplete !== undefined
      ? !issue.changelog.historyComplete
      : (!Array.isArray(issue.changelog.histories) || issue.changelog.total === null || issue.changelog.total === undefined || !Number.isFinite(Number(issue.changelog.total))
        || Number(issue.changelog.total) > (issue.changelog.histories.length + Number(issue.changelog.startAt || 0)))) incompleteHistories += 1;
    const sprintValues = resolveSemanticFields(issue, config).sprint;
    if (Array.isArray(sprintValues)) sprintValues.forEach((value) => { if (!parseIds(value).size && value) unparsableSprintValues += 1; });
  });
  Object.entries(fieldCoverage).forEach(([key, coverage]) => {
    if (coverage.invalid) findings.push({ severity: 'warning', code: 'SEMANTIC_FIELD_INVALID', semanticKey: key, count: coverage.invalid, message: `${coverage.invalid} مقدارا برای ${key} با تبدیل پیکربندی‌شده سازگار نیست؛ شواهد خام حفظ شده است.` });
  });
  semanticFieldAliases.forEach(({ semanticKeys: keys, count }) => {
    findings.push({ severity: 'warning', code: 'SEMANTIC_FIELD_ALIAS', semanticKeys: keys, count, message: `${count} issue یک فیلد Jira را هم‌زمان به چند معنی نگاشت می‌کند (${keys.join(', ')}); این alias را بررسی کنید.` });
  });
  if (issuesWithoutHistory) findings.push({ severity: 'warning', code: 'HISTORY_NOT_RETURNED', count: issuesWithoutHistory, message: `${issuesWithoutHistory} issueها تاریخچهٔ تغییرات ندارند؛ محاسبهٔ تغییرات تاریخی محدود است.` });
  if (incompleteHistories) findings.push({ severity: 'warning', code: 'HISTORY_PARTIAL', count: incompleteHistories, message: `${incompleteHistories} issue تاریخچهٔ صفحه‌بندی‌نشده یا ناقص دارند.` });
  if (unknownWorkflowStatuses.size) findings.push({ severity: 'warning', code: 'WORKFLOW_STATUS_UNMAPPED', count: unknownWorkflowStatuses.size, message: `${unknownWorkflowStatuses.size} وضعیت جاری به نقش گردش‌کار نگاشت نشده است: ${Array.from(new Set(unknownWorkflowStatuses.values())).slice(0, 8).join(', ')}.` });
  if (unknownWorkflowHistory.size) findings.push({ severity: 'warning', code: 'WORKFLOW_HISTORY_STATUS_UNMAPPED', count: unknownWorkflowHistory.size, message: `${unknownWorkflowHistory.size} مقدار وضعیت در تاریخچه به نقش گردش‌کار نگاشت نشده است: ${Array.from(new Set(unknownWorkflowHistory.values())).slice(0, 8).join(', ')}.` });
  if (ambiguousWorkflowStatuses.size) findings.push({ severity: 'warning', code: 'WORKFLOW_STATUS_ROLE_AMBIGUOUS', count: ambiguousWorkflowStatuses.size, message: `${ambiguousWorkflowStatuses.size} وضعیت به چند نقش گردش‌کار نگاشت شده است: ${Array.from(ambiguousWorkflowStatuses.values()).slice(0, 8).map((item) => `${item.name} (${item.roles.join('/')})`).join(', ')}.` });
  if (unparsableSprintValues) findings.push({ severity: 'warning', code: 'SPRINT_VALUE_UNPARSED', count: unparsableSprintValues, message: `${unparsableSprintValues} مقدار Sprint شناسهٔ قابل‌خواندن نداشت؛ متن خام حفظ شده است.` });
  if (unknownFields.size) findings.push({ severity: 'info', code: 'UNKNOWN_FIELDS_PRESERVED', count: unknownFields.size, message: `فیلدهای جدید حفظ شده‌اند: ${Array.from(unknownFields).slice(0, 12).join(', ')}${unknownFields.size > 12 ? '، …' : ''}` });
  if (conflicts.length) findings.push({ severity: 'warning', code: 'IMPORT_CONFLICTS', count: conflicts.length, message: `${conflicts.length} تعارض نسخه یا شناسه در import ثبت شده است.` });
  const unmappedSprints = rawSprints.filter((sprint) => !sprint.teamRoute).length;
  if (unmappedSprints) findings.push({ severity: 'info', code: 'SPRINT_BOARD_UNMAPPED', count: unmappedSprints, message: `${unmappedSprints} boardها نگاشت تیم ندارند؛ نگاشت issue، component یا project همچنان می‌تواند تیم گزارش را تعیین کند.` });
  const invalidPlannedDates = rawSprints.filter((sprint) => {
    const start = Date.parse(sprint.startDate || '');
    const end = Date.parse(sprint.endDate || '');
    return !Number.isFinite(start) || !Number.isFinite(end) || end < start;
  }).length;
  if (invalidPlannedDates) findings.push({ severity: 'warning', code: 'INVALID_PLANNED_SPRINT_DATES', count: invalidPlannedDates, message: `${invalidPlannedDates} اسپرینت تاریخ برنامه‌ریزی‌شدهٔ نامعتبر یا ناقص دارد؛ ظرفیت آن محاسبه نمی‌شود.` });
  const plannedDateOutliers = rawSprints.filter((sprint) => {
    const start = Date.parse(sprint.startDate || '');
    const end = Date.parse(sprint.endDate || '');
    return Number.isFinite(start) && Number.isFinite(end) && end - start > 45 * 86400000;
  }).length;
  if (plannedDateOutliers) findings.push({ severity: 'warning', code: 'PLANNED_DATE_OUTLIER', count: plannedDateOutliers, message: `${plannedDateOutliers} اسپرینت بیش از ۴۵ روز برنامه‌ریزی شده است؛ ظرفیت براساس تاریخ برنامه‌ریزی‌شده محاسبه می‌شود.` });
  return { findings, fieldCoverage, unknownFields: Array.from(unknownFields), incompleteHistories, issuesWithoutHistory, conflicts: conflicts.length };
}

function calculateMetrics(rawIssues, rawSprints, config, importRuns = [], conflicts = []) {
  const nowMs = Date.now();
  const normalizedIssues = rawIssues.map((raw) => {
    const fields = raw.fields || {};
    const semantic = resolveSemanticFields(raw, config);
    return {
      key: String(raw.key || '').toUpperCase(),
      id: String(raw.id || ''),
      project: String(fields.project?.key || raw.key?.split('-')[0] || '').toUpperCase(),
      fields,
      semantic,
      createdMs: Date.parse(fields.created || '') || null,
      currentSprintIds: Array.from(parseIds(semantic.sprint)),
      events: issueEvents(raw, config),
      raw,
    };
  });
  const normalizedSprints = rawSprints.map((raw) => {
    const boardId = String(raw.originBoardId ?? '');
    const window = extractActualSprint(raw, nowMs);
    const plannedStart = Date.parse(raw.startDate || '');
    const plannedEnd = Date.parse(raw.endDate || '');
    const route = resolveBoardTeam(config, boardId, window?.endMs ?? plannedEnd, raw.teamRoute || '');
    return {
      ...raw,
      id: String(raw.id),
      boardId,
      teamRoute: route.team?.name || null,
      teamRouteId: route.teamId,
      teamRoutePath: route.teamPath,
      teamRouteStatus: route.status,
      window,
      plannedWorkingDays: config.calendar?.configured && Number.isFinite(plannedStart) && Number.isFinite(plannedEnd) ? workingDays(plannedStart, plannedEnd, config.calendar) : null,
      reportEligible: Boolean(window),
      name: raw.name || `Sprint ${raw.id}`,
    };
  });
  const sprintById = new Map(normalizedSprints.map((sprint) => [sprint.id, sprint]));
  const issueMemberships = normalizedIssues.map((issue) => ({ issue, intervals: parseSprintMemberships(issue) }));
  const relations = [];
  const quality = buildDataQuality(rawIssues, normalizedSprints, importRuns, conflicts, config);
  normalizedSprints.forEach((sprint) => {
    if (!sprint.window) {
      quality.findings.push({ severity: 'warning', code: 'SPRINT_BOUNDARY_INCOMPLETE', count: 1, message: `مرز واقعی ${sprint.name} کامل نیست؛ متریک تحویل برای آن محاسبه نشد.` });
      return;
    }
    if (!sprint.window.hasActualStart || (String(sprint.state).toLowerCase() === 'closed' && !sprint.window.hasActualEnd)) {
      quality.findings.push({ severity: 'warning', code: 'SPRINT_PLANNED_BOUNDARY_FALLBACK', count: 1, message: `برای ${sprint.name} بخشی از مرز برنامه‌ریزی‌شده جایگزین تاریخ واقعی شده است.` });
    }
  });
  issueMemberships.forEach(({ issue, intervals }) => {
    intervals.forEach((interval, sprintId) => {
      const sprint = sprintById.get(String(sprintId));
      if (!sprint?.reportEligible || !sprint.window) return;
      const relation = makeRelation(issue, sprint, interval, config);
      if (!relation) return;
      if (relation.teamFieldConflict) {
        quality.findings.push({ severity: 'warning', code: 'TEAM_ATTRIBUTION_CONFLICT', count: 1, message: `${issue.key} is attributed to ${relation.team} by its configured team field, but ${sprint.name} is routed to ${sprint.teamRoute}; the configured field remains the reported attribution.` });
      }
      if (relation.teamFieldAmbiguous) {
        quality.findings.push({ severity: 'warning', code: 'TEAM_FIELD_AMBIGUOUS', count: 1, message: `${issue.key} has a team value matching multiple configured teams; the next configured attribution source is used for ${sprint.name} when available.` });
      } else if (relation.teamFieldUnmapped) {
        quality.findings.push({ severity: 'warning', code: 'TEAM_FIELD_UNMAPPED', count: 1, message: `${issue.key} has an unrecognized team value; a lower-priority assignment is used for ${sprint.name} when available.` });
      }
      if (relation.teamFieldInactive) quality.findings.push({ severity: 'warning', code: 'TEAM_FIELD_INACTIVE', count: 1, message: `${issue.key} has a team value outside that team's active dates; a lower-priority assignment is used for ${sprint.name} when available.` });
      if (relation.boardTeamInactive) quality.findings.push({ severity: 'warning', code: 'BOARD_TEAM_INACTIVE', count: 1, message: `${sprint.name} has a board team mapping outside its effective dates.` });
      if (relation.boardTeamAmbiguous) quality.findings.push({ severity: 'warning', code: 'BOARD_TEAM_AMBIGUOUS', count: 1, message: `${sprint.name} has multiple active team mappings for its board.` });
      if (relation.teamOverrideInactive) quality.findings.push({ severity: 'warning', code: 'TEAM_OVERRIDE_INACTIVE', count: 1, message: `${issue.key} has an issue-team override outside its effective dates.` });
      if (relation.componentTeamAmbiguous) quality.findings.push({ severity: 'warning', code: 'COMPONENT_TEAM_AMBIGUOUS', count: 1, message: `${issue.key} components map to multiple active teams; the next attribution source is used.` });
      if (relation.componentTeamInactive) quality.findings.push({ severity: 'info', code: 'COMPONENT_TEAM_INACTIVE', count: 1, message: `${issue.key} has component team mappings outside their effective dates.` });
      if (relation.projectTeamAmbiguous) quality.findings.push({ severity: 'warning', code: 'PROJECT_TEAM_AMBIGUOUS', count: 1, message: `${issue.key} project maps to multiple active teams; the next attribution source is used.` });
      if (relation.projectTeamInactive) quality.findings.push({ severity: 'info', code: 'PROJECT_TEAM_INACTIVE', count: 1, message: `${issue.key} has a project team mapping outside its effective dates.` });
      if (!relation.teamFieldConflict && relation.teamAttributionConflicts.length) {
        const sources = relation.teamAttributionConflicts.map((conflict) => `${conflict.source}: ${conflict.team}`).join(', ');
        quality.findings.push({ severity: 'warning', code: 'TEAM_ATTRIBUTION_CONFLICT', count: 1, message: `${issue.key} uses ${relation.team} from ${relation.teamAttributionSource}; other active sources disagree (${sources}).` });
      }
      if (!relation.team) {
        quality.findings.push({ severity: 'warning', code: 'UNMAPPED_TEAM', count: 1, message: `${issue.key} in ${sprint.name} has no team attribution and is excluded from team-level totals.` });
        return;
      }
      if (!relation.historyComplete) {
        quality.findings.push({ severity: 'warning', code: 'RELATION_HISTORY_INCOMPLETE', count: 1, message: `تاریخچهٔ ${issue.key} برای بازسازی ${sprint.name} کامل نیست.` });
      }
      if (relation.added && !relation.tagDuringSprint) quality.findings.push({ severity: 'info', code: 'MID_SPRINT_ADDED_ADHOC', count: 1, message: `${issue.key} پس از شروع واقعی به ${sprint.name} اضافه شده و Ad hoc شمرده شد.` });
      relations.push(relation);
    });
  });
  relations.sort((a, b) => a.issue.key.localeCompare(b.issue.key) || a.sprint.window.startMs - b.sprint.window.startMs);
  const relationRowsByIssue = new Map();
  const latestMappedTeamByIssue = new Map();
  relations.forEach((relation) => {
    if (!relationRowsByIssue.has(relation.issue.key)) relationRowsByIssue.set(relation.issue.key, []);
    relationRowsByIssue.get(relation.issue.key).push(relation);
    latestMappedTeamByIssue.set(relation.issue.key, relation.team);
  });
  relationRowsByIssue.forEach((rows, issueKey) => {
    const byCompletion = new Map();
    rows.filter((relation) => relation.completed && relation.completionMs !== null).forEach((relation) => {
      const key = String(relation.completionMs);
      if (!byCompletion.has(key)) byCompletion.set(key, []);
      byCompletion.get(key).push(relation);
    });
    byCompletion.forEach((candidates) => {
      if (candidates.length < 2) return;
      candidates.sort((a, b) => b.sprint.window.startMs - a.sprint.window.startMs || a.sprint.window.endMs - b.sprint.window.endMs);
      candidates.slice(1).forEach((relation) => {
        relation.completed = false;
        relation.completionMs = null;
        relation.cycleTimeDays = null;
        relation.leadTimeDays = null;
        relation.completionAssignedElsewhere = true;
      });
      quality.findings.push({ severity: 'warning', code: 'AMBIGUOUS_COMPLETION_SPRINT', count: 1, message: `پنجره‌های هم‌پوشان ${issueKey} یک رویداد تکمیل را پوشش می‌دهند؛ فقط اسپرینت با شروع محاسباتی دیرتر آن را می‌شمارد.` });
    });
  });
  const unmappedTimeBySprint = new Map();
  let unmappedTimeEventCount = 0;
  const unmappedTimeIssueKeys = new Set();
  normalizedIssues.forEach((issue) => {
    const issueRelations = relationRowsByIssue.get(issue.key) || [];
    const timeEvents = eventsFor(issue, 'timespent');
    const deltaTotal = timeEvents.reduce((total, event) => {
      const from = numberOrNull(event.from) ?? numberOrNull(event.fromString) ?? 0;
      const to = numberOrNull(event.to) ?? numberOrNull(event.toString);
      return to === null ? total : total + to - from;
    }, 0);
    const currentTimeSpent = numberOrNull(issue.fields.timespent);
    if (currentTimeSpent !== null && Math.abs(deltaTotal - currentTimeSpent) > 60) {
      quality.findings.push({ severity: 'warning', code: 'TIMESPENT_RECONCILIATION', count: 1, message: `جمع deltaهای timespent برای ${issue.key} با مقدار جاری اختلاف دارد؛ proxy زمان نیازمند بررسی است.` });
    }
    timeEvents.forEach((event) => {
      const from = numberOrNull(event.from) ?? numberOrNull(event.fromString) ?? 0;
      const to = numberOrNull(event.to) ?? numberOrNull(event.toString);
      if (to === null) return;
      const delta = to - from;
      const matches = issueRelations.filter((relation) => event.timeMs >= relation.sprint.window.startMs
        && event.timeMs <= relation.sprint.window.endMs
        && relation.membershipIntervals.some(([start, end]) => event.timeMs >= start && event.timeMs <= end))
        .sort((a, b) => b.sprint.window.startMs - a.sprint.window.startMs);
      const mapped = matches[0] || null;
      if (mapped) {
        mapped.loggedSeconds += delta;
        if (delta < 0) mapped.negativeTimeAdjustmentCount = (mapped.negativeTimeAdjustmentCount || 0) + 1;
      } else {
        unmappedTimeEventCount += 1;
        unmappedTimeIssueKeys.add(issue.key);
        const project = String(issue.fields.project?.key || issue.key.split('-')[0]).toUpperCase();
        const sourceTeam = latestMappedTeamByIssue.get(issue.key) || null;
        const reportingTeam = sourceTeam;
        const candidate = normalizedSprints.filter((sprint) => sprint.teamRoute === sourceTeam && sprint.window
          && event.timeMs >= sprint.window.startMs && event.timeMs <= sprint.window.endMs)
          .sort((a, b) => b.window.startMs - a.window.startMs)[0];
        if (candidate && reportingTeam) {
          const key = `${reportingTeam}|${candidate.id}`;
          unmappedTimeBySprint.set(key, (unmappedTimeBySprint.get(key) || 0) + delta / 3600);
        }
      }
    });
  });
  if (unmappedTimeEventCount) {
    const examples = Array.from(unmappedTimeIssueKeys).slice(0, 8).join('، ');
    quality.findings.push({ severity: 'info', code: 'UNMAPPED_TIME_EVENT', count: unmappedTimeEventCount, message: `${unmappedTimeEventCount} تغییر timespent به عضویت issue-sprint وصل نشد؛ در صورت امکان ساعت در Sprint متناظر به‌عنوان unmapped ثبت شد. نمونه: ${examples}${unmappedTimeIssueKeys.size > 8 ? '، …' : ''}` });
  }
  const negativeTimeAdjustments = relations.reduce((sum, relation) => sum + (relation.negativeTimeAdjustmentCount || 0), 0);
  if (negativeTimeAdjustments) quality.findings.push({ severity: 'warning', code: 'NEGATIVE_TIMESPENT_ADJUSTMENT', count: negativeTimeAdjustments, message: `${negativeTimeAdjustments} کاهش ثبت‌شده در timespent وجود دارد؛ ساعت changelog یک proxy است و می‌تواند اصلاح منفی داشته باشد.` });
  const byIssue = new Map();
  relations.forEach((relation) => {
    if (!byIssue.has(relation.issue.key)) byIssue.set(relation.issue.key, []);
    byIssue.get(relation.issue.key).push(relation);
  });
  byIssue.forEach((rows) => {
    rows.sort((a, b) => a.sprint.window.startMs - b.sprint.window.startMs || a.sprint.window.endMs - b.sprint.window.endMs);
    let previousOpen = false;
    let streak = 0;
    rows.forEach((row, index) => {
      row.incoming = previousOpen;
      row.carryoverCompleted = row.incoming && row.completed;
      row.outgoing = !row.completed && row.atEnd && !row.completionAssignedElsewhere;
      if (row.outgoing) streak += 1;
      else streak = 0;
      row.carryoverStreak = row.outgoing ? streak : 0;
      row.carriedToSprint = row.outgoing && rows[index + 1] ? rows[index + 1].sprint.name : '';
      previousOpen = row.outgoing;
    });
  });
  const capacityBySprint = new Map();
  const personCapacity = new Map();
  const configuredCapacityOverrides = Array.isArray(config.capacityOverrides) ? config.capacityOverrides : [];
  relations.forEach((relation) => {
    const personKey = getAssigneeKey(relation.assignee);
    if (!personKey || !config.calendar?.configured || !relation.sprint.plannedWorkingDays) return;
    const allocation = 1;
    const key = `${relation.team}|${relation.sprint.id}|${personKey}`;
    if (!personCapacity.has(key)) personCapacity.set(key, {
      team: relation.team,
      teamId: relation.teamId,
      teamPath: relation.teamPath,
      sprint: relation.sprint,
      assignee: relation.assignee,
      capacityHours: relation.sprint.plannedWorkingDays * Number(config.calendar.hoursPerDay) * allocation,
    });
  });
  configuredCapacityOverrides.forEach((item) => {
    const team = String(item.team || '');
    const sprintId = String(item.sprintId || '');
    const assigneeKey = String(item.assigneeKey || '');
    if (!team || !sprintId || !assigneeKey) return;
    const sprint = normalizedSprints.find((candidate) => candidate.id === sprintId && candidate.window
      && (candidate.teamRoute === team || relations.some((relation) => relation.sprint.id === sprintId && relation.team === team)));
    if (!sprint) return;
    const key = `${team}|${sprintId}|${assigneeKey}`;
    const current = personCapacity.get(key);
    const assignee = current?.assignee || { key: assigneeKey, name: String(item.assignee || assigneeKey), displayName: String(item.assignee || assigneeKey) };
    if (!config.calendar?.configured) return;
    const days = item.overrideWorkingDays === null || item.overrideWorkingDays === undefined || item.overrideWorkingDays === ''
      ? Number(sprint.plannedWorkingDays || 0) : Number(item.overrideWorkingDays);
    const allocation = Number.isFinite(Number(item.allocation)) ? Math.max(0, Math.min(1, Number(item.allocation))) : 1;
    personCapacity.set(key, {
      team, sprint, assignee, capacityHours: Math.max(0, days) * Number(config.calendar.hoursPerDay) * allocation,
      teamId: current?.teamId || config.teams.find((candidate) => candidate.name === team)?.id || '',
      teamPath: current?.teamPath || configuredTeamPath(config, config.teams.find((candidate) => candidate.name === team)?.id || ''),
      manualOverride: true,
    });
  });
  personCapacity.forEach((person) => {
    const key = `${person.team}|${person.sprint.id}`;
    capacityBySprint.set(key, (capacityBySprint.get(key) || 0) + person.capacityHours);
  });
  const sprintGroups = new Map();
  const sprintByGroup = new Map();
  normalizedSprints.filter((sprint) => sprint.reportEligible && sprint.window && sprint.teamRoute).forEach((sprint) => {
    const routedTeam = config.teams.find((team) => team.id === sprint.teamRouteId);
    if (!routedTeam || !isActiveAt(routedTeam, sprint.window.endMs)) return;
    const key = `${routedTeam.name}|${sprint.id}`;
    sprintGroups.set(key, []);
    sprintByGroup.set(key, sprint);
  });
  relations.forEach((relation) => {
    const key = `${relation.team}|${relation.sprint.id}`;
    if (!sprintGroups.has(key)) sprintGroups.set(key, []);
    sprintGroups.get(key).push(relation);
    sprintByGroup.set(key, relation.sprint);
  });
  const sprintMetrics = [];
  sprintGroups.forEach((rows, key) => {
    const [team] = key.split('|');
    const sprint = rows[0]?.sprint || sprintByGroup.get(key);
    if (!sprint) return;
    const capacityHours = config.calendar?.configured ? capacityBySprint.get(`${team}|${sprint.id}`) ?? 0 : null;
    const metric = {
      team,
      teamId: rows[0]?.teamId || sprint.teamRouteId || '',
      teamPath: rows[0]?.teamPath || sprint.teamRoutePath || [team],
      sprintId: sprint.id,
      sprintName: sprint.name,
      state: sprint.state || '',
      boardId: sprint.boardId,
      startDate: sprint.activatedDate || sprint.startDate || '',
      endDate: sprint.completeDate || sprint.endDate || '',
      plannedWorkingDays: sprint.plannedWorkingDays,
      scope: scoreBundle(rows, { capacityHours }, config),
      rows,
      sprint,
    };
    metric.scope.unmappedTimeHours = unmappedTimeBySprint.get(`${metric.team}|${metric.sprintId}`) || 0;
    sprintMetrics.push(metric);
  });
  sprintMetrics.sort((a, b) => a.team.localeCompare(b.team) || a.sprint.window.startMs - b.sprint.window.startMs);
  const sprintOrderByTeam = new Map();
  sprintMetrics.forEach((metric) => {
    const order = (sprintOrderByTeam.get(metric.team) || 0) + 1;
    sprintOrderByTeam.set(metric.team, order);
    metric.sprintOrder = order;
    metric.calendarDays = inclusiveCalendarDays(metric.sprint.window.startMs, metric.sprint.window.endMs, config.organization.timeZone);
    metric.workingDays = metric.plannedWorkingDays;
  });
  addForecasts(sprintMetrics, Number(config.planningLookback || 5), Number(config.minForecastCoverage ?? 0.7), undefined, Number(config.predictabilityLookback || 5));
  const personGroups = new Map();
  personCapacity.forEach((person) => {
    const personKey = getAssigneeKey(person.assignee);
    if (!personKey) return;
    const groupKey = `${person.team}|${person.sprint.id}|${personKey}`;
    if (!personGroups.has(groupKey)) personGroups.set(groupKey, []);
  });
  relations.forEach((relation) => {
    const assigneeKey = getAssigneeKey(relation.assignee) || 'unassigned';
    const personKey = `${relation.team}|${relation.sprint.id}|${assigneeKey}`;
    if (!personGroups.has(personKey)) personGroups.set(personKey, []);
    personGroups.get(personKey).push(relation);
  });
  const personMetrics = [];
  const sprintMetadataByKey = new Map(sprintMetrics.map((metric) => [`${metric.team}|${metric.sprintId}`, metric]));
  personGroups.forEach((rows) => {
    const first = rows[0];
    if (!first) return;
    const sprintMetadata = sprintMetadataByKey.get(`${first.team}|${first.sprint.id}`);
    const capacity = personCapacity.get(`${first.team}|${first.sprint.id}|${getAssigneeKey(first.assignee)}`)?.capacityHours ?? null;
    const scope = scoreBundle(rows, { capacityHours: capacity }, config);
    ['developmentShortfall', 'operationExcess', 'regulatoryExcess', 'developmentProtectionRateRaw', 'developmentProtectionRate',
      'operationCapConsumption', 'regulatoryCapConsumption', 'allocationStatus', 'capacityTargets'].forEach((key) => { delete scope[key]; });
    personMetrics.push({
      team: first.team,
      teamId: first.teamId || config.teams.find((candidate) => candidate.name === first.team)?.id || '',
      teamPath: first.teamPath || configuredTeamPath(config, first.teamId || config.teams.find((candidate) => candidate.name === first.team)?.id || ''),
      sprintId: first.sprint.id,
      sprintName: first.sprint.name,
      sprintOrder: sprintMetadata?.sprintOrder ?? null,
      calendarDays: sprintMetadata?.calendarDays ?? null,
      workingDays: first.sprint.plannedWorkingDays,
      startDate: first.sprint.activatedDate || first.sprint.startDate || '',
      endDate: first.sprint.completeDate || first.sprint.endDate || '',
      assigneeKey: getAssigneeKey(first.assignee),
      assignee: first.assignee?.displayName || first.assignee?.name || 'تخصیص‌نیافته',
      scope,
      rows,
      sprint: first.sprint,
    });
  });
  personMetrics.sort((a, b) => a.team.localeCompare(b.team)
    || a.sprint.window.startMs - b.sprint.window.startMs || a.assignee.localeCompare(b.assignee));
  addForecasts(personMetrics, Number(config.planningLookback || 5), Number(config.minForecastCoverage ?? 0.7), (metric) => `${metric.team}|${metric.assigneeKey}`, Number(config.predictabilityLookback || 5));
  sprintMetrics.forEach((metric) => {
    if (metric.scope.adHocHoursShare !== null && metric.scope.adHocHoursShare >= Number(config.adhocHoursWarning ?? 0.3)) {
      quality.findings.push({ severity: 'warning', code: 'ADHOC_HOURS_SHARE_HIGH', count: 1, message: `${metric.team} · ${metric.sprintName}: سهم ساعت Ad hoc به ${Math.round(metric.scope.adHocHoursShare * 100)}٪ رسیده است.` });
    }
  });
  const issues = buildIssueRows(rawIssues, config);
  const issueByKey = new Map(issues.map((issue) => [issue.key, issue]));
  const epics = issues.filter((issue) => issue.issueType.toLowerCase() === 'epic').map((epic) => {
    const children = issues.filter((issue) => issue.epicLink === epic.key);
    const teamGroups = new Map();
    children.forEach((child) => {
      const historical = (relationRowsByIssue.get(child.key) || []).filter((relation) => relation.teamId && relation.team);
      const identities = historical.length
        ? historical.map((relation) => ({ teamId: relation.teamId, team: relation.team }))
        : child.teamId && child.team ? [{ teamId: child.teamId, team: child.teamPath.at(-1) || child.team }] : [];
      const seen = new Set();
      identities.forEach((identity) => {
        if (!identity.teamId || seen.has(identity.teamId)) return;
        seen.add(identity.teamId);
        if (!teamGroups.has(identity.teamId)) teamGroups.set(identity.teamId, { teamId: identity.teamId, team: identity.team, issueKeys: new Set() });
        teamGroups.get(identity.teamId).issueKeys.add(child.key);
      });
    });
    return {
      ...epic,
      childrenCount: children.length,
      childrenDone: children.filter((child) => child.isDoneByScope.delivery).length,
      childStoryPoints: sumKnown(children, (child) => child.points),
      technicalProjects: Array.from(new Set(children.filter((child) => (config.projectRoles?.technicalDelivery || []).includes(child.project)).map((child) => child.project))),
      teamGroups: Array.from(teamGroups.values()).map((group) => ({ teamId: group.teamId, team: group.team, issueCount: group.issueKeys.size })),
      childKeys: children.map((child) => child.key),
    };
  });
  const summary = {
    issueCount: issues.length,
    projectCounts: Object.entries(issues.reduce((counts, issue) => { counts[issue.project] = (counts[issue.project] || 0) + 1; return counts; }, {})).map(([project, count]) => ({ project, count })).sort((a, b) => b.count - a.count),
    epicCount: epics.length,
    sprintCount: rawSprints.length,
    reportableSprints: sprintMetrics.length,
    relationCount: relations.length,
    unmappedTeamRelationCount: quality.findings.filter((finding) => finding.code === 'UNMAPPED_TEAM').reduce((sum, finding) => sum + finding.count, 0),
    warningCount: quality.findings.filter((finding) => finding.severity === 'warning').reduce((sum, finding) => sum + finding.count, 0),
    issuesWithoutAssignee: issues.filter((issue) => !issue.assigneeKey).length,
    lastIssueUpdate: issues.map((issue) => issue.updated).filter(Boolean).sort().at(-1) || null,
  };
  return {
    summary,
    issues,
    issueByKey,
    sprints: normalizedSprints,
    sprintMetrics,
    personMetrics,
    relations,
    epics,
    quality: { ...quality, findings: quality.findings.slice(0, 1000) },
  };
}

function addForecasts(metrics, lookback, minimumCoverage, groupBy = (metric) => metric.team, predictabilityLookback = lookback) {
  const groups = new Map();
  metrics.forEach((metric) => {
    const key = groupBy(metric);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(metric);
  });
  groups.forEach((group) => {
    group.sort((a, b) => a.sprint.window.startMs - b.sprint.window.startMs);
    group.forEach((current, index) => {
      const prior = group.slice(0, index).filter((metric) => String(metric.state).toLowerCase() === 'closed');
      const reliable = prior.filter((metric) => metric.scope.storyPointCoverage !== null && metric.scope.storyPointCoverage >= minimumCoverage && metric.scope.completedPlannedSP > 0).slice(-lookback);
      const usable = prior.filter((metric) => metric.scope.completedPlannedSP > 0).slice(-lookback);
      let history = [];
      let method = '';
      let confidence = '';
      if (reliable.length >= Math.min(2, lookback)) {
        history = reliable; method = 'Reliable historical median'; confidence = reliable.length >= 3 ? 'High' : 'Medium';
      } else if (reliable.length) {
        history = reliable; method = 'Limited reliable history'; confidence = 'Low';
      } else if (usable.length) {
        history = usable; method = 'Low-coverage historical median'; confidence = 'Low';
      }
      const forecast = history.length ? median(history.map((metric) => metric.scope.completedPlannedSP)) : current.scope.plannedSP;
      current.scope.forecastPlannableSP = forecast ?? 0;
      current.scope.forecastHistorySprints = history.length;
      current.scope.forecastMethod = history.length ? method : ((current.scope.plannedSP || 0) > 0 ? 'Current-plan fallback' : 'No SP basis');
      current.scope.forecastConfidence = history.length ? confidence : ((current.scope.plannedSP || 0) > 0 ? 'Baseline only' : 'Unavailable');
      current.scope.planningLoadRatio = current.scope.forecastPlannableSP > 0 ? current.scope.plannedSP / current.scope.forecastPlannableSP : 0;
      current.scope.velocitySP = current.scope.completedSP || 0;
      current.scope.plannedVelocitySP = current.scope.completedPlannedSP || 0;
      const committedBaseline = current.assigneeKey ? current.scope.scopeSP : current.scope.committedSP;
      current.scope.committedToCompletedVelocityRate = safeDiv(current.scope.completedSP, committedBaseline);
      const predictabilityWindow = prior.slice(-predictabilityLookback);
      const priorDelivery = predictabilityWindow.map((metric) => metric.scope.plannedCompletionRateSP).filter(Number.isFinite);
      const priorPlannedSP = predictabilityWindow.map((metric) => metric.scope.completedPlannedSP).filter(Number.isFinite);
      current.scope.rollingAveragePlannedDelivery = average(priorDelivery);
      current.scope.plannedDeliveryVariability = priorDelivery.length >= 2 ? populationStandardDeviation(priorDelivery) : null;
      current.scope.rollingMedianCompletedPlannedSP = median(priorPlannedSP);
      const plannedSPMean = average(priorPlannedSP);
      const plannedSPDeviation = priorPlannedSP.length >= 2 ? populationStandardDeviation(priorPlannedSP) : null;
      current.scope.completedPlannedSPVariability = plannedSPMean !== null && plannedSPMean !== 0 && plannedSPDeviation !== null
        ? plannedSPDeviation / Math.abs(plannedSPMean) : null;
      current.scope.deliveryConsistencyIndex = current.scope.completedPlannedSPVariability === null
        ? null : 1 - Math.min(1, current.scope.completedPlannedSPVariability);
      current.scope.plannedDeliveryVsRollingAverage = current.scope.plannedCompletionRateSP === null || current.scope.rollingAveragePlannedDelivery === null ? null : current.scope.plannedCompletionRateSP - current.scope.rollingAveragePlannedDelivery;
      current.scope.completedPlannedSPVsForecast = current.scope.completedPlannedSP === null ? null : current.scope.completedPlannedSP - current.scope.forecastPlannableSP;
    });
  });
}

function businessStatusSince(issue) {
  const statusEvents = (issue.raw?.changelog?.histories || []).flatMap((history) => (history.items || [])
    .filter((item) => String(item.field || '').toLowerCase() === 'status')
    .map((item) => ({ at: history.created || '', to: item.toString || '' })))
    .filter((event) => Number.isFinite(Date.parse(event.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = statusEvents.at(-1);
  if (latest && String(latest.to).toLowerCase() === String(issue.status).toLowerCase()) return latest.at;
  if (!statusEvents.length && issue.raw?.changelog?.historyComplete === true) return issue.created || '';
  return '';
}

function jiraOptionLabel(value) {
  if (Array.isArray(value)) return value.map(jiraOptionLabel).filter(Boolean).join('، ');
  if (value && typeof value === 'object') return String(value.value || value.name || value.displayName || value.key || '').trim();
  return String(value || '').trim();
}

function ageInDays(value, nowMs) {
  const at = Date.parse(value || '');
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / 86400000)) : null;
}

function recordIssueKeys(record) {
  const payload = record.payload || {};
  const values = [payload.issueKey, payload.requestKey, payload.productKey, payload.primaryIssueKey, payload.businessEpicKey,
    payload.businessIssueKey, payload.issueKeys, payload.businessIssueKeys, payload.linkedIssueKeys,
    payload.relatedIssueKeys, payload.technicalIssueKeys];
  return Array.from(new Set(values.flatMap((value) => Array.isArray(value) ? value : [value])
    .filter(Boolean).map((value) => String(value).trim().toUpperCase())));
}

function publicSnapshot(metrics, productRecords, importRuns, conflicts, filters = {}, localIssueLinks = [], config = {}) {
  const records = productRecords.filter((record) => !record.archived_at).map((record) => ({
    id: record.id,
    kind: record.kind,
    title: record.title,
    payload: safeJson(record.payload_json, {}),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }));
  const baseQuality = buildDataQuality(metrics.issues.map((row) => row.raw), metrics.sprints.map((sprint) => sprint), importRuns, conflicts, config);
  const baseFindingKeys = new Set(baseQuality.findings.map((finding) => finding.code + '|' + finding.message));
  const metricFindings = (metrics.quality?.findings || []).filter((finding) => !baseFindingKeys.has(finding.code + '|' + finding.message));
  const quality = { ...baseQuality, findings: [...baseQuality.findings, ...metricFindings] };
  const warningCount = quality.findings.filter((finding) => finding.severity === 'warning').reduce((sum, finding) => sum + finding.count, 0);
  const selectedTeam = filters.team || '';
  const selectedProject = filters.project || '';
  const filteredIssues = metrics.issues.filter((issue) => (!selectedProject || issue.project === selectedProject)
    && (!filters.search || (issue.key + ' ' + issue.summary + ' ' + issue.assignee).toLowerCase().includes(String(filters.search).toLowerCase())));
  const issueByKey = metrics.issueByKey || new Map(metrics.issues.map((issue) => [issue.key, issue]));
  const intakeProjects = new Set(config.projectRoles?.productIntake || []);
  const deliveryProjects = new Set(config.projectRoles?.technicalDelivery || []);
  const commitmentProjects = new Set(config.projectRoles?.commitments || []);
  const productLinks = new Map();
  const recordsByIntakeIssue = new Map();
  records.filter((record) => ['objective', 'action', 'request', 'decision', 'meeting', 'outcome'].includes(record.kind)).forEach((record) => {
    recordIssueKeys(record).forEach((key) => {
      if (!productLinks.has(key)) productLinks.set(key, []);
      productLinks.get(key).push({ id: record.id, kind: record.kind, title: record.title });
      if (intakeProjects.has(issueByKey.get(key)?.project)) {
        if (!recordsByIntakeIssue.has(key)) recordsByIntakeIssue.set(key, []);
        recordsByIntakeIssue.get(key).push({ id: record.id, kind: record.kind, title: record.title });
      }
    });
  });
  const epics = metrics.epics.map((epic) => ({
    key: epic.key, summary: epic.summary || epic.epicName, project: epic.project, status: epic.status,
    assignee: epic.assignee, childrenCount: epic.childrenCount, childrenDone: epic.childrenDone,
    childStoryPoints: epic.childStoryPoints, technicalProjects: epic.technicalProjects,
    teamGroups: epic.teamGroups || [],
    linkedProducts: productLinks.get(epic.key) || [],
  }));
  const relationsByIssue = new Map();
  metrics.relations.forEach((relation) => {
    const key = relation.issue.key;
    if (!relationsByIssue.has(key)) relationsByIssue.set(key, []);
    relationsByIssue.get(key).push(relation);
  });
  const sprints = metrics.sprintMetrics.filter((metric) => !selectedTeam || metric.team === selectedTeam).map((metric) => ({
    team: metric.team, teamId: metric.teamId, teamPath: metric.teamPath, sprintId: metric.sprintId, sprintName: metric.sprintName, state: metric.state,
    sprintOrder: metric.sprintOrder, calendarDays: metric.calendarDays, workingDays: metric.workingDays,
    startDate: metric.startDate, endDate: metric.endDate, plannedWorkingDays: metric.plannedWorkingDays,
    ...metric.scope,
  }));
  const people = metrics.personMetrics.filter((metric) => !selectedTeam || metric.team === selectedTeam).map((metric) => ({
    team: metric.team, teamId: metric.teamId, teamPath: metric.teamPath, sprintId: metric.sprintId, sprintName: metric.sprintName, sprintOrder: metric.sprintOrder,
    calendarDays: metric.calendarDays, workingDays: metric.workingDays, startDate: metric.startDate, endDate: metric.endDate,
    assigneeKey: metric.assigneeKey, assignee: metric.assignee,
    ...metric.scope,
    assignedIssues: metric.scope.scopeIssues, assignedSP: metric.scope.scopeSP,
    completedIssues: metric.scope.completedIssues, completedSP: metric.scope.completedSP,
    plannedIssues: metric.scope.plannedIssues, adhocIssues: metric.scope.adhocIssues,
    loggedHours: metric.scope.loggedHours, capacityHours: metric.scope.capacityHours, utilization: metric.scope.utilization,
    medianCycleTimeDays: metric.scope.medianCycleTimeDays, estimateAccuracy: metric.scope.estimateAccuracy,
    incomingCarryoverIssues: metric.scope.incomingCarryoverIssues, outgoingCarryoverIssues: metric.scope.outgoingCarryoverIssues,
    storyPointCoverage: metric.scope.storyPointCoverage, timeDataCoverage: metric.scope.timeDataCoverage,
  }));
  const links = records.filter((record) => ['action', 'request'].includes(record.kind)).map((record) => {
    const keys = recordIssueKeys(record);
    const linked = Array.from(new Set(keys)).map((key) => issueByKey.get(key)).filter(Boolean);
    const linkedRelations = Array.from(new Set(keys)).flatMap((key) => relationsByIssue.get(key) || []);
    const deliveryBySprint = new Map();
    linkedRelations.forEach((relation) => {
      const groupKey = relation.team + '|' + relation.sprint.id;
      if (!deliveryBySprint.has(groupKey)) deliveryBySprint.set(groupKey, {
        team: relation.team, sprintId: relation.sprint.id, sprintName: relation.sprint.name,
        state: relation.sprint.state || '', startDate: relation.sprint.activatedDate || relation.sprint.startDate || '',
        endDate: relation.sprint.completeDate || relation.sprint.endDate || '',
        issueKeys: new Set(), completedIssueKeys: new Set(), completedSP: 0, loggedHours: 0,
      });
      const sprintRow = deliveryBySprint.get(groupKey);
      sprintRow.issueKeys.add(relation.issue.key);
      sprintRow.loggedHours += relation.loggedSeconds / 3600;
      if (relation.completed) {
        sprintRow.completedIssueKeys.add(relation.issue.key);
        sprintRow.completedSP += Number(relation.storyPointsAtEnd || 0);
      }
    });
    const linkedSprintDeliveries = Array.from(deliveryBySprint.values()).map((item) => ({
      ...item, issueCount: item.issueKeys.size, completedIssueCount: item.completedIssueKeys.size,
      issueKeys: Array.from(item.issueKeys).sort(), completedIssueKeys: Array.from(item.completedIssueKeys).sort(),
    })).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)) || a.team.localeCompare(b.team));
    const linkedSprintNames = Array.from(new Set(linkedSprintDeliveries.map((item) => item.team + ' · ' + item.sprintName)));
    const linkedTeams = Array.from(new Set(linkedSprintDeliveries.map((item) => item.team))).sort();
    const completedKeys = new Set([...linked.filter((issue) => {
      const scope = intakeProjects.has(issue.project) ? 'intake' : deliveryProjects.has(issue.project) ? 'delivery' : '';
      return scope ? issue.isDoneByScope[scope] : issue.isDone;
    }).map((issue) => issue.key), ...linkedRelations.filter((relation) => relation.completed).map((relation) => relation.issue.key)]);
    return {
      recordId: record.id, kind: record.kind, title: record.title, keys,
      linkedIssues: linked.map((issue) => ({ key: issue.key, project: issue.project, status: issue.status, assignee: issue.assignee, points: issue.points, epicLink: issue.epicLink })),
      linkedSprintCount: linkedSprintDeliveries.length, linkedSprintNames, linkedTeams, linkedSprintDeliveries,
      linkedDeliveredSP: linkedSprintDeliveries.reduce((sum, sprint) => sum + sprint.completedSP, 0),
      linkedDoneCount: completedKeys.size,
    };
  });
  const jiraIssueLinks = [];
  const seenJiraLinks = new Set();
  metrics.issues.forEach((issue) => (issue.issueLinks || []).forEach((link) => {
    const targetKey = String(link.key || '').toUpperCase();
    if (!targetKey) return;
    const relation = { id: link.id || issue.key + '|' + targetKey + '|' + link.relationship,
      sourceKey: issue.key, targetKey, direction: link.direction, relationship: link.relationship, source: 'Jira' };
    const identity = String(link.id || [issue.key, targetKey].sort().join('|') + '|' + link.relationship);
    if (!seenJiraLinks.has(identity)) { jiraIssueLinks.push(relation); seenJiraLinks.add(identity); }
  }));
  const intakeLinks = new Map();
  const addIntakeLink = (intakeKey, deliveryKey, source, relationship, id) => {
    const intakeIssue = issueByKey.get(String(intakeKey || '').toUpperCase());
    const deliveryIssue = issueByKey.get(String(deliveryKey || '').toUpperCase());
    if (!intakeIssue || !deliveryIssue || !intakeProjects.has(intakeIssue.project) || !deliveryProjects.has(deliveryIssue.project)) return;
    const key = intakeIssue.key;
    if (!intakeLinks.has(key)) intakeLinks.set(key, []);
    const rows = intakeLinks.get(key);
    if (rows.some((row) => row.deliveryKey === deliveryIssue.key && row.source === source && row.relationship === relationship)) return;
    rows.push({ id: id || '', intakeKey: key, deliveryKey: deliveryIssue.key, source, relationship: relationship || '', deliveryIssue: {
      key: deliveryIssue.key, summary: deliveryIssue.summary, status: deliveryIssue.status, assignee: deliveryIssue.assignee, project: deliveryIssue.project,
    } });
  };
  jiraIssueLinks.forEach((link) => {
    addIntakeLink(link.sourceKey, link.targetKey, 'Jira issue link', link.relationship, link.id);
    addIntakeLink(link.targetKey, link.sourceKey, 'Jira issue link', link.relationship, link.id);
  });
  localIssueLinks.forEach((link) => addIntakeLink(link.intake_issue_key || link.business_issue_key, link.delivery_issue_key || link.technical_issue_key,
    'Axiloom local link', link.relationship, link.id));
  records.forEach((record) => {
    const keys = recordIssueKeys(record);
    const intakeKeys = keys.filter((key) => intakeProjects.has(issueByKey.get(key)?.project));
    const deliveryKeys = keys.filter((key) => deliveryProjects.has(issueByKey.get(key)?.project));
    intakeKeys.forEach((intakeKey) => {
      deliveryKeys.forEach((deliveryKey) => addIntakeLink(intakeKey, deliveryKey, 'Product ' + record.kind, 'explicit relation', record.id));
    });
  });
  const nowMs = Date.now();
  const intakeIssues = metrics.issues.filter((issue) => intakeProjects.has(issue.project)).map((issue) => {
    const statusSince = businessStatusSince(issue);
    const issueAgeDays = ageInDays(issue.created, nowMs);
    const statusAgeDays = ageInDays(statusSince, nowMs);
    const connections = intakeLinks.get(issue.key) || [];
    const deliveryKeys = Array.from(new Set(connections.map((link) => link.deliveryKey))).sort();
    return {
      ...issue, done: issue.isDoneByScope.intake, productTeam: issue.components?.length ? issue.components.join('، ') : '—',
      requester: jiraOptionLabel(issue.requester), department: jiraOptionLabel(issue.department), productOwner: jiraOptionLabel(issue.productOwner),
      statusSince, statusAgeDays, issueAgeDays, lastUpdatedAgeDays: ageInDays(issue.updated, nowMs),
      linkedTechnicalKeys: deliveryKeys, linkedTechnicalLinks: connections, linkedProducts: recordsByIntakeIssue.get(issue.key) || [],
    };
  });
  const activeIntakeIssues = intakeIssues.filter((issue) => !issue.done);
  const groupCounts = (rows, keyOf) => {
    const groups = new Map();
    rows.forEach((row) => { const key = keyOf(row) || '—'; groups.set(key, (groups.get(key) || 0) + 1); });
    return Array.from(groups, ([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  };
  const intakeComponents = new Map();
  const intakeAssignees = new Map();
  const componentAssignees = new Map();
  intakeIssues.forEach((issue) => {
    const components = issue.components.length ? issue.components : ['—'];
    components.forEach((component) => {
      const group = intakeComponents.get(component) || { key: component, total: 0, open: 0, done: 0, linkedTechnical: 0, assignees: new Set() };
      group.total += 1; if (issue.done) group.done += 1; else group.open += 1;
      if (issue.linkedTechnicalKeys.length) group.linkedTechnical += 1;
      if (issue.assigneeKey) group.assignees.add(issue.assigneeKey);
      intakeComponents.set(component, group);
    });
    const key = issue.assigneeKey || 'unassigned';
    const person = intakeAssignees.get(key) || { key, name: issue.assignee, total: 0, open: 0, done: 0, linkedTechnical: 0, components: new Set(), oldestOpenAgeDays: null };
    person.total += 1; if (issue.done) person.done += 1; else person.open += 1;
    if (issue.linkedTechnicalKeys.length) person.linkedTechnical += 1;
    issue.components.forEach((component) => person.components.add(component));
    if (!issue.done && issue.issueAgeDays !== null) person.oldestOpenAgeDays = Math.max(person.oldestOpenAgeDays || 0, issue.issueAgeDays);
    intakeAssignees.set(key, person);
    components.forEach((component) => {
      const componentKey = component + '|' + key;
      const assigned = componentAssignees.get(componentKey) || { component, key, name: issue.assignee, total: 0, open: 0, done: 0 };
      assigned.total += 1; if (issue.done) assigned.done += 1; else assigned.open += 1;
      componentAssignees.set(componentKey, assigned);
    });
  });
  const ageRanges = [
    { key: '0–7 days', min: 0, max: 7 }, { key: '8–30 days', min: 8, max: 30 },
    { key: '31–90 days', min: 31, max: 90 }, { key: '91–180 days', min: 91, max: 180 },
    { key: 'More than 180 days', min: 181, max: Infinity },
  ];
  const agingBuckets = ageRanges.map((range) => ({ key: range.key, count: activeIntakeIssues.filter((issue) => issue.issueAgeDays !== null && issue.issueAgeDays >= range.min && issue.issueAgeDays <= range.max).length }));
  const monthlyMap = new Map();
  const ensureMonth = (month) => { if (!monthlyMap.has(month)) monthlyMap.set(month, { month, created: 0, completed: 0 }); return monthlyMap.get(month); };
  intakeIssues.forEach((issue) => {
    if (issue.created) ensureMonth(String(issue.created).slice(0, 7)).created += 1;
    const completedAt = issue.resolutionDate || (issue.done ? issue.statusSince : '');
    if (completedAt) ensureMonth(String(completedAt).slice(0, 7)).completed += 1;
  });
  const businessSummary = {
    total: intakeIssues.length, open: activeIntakeIssues.length, done: intakeIssues.length - activeIntakeIssues.length,
    withoutAssignee: intakeIssues.filter((issue) => !issue.assigneeKey).length,
    withoutComponent: intakeIssues.filter((issue) => !issue.components.length).length,
    withTechnicalLinks: intakeIssues.filter((issue) => issue.linkedTechnicalKeys.length > 0).length,
    linkedTechnicalCount: new Set(intakeIssues.flatMap((issue) => issue.linkedTechnicalKeys)).size,
    withStatusAge: activeIntakeIssues.filter((issue) => issue.statusAgeDays !== null).length,
    resolutionDateCoverage: intakeIssues.filter((issue) => Boolean(issue.resolutionDate)).length,
  };
  const business = {
    summary: businessSummary, issues: intakeIssues,
    statuses: groupCounts(intakeIssues, (issue) => issue.status || '—'),
    components: Array.from(intakeComponents.values()).map((item) => ({ ...item, assigneeCount: item.assignees.size, assignees: undefined, doneRate: item.total ? item.done / item.total : null }))
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)),
    assignees: Array.from(intakeAssignees.values()).map((item) => ({ ...item, components: Array.from(item.components).sort() }))
      .sort((a, b) => b.open - a.open || b.total - a.total || a.name.localeCompare(b.name)),
    componentAssignees: Array.from(componentAssignees.values()).sort((a, b) => a.component.localeCompare(b.component) || b.open - a.open || a.name.localeCompare(b.name)),
    agingBuckets, monthly: Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    ageMethod: 'Issue age is measured from creation to the current date; it is not an SLA or time in status.',
  };
  return {
    summary: { ...metrics.summary, warningCount, businessIssueCount: businessSummary.total, openBusinessIssues: businessSummary.open,
      businessIssuesWithTechnicalLinks: businessSummary.withTechnicalLinks,
      openActions: metrics.issues.filter((issue) => commitmentProjects.has(issue.project) && !issue.isDoneByScope.commitment).length,
      openRequests: activeIntakeIssues.length, decisions: records.filter((record) => record.kind === 'decision').length,
      outcomes: records.filter((record) => record.kind === 'outcome').length },
    teams: Array.from(new Set(metrics.sprintMetrics.map((metric) => metric.team))).sort((a, b) => a.localeCompare(b)),
    projects: metrics.summary.projectCounts.map((row) => row.project), sprintMetrics: sprints, people,
    issues: filteredIssues.map(({ raw, ...issue }) => issue), issueTotal: filteredIssues.length, epics, records, links, business,
    jiraIssueLinks, localIssueLinks, quality: { ...quality, findings: quality.findings.slice(0, 1000) },
    importRuns: importRuns.map((run) => ({ id: run.id, startedAt: run.started_at, finishedAt: run.finished_at,
      issuesAdded: run.issues_added, issuesUpdated: run.issues_updated, duplicates: run.duplicates, conflicts: run.conflicts,
      skipped: run.skipped, sprintsAdded: run.sprints_added, sprintsUpdated: run.sprints_updated, files: safeJson(run.files_json, []) })).slice(-30).reverse(),
  };
}

// Metric results contain large object graphs: each relation points back to its
// full issue (including Jira's entire changelog), and each sprint/person metric
// repeats those relations in `rows`. Persist only the values publicSnapshot
// needs so JSON cache writes stay bounded without changing calculated output.
function compactMetricsForCache(metrics, config = {}) {
  const coverageFields = new Set([
    'assignee', 'components', 'issuelinks', 'priority', 'resolutiondate',
    ...(config.fieldMappings || []).map((binding) => binding.providerFieldId),
  ]);
  const compactRaw = (raw) => {
    if (!raw) return raw;
    const fields = raw.fields || {};
    const compactFields = {};
    Object.keys(fields).forEach((key) => {
      if (coverageFields.has(key)) compactFields[key] = fields[key];
      else compactFields[key] = true;
    });
    const changelog = raw.changelog;
    if (!changelog) return { fields: compactFields };
    const histories = Array.isArray(changelog.histories) ? changelog.histories : [];
    const historyComplete = changelog.historyComplete !== undefined
      ? Boolean(changelog.historyComplete)
      : Array.isArray(changelog.histories)
        && changelog.total !== null && changelog.total !== undefined
        && Number.isFinite(Number(changelog.total))
        && Number(changelog.total) <= histories.length + Number(changelog.startAt || 0);
    const statusHistories = [];
    histories.forEach((history) => {
      const items = (history.items || []).filter((item) => String(item.field || '').toLowerCase() === 'status'
        || (config.fieldMappings || []).some((binding) => String(item.fieldId || item.field || '') === String(binding.providerFieldId)
          || String(item.field || '').toLowerCase() === String(binding.providerFieldName || '').toLowerCase()))
        .map((item) => ({ field: item.field, fieldId: item.fieldId, from: item.from, fromString: item.fromString, to: item.to, toString: item.toString }));
      if (items.length) statusHistories.push({ created: history.created || '', items });
    });
    return { fields: compactFields, changelog: { historyComplete, histories: statusHistories } };
  };
  const compactRelation = (relation) => ({
    team: relation.team,
    teamId: relation.teamId,
    teamPath: relation.teamPath,
    teamAttributionSource: relation.teamAttributionSource,
    issue: { key: relation.issue?.key },
    sprint: {
      id: relation.sprint?.id,
      name: relation.sprint?.name,
      state: relation.sprint?.state,
      activatedDate: relation.sprint?.activatedDate,
      startDate: relation.sprint?.startDate,
      completeDate: relation.sprint?.completeDate,
      endDate: relation.sprint?.endDate,
    },
    loggedSeconds: relation.loggedSeconds,
    completed: relation.completed,
    storyPointsAtEnd: relation.storyPointsAtEnd,
  });
  const compactGroup = (group) => {
    const { rows: _rows, sprint: _sprint, ...values } = group;
    return values;
  };
  return {
    summary: metrics.summary,
    issues: metrics.issues.map((issue) => ({ ...issue, raw: compactRaw(issue.raw) })),
    sprints: metrics.sprints.map((sprint) => ({
      id: sprint.id, name: sprint.name, state: sprint.state,
      startDate: sprint.startDate, endDate: sprint.endDate,
      teamRoute: sprint.teamRoute, teamRouteId: sprint.teamRouteId, teamRoutePath: sprint.teamRoutePath,
      plannedWorkingDays: sprint.plannedWorkingDays,
    })),
    sprintMetrics: metrics.sprintMetrics.map(compactGroup),
    personMetrics: metrics.personMetrics.map(compactGroup),
    relations: metrics.relations.map(compactRelation),
    epics: metrics.epics.map((epic) => ({
      key: epic.key, summary: epic.summary, epicName: epic.epicName,
      project: epic.project, status: epic.status, assignee: epic.assignee,
      childrenCount: epic.childrenCount, childrenDone: epic.childrenDone,
      childStoryPoints: epic.childStoryPoints, technicalProjects: epic.technicalProjects,
      teamGroups: epic.teamGroups || [],
      childKeys: epic.childKeys,
    })),
    quality: metrics.quality,
  };
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

module.exports = { calculateMetrics, compactMetricsForCache, publicSnapshot, parseIds, issueEvents };
