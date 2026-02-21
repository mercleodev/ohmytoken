import { motion } from 'framer-motion';

export type SubTabType = 'usage' | 'live-session' | 'context-analysis';

type SubTabsProps = {
  active: SubTabType;
  onChange: (tab: SubTabType) => void;
};

const TABS: { id: SubTabType; label: string }[] = [
  { id: 'usage', label: 'Usage Insights' },
  { id: 'live-session', label: 'Live Flow' },
  { id: 'context-analysis', label: 'Context Insights' },
];

export const SubTabs = ({ active, onChange }: SubTabsProps) => {
  return (
    <div className="sub-tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`sub-tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {active === tab.id && (
            <motion.div
              layoutId="sub-tab-underline"
              className="sub-tab-underline"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
        </button>
      ))}
    </div>
  );
};
