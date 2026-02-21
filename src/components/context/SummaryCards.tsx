import { formatTokens, formatCost } from '../scan/shared';
import './context.css';

type SessionSummary = {
  totalInjectedTokens: number;
  totalSessionCost: number;
  injectedCostRatio: number;
  avgInjectedPerPrompt: number;
  promptCount: number;
};

type SummaryCardsProps = {
  summary: SessionSummary;
};

export const SummaryCards = ({ summary }: SummaryCardsProps) => {
  const cards = [
    {
      label: 'Total Injected',
      value: formatTokens(summary.totalInjectedTokens),
      sub: `${summary.promptCount} prompts`,
    },
    {
      label: 'Injection Ratio',
      value: `${summary.injectedCostRatio.toFixed(1)}%`,
      sub: formatCost(summary.totalSessionCost),
    },
    {
      label: 'Avg / Prompt',
      value: formatTokens(summary.avgInjectedPerPrompt),
      sub: 'per prompt',
    },
  ];

  return (
    <div className="prompt-detail-stats">
      {cards.map((card) => (
        <div key={card.label} className="stat-pill">
          <span className="stat-pill-value">{card.value}</span>
          <span className="stat-pill-label">{card.label}</span>
          <span className="stat-pill-label summary-card-sub">
            {card.sub}
          </span>
        </div>
      ))}
    </div>
  );
};
