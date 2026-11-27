import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { TABS, type TabId } from '@life/shared';
import {
  angleDelta,
  angleOf,
  fadeOf,
  mod,
  posToReveal,
  settleTarget,
  slotOf,
  STEP_DEG,
} from '../lib/spin';
import { useReducedMotion } from '../lib/useMotion';

const LABEL: Record<TabId, string> = {
  today: 'Today',
  plan: 'Plan',
  train: 'Train',
  fuel: 'Fuel',
  sleep: 'Sleep',
  home: 'Home',
  inbox: 'Inbox',
  chat: 'Chat',
  connect: 'Connect',
  settings: 'You',
};

const ICON: Record<TabId, ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </>
  ),
  plan: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  train: <path d="M6 8v8M3 10v4M18 8v8M21 10v4M6 12h12" />,
  fuel: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 0-6 1-9z" />,
  sleep: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  home: <path d="M4 11l8-7 8 7v9H4zM10 20v-6h4v6" />,
  inbox: <path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5" />,
  chat: <path d="M4 5h16v11H9l-5 4zM8 9h8M8 12h5" />,
  connect: <path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0zM12 16v5" />,
  settings: <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />,
};

/** Dial geometry in px, measured from the bottom-right screen corner. */
const RADIUS = 176;
const DOT = 52;
const SIZE = 240; // square box anchored at the corner, large enough for the arc and its dots
const N = TABS.length;

export function RadialNav({ active, onSelect }: { active: TabId; onSelect: (t: TabId) => void }) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [pos, setPosState] = useState(0);
  const posRef = useRef(0);
  const raf = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const dragged = useRef(false);

  const setPos = useCallback((p: number) => {
    posRef.current = p;
    setPosState(p);
  }, []);

  const animateTo = useCallback(
    (target: number) => {
      cancelAnimationFrame(raf.current);
      if (reduced) return setPos(target);
      let last = performance.now();
      const tick = (t: number) => {
        const dt = Math.min(50, t - last);
        last = t;
        const next = posRef.current + (target - posRef.current) * (1 - Math.exp(-dt / 85));
        if (Math.abs(target - next) < 0.002) return setPos(target);
        setPos(next);
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    },
    [reduced, setPos],
  );

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) hub.current?.focus();
  }, []);

  // On open, line the dial up so the current page sits just inside the window.
  useEffect(() => {
    if (!open) return;
    cancelAnimationFrame(raf.current);
    setPos(TABS.indexOf(active) - 1);
    requestAnimationFrame(() => items.current[TABS.indexOf(active)]?.focus());
    // Only re-seed when the menu opens, not when `active` changes underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Keyboard: arrows turn the dial and move focus; Escape closes.
  useEffect(() => {
    if (!open) return;
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
      const cur = Math.max(
        0,
        items.current.findIndex((el) => el === document.activeElement),
      );
      const next = mod(cur + dir, N);
      animateTo(posToReveal(next, posRef.current, N));
      items.current[next]?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close, animateTo]);

  // Mouse wheel / trackpad turns the dial one item at a time. Listens on the document while
  // open (the scrim covers the page), so it works wherever the pointer is.
  useEffect(() => {
    if (!open) return;
    let lock = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = performance.now();
      if (now - lock < 140) return;
      lock = now;
      animateTo(Math.round(posRef.current) + (e.deltaY + e.deltaX > 0 ? 1 : -1));
    };
    document.addEventListener('wheel', onWheel, { passive: false });
    return () => document.removeEventListener('wheel', onWheel);
  }, [open, animateTo]);

  // Drag / swipe around the corner. Window listeners (not pointer capture) keep dot clicks working.
  const onPointerDown = (e: React.PointerEvent) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cx = box.right;
    const cy = box.bottom;
    const angle = (x: number, y: number) => (Math.atan2(cy - y, cx - x) * 180) / Math.PI;
    const start = { x: e.clientX, y: e.clientY };
    let lastAngle = angle(start.x, start.y);
    let lastT = performance.now();
    let velocity = 0;
    dragged.current = false;
    cancelAnimationFrame(raf.current);

    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) dragged.current = true;
      if (!dragged.current || Math.hypot(cx - ev.clientX, cy - ev.clientY) < 24) return;
      const a = angle(ev.clientX, ev.clientY);
      const dPos = -angleDelta(lastAngle, a) / STEP_DEG; // moving up the arc brings later items round
      const t = performance.now();
      velocity = 0.7 * velocity + 0.3 * (dPos / Math.max(1, t - lastT));
      lastAngle = a;
      lastT = t;
      setPos(posRef.current + dPos);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (dragged.current) {
        animateTo(settleTarget(posRef.current, performance.now() - lastT > 80 ? 0 : velocity));
        setTimeout(() => (dragged.current = false), 60); // swallow the click that follows a drag
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const pick = (t: TabId) => {
    if (dragged.current) return;
    onSelect(t);
    close();
  };

  const layout = useMemo(
    () =>
      TABS.map((_, i) => {
        const slot = slotOf(i, pos, N);
        const a = (angleOf(slot) * Math.PI) / 180;
        // Labels sit just outside the ring, pushed out along the radius far enough to clear the dot.
        const d = DOT / 2 + 8 + 17 * Math.abs(Math.cos(a)) + 7 * Math.abs(Math.sin(a));
        return {
          x: RADIUS * Math.cos(a),
          y: RADIUS * Math.sin(a),
          lx: -d * Math.cos(a),
          ly: -d * Math.sin(a),
          fade: fadeOf(slot),
        };
      }),
    [pos],
  );

  const arc = `M${SIZE - RADIUS} ${SIZE} A${RADIUS} ${RADIUS} 0 0 1 ${SIZE} ${SIZE - RADIUS}`;

  return (
    <>
      <div
        aria-hidden="true"
        className="radial-scrim"
        data-open={open}
        onClick={() => close(false)}
      />
      <div className="radial" data-open={open} style={{ width: SIZE, height: SIZE }}>
        <div
          ref={wrap}
          className="radial-dial"
          role="menu"
          aria-label="Pages. Swipe around the corner to see more."
          onPointerDown={onPointerDown}
        >
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="radial-track" aria-hidden="true">
            <path d={arc} />
          </svg>
          {TABS.map((tab, i) => {
            const l = layout[i]!;
            const on = tab === active;
            return (
              <button
                key={tab}
                ref={(el) => {
                  items.current[i] = el;
                }}
                type="button"
                role="menuitem"
                aria-current={on ? 'page' : undefined}
                tabIndex={open && on ? 0 : -1}
                className="radial-dot"
                data-active={on}
                data-hidden={l.fade < 0.05}
                style={{
                  opacity: l.fade,
                  transform: `translate(${-(l.x - DOT / 2)}px, ${-(l.y - DOT / 2)}px) scale(${0.6 + 0.4 * l.fade})`,
                  width: DOT,
                  height: DOT,
                }}
                onClick={() => pick(tab)}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                  {ICON[tab]}
                </svg>
                <span
                  className="radial-label"
                  style={{
                    left: `calc(50% + ${l.lx.toFixed(1)}px)`,
                    top: `calc(50% + ${l.ly.toFixed(1)}px)`,
                  }}
                >
                  {LABEL[tab]}
                </span>
              </button>
            );
          })}
        </div>
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
