export const TokenRow = ({
  label,
  value,
}: {
  label: string;
  value: number;
}) => (
  <div className="token-row">
    <span className="token-row-label">{label}</span>
    <span className="token-row-value">{value.toLocaleString()}</span>
  </div>
);
