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
 * Advances the clock by exactly 1 hour.
 */
export function advance1Hour(): void {
  offsetMs += 60 * 60 * 1000;
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
