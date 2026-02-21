import { ACTION_COLORS } from "../../scan/shared";

type ActionFilterChipsProps = {
  options: Array<{ name: string; count: number }>;
  activeTools: Set<string> | "all";
  onToggle: (name: string) => void;
  totalCount: number;
  filteredCount: number;
};

export const ActionFilterChips = ({
  options,
  activeTools,
  onToggle,
  totalCount,
  filteredCount,
}: ActionFilterChipsProps) => (
  <div className="action-filter-chips">
    <div className="action-filter-chips-row">
      <button
        className={`action-filter-chip preset${activeTools === "all" ? " active" : ""}`}
        style={{ "--chip-color": "#8e8e93" } as React.CSSProperties}
        onClick={() => onToggle("all")}
        aria-label="Show all tools"
      >
        All
      </button>
      <span className="action-filter-divider" />
      {options.map(({ name, count }) => {
        const active = activeTools === "all" || activeTools.has(name);
        return (
          <button
            key={name}
            className={`action-filter-chip${active ? " active" : ""}`}
            style={{
              "--chip-color": ACTION_COLORS[name] || "#8e8e93",
            } as React.CSSProperties}
            onClick={() => onToggle(name)}
            aria-label={`Toggle ${name}`}
          >
            <span
              className="action-filter-chip-dot"
              style={{ background: ACTION_COLORS[name] || "#8e8e93" }}
            />
            {name} ({count})
          </button>
        );
      })}
    </div>
    {activeTools !== "all" && (
      <span className="action-filter-chips-count">
        {filteredCount} / {totalCount}
      </span>
    )}
  </div>
);
