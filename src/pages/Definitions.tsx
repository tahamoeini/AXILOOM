import { useState } from 'react';
import { ChevronDown, CircleHelp, Gauge, GitBranch, TimerReset } from 'lucide-react';
import definitionData from '../data/metric-definitions.json';
import { formatNumber } from '../components/Primitives';

type Definition = {
  group: string;
  sourceCategory: string;
  title: string;
  formula: string;
  unit: string;
  interpretation: string;
  caveat: string;
  source: string;
};

const DEFINITIONS = definitionData as Definition[];

export default function Definitions() {
  const [group, setGroup] = useState('همه');
  const [query, setQuery] = useState('');
  const groups = ['همه', ...Array.from(new Set(DEFINITIONS.map((item) => item.group)))];
  const rows = DEFINITIONS.filter((item) => (group === 'همه' || item.group === group) && (!query || Object.values(item).join(' ').toLowerCase().includes(query.toLowerCase())));
  return <>
    <div className="callout info"><CircleHelp size={16} /><span>تعریف شاخص‌های تحویل، ظرفیت، جریان و کیفیت داده به زبان فارسی در دسترس است. فرمول، واحد، تفسیر، محدودیت و منبع هر شاخص در همین صفحه آمده است.</span></div>
    <div className="metric-grid four definition-intro">
      <div className="definition-intro-card"><Gauge size={18} /><b>تحویل Sprint</b><span>تعهد، دامنه، تکمیل، انتقال و پیش‌بینی</span></div>
      <div className="definition-intro-card"><TimerReset size={18} /><b>زمان و تخمین</b><span>چرخه، زمان تحویل، ظرفیت و محدودیت برآورد ساعت</span></div>
      <div className="definition-intro-card"><GitBranch size={18} /><b>روابط صریح</b><span>اپیک محصول، درخواست، کار فنی و خروجی</span></div>
      <div className="definition-intro-card"><CircleHelp size={18} /><b>کیفیت و پوشش</b><span>فیلد ناقص، مقدار ناموجود، تعارض و عمق شواهد</span></div>
    </div>
    <section className="definition-toolbar"><div><span className="eyebrow">{formatNumber(DEFINITIONS.length, 0)} تعریف و قاعده</span><h2>فرمول هر شاخص</h2></div><input aria-label="جست‌وجوی تعاریف" placeholder="جست‌وجو در عنوان، فرمول و توضیحات" value={query} onChange={(e) => setQuery(e.target.value)} /><select value={group} onChange={(event) => setGroup(event.target.value)}>{groups.map((item) => <option key={item}>{item}</option>)}</select></section>
    <div className="definition-list">{rows.map((item, index) => <article className="definition-card" key={`${item.sourceCategory}-${item.title}-${index}`}><div className="definition-card-title"><span className="definition-dot" /><div><small>{item.group}</small><h3>{item.title}</h3></div><ChevronDown size={16} /></div><div className="definition-body">
      <p><b>فرمول / قاعده</b>{item.formula || 'تعریف نشده'}</p>
      <p><b>واحد</b>{item.unit || '—'}</p>
      <p><b>تفسیر</b>{item.interpretation || '—'}</p>
      <p className="definition-caveat"><b>محدودیت</b>{item.caveat || '—'}</p>
      <p className="definition-source"><b>منبع</b>{item.source || '—'}</p>
    </div></article>)}</div>
  </>;
}
