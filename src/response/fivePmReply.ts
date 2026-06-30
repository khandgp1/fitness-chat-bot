import { devNow } from '../dev/clock.js';
import { ClientState } from '../state/schema.js';

/**
 * Returns the current hour (0-23) in the target IANA timezone.
 */
export function getLocalHour(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    });
    const hour = parseInt(formatter.format(devNow()), 10);
    return hour === 24 ? 0 : hour;
  } catch (error) {
    console.error(
      `Error calculating local hour for timezone "${timezone}". Falling back to system hour.`,
      error,
    );
    return devNow().getHours();
  }
}

/**
 * Selects the 5pm GM compliance reply based on the client's state.
 * Case 1: Valid GM today -> "G"
 * Case 2: Missing GM + Streak > 0 -> "G. You got this. Keep going"
 * Case 3: Missing GM + Streak is 0 -> "bruv"
 */
export function select5pmReply(state: ClientState): string {
  if (state.gm_received_today) {
    return 'G';
  } else if (state.streak_count > 0) {
    return 'G. You got this. Keep going';
  } else {
    return 'bruv';
  }
}
