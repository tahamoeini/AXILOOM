import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Check, ExternalLink, Link2, Pencil, Plus, X } from 'lucide-react';
import type { ProductRecord, ProductRelationship, ProductRelationshipKind, RecordFieldTemplate, RecordKind, RecordTemplate } from '../types';
import { formatDate } from './Primitives';

const RELATIONSHIP_OPTIONS: Array<{ value: ProductRelationshipKind; label: string }> = [
  { value: 'related_to', label: 'Related to' }, { value: 'supports', label: 'Supports' },
  { value: 'implements', label: 'Implements' }, { value: 'depends_on', label: 'Depends on' },
  { value: 'decides', label: 'Decides' }, { value: 'delivers', label: 'Delivers' },
  { value: 'measures', label: 'Measures' }, { value: 'supersedes', label: 'Supersedes' },
  { value: 'informs', label: 'Informs' },
];
const ORIGIN_OPTIONS: Array<{ value: ProductRelationship['sourceOrigin']; label: string }> = [
  { value: 'manual', label: 'Manually recorded' }, { value: 'meeting', label: 'Meeting record' },
  { value: 'decision-log', label: 'Decision log' }, { value: 'imported-document', label: 'Imported document' },
  { value: 'jira', label: 'Jira evidence' }, { value: 'other', label: 'Other source' },
];
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

function localInputValue(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function storedValue(field: RecordFieldTemplate, value: string): unknown {
  if (field.type === 'date' && value) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : value;
  }
  if (field.type === 'number' && value !== '') return Number(value);
  if (field.type === 'boolean') return value === 'true';
  return value;
}

function fieldInitialValue(field: RecordFieldTemplate, source: Record<string, unknown>) {
  const value = source[field.key];
  if (field.type === 'issueRefList') return Array.isArray(value) ? value.map(String).join(', ') : '';
  if (field.type === 'date') return localInputValue(value);
  if (field.type === 'boolean') return value === true ? 'true' : value === false ? 'false' : '';
  return String(value ?? '');
}

function relatedToRecord(relationship: ProductRelationship, recordId: string) {
  return (relationship.sourceType === 'record' && relationship.sourceId === recordId)
    || (relationship.targetType === 'record' && relationship.targetId === recordId);
}

export default function RecordEditor({ kind, template, record, jiraUrl, close, save, recordOptions = [], relationships = [], onSaveRelationship, onArchiveRelationship }: {
  kind: RecordKind;
  template?: RecordTemplate;
  record?: ProductRecord;
  jiraUrl: string;
  close: () => void;
  save: (kind: RecordKind, title: string, payload: Record<string, unknown>, id?: string) => Promise<void>;
  recordOptions?: ProductRecord[];
  relationships?: ProductRelationship[];
  onSaveRelationship?: (input: Parameters<typeof window.axiloom.saveRecordRelationship>[0]) => Promise<void>;
  onArchiveRelationship?: (relationship: ProductRelationship) => Promise<void>;
}) {
  const fields = template?.fields || [];
  const titleLabel = template?.label || kind;
  const [title, setTitle] = useState(record?.title || '');
  const [values, setValues] = useState<Record<string, string>>(() => {
    const source = record?.payload || {};
    return Object.fromEntries(fields.map((field) => [field.key, fieldInitialValue(field, source)]));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [targetType, setTargetType] = useState<'record' | 'issue'>('record');
  const [targetId, setTargetId] = useState('');
  const [linkKind, setLinkKind] = useState<ProductRelationshipKind>('related_to');
  const [evidence, setEvidence] = useState('');
  const [sourceOrigin, setSourceOrigin] = useState<ProductRelationship['sourceOrigin']>('manual');
  const [sourceReference, setSourceReference] = useState('');
  const [attributedTo, setAttributedTo] = useState('');
  const [editingRelationship, setEditingRelationship] = useState<ProductRelationship | null>(null);
  const [savingRelationship, setSavingRelationship] = useState(false);
  const [recordLookupQuery, setRecordLookupQuery] = useState('');
  const [recordLookupRecords, setRecordLookupRecords] = useState<ProductRecord[]>([]);
  const [selectedRecordOptions, setSelectedRecordOptions] = useState<ProductRecord[]>([]);
  const availableRecordOptions = useMemo(() => {
    const byId = new Map<string, ProductRecord>();
    [...recordOptions, ...recordLookupRecords, ...selectedRecordOptions, ...(record ? [record] : [])].forEach((item) => byId.set(item.id, item));
    return Array.from(byId.values());
  }, [recordOptions, recordLookupRecords, selectedRecordOptions, record]);
  const activeRelationships = useMemo(() => record ? relationships.filter((item) => relatedToRecord(item, record.id)) : [], [relationships, record]);
  const suggestions = useMemo(() => {
    if (!record) return [];
    const currentPair = (type: 'record' | 'issue', id: string) => relationships.some((item) =>
      (item.sourceType === 'record' && item.sourceId === record.id && item.targetType === type && item.targetId === id)
      || (item.targetType === 'record' && item.targetId === record.id && item.sourceType === type && item.sourceId === id));
    const items: Array<{ type: 'record' | 'issue'; id: string; label: string; field: string }> = [];
    fields.forEach((field) => {
      const value = record.payload[field.key];
      const values = field.type === 'issueRefList' && Array.isArray(value) ? value.map(String) : [String(value || '')];
      values.forEach((id) => {
        if (!id || currentPair(field.type === 'issueRef' || field.type === 'issueRefList' ? 'issue' : 'record', id)) return;
        if (field.type === 'recordRef' && availableRecordOptions.some((option) => option.id === id)) {
          items.push({ type: 'record', id, label: availableRecordOptions.find((option) => option.id === id)?.title || id, field: field.label });
        } else if ((field.type === 'issueRef' || field.type === 'issueRefList') && ISSUE_KEY.test(id.toUpperCase())) {
          items.push({ type: 'issue', id: id.toUpperCase(), label: id.toUpperCase(), field: field.label });
        }
      });
    });
    return items.filter((item, index) => items.findIndex((candidate) => candidate.type === item.type && candidate.id === item.id) === index);
  }, [fields, record, availableRecordOptions, relationships]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      window.axiloom.listRecords({ query: recordLookupQuery, limit: 50, includeHistory: false })
        .then((result) => { if (active) setRecordLookupRecords(result.items); })
        .catch(() => { if (active) setRecordLookupRecords([]); });
    }, recordLookupQuery ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [recordLookupQuery]);

  const selectedReferenceIds = Array.from(new Set([
    ...fields.filter((field) => field.type === 'recordRef').map((field) => String(values[field.key] || '')),
    ...(targetType === 'record' ? [targetId] : []),
  ].filter(Boolean)));
  useEffect(() => {
    let active = true;
    if (!selectedReferenceIds.length) { setSelectedRecordOptions([]); return () => { active = false; }; }
    window.axiloom.listRecords({ ids: selectedReferenceIds, limit: Math.min(250, selectedReferenceIds.length), includeHistory: false })
      .then((result) => { if (active) setSelectedRecordOptions(result.items); })
      .catch(() => { if (active) setSelectedRecordOptions([]); });
    return () => { active = false; };
  }, [selectedReferenceIds.join('|')]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving && !savingRelationship) close(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [saving, savingRelationship, close]);

  function update(key: string, value: string) { setValues((current) => ({ ...current, [key]: value })); }

  async function openInJira(issueKey: string) {
    setError('');
    try { await window.axiloom.openJiraIssue(issueKey); }
    catch (openError) { setError(openError instanceof Error ? openError.message : `Could not open ${issueKey} in Jira.`); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const missing = fields.find((field) => field.required && !values[field.key]?.trim());
    if (!title.trim()) { setError('Enter a title.'); return; }
    if (missing) { setError(`«${missing.label}» is required.`); return; }
    const payload: Record<string, unknown> = { ...(record?.payload || {}) };
    for (const field of fields) {
      const value = values[field.key] || '';
      if (field.type === 'issueRef') {
        const issueKey = value.trim().toUpperCase();
        if (issueKey && !ISSUE_KEY.test(issueKey)) { setError(`Use a Jira issue key such as PROJECT-123 in «${field.label}».`); return; }
        payload[field.key] = issueKey;
      } else if (field.type === 'issueRefList') {
        const tokens = value.split(/[,،\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean);
        const invalid = tokens.find((item) => !ISSUE_KEY.test(item));
        if (invalid) { setError(`«${field.label}» contains an invalid Jira issue key: ${invalid}.`); return; }
        payload[field.key] = Array.from(new Set(tokens));
      } else if (field.type === 'enum' && value && !field.options.includes(value)) {
        setError(`Choose a configured value for «${field.label}».`); return;
      } else if (field.type === 'recordRef' && value && !availableRecordOptions.some((item) => item.id === value && (field.referenceKinds || []).includes(item.kind))) {
        setError(`Choose an active record of the configured type for «${field.label}».`); return;
      } else payload[field.key] = storedValue(field, value);
    }
    if (kind === 'outcome' && values.status === 'Achieved' && (!values.ownerName || !values.metric || !values.target || !values.actual || !values.evidence)) {
      payload.verificationState = 'Unverified claim';
    }
    setSaving(true);
    try { await save(kind, title.trim(), payload, record?.id); close(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Record could not be saved.'); }
    finally { setSaving(false); }
  }

  function selectSuggestion(suggestion: { type: 'record' | 'issue'; id: string }) {
    setEditingRelationship(null);
    setTargetType(suggestion.type);
    setTargetId(suggestion.id);
    setLinkKind('related_to');
    setEvidence('');
    setSourceOrigin('manual');
    setSourceReference('');
    setAttributedTo('');
  }

  async function submitRelationship(event: FormEvent) {
    event.preventDefault();
    if (!record || !onSaveRelationship) return;
    setError('');
    if (!targetId.trim()) { setError('Choose a record or enter an existing Jira issue key.'); return; }
    if (targetType === 'issue' && !ISSUE_KEY.test(targetId.trim().toUpperCase())) { setError('Use a Jira issue key such as PROJECT-123.'); return; }
    if (!evidence.trim()) { setError('Add evidence for this relationship.'); return; }
    setSavingRelationship(true);
    try {
      const existing = editingRelationship;
      await onSaveRelationship({
        ...(existing ? { id: existing.id, sourceType: existing.sourceType, sourceId: existing.sourceId, targetType: existing.targetType, targetId: existing.targetId } : {
          sourceType: 'record', sourceId: record.id, targetType, targetId: targetType === 'issue' ? targetId.trim().toUpperCase() : targetId,
        }),
        relationship: linkKind, evidence: evidence.trim(), sourceOrigin,
        sourceReference: sourceReference.trim(), attributedTo: attributedTo.trim(),
      });
      setEditingRelationship(null); setTargetId(''); setEvidence(''); setSourceReference(''); setAttributedTo('');
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Relationship could not be saved.'); }
    finally { setSavingRelationship(false); }
  }

  function editRelationship(item: ProductRelationship) {
    setEditingRelationship(item);
    setLinkKind(item.relationship);
    setEvidence(item.evidence);
    setSourceOrigin(item.sourceOrigin);
    setSourceReference(item.sourceReference);
    setAttributedTo(item.attributedTo);
    const other = item.sourceType === 'record' && item.sourceId === record?.id
      ? { type: item.targetType, id: item.targetId }
      : { type: item.sourceType, id: item.sourceId };
    setTargetType(other.type);
    setTargetId(other.id);
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !savingRelationship) close(); }}>
    <section className="record-modal" role="dialog" aria-modal="true" aria-label={`${record ? 'Edit' : 'Create'} ${titleLabel}`}>
      <div className="modal-heading"><div><span className="eyebrow">Local workspace · {titleLabel}</span><h2>{record ? 'Edit record' : `Create ${titleLabel}`}</h2></div><button className="icon-button" onClick={close} disabled={saving || savingRelationship} aria-label="Close"><X size={18} /></button></div>
      {record && <div className="record-jira-links" aria-label="Linked Jira issues"><span>Jira</span>{Array.from(new Set([record.payload.primaryIssueKey, ...(Array.isArray(record.payload.relatedIssueKeys) ? record.payload.relatedIssueKeys : [])].map((value) => String(value || '').trim().toUpperCase()).filter((value) => ISSUE_KEY.test(value)))).map((key) => <button type="button" key={key} className="button tiny secondary jira-record-link" onClick={() => void openInJira(key)} disabled={!jiraUrl} title={jiraUrl ? `Open ${key} in Jira` : 'Configure a Jira URL in Settings first'}><ExternalLink size={12} /><b dir="ltr">{key}</b></button>)}</div>}
      {!template && <div className="form-error">This record type has no active typed template in the workspace configuration.</div>}
      <form onSubmit={submit}>
        <label className="form-field full"><span>Title <i>Required</i></span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Write a short, traceable title" /></label>
        <label className="form-field full"><span>Search active records for references and relationships</span><input value={recordLookupQuery} onChange={(event) => setRecordLookupQuery(event.target.value)} placeholder="Type a record title or ID" /></label>
        <div className="form-grid">{fields.map((field) => {
          const referenceOptions = availableRecordOptions.filter((item) => item.id !== record?.id && (field.referenceKinds || []).includes(item.kind));
          return <label className={`form-field ${field.type === 'textarea' || field.type === 'issueRefList' ? 'full' : ''}`} key={field.key}><span>{field.label}{field.required && <i>Required</i>}</span>
            {field.type === 'recordRef' ? <select value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)}><option value="">No record selected</option>{values[field.key] && !referenceOptions.some((option) => option.id === values[field.key]) && <option value={values[field.key]}>Stored legacy reference · {values[field.key]}</option>}{referenceOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select>
              : field.type === 'enum' ? <select value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)}><option value="">Choose a configured value</option>{values[field.key] && !field.options.includes(values[field.key]) && <option value={values[field.key]}>Stored legacy value · {values[field.key]}</option>}{field.options.map((option) => <option key={option}>{option}</option>)}</select>
                : field.type === 'textarea' || field.type === 'issueRefList' ? <textarea value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} rows={3} placeholder={field.type === 'issueRefList' ? 'Comma-separated keys, for example ALPHA-12, BETA-8' : ''} />
                  : field.type === 'boolean' ? <select value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>
                    : <input type={field.type === 'date' ? 'datetime-local' : field.type === 'number' ? 'number' : 'text'} value={values[field.key] || ''} onChange={(event) => update(field.key, event.target.value)} />}
          </label>;
        })}</div>
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions"><span>Record changes are kept in local history.</span><button type="button" className="button secondary" onClick={close} disabled={saving || savingRelationship}>Cancel</button><button className="button primary" disabled={saving || !template}><Check size={16} />{saving ? 'Saving…' : 'Save record'}</button></div>
      </form>

      {record && <section className="record-relationships">
        <div className="record-relationships-heading"><div><h3><Link2 size={15} /> Audited relationships</h3><p>Links require a target, evidence, and source origin. Similarity and legacy field references remain suggestions only.</p></div></div>
        {suggestions.length > 0 && <div className="relationship-suggestions"><b>Legacy reference suggestions</b><small>These references were already stored on the record; they are not yet audited relationships.</small>{suggestions.map((suggestion) => <button type="button" key={`${suggestion.type}:${suggestion.id}`} onClick={() => selectSuggestion(suggestion)}><Plus size={13} /> {suggestion.field}: {suggestion.label}</button>)}</div>}
        <div className="relationship-list">{activeRelationships.length ? activeRelationships.map((item) => <article className="relationship-card" key={item.id}>
          <div className="relationship-card-title"><b>{item.sourceLabel} <span>→</span> {item.targetLabel}</b><span className="relationship-type">{item.relationship.replaceAll('_', ' ')}</span></div>
          <p>{item.evidence}</p><small>Origin: {item.sourceOrigin}{item.sourceReference ? ` · Reference: ${item.sourceReference}` : ''} · Attributed to: {item.attributedTo || 'not captured'} · {formatDate(item.createdAt)}</small>
          <div className="relationship-actions"><button type="button" className="row-action" onClick={() => editRelationship(item)}><Pencil size={13} /> Edit provenance</button><button type="button" className="row-action archive" onClick={() => void onArchiveRelationship?.(item)}><Archive size={13} /> Archive</button></div>
          {item.history?.length ? <details><summary>Relationship history · {item.history.length}</summary><ol>{item.history.map((event, index) => <li key={`${item.id}-${event.occurredAt}-${index}`}>{event.eventType} · {formatDate(event.occurredAt)}<pre>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol></details> : null}
        </article>) : <p className="relationship-empty">No audited relationships have been recorded yet.</p>}</div>
        {onSaveRelationship && <form className="relationship-form" onSubmit={submitRelationship}>
          <h4>{editingRelationship ? 'Edit relationship provenance' : 'Add an explicit relationship'}</h4>
          {editingRelationship ? <div className="relationship-target-readonly">{editingRelationship.sourceLabel} → {editingRelationship.targetLabel}</div> : <>
            <label className="form-field"><span>Target type</span><select value={targetType} onChange={(event) => { setTargetType(event.target.value as 'record' | 'issue'); setTargetId(''); }}><option value="record">Local record</option><option value="issue">Existing Jira issue</option></select></label>
            {targetType === 'record' ? <label className="form-field"><span>Target record</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">Choose a record</option>{availableRecordOptions.filter((item) => item.id !== record.id).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.kind}</option>)}</select></label>
              : <label className="form-field"><span>Jira issue key</span><input value={targetId} onChange={(event) => setTargetId(event.target.value.toUpperCase())} placeholder="PROJECT-123" dir="ltr" />{!jiraUrl && <small>Issue existence is checked against the imported workspace evidence.</small>}</label>}
          </>}
          <div className="form-grid"><label className="form-field"><span>Relationship type</span><select value={linkKind} onChange={(event) => setLinkKind(event.target.value as ProductRelationshipKind)}>{RELATIONSHIP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="form-field"><span>Source origin</span><select value={sourceOrigin} onChange={(event) => setSourceOrigin(event.target.value as ProductRelationship['sourceOrigin'])}>{ORIGIN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="form-field full"><span>Evidence <i>Required</i></span><textarea rows={2} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="What source supports this link?" /></label>
            <label className="form-field"><span>Source reference</span><input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="Meeting ID, Jira key, or document reference" /></label>
            <label className="form-field"><span>Attribution <small>Optional; no login identity is assumed</small></span><input value={attributedTo} onChange={(event) => setAttributedTo(event.target.value)} placeholder="Person who confirmed the link" /></label>
          </div>
          <div className="relationship-form-actions"><button type="button" className="button secondary" onClick={() => { setEditingRelationship(null); setEvidence(''); setSourceReference(''); setAttributedTo(''); setTargetId(''); }}>Clear</button><button className="button primary" disabled={savingRelationship}><Check size={14} />{savingRelationship ? 'Saving…' : editingRelationship ? 'Update provenance' : 'Save relationship'}</button></div>
        </form>}
      </section>}
      {record?.history?.length ? <details className="record-history"><summary>Record history · {record.history.length} recent events</summary><ol>{record.history.map((event, index) => <li key={`${event.occurredAt}-${index}`}><div><b>{event.eventType}</b><time>{formatDate(event.occurredAt)}</time></div><details><summary>Recorded details</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></li>)}</ol></details> : null}
    </section>
  </div>;
}
