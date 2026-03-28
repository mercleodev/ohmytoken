import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { toLocalDateKey } from '../../utils/format';

type HeatmapDay = { date: string; count: number };

type PromptHeatmapProps = {
  provider?: string;
};

const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_RADIUS = 2;

const LEVELS = [
  'rgba(0, 0, 0, 0.05)', // 0 — no data
  '#FDBA74',             // 1 — low
  '#FB923C',             // 2 — mid
  '#F97316',             // 3 — high
  '#EA580C',             // 4 — max
];

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const getLevel = (count: number, max: number): number => {
  if (count === 0) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
};

const formatTooltipDate = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

type WeekColumn = Array<{ date: string; count: number; dayOfWeek: number }>;

const buildGrid = (data: HeatmapDay[]): { weeks: WeekColumn[]; totalPrompts: number } => {
  const map = new Map(data.map((d) => [d.date, d.count]));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Go back 365 days
  const start = new Date(today);
  start.setDate(start.getDate() - 364);

  // Align start to Sunday
  const startDow = start.getDay();
  if (startDow !== 0) {
    start.setDate(start.getDate() - startDow);
  }

  const weeks: WeekColumn[] = [];
  let currentWeek: WeekColumn = [];
  let totalPrompts = 0;

  const cursor = new Date(start);
  while (cursor <= today) {
    const key = toLocalDateKey(cursor);
    const count = map.get(key) ?? 0;
    totalPrompts += count;
    currentWeek.push({ date: key, count, dayOfWeek: cursor.getDay() });

    if (cursor.getDay() === 6) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return { weeks, totalPrompts };
};

const buildMonthLabels = (weeks: WeekColumn[]): Array<{ label: string; colIndex: number }> => {
  const labels: Array<{ label: string; colIndex: number }> = [];
  let lastMonth = -1;

  for (let i = 0; i < weeks.length; i++) {
    // Use the first day of the week
    const firstDay = weeks[i][0];
    if (!firstDay) continue;
    const month = new Date(firstDay.date + 'T00:00:00').getMonth();
    if (month !== lastMonth) {
      labels.push({ label: MONTH_NAMES[month], colIndex: i });
      lastMonth = month;
    }
  }

  return labels;
};

export const PromptHeatmap = ({ provider }: PromptHeatmapProps) => {
  const [data, setData] = useState<HeatmapDay[]>([]);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const result = await window.api.getPromptHeatmap(provider);
      setData(result);
    } catch {
      // best-effort
    }
  }, [provider]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-scroll to current date (rightmost) on load
  useEffect(() => {
    if (data.length > 0 && gridScrollRef.current) {
      gridScrollRef.current.scrollLeft = gridScrollRef.current.scrollWidth;
    }
  }, [data]);

  const { weeks, totalPrompts } = useMemo(() => buildGrid(data), [data]);
  const monthLabels = useMemo(() => buildMonthLabels(weeks), [weeks]);
  const maxCount = useMemo(() => Math.max(...data.map((d) => d.count), 1), [data]);

  const gridWidth = weeks.length * (CELL_SIZE + CELL_GAP);
  const dayLabelWidth = 28;

  const handleMouseEnter = (e: React.MouseEvent, day: { date: string; count: number }) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const container = (e.currentTarget as HTMLElement).closest('.heatmap-grid-scroll');
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    setTooltip({
      text: `${day.count} prompt${day.count !== 1 ? 's' : ''} on ${formatTooltipDate(day.date)}`,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.top - containerRect.top - 8,
    });
  };

  const handleMouseLeave = () => setTooltip(null);

  return (
    <div className="stats-section">
      <div className="heatmap-header">
        <span className="heatmap-total">{totalPrompts.toLocaleString()} prompts in the last year</span>
      </div>
      <div className="heatmap-container">
        {/* Day labels (left side) */}
        <div className="heatmap-day-labels" style={{ width: dayLabelWidth }}>
          {DAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="heatmap-day-label"
              style={{ height: CELL_SIZE + CELL_GAP, lineHeight: `${CELL_SIZE + CELL_GAP}px` }}
            >
              {label}
            </div>
          ))}
        </div>
        {/* Grid area */}
        <div ref={gridScrollRef} className="heatmap-grid-scroll" style={{ position: 'relative' }}>
          {/* Month labels */}
          <div className="heatmap-month-labels" style={{ height: 16, marginBottom: 2 }}>
            {monthLabels.map((m) => (
              <span
                key={m.colIndex}
                className="heatmap-month-label"
                style={{ left: m.colIndex * (CELL_SIZE + CELL_GAP) }}
              >
                {m.label}
              </span>
            ))}
          </div>
          {/* Cells */}
          <div className="heatmap-grid" style={{ width: gridWidth, height: 7 * (CELL_SIZE + CELL_GAP) }}>
            {weeks.map((week, wi) =>
              week.map((day) => (
                <div
                  key={day.date}
                  className="heatmap-cell"
                  style={{
                    left: wi * (CELL_SIZE + CELL_GAP),
                    top: day.dayOfWeek * (CELL_SIZE + CELL_GAP),
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                    borderRadius: CELL_RADIUS,
                    background: LEVELS[getLevel(day.count, maxCount)],
                  }}
                  onMouseEnter={(e) => handleMouseEnter(e, day)}
                  onMouseLeave={handleMouseLeave}
                />
              )),
            )}
          </div>
          {/* Tooltip */}
          {tooltip && (
            <div
              className="stats-tooltip heatmap-tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              {tooltip.text}
            </div>
          )}
        </div>
      </div>
      {/* Legend */}
      <div className="heatmap-legend">
        <span className="heatmap-legend-label">Less</span>
        {LEVELS.map((color, i) => (
          <div
            key={i}
            className="heatmap-legend-cell"
            style={{ background: color, width: CELL_SIZE, height: CELL_SIZE, borderRadius: CELL_RADIUS }}
          />
        ))}
        <span className="heatmap-legend-label">More</span>
      </div>
    </div>
  );
};
