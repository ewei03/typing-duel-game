import { powerToWords, type PendingAttack } from "../game/attackEconomy";

interface TelegraphWarningProps {
  pendingIncoming: PendingAttack[];
}

export function TelegraphWarning({ pendingIncoming }: TelegraphWarningProps) {
  if (pendingIncoming.length === 0) return null;
  const totalWords = pendingIncoming.reduce((sum, a) => sum + powerToWords(a.power), 0);
  if (totalWords === 0) return null;

  return (
    <div className="telegraph-warning">
      incoming - {totalWords} word{totalWords === 1 ? "" : "s"}
    </div>
  );
}
