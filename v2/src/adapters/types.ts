/**
 * Channel adapter contract (Phase 1 §2.1). Adapters translate; they never
 * touch the DB and never contain policy. Identity resolution, gating, and
 * batching live in the ingestion service.
 */
export interface InboundMessage {
  channel: string; // 'telegram'
  externalId: string; // chat id as string
  handle?: string; // @username if present
  displayName?: string; // profile name
  text: string;
  channelMessageRef?: string; // channel's own message id
  rawPayload?: string; // JSON of the raw update, for debugging
}

export interface ChannelAdapter {
  readonly name: string;
  start(onMessage: (msg: InboundMessage) => void): Promise<void>;
  stop(): Promise<void>;
  send(externalId: string, text: string): Promise<void>;
}
