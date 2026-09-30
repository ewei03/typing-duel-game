import { useEffect, useRef } from "react";
import { useDuelSimulation } from "./game/useDuelSimulation";
import { ATTACK_THRESHOLD, QUEUE_CAPACITY } from "./game/attackEconomy";
import { WordQueue } from "./components/WordQueue";
import { StatsBar } from "./components/StatsBar";
import { Bar } from "./components/Bar";
import { TelegraphWarning } from "./components/TelegraphWarning";
import { OpponentPanel } from "./components/OpponentPanel";

function App() {
  const duel = useDuelSimulation();
  const inputRef = useRef<HTMLInputElement>(null);
  const you = duel.you;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="app" onClick={() => inputRef.current?.focus()}>
      <header className="header">
        <h1>typing duel</h1>
        <span className="subtitle">local prototype — step 2</span>
      </header>

      {duel.winner && (
        <div className="result-banner">{duel.winner === "you" ? "you win" : "you lose"}</div>
      )}

      <div className="duel-layout">
        <div className={`panel you-panel ${duel.youSide.ko ? "ko" : ""}`}>
          <h2>you</h2>
          <StatsBar wpm={you.wpm} accuracy={you.accuracy} combo={you.combo} maxCombo={you.maxCombo} />
          <TelegraphWarning pendingIncoming={duel.youSide.pendingIncoming} />
          <Bar value={duel.youSide.meter} max={ATTACK_THRESHOLD} label="attack" variant="meter" />
          <Bar
            value={duel.youSide.backlog}
            max={QUEUE_CAPACITY}
            label="backlog"
            variant={duel.youSide.backlog > QUEUE_CAPACITY * 0.7 ? "danger" : "backlog"}
          />

          <div className="game-area">
            {you.isLoading ? (
              <p className="status-message">loading words…</p>
            ) : (
              <WordQueue
                words={you.words}
                currentWordIndex={you.currentWordIndex}
                currentInput={you.currentInput}
                currentWordHasError={you.currentWordHasError}
                completedWords={you.completedWords}
              />
            )}
            <input
              ref={inputRef}
              className="typing-input"
              value={you.currentInput}
              onChange={you.handleChange}
              onKeyDown={you.handleKeyDown}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              aria-label="Typing input"
              disabled={!duel.isRunning}
            />
          </div>

          {you.error && <p className="error-message">{you.error}</p>}
        </div>

        <OpponentPanel
          meter={duel.botSide.meter}
          backlog={duel.botSide.backlog}
          pendingIncoming={duel.botSide.pendingIncoming}
          ko={duel.botSide.ko}
        />
      </div>

      <button className="reset-button" onClick={duel.reset}>
        restart
      </button>
    </div>
  );
}

export default App;
