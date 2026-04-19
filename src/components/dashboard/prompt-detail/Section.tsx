type SectionProps = {
  title: string;
  id: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
};

export const Section = ({ title, id, expanded, onToggle, children, headerExtra }: SectionProps) => {
  const isOpen = expanded.has(id);
  return (
    <div className="detail-section">
      <button
        className="detail-section-header"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        aria-controls={`section-body-${id}`}
      >
        <span>{title}</span>
        <span className="detail-section-header-right">
          {headerExtra}
          <span className={`detail-section-chevron ${isOpen ? "expanded" : ""}`}>›</span>
        </span>
      </button>
      <div
        id={`section-body-${id}`}
        className={`collapsible ${isOpen ? "open" : ""}`}
        aria-hidden={!isOpen}
      >
        <div className="collapsible-inner">
          <div className="detail-section-body">{children}</div>
        </div>
      </div>
    </div>
  );
};
