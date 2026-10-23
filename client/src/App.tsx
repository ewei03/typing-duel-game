import { useEffect, useRef } from "react";
import { useNetworkDuel, type MatchSnapshot } from "./game/useNetworkDuel";
import { ATTACK_THRESHOLD, QUEUE_CAPACITY } from "./game/attackEconomy";
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

  // The input is disabled outside of play (which drops focus), so grab
  // focus back the moment the countdown ends.
  useEffect(() => {
    if (phase === "playing") inputRef.current?.focus();
  }, [phase]);

  return (
    <div className="app" onClick={() => inputRef.current?.focus()}>
      <header className="header">
        <h1>typing duel</h1>
        <span className="subtitle">online duel — step 4{!duel.connected && " (connecting…)"}</span>
      </header>

      {!duel.connected ? (
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
                  currentWordIndex={match.you.currentWordIndex}
                  currentInput={duel.currentInput}
                  currentWordHasError={duel.currentWordHasError}
                  completedWords={match.you.completedWords}
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
                  disabled={phase !== "playing"}
                />
              </div>
            </div>

            <OpponentPanel
              opponent={match.opponent}
              label={match.opponentKind === "bot" ? "practice bot" : "opponent"}
              connected={match.opponentConnected}
            />
          </div>

          <div className="match-actions">
            {phase === "finished" && (
              <button
                className="action-button primary"
                onClick={duel.rematch}
                disabled={!match.opponentConnected || match.rematch.you}
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
