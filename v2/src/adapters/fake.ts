import type { ChannelAdapter, InboundMessage } from './types.js';

/** Test double: push messages in with deliver(), inspect outbound via sent. */
export interface FakeAdapter extends ChannelAdapter {
  deliver(msg: Partial<InboundMessage> & { externalId: string; text: string }): void;
  readonly sent: Array<{ externalId: string; text: string }>;
}

export function createFakeAdapter(): FakeAdapter {
  let onMessage: ((msg: InboundMessage) => void) | undefined;
  const sent: Array<{ externalId: string; text: string }> = [];

  return {
    name: 'fake',
    sent,
    async start(handler) {
      onMessage = handler;
    },
    async stop() {
      onMessage = undefined;
    },
    async send(externalId, text) {
      sent.push({ externalId, text });
    },
    deliver(msg) {
      if (onMessage === undefined) throw new Error('Fake adapter not started');
      onMessage({ channel: 'fake', ...msg });
    },
  };
}
