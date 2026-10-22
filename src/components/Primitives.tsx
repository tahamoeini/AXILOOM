import { isValidElement, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownLeft, ArrowUpLeft, Minus } from 'lucide-react';

let displayLocale = 'en-US';
let displayTimeZone = 'UTC';
export function setDisplayPreferences(locale: string, timeZone: string) {
  displayLocale = locale || 'en-US';
  displayTimeZone = timeZone || 'UTC';
}

export function MetricCard({ label, value, hint, tone = 'blue', icon }: { label: string; value: ReactNode; hint?: string; tone?: 'blue' | 'teal' | 'amber' | 'red' | 'purple'; icon?: ReactNode }) {
  return <article className={`metric-card ${tone}`}><div className="metric-card-top"><span>{label}</span>{icon && <i>{icon}</i>}</div><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

export function SectionHeading({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{action}</div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-mark"><i /><i /><i /></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = String(value || '').toLocaleLowerCase();
  const tone = ['done', 'review', 'بسته', 'انجام‌شده', 'اجراشده'].includes(normalized) ? 'green'
    : ['blocked', 'متوقف', 'مسدود'].includes(normalized) ? 'red'
      : ['in progress', 'در حال انجام', 'فعال'].includes(normalized) ? 'blue'
        : ['waiting', 'منتظر', 'pending'].includes(normalized) ? 'amber' : 'gray';
  return <span className={`status-badge ${tone}`}>{value || 'نامشخص'}</span>;
}

export function IssueKey({ value, onOpen }: { value: string; onOpen: (key: string) => void }) {
  if (!value) return <>—</>;
  return <button type="button" className="issue-key-ref" dir="ltr" onClick={() => onOpen(value)}>{value}</button>;
}

export function Trend({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="trend neutral"><Minus size={12} /> بدون سابقه</span>;
  const Icon = value >= 0 ? ArrowUpLeft : ArrowDownLeft;
  return <span className={`trend ${value >= 0 ? 'positive' : 'negative'}`}><Icon size={12} /> {new Intl.NumberFormat(displayLocale, { maximumFractionDigits: 0 }).format(Math.abs(value * 100))}%</span>;
}

export function formatPercent(value: number | null | undefined, decimals = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(displayLocale, { style: 'percent', maximumFractionDigits: decimals }).format(value);
}

export function formatNumber(value: number | null | undefined, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString(displayLocale, { maximumFractionDigits: decimals });
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString(displayLocale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: dateOnly ? 'UTC' : displayTimeZone });
}

export function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleTimeString(displayLocale, { hour: '2-digit', minute: '2-digit', timeZone: displayTimeZone });
}

function searchableText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(searchableText).join(' ');
  if (isValidElement<{ children?: ReactNode; value?: unknown; title?: string; 'aria-label'?: string }>(node)) {
    return [searchableText(node.props.children), typeof node.props.value === 'string' || typeof node.props.value === 'number' ? String(node.props.value) : '', node.props.title || '', node.props['aria-label'] || ''].filter(Boolean).join(' ');
  }
  return '';
}
const normalizedText = (value: string) => value.toLocaleLowerCase(displayLocale).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));

export function MultiSelect({ label, options, value, onChange, showSelectionChips = false }: { label: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (value: string[]) => void; showSelectionChips?: boolean }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleOptions = useMemo(() => options.filter((option) => normalizedText(option.label).includes(normalizedText(search))), [options, search]);
  const visibleValues = visibleOptions.map((option) => option.value);
  const allVisibleSelected = visibleValues.length > 0 && visibleValues.every((item) => value.includes(item));
  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const trigger = summaryRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 250), Math.max(180, viewportWidth - 24));
      const maxHeight = Math.min(360, Math.max(160, viewportHeight - 24));
      const height = Math.min(menu.scrollHeight, maxHeight);
      const spaceBelow = viewportHeight - rect.bottom - 8;
      const openAbove = spaceBelow < height && rect.top > height + 8;
      const right = Math.min(Math.max(viewportWidth - rect.right, 12), Math.max(12, viewportWidth - width - 12));
      const top = openAbove ? Math.max(12, rect.top - height - 6) : Math.min(rect.bottom + 6, Math.max(12, viewportHeight - height - 12));
      setMenuStyle({ position: 'fixed', zIndex: 1000, width, maxHeight, right, top, visibility: 'visible' });
    };
    updatePosition();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (detailsRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      if (detailsRef.current) detailsRef.current.open = false;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (detailsRef.current) detailsRef.current.open = false;
      setOpen(false);
      summaryRef.current?.focus();
    };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, search, visibleOptions.length]);
  const menu = <div ref={menuRef} className={`multi-select-menu${detailsRef.current?.closest('.column-filters') ? ' is-column-filter' : ''}`} style={menuStyle}>
    <input aria-label={`جست‌وجوی ${label}`} placeholder="جست‌وجوی گزینه‌ها" value={search} onChange={(e) => setSearch(e.target.value)} />
    <div className="multi-select-actions"><button type="button" className="row-action" onClick={() => onChange(allVisibleSelected ? value.filter((item) => !visibleValues.includes(item)) : [...new Set([...value, ...visibleValues])])}>{allVisibleSelected ? 'برداشتن انتخاب‌های پیدا شده' : 'انتخاب همهٔ پیدا شده‌ها'}</button><button type="button" className="row-action" onClick={() => onChange([])}>پاک‌کردن انتخاب</button></div>
    <div className="multi-select-options" role="group" aria-label={label}>{visibleOptions.map((option) => <label key={option.value}><input type="checkbox" checked={value.includes(option.value)} onChange={(e) => onChange(e.target.checked ? [...new Set([...value, option.value])] : value.filter((item) => item !== option.value))} />{option.label || 'خالی'}</label>)}{!visibleOptions.length && <span className="multi-select-empty">گزینه‌ای پیدا نشد.</span>}</div>
  </div>;
  return <><details ref={detailsRef} className="multi-select" onToggle={(event) => setOpen(event.currentTarget.open)}><summary ref={summaryRef}>{label} · {value.length ? formatNumber(value.length, 0) + ' انتخاب' : 'همه'}</summary></details>{open && createPortal(menu, document.body)}{showSelectionChips && value.length > 0 && <div className="multi-select-chips" aria-label={`انتخاب‌های ${label}`}>{value.map((item) => <button key={item} type="button" className="multi-select-chip" onClick={() => onChange(value.filter((selected) => selected !== item))} aria-label={`حذف ${options.find((option) => option.value === item)?.label || item}`}><span>{options.find((option) => option.value === item)?.label || item}</span><b aria-hidden="true">×</b></button>)}</div>}</>;
}

export function DataTable({ headers, rows, empty = 'داده‌ای برای نمایش نیست.', serverPagination }: {
  headers: string[]; rows: Array<Array<ReactNode>>; empty?: string;
  serverPagination?: { offset:number; limit:number; total:number; loading?:boolean; onPageChange:(offset:number)=>void };
}) {
  const [query, setQuery] = useState(''); const [columnQueries, setColumnQueries] = useState<Record<number, string>>({});
  const [selections, setSelections] = useState<Record<number, string[]>>({}); const [page, setPage] = useState(0);
  const textRows = useMemo(() => serverPagination ? [] : rows.map((row) => row.map(searchableText)), [rows, serverPagination]);
  const headerKey = headers.join('\u0000');
  const columnOptions = useMemo(() => serverPagination ? [] : headers.map((_, index) => Array.from(new Set(textRows.map((row) => row[index] || ''))).sort().map((text) => ({ value: text, label: text || 'خالی' }))), [headerKey, textRows, serverPagination]);
  const filtered = useMemo(() => serverPagination ? [] : textRows.map((cells, index) => ({ cells, index })).filter(({ cells }) => (!query || normalizedText(cells.join(' ')).includes(normalizedText(query))) && headers.every((_, index) => (!columnQueries[index] || normalizedText(cells[index] || '').includes(normalizedText(columnQueries[index]))) && (!selections[index]?.length || selections[index].includes(cells[index] || '')))), [serverPagination, textRows, query, columnQueries, selections, headerKey]);
  const pageSize = serverPagination?.limit || 50;
  const lastPage = serverPagination ? Math.max(0, Math.ceil(serverPagination.total / pageSize) - 1) : Math.max(0, Math.ceil(filtered.length / 50) - 1);
  const currentPage = serverPagination ? Math.min(lastPage, Math.floor(serverPagination.offset / pageSize)) : Math.min(page, lastPage);
  const visibleRows = serverPagination ? rows.map((_, index) => ({ index })) : filtered.slice(currentPage * 50, (currentPage + 1) * 50).map(({ index }) => ({ index }));
  const changePage = (nextPage:number) => serverPagination ? serverPagination.onPageChange(nextPage * pageSize) : setPage(nextPage);
  return <div className="filterable-table" aria-busy={Boolean(serverPagination?.loading)}>
    {serverPagination ? <div className="table-tools"><span>{serverPagination.total ? `${formatNumber((serverPagination.offset + 1), 0)} تا ${formatNumber(Math.min(serverPagination.offset + rows.length, serverPagination.total), 0)} از ${formatNumber(serverPagination.total, 0)} ردیف` : '۰ ردیف'}</span>{serverPagination.loading && <span className="muted-copy">در حال دریافت از SQLite…</span>}</div> : <div className="table-tools"><input aria-label="جست‌وجو در تمامی ستون‌ها" placeholder="جست‌وجو در تمامی ستون‌ها" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /><span>{formatNumber(filtered.length, 0)} از {formatNumber(rows.length, 0)} ردیف</span><button className="button tiny secondary" onClick={() => { setQuery(''); setColumnQueries({}); setSelections({}); setPage(0); }}>پاک‌کردن فیلترهای جدول</button></div>}
    <div className="table-scroll"><table className="data-table"><thead><tr>{headers.map((header, index) => <th key={index}>{header}</th>)}</tr>{!serverPagination && <tr className="column-filters">{headers.map((header, index) => <th key={index}>{header && <><input aria-label={`جست‌وجوی ستون ${header}`} placeholder="جست‌وجو…" value={columnQueries[index] || ''} onChange={(e) => { setColumnQueries((current) => ({ ...current, [index]: e.target.value })); setPage(0); }} /><MultiSelect label={header} options={columnOptions[index] || []} value={selections[index] || []} onChange={(value) => { setSelections((current) => ({ ...current, [index]: value })); setPage(0); }} /></>}</th>)}</tr>}</thead><tbody>{visibleRows.map(({ index }) => <tr key={index}>{rows[index].map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
    {!visibleRows.length && <div className="table-empty">{rows.length ? 'ردیفی با این فیلترها یافت نشد.' : empty}</div>}
    {lastPage > 0 && <div className="table-tools"><button className="button tiny secondary" disabled={!currentPage || serverPagination?.loading} onClick={() => changePage(currentPage - 1)}>قبلی</button><span>صفحه {formatNumber((currentPage + 1), 0)} از {formatNumber((lastPage + 1), 0)}</span><button className="button tiny secondary" disabled={currentPage === lastPage || serverPagination?.loading} onClick={() => changePage(currentPage + 1)}>بعدی</button></div>}
  </div>;
}

export function ProgressBar({ value, tone = 'teal' }: { value: number | null | undefined; tone?: string }) {
  const percentage = value === null || value === undefined ? null : Math.max(0, Math.min(1, value));
  return <div className="progress-line"><span className={`progress-fill ${tone}`} style={{ width: `${(percentage ?? 0) * 100}%` }} />{percentage === null && <i className="progress-unknown" />}</div>;
}
