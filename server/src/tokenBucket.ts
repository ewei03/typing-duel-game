/**
 * Classic token bucket: holds up to `capacity` tokens, refilling at
 * `ratePerSec`. Used both to cap how fast a player can plausibly type and
 * to throttle raw socket events.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly capacity: number,
    now = Date.now()
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  // Takes `n` tokens if there are enough; otherwise takes nothing.
  take(n: number, now = Date.now()): boolean {
    const elapsedSec = Math.max(0, now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
