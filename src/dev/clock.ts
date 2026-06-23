let offsetMs = 0;

/**
 * Returns a Date object adjusted by the current developer clock offset.
 */
export function devNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/**
 * Advances the clock by exactly 1 day (24 hours).
 */
export function advanceDay(): void {
  offsetMs += 24 * 60 * 60 * 1000;
}

/**
 * Advances the clock by exactly 30 minutes.
 */
export function advance30Min(): void {
  offsetMs += 30 * 60 * 1000;
}

/**
 * Resets the clock offset back to 0.
 */
export function resetClock(): void {
  offsetMs = 0;
}

/**
 * Returns the current offset in milliseconds.
 */
export function getOffsetMs(): number {
  return offsetMs;
}
