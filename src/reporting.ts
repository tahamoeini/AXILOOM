import type { ReportScope, ReportScopeInput, Snapshot } from './types';

function safeCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : null;
}

function displayFilterValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') return value.trim();
  return '';
}

function labelFor(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function createReportScope(snapshot: Snapshot, input: ReportScopeInput): ReportScope {
  const warningCount = snapshot.quality.findings
    .filter((finding) => finding.severity === 'warning')
    .reduce((total, finding) => total + Math.max(0, Number(finding.count) || 0), 0);
  const infoCount = snapshot.quality.findings
    .filter((finding) => finding.severity !== 'warning')
    .reduce((total, finding) => total + Math.max(0, Number(finding.count) || 0), 0);
  const filters = (Object.entries(input.filters || {}) as Array<[string, unknown]>).flatMap(([key, value]) => {
    const display = displayFilterValue(value);
    return display ? [{ label: input.filterLabels?.[key] || labelFor(key), value: display.slice(0, 500) }] : [];
  });
  return {
    view: String(input.view || 'Report').trim().slice(0, 120),
    semantics: input.semantics || 'view-specific',
    filters,
    primaryRowCount: safeCount(input.primaryRowCount),
    matchingRowCount: safeCount(input.matchingRowCount),
    quality: {
      scope: 'workspace',
      warningCount,
      infoCount,
      incompleteHistories: Math.max(0, Number(snapshot.quality.incompleteHistories) || 0),
      conflicts: Math.max(0, Number(snapshot.quality.conflicts) || 0),
    },
    notes: Array.from(new Set((input.notes || []).map((note) => String(note).trim()).filter(Boolean))).slice(0, 30),
  };
}
