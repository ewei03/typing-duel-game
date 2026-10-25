import type { LobbyStatus } from "../../../shared/protocol";

interface LobbyProps {
  status: LobbyStatus;
  onFindMatch: () => void;
  onCancel: () => void;
  onPractice: () => void;
}

export function Lobby({ status, onFindMatch, onCancel, onPractice }: LobbyProps) {
  if (status === "queued") {
    return (
      <div className="lobby">
        <p className="status-message searching">looking for an opponent…</p>
        <button className="action-button" onClick={onCancel}>
          cancel
        </button>
      </div>
    );
  }

  return (
    <div className="lobby">
      <button className="action-button primary" onClick={onFindMatch}>
        find match
      </button>
      <button className="action-button" onClick={onPractice}>
        practice vs bot
      </button>
      <p className="lobby-hint">
        Testing locally? Open a second browser tab and hit "find match" in both.
      </p>
    </div>
  );
}
