const SCAN_GRID_SIZE = 20;

type ScanProgressProps = {
  scanProgress: number;
};

export const ScanProgress = ({ scanProgress }: ScanProgressProps) => {
  return (
    <div className="scan-overlay">
      <div className="scan-modal">
        <div className="scan-animation">
          <div className="scan-line" style={{ top: `${scanProgress}%` }} />
          <div className="scan-grid">
            {[...Array(SCAN_GRID_SIZE)].map((_, i) => (
              <div
                key={i}
                className="scan-cell"
                style={{
                  opacity: scanProgress > (i * 5) ? 1 : 0.2,
                  backgroundColor: `hsl(${i * 18}, 70%, 50%)`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="scan-text">Analyzing tokens... {scanProgress}%</div>
      </div>
    </div>
  );
};
