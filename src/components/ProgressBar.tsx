import { ColorSettings } from '../types';

type ProgressBarProps = {
  value: number;
  colors: ColorSettings;
};

export const ProgressBar = ({ value, colors }: ProgressBarProps) => {
  const getColor = (): string => {
    if (value >= 80) return colors.high;
    if (value >= 50) return colors.medium;
    return colors.low;
  };

  return (
    <div className="progress-bar">
      <div
        className="progress-fill"
        style={{
          width: `${value}%`,
          backgroundColor: getColor()
        }}
      />
    </div>
  );
};
