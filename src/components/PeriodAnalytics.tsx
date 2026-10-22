import { useEffect, useMemo, useState } from 'react';
import type { Snapshot } from '../types';
import { AnalyticChart } from './Analytics';
import { DataTable, MetricCard, MultiSelect, SectionHeading, formatNumber } from './Primitives';

type PeriodReport={created:number;completed:number;completedWithoutResolution:number;previousCreated:number|null;previousCompleted:number|null;monthly:Array<{month:string;created:number;completed:number}>};
const emptyReport:PeriodReport={created:0,completed:0,completedWithoutResolution:0,previousCreated:null,previousCompleted:null,monthly:[]};

// Calendar-period flow uses actual Jira creation/resolution dates, independently of sprint membership.
export default function PeriodAnalytics({ snapshot }: { snapshot: Snapshot }) {
  const [from,setFrom]=useState(''); const [to,setTo]=useState(''); const [projects,setProjects]=useState<string[]>([]);
  const [report,setReport]=useState<PeriodReport>(emptyReport); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const valid=!from||!to||from<=to;
  const previous=useMemo(()=>{
    if(!from||!to||!valid)return null;
    const duration=Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`)+86400000;
    return {from:new Date(Date.parse(`${from}T00:00:00Z`)-duration).toISOString().slice(0,10),to:new Date(Date.parse(`${from}T00:00:00Z`)-86400000).toISOString().slice(0,10)};
  },[from,to,valid]);

  useEffect(()=>{
    if(!valid){setReport(emptyReport);return;}
    let active=true; setLoading(true); setError('');
    const timer=setTimeout(()=>{
      window.axiloom.getCalendarPeriodReport({projects,from,to,previousFrom:previous?.from||'',previousTo:previous?.to||''})
        .then((value)=>{if(active)setReport(value);})
        .catch((e)=>{if(active)setError(e instanceof Error?e.message:'گزارش دوره‌ای از SQLite خوانده نشد.');})
        .finally(()=>{if(active)setLoading(false);});
    },200);
    return()=>{active=false;clearTimeout(timer);};
  },[projects,from,to,previous,valid,snapshot.summary.issueCount,snapshot.summary.lastIssueUpdate]);

  const months=report.monthly;
  return <section className="panel"><SectionHeading title="نمای کلی و مقایسهٔ دوره‌های زمانی" hint="تعداد تسک یکتا بر اساس تاریخ واقعی ایجاد و حل Jira؛ مستقل از دامنهٔ اسپرینت. وضعیت تکمیل، وضعیت فعلی تسک است." />
    <div className="table-tools"><MultiSelect label="پروژه‌ها" value={projects} onChange={setProjects} options={snapshot.projects.map((value)=>({value,label:value}))}/><label>از تاریخ<input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/></label><label>تا تاریخ<input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/></label>{loading&&<span className="muted-copy">در حال خواندن گزارش دوره‌ای…</span>}</div>
    {!valid&&<p className="form-error">تاریخ پایان باید پس از تاریخ شروع باشد.</p>}{error&&<p className="form-error" role="alert">{error}</p>}
    <div className="metric-grid four"><MetricCard label="ایجاد در دوره" value={formatNumber(report.created,0)} hint={previous?`دورهٔ قبل: ${formatNumber(report.previousCreated,0)}`:'برای مقایسه با دورهٔ قبل، هر دو تاریخ را انتخاب کنید.'}/><MetricCard label="حل و تکمیل در دوره" value={formatNumber(report.completed,0)} tone="teal" hint={previous?`دورهٔ قبل: ${formatNumber(report.previousCompleted,0)}`:'نیازمند تاریخ حل و وضعیت تکمیل فعلی'}/><MetricCard label="اختلاف ورود و تکمیل" value={formatNumber(report.created-report.completed,0)} tone="amber" hint="تغییر خالص جریان دوره؛ معادل تعداد عقب‌ماندگی نیست"/><MetricCard label="تکمیل بدون تاریخ حل" value={formatNumber(report.completedWithoutResolution,0)} tone="red" hint="از تحلیل تکمیل دوره کنار گذاشته شده‌اند؛ کل دامنهٔ پروژه‌های انتخاب‌شده"/></div>
    {previous&&<p className="analytics-method">دورهٔ مقایسهٔ هم‌اندازه: {previous.from} تا {previous.to}. ماه‌های فاقد هرگونه رویداد در نمودار نمایش داده نمی‌شوند.</p>}
    <AnalyticChart title="جریان ماهانه ایجاد و تکمیل" points={months.map((row)=>row.month)} series={[{name:'ایجاد',values:months.map((row)=>row.created)},{name:'حل و تکمیل',values:months.map((row)=>row.completed)}]}/>
    <DataTable headers={['ماه','ایجاد','حل و تکمیل','اختلاف']} rows={months.map((row)=>[row.month,row.created,row.completed,row.created-row.completed])}/>
  </section>;
}
