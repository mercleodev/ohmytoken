import { AnimatePresence, motion } from "framer-motion";

type SectionProps = {
  title: string;
  id: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
};

export const Section = ({
  title,
  id,
  expanded,
  onToggle,
  children,
}: SectionProps) => {
  const isOpen = expanded.has(id);
  return (
    <div className="detail-section">
      <button className="detail-section-header" onClick={() => onToggle(id)}>
        <span>{title}</span>
        <span className={`detail-section-chevron ${isOpen ? "expanded" : ""}`}>
          ›
        </span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div className="detail-section-body">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
