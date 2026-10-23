import { ATTACK_THRESHOLD, QUEUE_CAPACITY } from "../game/attackEconomy";
import type { OpponentSnapshot } from "../game/useNetworkDuel";
import { Bar } from "./Bar";

interface OpponentPanelProps {
  opponent: OpponentSnapshot;
  label: string;
  connected: boolean;
}

export function OpponentPanel({ opponent, label, connected }: OpponentPanelProps) {
  const { meter, backlog, ko } = opponent;
  return (
    <div className={`panel opponent-panel ${ko || !connected ? "ko" : ""}`}>
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
      {!connected && <p className="ko-message">left the match</p>}
    </div>
  );
}
