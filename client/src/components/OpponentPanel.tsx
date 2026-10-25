import { ATTACK_THRESHOLD, QUEUE_CAPACITY } from "../../../shared/attackEconomy";
import type { OpponentSnapshot, PresenceStatus } from "../../../shared/protocol";
import { Bar } from "./Bar";

interface OpponentPanelProps {
  opponent: OpponentSnapshot;
  label: string;
  status: PresenceStatus;
}

export function OpponentPanel({ opponent, label, status }: OpponentPanelProps) {
  const { meter, backlog, ko } = opponent;
  return (
    <div className={`panel opponent-panel ${ko || status === "left" ? "ko" : ""}`}>
      <h2>{label}</h2>
      <div className="opponent-stats">
        <span>{opponent.wpm} wpm</span>
        <span>{opponent.accuracy}% acc</span>
        <span>{opponent.combo}x combo</span>
      </div>
      <Bar value={meter} max={ATTACK_THRESHOLD} label="attack" variant="meter" />
      <Bar
        value={backlog}
        max={QUEUE_CAPACITY}
        label="backlog"
        variant={backlog > QUEUE_CAPACITY * 0.7 ? "danger" : "backlog"}
      />
      {ko && <p className="ko-message">KO'd — buried in words</p>}
      {status === "reconnecting" && (
        <p className="ko-message searching">connection lost — waiting for them to reconnect…</p>
      )}
      {status === "left" && <p className="ko-message">left the match</p>}
    </div>
  );
}
