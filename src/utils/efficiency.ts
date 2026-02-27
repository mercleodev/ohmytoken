import type { EfficiencyGrade } from '../types/electron';

type EfficiencyResult = {
  outputRatio: number;
  grade: EfficiencyGrade;
  label: string;
  color: string;
};

const GRADE_THRESHOLDS: Array<{
  min: number;
  grade: EfficiencyGrade;
  label: string;
  color: string;
}> = [
  { min: 0.03, grade: 'A', label: 'Excellent', color: '#34C759' },
  { min: 0.01, grade: 'B', label: 'Good', color: '#007AFF' },
  { min: 0.005, grade: 'C', label: 'Fair', color: '#F59E0B' },
  { min: 0, grade: 'D', label: 'Low', color: '#FF3B30' },
];

export const getEfficiency = (
  totalOutput: number,
  totalAll: number,
): EfficiencyResult => {
  if (totalAll <= 0) {
    return { outputRatio: 0, grade: 'D', label: 'No data', color: '#FF3B30' };
  }

  const outputRatio = totalOutput / totalAll;

  for (const t of GRADE_THRESHOLDS) {
    if (outputRatio >= t.min) {
      return { outputRatio, grade: t.grade, label: t.label, color: t.color };
    }
  }

  return { outputRatio, grade: 'D', label: 'Low', color: '#FF3B30' };
};
