import { useEffect, useMemo, useRef, useState } from 'react';
import { TABS, type TabId } from '@life/shared';
import { wheelSectors } from '../lib/wheel';

const LABEL: Record<TabId, string> = {
  today: 'Today',
  plan: 'Plan',
  train: 'Train',
  fuel: 'Fuel',
  sleep: 'Sleep',
  home: 'Home',
  inbox: 'Inbox',
};

/**
 * One quarter-disc button in the bottom-right corner. Pressing it fans a
 * quarter-circle wheel out to the screen edges, one wedge per page.
 */
export function RadialNav({ active, onSelect }: { active: TabId; onSelect: (t: TabId) => void }) {
  const [open, setOpen] = useState(false);
  const sectors = useMemo(() => wheelSectors(TABS.length), []);
  const hub = useRef<HTMLButtonElement>(null);
  const items = useRef<(SVGGElement | null)[]>([]);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) hub.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items.current[TABS.indexOf(active)]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close();
      const dir =
        e.key === 'ArrowDown' || e.key === 'ArrowLeft'
          ? 1
          : e.key === 'ArrowUp' || e.key === 'ArrowRight'
            ? -1
            : 0;
      if (!dir) return;
      e.preventDefault();
      const cur = items.current.findIndex((el) => el === document.activeElement);
      const next = (cur + dir + TABS.length) % TABS.length;
      items.current[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, active]);

  const pick = (t: TabId) => {
    onSelect(t);
    close();
  };

  return (
    <>
      <div
        aria-hidden="true"
        className="radial-scrim"
        data-open={open}
        onClick={() => close(false)}
      />
      <div className="radial" data-open={open}>
        <svg viewBox="0 0 300 300" className="radial-wheel" role="menu" aria-label="Pages">
          {sectors.map((s, i) => {
            const tab = TABS[i]!;
            const on = tab === active;
            return (
              <g
                key={tab}
                ref={(el) => {
                  items.current[i] = el;
                }}
                role="menuitem"
                aria-current={on ? 'page' : undefined}
                tabIndex={open ? (on ? 0 : -1) : -1}
                className="radial-item"
                data-active={on}
                style={{ transitionDelay: open ? `${60 + i * 28}ms` : '0ms' }}
                onClick={() => pick(tab)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(tab);
                  }
                }}
              >
                <path d={s.path} />
                <text
                  x={s.label.x}
                  y={s.label.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${s.angle.toFixed(1)} ${s.label.x.toFixed(1)} ${s.label.y.toFixed(1)})`}
                >
                  {LABEL[tab]}
                </text>
              </g>
            );
          })}
        </svg>
        <button
          ref={hub}
          type="button"
          className="radial-hub"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={open ? 'Close page menu' : `Open page menu, current page ${LABEL[active]}`}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            {open ? (
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            ) : (
              <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
              </g>
            )}
          </svg>
        </button>
      </div>
    </>
  );
}
