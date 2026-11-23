import { useMemo } from "react";
import { NIGERIA_STATES } from "../nigeria-states";

// Nigeria map with callout boxes and leader lines (Overview + Distribution
// Network designs). Fills come from the caller; callouts sit outside the
// country and are nudged apart so they never overlap.

export type Callout = { state: string; lines: string[]; color: string; strong?: boolean; pin?: boolean };
export type Arrow = { from: string; to: string; color: string };

const VIEW = { x: -170, y: -30, w: 1340, h: 880 };
const CENTER = { x: 500, y: 430 };
const mapName = (state: string) => (state === "FCT Abuja" ? "FCT" : state);
const byName = new Map(NIGERIA_STATES.map((s) => [s.name, s]));

export function IntelMap({ fills, callouts, arrows = [], onSelect, label }: {
  fills: Record<string, string>; callouts: Callout[]; arrows?: Arrow[]; onSelect?: (state: string) => void; label: string;
}) {
  const boxes = useMemo(() => {
    const placed: Array<{ c: Callout; x: number; y: number; w: number; h: number; ax: number; ay: number }> = [];
    for (const c of callouts) {
      const s = byName.get(mapName(c.state));
      if (!s) continue;
      const w = Math.max(...c.lines.map((l, i) => l.length * (i === 0 ? 17 : 15.5))) + 34;
      const h = 22 + c.lines.length * 31;
      let dx = s.cx - CENTER.x, dy = s.cy - CENTER.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const reach = c.strong ? 120 : 230;
      const baseX = s.cx + dx * reach - w / 2, baseY = s.cy + dy * reach - h / 2;
      const clampX = (v: number) => Math.min(VIEW.x + VIEW.w - w - 8, Math.max(VIEW.x + 8, v));
      const clampY = (v: number) => Math.min(VIEW.y + VIEW.h - h - 8, Math.max(VIEW.y + 8, v));
      const free = (cx: number, cy: number) => !placed.some((p) => cx < p.x + p.w + 10 && cx + w + 10 > p.x && cy < p.y + p.h + 10 && cy + h + 10 > p.y);
      // Try the natural spot, then step up/down, then sideways, until a free one.
      let x = clampX(baseX), y = clampY(baseY);
      search: for (let ring = 0; ring < 6; ring += 1) {
        for (let step = 0; step < 8; step += 1) {
          const cy = clampY(baseY + (step % 2 ? -1 : 1) * Math.ceil(step / 2) * (h + 12));
          const cx = clampX(baseX + (dx >= 0 ? 1 : -1) * ring * (w + 12) * (ring % 2 ? 1 : -0.5));
          if (free(cx, cy)) { x = cx; y = cy; break search; }
        }
      }
      placed.push({ c, x, y, w, h, ax: s.cx, ay: s.cy });
    }
    return placed;
  }, [callouts]);

  return (
    <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} className="h-auto w-full" role="img" aria-label={label}>
      <defs>
        {arrows.map((a, i) => <marker key={i} id={`ah-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={a.color} /></marker>)}
      </defs>
      {NIGERIA_STATES.map((s) => {
        const key = s.name === "FCT" ? "FCT Abuja" : s.name;
        return (
          <path key={s.name} d={s.d} fill={fills[key] ?? "#e9eef5"} stroke="#ffffff" strokeWidth={1.6}
            className={onSelect ? "cursor-pointer transition-opacity hover:opacity-80" : ""} onClick={() => onSelect?.(key)}>
            <title>{s.name === "FCT" ? "Abuja" : s.name}</title>
          </path>
        );
      })}
      {arrows.map((a, i) => {
        const f = byName.get(mapName(a.from)), t = byName.get(mapName(a.to));
        if (!f || !t) return null;
        const mx = (f.cx + t.cx) / 2, my = (f.cy + t.cy) / 2 - 40;
        return <path key={`a${i}`} d={`M${f.cx},${f.cy} Q${mx},${my} ${t.cx},${t.cy}`} fill="none" stroke={a.color} strokeWidth={4} markerEnd={`url(#ah-${i})`} opacity={0.85} pointerEvents="none" />;
      })}
      {boxes.map(({ c, x, y, w, h, ax, ay }) => {
        const bx = Math.min(Math.max(ax, x), x + w), by = Math.min(Math.max(ay, y), y + h);
        return (
          <g key={c.state} pointerEvents="none">
            <line x1={ax} y1={ay} x2={bx} y2={by} stroke={c.color} strokeWidth={2.5} />
            <circle cx={ax} cy={ay} r={c.pin ? 13 : 9} fill={c.color} stroke="#fff" strokeWidth={3} />
            <rect x={x} y={y} width={w} height={h} rx={14} fill={c.strong ? c.color : "#ffffff"} stroke={c.color} strokeWidth={3} />
            {c.lines.map((line, i) => (
              <text key={i} x={x + w / 2} y={y + 36 + i * 31} textAnchor="middle" fontSize={i === 0 ? 26 : 23} fontWeight={i === 0 ? 800 : i === c.lines.length - 1 && !c.strong ? 700 : 600}
                fill={c.strong ? "#ffffff" : i === c.lines.length - 1 && c.lines.length > 2 ? c.color : "#0f172a"}>{line}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
