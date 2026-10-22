const REPORT_SCOPE_SEMANTICS = new Set(['report-wide', 'active-tab', 'view-specific', 'unspecified']);

function cleanText(value, limit = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
}

function safeCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : null;
}

function normalizeReportScope(scope, report) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return { view: cleanText(report?.title || 'Report', 120), semantics: 'unspecified', filters: [], primaryRowCount: null,
      matchingRowCount: null, quality: { scope: 'not-provided', warningCount: null, infoCount: null, incompleteHistories: null, conflicts: null }, notes: [] };
  }
  const filters = Array.isArray(scope.filters) ? scope.filters.slice(0, 40).flatMap((filter) => {
    if (!filter || typeof filter !== 'object') return [];
    const label = cleanText(filter.label, 120);
    const value = cleanText(filter.value, 500);
    return label && value ? [{ label, value }] : [];
  }) : [];
  const quality = scope.quality && typeof scope.quality === 'object' ? scope.quality : {};
  const notes = Array.isArray(scope.notes) ? Array.from(new Set(scope.notes.map((note) => cleanText(note, 500)).filter(Boolean))).slice(0, 30) : [];
  return {
    view: cleanText(scope.view || report?.title || 'Report', 120),
    semantics: REPORT_SCOPE_SEMANTICS.has(scope.semantics) ? scope.semantics : 'unspecified',
    filters,
    primaryRowCount: safeCount(scope.primaryRowCount),
    matchingRowCount: safeCount(scope.matchingRowCount),
    quality: {
      scope: quality.scope === 'workspace' ? 'workspace' : 'not-provided',
      warningCount: safeCount(quality.warningCount),
      infoCount: safeCount(quality.infoCount),
      incompleteHistories: safeCount(quality.incompleteHistories),
      conflicts: safeCount(quality.conflicts),
    },
    notes,
  };
}

function buildReportContextRows(report, runtime) {
  const scope = normalizeReportScope(report?.scope, report);
  const rows = [
    ['Field', 'Value'],
    ['Workspace', cleanText(runtime.workspaceName, 240)],
    ['Organization profile', cleanText(runtime.organizationName, 240)],
    ['Source provider', cleanText(runtime.sourceProvider, 80)],
    ['Source instance ID', cleanText(runtime.sourceId, 160)],
    ['Configuration revision', safeCount(runtime.configurationRevision)],
    ['Report engine fingerprint', cleanText(runtime.engineFingerprint, 80)],
    ['Axiloom version', cleanText(runtime.appVersion, 80)],
    ['Locale', cleanText(runtime.locale, 80)],
    ['Time zone', cleanText(runtime.timeZone, 120)],
    ['Generated at (UTC)', cleanText(runtime.generatedAt || new Date().toISOString(), 80)],
    ['View', scope.view],
    ['Filter semantics', scope.semantics],
    ['Primary rows included', scope.primaryRowCount],
    ['Matching rows', scope.matchingRowCount],
    ['Data quality scope', scope.quality.scope],
    ['Workspace warning count', scope.quality.warningCount],
    ['Workspace information finding count', scope.quality.infoCount],
    ['Incomplete histories', scope.quality.incompleteHistories],
    ['Import conflicts', scope.quality.conflicts],
  ];
  if (scope.filters.length) rows.push([], ['Active filters', 'Value'], ...scope.filters.map((filter) => [filter.label, filter.value]));
  if (scope.notes.length) rows.push([], ['Quality and interpretation notes'], ...scope.notes.map((note) => [note]));
  if (scope.semantics === 'unspecified') rows.push([], ['Filter details were not supplied by this report view.']);
  return rows;
}

function attachReportContext(report, runtime) {
  const inputSheets = Array.isArray(report?.sheets) ? report.sheets : [];
  const sheets = inputSheets.filter((sheet) => cleanText(sheet?.name, 31).toLowerCase() !== 'report context').slice(0, 29);
  return { ...report, sheets: [{ name: 'Report Context', rows: buildReportContextRows(report, runtime) }, ...sheets] };
}

module.exports = { attachReportContext, buildReportContextRows, normalizeReportScope };
