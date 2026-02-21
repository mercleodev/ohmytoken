export const LegendDot = ({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) => (
  <div className="legend-dot-item">
    <span className="legend-dot" style={{ background: color }} />
    <span className="legend-label">{label}</span>
    <span className="legend-value">{value}</span>
  </div>
);
