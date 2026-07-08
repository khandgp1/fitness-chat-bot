import { useState } from 'react';
import { get, post, type TriageItem } from '../api.js';
import { reportError, usePoll } from '../App.js';

const GROUPS: Array<[string, string]> = [
  ['pending_draft', 'Drafts awaiting your review'],
  ['awaiting_response', 'Awaiting a response'],
  ['miss_followup', 'Missed days'],
  ['pending_review', 'Pending reviews'],
  ['unverified', 'New contacts'],
  ['narrative_staleness', 'Narrative nudges'],
];

export function Triage({ openClient }: { openClient: (id: string) => void }) {
  const { data, refresh } = usePoll(() => get<TriageItem[]>('/triage'));
  const [busy, setBusy] = useState<string>();
  const [edits, setEdits] = useState<Record<string, string>>({});

  const act = (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    fn()
      .then(() => refresh())
      .catch(reportError)
      .finally(() => setBusy(undefined));
  };

  if (data === undefined) return <p className="muted">loading…</p>;
  if (data.length === 0) return <h2>Inbox zero. Nothing needs you. 🎉</h2>;

  return (
    <>
      {GROUPS.map(([type, heading]) => {
        const items = data.filter((i) => i.type === type);
        if (items.length === 0) return null;
        return (
          <section key={type}>
            <h2>{heading}</h2>
            {items.map((item, idx) => {
              const key = `${type}:${item.refs.batchId ?? item.refs.draftId ?? item.refs.date ?? item.clientId}:${idx}`;
              return (
                <div className="card" key={key}>
                  <h4>
                    <span className={`tag ${item.type}`}>{item.type.replace(/_/g, ' ')}</span>{' '}
                    {item.clientName}
                  </h4>
                  <div className="muted">{item.title}</div>
                  {item.type === 'pending_draft' ? (
                    <textarea
                      value={edits[item.refs.draftId!] ?? item.detail ?? ''}
                      onChange={(e) => setEdits({ ...edits, [item.refs.draftId!]: e.target.value })}
                    />
                  ) : (
                    item.detail !== undefined && <div>{item.detail}</div>
                  )}
                  <div className="row">
                    {item.type === 'awaiting_response' && (
                      <>
                        <button disabled={busy === key} onClick={() => act(key, () => post(`/clients/${item.clientId}/drafts`))}>
                          {busy === key ? 'drafting…' : 'Draft reply'}
                        </button>
                        <button className="ghost" onClick={() => act(key, () => post(`/batches/${item.refs.batchId}/dismiss`))}>
                          No reply needed
                        </button>
                      </>
                    )}
                    {item.type === 'pending_draft' && (
                      <>
                        <button
                          disabled={busy === key}
                          onClick={() =>
                            act(key, () =>
                              post(`/drafts/${item.refs.draftId}/send`, {
                                text: edits[item.refs.draftId!] ?? item.detail,
                              })
                            )
                          }
                        >
                          Send
                        </button>
                        <button className="warn" onClick={() => act(key, () => post(`/drafts/${item.refs.draftId}/reject`))}>
                          Reject
                        </button>
                      </>
                    )}
                    {item.type === 'miss_followup' && (
                      <>
                        <button disabled={busy === key} onClick={() => act(key, () => post(`/clients/${item.clientId}/drafts`))}>
                          {busy === key ? 'drafting…' : 'Draft follow-up'}
                        </button>
                        <button className="ghost" onClick={() => act(key, () => post(`/followups/${item.clientId}/${item.refs.date}`, { state: 'dismissed' }))}>
                          Dismiss
                        </button>
                      </>
                    )}
                    {item.type === 'pending_review' && (
                      <>
                        <button onClick={() => act(key, () => post(`/compliance/${item.clientId}/${item.refs.date}/correct`, { status: 'compliant' }))}>
                          Valid GM
                        </button>
                        <button className="warn" onClick={() => act(key, () => post(`/compliance/${item.clientId}/${item.refs.date}/correct`, { status: 'miss' }))}>
                          Miss
                        </button>
                      </>
                    )}
                    {item.type === 'unverified' && (
                      <>
                        <button onClick={() => act(key, () => post(`/clients/${item.clientId}/verify`))}>Verify</button>
                        <button className="warn" onClick={() => act(key, () => post(`/clients/${item.clientId}/block`))}>
                          Block
                        </button>
                      </>
                    )}
                    <button className="ghost" onClick={() => openClient(item.clientId)}>
                      Open client
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
