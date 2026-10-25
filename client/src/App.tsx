import { useEffect, useRef } from "react";
import { useNetworkDuel } from "./game/useNetworkDuel";
import { ATTACK_THRESHOLD, QUEUE_CAPACITY } from "../../shared/attackEconomy";
import type { MatchSnapshot } from "../../shared/protocol";
import { WordQueue } from "./components/WordQueue";
import { StatsBar } from "./components/StatsBar";
import { Bar } from "./components/Bar";
import { OpponentPanel } from "./components/OpponentPanel";
import { Lobby } from "./components/Lobby";

function resultText(result: NonNullable<MatchSnapshot["result"]>): string {
  if (result.outcome === "draw") return "draw — you both topped out";
  if (result.reason === "forfeit") {
    return result.outcome === "win" ? "you win — opponent left" : "you forfeited";
  }
  return result.outcome === "win" ? "you win" : "you lose";
}

function App() {
  const duel = useNetworkDuel();
  const inputRef = useRef<HTMLInputElement>(null);
  const match = duel.match;
  const phase = match?.phase;

  // The input is disabled outside of play or while offline (which drops
  // focus), so grab focus back the moment typing is possible again.
  const canType = duel.canType;
  useEffect(() => {
    if (canType) inputRef.current?.focus();
  }, [canType]);

  return (
    <div className="app" onClick={() => inputRef.current?.focus()}>
      <header className="header">
        <h1>typing duel</h1>
        <span className="subtitle">online duel — step 4{!duel.connected && " (connecting…)"}</span>
      </header>

      {duel.superseded ? (
        <div className="lobby">
          <p className="status-message">the game is open in another tab</p>
          <button className="action-button primary" onClick={duel.reconnect}>
            play here instead
          </button>
        </div>
      ) : !match && !duel.connected ? (
        <p className="status-message">connecting to server…</p>
      ) : !match ? (
        <Lobby
          status={duel.lobbyStatus}
          onFindMatch={duel.findMatch}
          onCancel={duel.cancelQueue}
          onPractice={duel.practice}
        />
      ) : (
        <>
          {phase === "countdown" && (
            <div className="countdown">{Math.max(1, Math.ceil(duel.countdownLeft / 1000))}</div>
          )}
          {match.result && <div className="result-banner">{resultText(match.result)}</div>}
          {!duel.connected && (
            <p className="status-message searching">connection lost — reconnecting…</p>
          )}

          <div className="duel-layout">
            <div className={`panel you-panel ${match.you.ko ? "ko" : ""}`}>
              <h2>you</h2>
              <StatsBar
                wpm={match.you.wpm}
                accuracy={match.you.accuracy}
                combo={match.you.combo}
                maxCombo={match.you.maxCombo}
              />
              <Bar value={match.you.meter} max={ATTACK_THRESHOLD} label="attack" variant="meter" />
              <Bar
                value={match.you.backlog}
                max={QUEUE_CAPACITY}
                label="backlog"
                variant={match.you.backlog > QUEUE_CAPACITY * 0.7 ? "danger" : "backlog"}
              />

              <div className="game-area">
                <WordQueue
                  words={match.you.words}
                  wordOffset={match.you.wordOffset}
                  currentWordIndex={match.you.currentWordIndex}
                  currentInput={duel.currentInput}
                  currentWordHasError={duel.currentWordHasError}
                />
                <input
                  ref={inputRef}
                  className="typing-input"
                  value={duel.currentInput}
                  onChange={duel.handleChange}
                  onKeyDown={duel.handleKeyDown}
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Typing input"
                  disabled={!canType}
                />
              </div>
            </div>

            <OpponentPanel
              opponent={match.opponent}
              label={match.opponentKind === "bot" ? "practice bot" : "opponent"}
              status={match.opponentStatus}
            />
          </div>

          <div className="match-actions">
            {phase === "finished" && (
              <button
                className="action-button primary"
                onClick={duel.rematch}
                disabled={
                  !duel.connected || match.opponentStatus !== "connected" || match.rematch.you
                }
              >
                {match.rematch.you
                  ? "waiting for opponent…"
                  : match.rematch.opponent && match.opponentKind === "human"
                    ? "opponent wants a rematch — accept"
                    : "rematch"}
              </button>
            )}
            {phase === "finished" && match.opponentKind === "human" && (
              <button className="action-button" onClick={duel.findMatch}>
                find new opponent
              </button>
            )}
            <button className="action-button" onClick={duel.leaveMatch}>
              {phase === "finished" ? "back to lobby" : "forfeit"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
