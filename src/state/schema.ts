export type ComplianceStatus = 'Compliant' | 'Miss' | 'Pending Review' | 'Unknown';

export interface GmLogEntry {
  timestamp: string; // ISO 8601 string
  message: string;
  reasoning: string;
}

export interface PendingReviewEntry {
  date: string; // YYYY-MM-DD
  message: string;
  failure_reason: string;
  timestamp: string; // ISO 8601 string
}

export interface ClassificationLogEntry {
  timestamp: string; // ISO 8601 string
  message: string;
  is_valid_gm: boolean;
  reasoning: string;
}

export interface ClientState {
  client_id: string;
  timezone: string; // IANA timezone string
  gm_received_today: boolean;
  compliance_status: ComplianceStatus;
  streak_count: number;
  current_response_level: 0 | 1 | 2 | 3;
  window_position: number; // 0-5
  responses_given: number;
  gm_log: GmLogEntry[];
  miss_log: string[]; // ISO date strings (e.g. YYYY-MM-DD)
  pending_review_log: PendingReviewEntry[];
  classification_log: ClassificationLogEntry[];
}
