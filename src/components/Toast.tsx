import { useEffect } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

export default function Toast({ notice, dismiss }: { notice: { tone: 'success' | 'error' | 'info'; text: string }; dismiss: () => void }) {
  useEffect(() => { const timer = window.setTimeout(dismiss, 5600); return () => window.clearTimeout(timer); }, [dismiss]);
  const Icon = notice.tone === 'success' ? CheckCircle2 : notice.tone === 'error' ? XCircle : Info;
  return <div className={`toast ${notice.tone}`} role="status"><Icon size={18} /><span>{notice.text}</span><button onClick={dismiss} aria-label="بستن"><X size={16} /></button></div>;
}
