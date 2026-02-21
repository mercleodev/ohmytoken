export const StatPill = ({ label, value }: { label: string; value: string }) => (
  <div className="stat-pill">
    <span className="stat-pill-value">{value}</span>
    <span className="stat-pill-label">{label}</span>
  </div>
);
