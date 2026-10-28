import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clearLog, downloadLog, formatEntry, logText, toggleLog, useLog } from '../log/sessionLog';
import { toast } from '../model/store';

/** Bottom drawer listing the session log. Lines are plain selectable text: drag to select, Ctrl+C to copy. */
export function LogPanel() {
  const open = useLog((s) => s.open);
  const entries = useLog((s) => s.entries);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? entries.filter((e) => formatEntry(e).toLowerCase().includes(f)) : entries;
  }, [entries, filter]);

  // follow new lines only while scrolled to the end, so reading back isn't interrupted
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown, open]);
  useEffect(() => {
    if (open) atBottom.current = true;
  }, [open]);

  if (!open) return null;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${what}`);
    } catch {
      toast('Copy failed: select the lines and press Ctrl+C');
    }
  };
  const selectAll = () => {
    const el = listRef.current;
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  return (
    <div
      className="log-panel"
      // keep tool shortcuts (V, C, B, Delete…) from firing while reading or selecting here
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === '`') return;
        if (e.ctrlKey && e.key.toLowerCase() === 'a' && e.target === listRef.current) {
          e.preventDefault();
          selectAll();
        }
        e.stopPropagation();
      }}
    >
      <div className="log-head">
        <b>Session log</b>
        <span className="muted">{filter ? `${shown.length} of ${entries.length}` : entries.length} lines</span>
        <input type="text" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button onClick={() => copy(logText(shown), filter ? 'filtered lines' : 'log')} title="Copy every shown line">Copy all</button>
        <button onClick={downloadLog} title="Save the whole log as a .txt file">Save…</button>
        <button className="danger" onClick={() => confirm('Clear the session log?') && clearLog()}>Clear</button>
        <button onClick={toggleLog} title="Close (`)">✕</button>
      </div>
      <div
        ref={listRef}
        className="log-list"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        }}
      >
        {shown.map((e, i) => (
          <div key={i} className={'log-line ' + e.level}>
            {formatEntry(e)}
          </div>
        ))}
        {!shown.length && <div className="muted">{entries.length ? 'No lines match the filter.' : 'Nothing logged yet.'}</div>}
      </div>
    </div>
  );
}
