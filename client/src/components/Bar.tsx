interface BarProps {
  value: number;
  max: number;
  label: string;
  variant: "meter" | "backlog" | "danger";
}

export function Bar({ value, max, label, variant }: BarProps) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className={`bar bar-${variant}`}>
      <div className="bar-label">
        <span>{label}</span>
        <span>
          {Math.round(value)}/{max}
        </span>
      </div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
