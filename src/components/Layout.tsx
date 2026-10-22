import { formatNumber } from './Primitives';
import type { ComponentType, ReactNode } from 'react';
import { ArrowUpLeft, Database, LockKeyhole, Search } from 'lucide-react';
import type { PageId, Snapshot } from '../types';

interface NavItem { id: PageId; label: string; group: string; icon: ComponentType<{ size?: number }> }

export default function Layout({ navigation, page, setPage, title, actions, summary, loading, direction, children }: {
  navigation: NavItem[];
  page: PageId;
  setPage: (page: PageId) => void;
  title: string;
  actions: ReactNode;
  summary: Snapshot['summary'];
  loading: boolean;
  direction: 'ltr' | 'rtl';
  children: ReactNode;
}) {
  const groups = Array.from(new Set(navigation.map((item) => item.group)));
  return (
    <div className="app-shell" dir={direction}>
      <aside className="sidebar">
        <button className="brand" onClick={() => setPage('overview')}>
          <span className="brand-mark"><span /><span /><span /></span>
          <span><b>Axiloom</b><small>گزارش و پیگیری محصول</small></span>
        </button>
        <div className="sidebar-label">فضای کاری</div>
        <div className="side-groups">
          {groups.map((group) => (
            <section className="nav-group" key={group}>
              <div className="nav-group-label">{group}</div>
              {navigation.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
                  <Icon size={17} /><span>{item.label}</span>
                  {item.id === 'quality' && summary.warningCount > 0 && <i className="nav-count">{formatNumber(summary.warningCount, 0)}</i>}
                  {item.id === 'actions' && summary.openActions > 0 && <i className="nav-count muted">{formatNumber(summary.openActions, 0)}</i>}
                  {page === item.id && <ArrowUpLeft className="nav-current" size={14} />}
                </button>;
              })}
            </section>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="workspace-state"><span className="state-icon"><Database size={16} /></span><span><b>فضای محلی</b><small>ذخیره روی همین رایانه</small></span><i /></div>
          <div className="privacy-note"><LockKeyhole size={14} /><span>گزارش‌ها محلی می‌مانند؛ اتصال فقط با اقدام شما انجام می‌شود.</span></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Axiloom</span><b>/</b><strong>{title}</strong></div>
          <div className="topbar-right">
            <div className="local-pill"><span className="status-dot" /> آفلاین / محلی</div>
            <div className="header-actions">{actions}</div>
          </div>
        </header>
        <div className="page-wrap">
          {!loading && <div className="page-intro"><div><p className="eyebrow">فضای کاری محصول</p><h1>{title}</h1></div><div className="intro-meta"><span><Database size={14} /> {formatNumber(summary.issueCount, 0)} پرونده</span><button className="icon-button search-shortcut" title="جست‌وجوی Jira" onClick={() => setPage('portfolio')}><Search size={16} /></button></div></div>}
          {children}
        </div>
        <footer className="app-footer"><span>Axiloom · فضای محلی</span><span>تغییرات Jira با تأیید شما ثبت می‌شوند <i /> اطلاعات شما داخل این workspace ذخیره می‌شود</span></footer>
      </main>
    </div>
  );
}
