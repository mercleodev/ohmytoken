type ClampTooltipXArgs = {
  targetX: number;
  halfWidth: number;
  viewportWidth: number;
  margin?: number;
};

export const clampTooltipX = ({
  targetX,
  halfWidth,
  viewportWidth,
  margin = 4,
}: ClampTooltipXArgs): number => {
  const minX = halfWidth + margin;
  const maxX = viewportWidth - halfWidth - margin;
  if (maxX < minX) return minX;
  return Math.max(minX, Math.min(targetX, maxX));
};
