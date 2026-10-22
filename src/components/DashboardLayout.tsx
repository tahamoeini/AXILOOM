import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';

type Width = 1 | 2 | 3;
type Height = 1 | 2;
type Widget = { id: string; title: string; content: ReactNode };
type Placement = { width: Width; height: Height };

/** User-controlled dashboard grid. Layout choices persist locally per page. */
export default function DashboardLayout({ storageKey, widgets }: { storageKey: string; widgets: Widget[] }) {
  const [order, setOrder] = useState<string[]>(widgets.map((widget) => widget.id));
  const [placements, setPlacements] = useState<Record<string, Placement>>({});
  const [dragging, setDragging] = useState('');
  const available = useMemo(() => new Set(widgets.map((widget) => widget.id)), [widgets]);
  const widgetIds = widgets.map((widget) => widget.id).join('|');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`axiloom:dashboard:${storageKey}`) || '{}');
      const savedOrder = Array.isArray(saved.order) ? saved.order.filter((id: string) => available.has(id)) : [];
      setOrder([...savedOrder, ...widgets.map((widget) => widget.id).filter((id) => !savedOrder.includes(id))]);
      const next: Record<string, Placement> = {};
      for (const [id, value] of Object.entries(saved.placements || {}) as Array<[string, any]>) {
        if (available.has(id)) next[id] = { width: [1, 2, 3].includes(value?.width) ? value.width : 3, height: value?.height === 2 ? 2 : 1 };
      }
      setPlacements(next);
    } catch { setOrder(widgets.map((widget) => widget.id)); }
  // Depend on the stable widget id list, since page callers build widget arrays inline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, widgetIds]);

  useEffect(() => {
    try { localStorage.setItem(`axiloom:dashboard:${storageKey}`, JSON.stringify({ order, placements })); } catch { /* Layout preferences are optional. */ }
  }, [storageKey, order, placements]);

  const move = (id: string, delta: number) => setOrder((current) => {
    const index = current.indexOf(id); const target = Math.max(0, Math.min(current.length - 1, index + delta));
    if (index < 0 || index === target) return current;
    const next = [...current]; next.splice(index, 1); next.splice(target, 0, id); return next;
  });
  const sorted = [...widgets].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return <div className="custom-dashboard-grid">
    {sorted.map((widget, index) => {
      const placement = placements[widget.id] || { width: 3 as Width, height: 1 as Height };
      return <div key={widget.id} className={`custom-dashboard-widget span-${placement.width} height-${placement.height}`} draggable
        onDragStart={() => setDragging(widget.id)} onDragEnd={() => setDragging('')}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); if (dragging && dragging !== widget.id) { setOrder((current) => { const next = [...current]; const from = next.indexOf(dragging); const to = next.indexOf(widget.id); if (from >= 0 && to >= 0) { next.splice(from, 1); next.splice(to, 0, dragging); } return next; }); } setDragging(''); }}>
        <div className="dashboard-widget-toolbar" title="برای جابه‌جایی، این بخش را بکشید">
          <span className="dashboard-widget-grip"><GripVertical size={15} />{widget.title}</span>
          <label>عرض<select aria-label={`عرض ${widget.title}`} value={placement.width} onChange={(event) => setPlacements((current) => ({ ...current, [widget.id]: { ...placement, width: Number(event.target.value) as Width } }))}><option value={1}>⅓</option><option value={2}>⅔</option><option value={3}>۳/۳</option></select></label>
          <label>ارتفاع<select aria-label={`ارتفاع ${widget.title}`} value={placement.height} onChange={(event) => setPlacements((current) => ({ ...current, [widget.id]: { ...placement, height: Number(event.target.value) as Height } }))}><option value={1}>½</option><option value={2}>۲/۲</option></select></label>
          <button type="button" className="icon-button" disabled={index === 0} aria-label={`انتقال ${widget.title} به بالا`} onClick={() => move(widget.id, -1)}><ArrowUp size={14} /></button>
          <button type="button" className="icon-button" disabled={index === sorted.length - 1} aria-label={`انتقال ${widget.title} به پایین`} onClick={() => move(widget.id, 1)}><ArrowDown size={14} /></button>
        </div>
        <div className="dashboard-widget-content">{widget.content}</div>
      </div>;
    })}
  </div>;
}
