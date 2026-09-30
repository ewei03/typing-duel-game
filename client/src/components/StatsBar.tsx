interface StatsBarProps {
  wpm: number;
  accuracy: number;
  combo: number;
  maxCombo: number;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function StatsBar({ wpm, accuracy, combo, maxCombo }: StatsBarProps) {
  return (
    <div className="stats-bar">
      <Stat label="wpm" value={wpm} />
      <Stat label="accuracy" value={`${accuracy}%`} />
      <Stat label="combo" value={combo} />
      <Stat label="best combo" value={maxCombo} />
    </div>
  );
}
