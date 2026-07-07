export type ClientStatus = 'pending_verification' | 'active' | 'blocked' | 'graduated' | 'dropped';

export interface Client {
  id: string;
  displayName: string;
  timezone: string;
  status: ClientStatus;
  createdAt: string;
  verifiedAt?: string;
  lastReconciledDate?: string;
}

export interface Message {
  id: string;
  clientId: string;
  direction: 'inbound' | 'outbound';
  text: string;
  channelMessageRef?: string;
  rawPayload?: string;
  batchId?: string;
  draftId?: string;
  createdAt: string;
}

export type BatchStatus = 'open' | 'pending' | 'processed';
export type Intent = 'gm_checkin' | 'coaching_question' | 'status_update' | 'other';

export interface Batch {
  id: string;
  clientId: string;
  status: BatchStatus;
  primaryIntent?: Intent;
  routerConfidence?: number;
  needsResponse: boolean;
  dismissedAt?: string;
  createdAt: string;
  processedAt?: string;
}

export type ComplianceStatus = 'unknown' | 'compliant' | 'miss' | 'pending_review';
export type FollowupState = 'pending' | 'handled' | 'dismissed';

export interface ComplianceDay {
  clientId: string;
  date: string; // YYYY-MM-DD, client tz
  status: ComplianceStatus;
  streakAfter?: number;
  resolvedAt?: string;
  resolvingMessageId?: string;
  followupState?: FollowupState;
}

export type DraftStatus = 'draft' | 'approved' | 'sent' | 'rejected' | 'stale';
export type ResponseType = 'gm_ack' | 'status_ack' | 'coaching_answer' | 'accountability_followup';

export interface Draft {
  id: string;
  clientId: string;
  coversThroughMessageId: string;
  draftText: string;
  finalText?: string;
  responseType: ResponseType;
  confidence?: number;
  status: DraftStatus;
  autonomyLevel: number;
  createdAt: string;
  resolvedAt?: string;
}

export interface NarrativeFlag {
  id: string;
  clientId: string;
  note: string;
  createdBy: 'agent' | 'operator';
  createdAt: string;
  clearedAt?: string;
}

export interface AuditEvent {
  id: string;
  clientId?: string;
  actor: 'operator' | 'system';
  action: string;
  details?: unknown;
  createdAt: string;
}

export interface LlmCallInput {
  clientId?: string;
  batchId?: string;
  agent: 'router' | 'gm_classifier' | 'coach';
  model: string;
  promptFileHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  result?: unknown;
  error?: string;
}

export interface LlmCall extends LlmCallInput {
  id: string;
  createdAt: string;
}
