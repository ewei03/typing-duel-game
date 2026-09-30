import { ATTACK_THRESHOLD, QUEUE_CAPACITY, type PendingAttack } from "../game/attackEconomy";
import { Bar } from "./Bar";
import { TelegraphWarning } from "./TelegraphWarning";

interface OpponentPanelProps {
  meter: number;
  backlog: number;
  pendingIncoming: PendingAttack[];
  ko: boolean;
}

export function OpponentPanel({ meter, backlog, pendingIncoming, ko }: OpponentPanelProps) {
  return (
    <div className={`panel opponent-panel ${ko ? "ko" : ""}`}>
      <h2>opponent</h2>
      <TelegraphWarning pendingIncoming={pendingIncoming} />
      <Bar value={meter} max={ATTACK_THRESHOLD} label="attack" variant="meter" />
      <Bar
        value={backlog}
        max={QUEUE_CAPACITY}
        label="backlog"
        variant={backlog > QUEUE_CAPACITY * 0.7 ? "danger" : "backlog"}
      />
      {ko && <p className="ko-message">KO'd — buried in words</p>}
    </div>
  );
}
