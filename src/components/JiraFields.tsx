import { useEffect, useState } from 'react';
import type { AppConfig, JiraFieldMeta } from '../types';
import { MultiSelect } from './Primitives';

const label = (option: any) => String(option?.label ?? option?.displayName ?? option?.name ?? option?.value ?? option?.key ?? option?.id ?? option);
const identity = (option: any) => String(option?.id ?? option?.accountId ?? option?.name ?? option?.key ?? option?.value ?? option);
const selectedValue = (option: any, type?: string) => {
  if (typeof option !== 'object') return option;
  if (type === 'user') return option.accountId ? { accountId: option.accountId } : { name: option.name || option.key };
  return option.id != null ? { id: String(option.id) } : option.value != null ? { value: option.value } : { name: option.name };
};
export function fieldSupported(meta: JiraFieldMeta, id = '', semanticKey = '') {
  const schema = meta.schema || {};
  if (['epicLink', 'sprint', 'timetracking'].includes(semanticKey) || id === 'parent' || /epic-link|sprint/i.test(schema.custom || '')) return true;
  if (schema.type === 'user' || schema.type === 'array' && schema.items === 'user') return true;
  if (meta.allowedValues !== undefined) return true;
  if (schema.type === 'array' && schema.items === 'string' && !/sprint/i.test(schema.custom || '')) return true;
  if (meta.autoCompleteUrl) return true;
  if (schema.custom && /select|radio|checkbox|version|project|group|sprint|epic-link/i.test(schema.custom)) return false;
  return ['string', 'number', 'date', 'datetime', 'timetracking'].includes(schema.type || '');
}
function RemoteField({ id, meta, value, onChange, issueKey, project, issueType, currentProject, semanticKey }: {
  id: string; meta: JiraFieldMeta; value: any; onChange: (value: any) => void; issueKey?: string; project?: string; issueType?: string; currentProject?: string; semanticKey?: string;
}) {
  const [query, setQuery] = useState(''); const [options, setOptions] = useState<any[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const user = meta.schema?.type === 'user' || meta.schema?.items === 'user';
  const sprint = semanticKey === 'sprint' || /sprint/i.test(meta.schema?.custom || '');
  const issue = semanticKey === 'epicLink' || id === 'parent' || /epic-link/i.test(meta.schema?.custom || '');
  const multiple = meta.schema?.type === 'array' && !sprint;
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      const result = user ? window.axiloom.getJiraUsers({ key: issueKey, project: project || currentProject, query, fieldId: id })
        : window.axiloom.getJiraFieldOptions({ key: issueKey, project: project || currentProject, issueType, fieldId: id, query });
      result.then((items) => { if (active) { setOptions(items); setError(''); } }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query, issueKey, project, issueType, user, id, currentProject]);
  let normalized = value;
  if (sprint && Array.isArray(value)) {
    const last = value.at(-1);
    const number = last?.id ?? (typeof last === 'string' ? last.match(/\bid=(\d+)/)?.[1] : last);
    normalized = number ? { id: String(number), label: typeof last === 'string' ? last.match(/\bname=([^,\]]+)/)?.[1] || String(number) : last?.name || String(number) } : null;
  }
  const selected = multiple ? Array.isArray(normalized) ? normalized : [] : normalized != null ? [normalized] : [];
  const all = Array.from(new Map([...selected, ...options].map((item: any) => [identity(item), item])).values());
  function convert(item: any) {
    if (user) return selectedValue(item, 'user');
    if (sprint) return Number(item.id);
    if (issue) return id === 'parent' ? { key: item.key || item } : item.key || item;
    return selectedValue(item);
  }
  return <><input aria-label={`جست‌وجوی ${meta.name}`} placeholder="جست‌وجو در گزینه‌های Jira" value={query} onChange={(e) => setQuery(e.target.value)} />
    {loading && <small>دریافت گزینه‌ها…</small>}
    {multiple ? <MultiSelect label={meta.name} options={all.map((item) => ({ value: identity(item), label: label(item) }))} value={selected.map(identity)} showSelectionChips onChange={(chosenIds) => onChange(chosenIds.map((selectedId) => convert(all.find((item) => identity(item) === selectedId))))} /> : <select value={normalized == null ? '' : identity(normalized)} onChange={(e) => {
      const chosen = Array.from(e.target.selectedOptions).filter((o) => o.value).map((o) => all.find((item) => identity(item) === o.value)).filter(Boolean);
      onChange(chosen.length ? convert(chosen[0]) : null);
    }} id={`jira-field-${id}`} aria-label={meta.name}><option value="">انتخاب نشده</option>{all.map((item) => <option key={identity(item)} value={identity(item)}>{label(item)}</option>)}</select>}
    {sprint && <small>اسپرینت‌های فعال و آیندهٔ بردهای تنظیم‌شده؛ مقدار جدید به‌صورت شناسهٔ عددی به Jira ارسال می‌شود.</small>}
    {error && <small className="form-error">{error}</small>}</>;
}
export default function JiraFields({ metadata, values, onChange, issueKey, project, issueType, config }: {
  metadata: Record<string, JiraFieldMeta>; values: Record<string, any>; onChange: (id: string, value: any) => void; issueKey?: string; project?: string; issueType?: string; config?: AppConfig | null;
}) {
  const editableMetadata = Object.entries(metadata).filter(([id, meta]) => !['project', 'issuetype', 'attachment', 'comment', 'issuelinks'].includes(id)
    && (!issueKey || !meta.operations || meta.operations.includes('set')));
  return <div className="form-grid">{editableMetadata.map(([id, meta]) => {
    const schema = meta.schema || {}; const value = values[id]; const multiple = schema.type === 'array';
    const allowed = meta.allowedValues || [];
    const currentProject = project || values.project?.key || '';
    const effectiveIssueType = issueType || String(values.issuetype?.id || '');
    const mappings = (config?.fieldMappings || []).filter((mapping) => mapping.providerFieldId === id && (!mapping.projectKey || mapping.projectKey === currentProject) && (!mapping.issueTypeId || mapping.issueTypeId === effectiveIssueType));
    const semanticKey = mappings.sort((a, b) => Number(Boolean(b.projectKey)) + Number(Boolean(b.issueTypeId)) - Number(Boolean(a.projectKey)) - Number(Boolean(a.issueTypeId)))[0]?.semanticKey || '';
    const supported = fieldSupported(meta, id, semanticKey);
    const currentOptions = multiple ? Array.isArray(value) ? value : [] : value != null ? [value] : [];
    const options = Array.from(new Map([...currentOptions, ...allowed].map((item) => [identity(item), item])).values());
    const cascading = /cascadingselect/i.test(schema.custom || '');
    const labels = multiple && schema.items === 'string' && semanticKey !== 'sprint';
    const remote = semanticKey === 'sprint' || semanticKey === 'epicLink' || id === 'parent' || /epic-link|sprint/i.test(schema.custom || '') || schema.type === 'user' || schema.items === 'user' || meta.autoCompleteUrl && !labels && !allowed.length;
    return <div className={`form-field ${id === 'description' ? 'full' : ''}`} key={id}><label htmlFor={`jira-field-${id}`}>{meta.name} {meta.required && <i>ضروری</i>}<small dir="ltr">{id}</small></label>
      {!supported ? <><small>نوع اختصاصی این فیلد قابل تبدیل نیست؛ مقدار فعلی حفظ می‌شود و مقدار حدسی ارسال نمی‌شود.</small><pre className="field-current">{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</pre></>
        : remote ? <RemoteField id={id} meta={meta} value={value} onChange={(v) => onChange(id, v)} issueKey={issueKey} project={project} currentProject={values.project?.key} issueType={effectiveIssueType} semanticKey={semanticKey} />
        : id === 'timetracking' || schema.type === 'timetracking' ? <div className="form-grid"><label>تخمین اولیه<input placeholder="مانند 2d 4h" value={value?.originalEstimate || ''} onChange={(e) => onChange(id, { ...(value?.remainingEstimate ? { remainingEstimate: value.remainingEstimate } : {}), originalEstimate: e.target.value })} /></label><label>زمان باقی‌مانده<input placeholder="مانند 1d 2h" value={value?.remainingEstimate || ''} onChange={(e) => onChange(id, { ...(value?.originalEstimate ? { originalEstimate: value.originalEstimate } : {}), remainingEstimate: e.target.value })} /></label></div>
        : meta.allowedValues !== undefined ? <>{multiple ? <MultiSelect label={meta.name} options={options.map((item) => ({ value: identity(item), label: label(item) }))} value={currentOptions.map(identity)} showSelectionChips onChange={(chosenIds) => onChange(id, chosenIds.map((selectedId) => selectedValue(options.find((item) => identity(item) === selectedId))))} /> : <select id={`jira-field-${id}`} value={value == null ? '' : identity(value)} onChange={(e) => {
          const chosen = Array.from(e.target.selectedOptions).filter((o) => o.value).map((o) => options.find((item) => identity(item) === o.value)).filter(Boolean);
          onChange(id, chosen.length ? selectedValue(chosen[0]) : null);
        }}><option value="">{allowed.length ? 'انتخاب کنید' : 'گزینهٔ مجازی در این زمینه موجود نیست'}</option>{options.map((item) => <option key={identity(item)} value={identity(item)}>{label(item)}</option>)}</select>}
          {cascading && <select aria-label={`زیرگزینه ${meta.name}`} value={value?.child?.id || ''} onChange={(e) => onChange(id, { ...value, child: e.target.value ? { id: e.target.value } : undefined })}><option value="">بدون زیرگزینه</option>{(allowed.find((item) => identity(item) === identity(value))?.children || []).map((child: any) => <option key={child.id} value={child.id}>{label(child)}</option>)}</select>}</>
        : labels ? <textarea id={`jira-field-${id}`} value={(value || []).join('\n')} placeholder="هر برچسب در یک خط" onChange={(e) => onChange(id, [...new Set(e.target.value.split('\n').map((item) => item.trim()).filter(Boolean))])} />
        : schema.type === 'number' ? <input id={`jira-field-${id}`} type="number" step="any" value={value ?? ''} onChange={(e) => onChange(id, e.target.value === '' ? null : Number(e.target.value))} />
        : schema.type === 'date' ? <input id={`jira-field-${id}`} type="date" value={String(value || '').slice(0, 10)} onChange={(e) => onChange(id, e.target.value || null)} />
        : schema.type === 'datetime' ? <input id={`jira-field-${id}`} type="datetime-local" value={value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => onChange(id, e.target.value ? new Date(e.target.value).toISOString().replace('Z', '+0000') : null)} />
        : id === 'description' || /textarea/i.test(schema.custom || '') ? <textarea id={`jira-field-${id}`} rows={4} value={value || ''} onChange={(e) => onChange(id, e.target.value || null)} />
        : <input id={`jira-field-${id}`} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(id, e.target.value || null)} />}
    </div>;
  })}</div>;
}
export function validateJiraValues(metadata: Record<string, JiraFieldMeta>, values: Record<string, any>, creating = false) {
  for (const [id, meta] of Object.entries(metadata)) {
    if (['project', 'issuetype', 'attachment', 'comment', 'issuelinks'].includes(id)) continue;
    if (meta.required && (creating || id in values) && !meta.hasDefaultValue && (values[id] == null || values[id] === '' || Array.isArray(values[id]) && !values[id].length)) return `فیلد «${meta.name}» ضروری است.${!fieldSupported(meta, id) ? ' این فیلد باید در Jira تکمیل شود.' : ''}`;
  }
  return '';
}
export function describeJiraValue(value: any): string {
  if (value == null || value === '') return 'خالی';
  if (Array.isArray(value)) return value.map(describeJiraValue).join('، ');
  if (typeof value === 'object' && ('originalEstimate' in value || 'remainingEstimate' in value)) return `تخمین: ${value.originalEstimate || '—'}؛ باقی‌مانده: ${value.remainingEstimate || '—'}`;
  return typeof value === 'object' ? (value.id && !value.name && !value.value && !value.displayName ? `شناسه ${value.id}` : label(value)) + (value.child ? ` / ${label(value.child)}` : '') : String(value);
}
