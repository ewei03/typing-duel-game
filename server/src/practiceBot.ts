import type { DuelSession, Seat } from "./duelSession";

const BOT_TICK_MS = 500;

/**
 * The step-3 scripted opponent, now just another player: it sits in a
 * seat and submits its actual current word through the same
 * `submitWord` path a human socket uses (including the typing-speed
 * cap, which it stays well under), so attack words sent to it
 * really land in its queue. Kept for solo practice / testing without a
 * second browser.
 */
export class PracticeBot {
  private interval: ReturnType<typeof setInterval>;

  constructor(session: DuelSession, seat: Seat, tickMs = BOT_TICK_MS) {
    this.interval = setInterval(() => {
      if (session.phase !== "playing") return;
      session.submitWord(seat, [...session.getCurrentWord(seat)]);
    }, tickMs);
  }

  destroy() {
    clearInterval(this.interval);
  }
}
