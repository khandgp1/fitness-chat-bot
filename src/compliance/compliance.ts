import { ClientState, PendingReviewEntry } from '../state/schema.js';
import { ClassificationResult } from '../classifier/classify.js';

/**
 * Returns current date in YYYY-MM-DD using sv-SE locale in the target IANA timezone.
 */
export function getLocalDateStr(timezone: string, timestampStr?: string): string {
  try {
    const referenceDate = timestampStr ? new Date(timestampStr) : new Date();
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(referenceDate);
  } catch (error) {
    console.error(
      `Error formatting local date for timezone "${timezone}". Falling back to local system date.`,
      error,
    );
    const referenceDate = timestampStr ? new Date(timestampStr) : new Date();
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(referenceDate);
  }
}

/**
 * Adds exactly 1 day to a YYYY-MM-DD string, executing in UTC to avoid timezone/DST shift issues.
 */
export function getNextDateStr(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().split('T')[0];
}

/**
 * Transitions a client state through midnight boundaries up to the current date.
 * Logs misses and resets streaks for any day without a GM check-in or Pending Review status.
 */
export function transitionClientDays(state: ClientState, currentDate: string): ClientState {
  if (!state.last_active_date) {
    state.last_active_date = currentDate;
    state.gm_received_today = false;
    state.compliance_status = 'Unknown';
    return state;
  }

  if (state.last_active_date === currentDate) {
    return state;
  }

  let tempDate = state.last_active_date;
  while (tempDate !== currentDate) {
    // Process the end of tempDate
    if (state.gm_received_today) {
      // Already compliant for that day.
      // Streak was updated immediately when the first valid GM was received.
    } else {
      if (state.compliance_status === 'Pending Review') {
        // Pending Review status holds the streak.
        // It does not log as a Miss and does not reset the streak.
      } else {
        // Log as a Miss
        state.compliance_status = 'Miss';
        state.streak_count = 0;
        if (!state.miss_log.includes(tempDate)) {
          state.miss_log.push(tempDate);
        }
      }
    }

    // Set up state for the next calendar day
    state.gm_received_today = false;
    state.compliance_status = 'Unknown';
    tempDate = getNextDateStr(tempDate);
  }

  state.last_active_date = currentDate;
  return state;
}

/**
 * Handles the classification result of a client's message.
 * Updates compliance status, handles streak increments, logs entries,
 * manages Pending Review status, and immediately persists state.
 */
export function handleGmResult(
  state: ClientState,
  result: ClassificationResult | null,
  messageText: string,
  timestampStr?: string,
): ClientState {
  const currentDate = getLocalDateStr(state.timezone, timestampStr);

  // Catch up the client state to today's date first
  transitionClientDays(state, currentDate);

  const timestamp = timestampStr || new Date().toISOString();

  if (result === null) {
    // LLM classification failed or timed out
    if (!state.gm_received_today) {
      state.compliance_status = 'Pending Review';

      const alreadyPending = state.pending_review_log.some((entry) => entry.date === currentDate);
      if (!alreadyPending) {
        const entry: PendingReviewEntry = {
          date: currentDate,
          message: messageText,
          failure_reason: 'LLM classification error or timeout',
          timestamp,
        };
        state.pending_review_log.push(entry);
      }
    }
  } else if (result.is_valid_gm) {
    if (state.gm_received_today) {
      // Duplicate GM: log to audit trail only, do not trigger responses or alter streak
      state.classification_log.push({
        timestamp,
        message: messageText,
        is_valid_gm: true,
        reasoning: `${result.reasoning} (Duplicate check-in)`,
      });
    } else {
      // First valid GM today: Compliant day
      state.gm_received_today = true;
      state.compliance_status = 'Compliant';
      state.streak_count += 1;

      // Clear any pending review logs for today (natural resolution)
      state.pending_review_log = state.pending_review_log.filter(
        (entry) => entry.date !== currentDate,
      );

      state.gm_log.push({
        timestamp,
        message: messageText,
        reasoning: result.reasoning,
      });

      state.classification_log.push({
        timestamp,
        message: messageText,
        is_valid_gm: true,
        reasoning: result.reasoning,
      });
    }
  } else {
    // Invalid check-in: log to audit trail only, no compliance changes
    state.classification_log.push({
      timestamp,
      message: messageText,
      is_valid_gm: false,
      reasoning: result.reasoning,
    });
  }

  return state;
}
