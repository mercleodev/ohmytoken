type HeaderProps = {
  onRefresh: () => void;
  loading: boolean;
};

export const Header = ({ onRefresh, loading }: HeaderProps) => {
  return (
    <header className="header">
      <h1>AI Token Monitor</h1>
      <button
        className={`icon-btn ${loading ? 'loading' : ''}`}
        onClick={onRefresh}
        disabled={loading}
        title="Refresh"
      >
        ↻
      </button>
    </header>
  );
};
