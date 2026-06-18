import { ClientState } from '../state/schema.js';

export interface ShouldRespondResult {
  respond: boolean;
  updatedState: ClientState;
}

/**
 * Stub implementation of the §5.2 conditional probability response engine.
 * Currently configured for Level 0 testing, which always returns true.
 *
 * TODO: implement §5.2 conditional probability mechanic
 */
export function shouldRespond(state: ClientState): ShouldRespondResult {
  return {
    respond: true,
    updatedState: state,
  };
}
