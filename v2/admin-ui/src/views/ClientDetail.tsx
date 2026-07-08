import { useEffect, useState } from 'react';
import { get, post, put, type ClientDetail as Detail, type Message } from '../api.js';
import { reportError, usePoll } from '../App.js';

export function ClientDetail({ id, back }: { id: string; back: () => void }) {
  const { data, refresh } = usePoll(() => get<Detail>(`/clients/${id}`), [id]);
  const { data: messages, refresh: refreshMsgs } = usePoll(() => get<Message[]>(`/clients/${id}/messages`), [id]);
  const [narrative, setNarrative] = useState<string>();
  const [draftEdit, setDraftEdit] = useState<string>();
  const [audit, setAudit] = useState<Array<{ id: string; action: string; createdAt: string }>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<Array<{ id: string; action: string; createdAt: string }>>(`/audit?clientId=${id}`).then(setAudit, () => undefined);
  }, [id, data]);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn()
      .then(() => {
        refresh();
        refreshMsgs();
      })
      .catch(reportError)
      .finally(() => setBusy(false));
  };

  if (data === undefined) return <p className="muted">loading…</p>;
  const activeDraft = data.drafts.find((d) => d.status === 'draft');
  const stale = data.staleness.flags + data.staleness.replyWorthyBatches;

  return (
    <>
      <div className="row">
        <button className="ghost" onClick={back}>← back</button>
        <h2 style={{ margin: 0 }}>{data.client.displayName}</h2>
        <span className="tag">{data.client.status}</span>
        <span className="muted">streak {data.streak} · {data.client.timezone} · today: {data.today}</span>
        {stale >= 3 && <span className="tag narrative_staleness">narrative stale ({stale})</span>}
      </div>

      <h3>Compliance — last 28 days <span className="muted">(click a day to correct it)</span></h3>
      <div className="cal">
        {data.calendar.map((d) => (
          <div
            key={d.date}
            className={d.status}
            title={`${d.date}: ${d.status}`}
            onClick={() => {
              const status = prompt(`${d.date} is '${d.status}'. Correct to (compliant/miss):`, 'compliant');
              if (status === 'compliant' || status === 'miss') {
                act(() => post(`/compliance/${id}/${d.date}/correct`, { status }));
              }
            }}
          >
            {d.date.slice(8)}
          </div>
        ))}
      </div>

      <h3>Drafts</h3>
      {activeDraft === undefined ? (
        <div className="row">
          <button disabled={busy} onClick={() => act(() => post(`/clients/${id}/drafts`))}>
            {busy ? 'drafting…' : 'Draft a reply'}
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="muted">
            {activeDraft.responseType} · confidence {activeDraft.confidence ?? '—'}
          </div>
          <textarea
            value={draftEdit ?? activeDraft.draftText}
            onChange={(e) => setDraftEdit(e.target.value)}
          />
          <div className="row">
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await post(`/drafts/${activeDraft.id}/send`, { text: draftEdit ?? activeDraft.draftText });
                  setDraftEdit(undefined);
                })
              }
            >
              Send
            </button>
            <button className="warn" onClick={() => act(() => post(`/drafts/${activeDraft.id}/reject`))}>
              Reject
            </button>
          </div>
        </div>
      )}

      <h3>Narrative <span className="muted">(quick edits only — deep work belongs in the design plane)</span></h3>
      <textarea
        style={{ minHeight: 140 }}
        value={narrative ?? data.narrative}
        onChange={(e) => setNarrative(e.target.value)}
      />
      <div className="row">
        <button
          disabled={narrative === undefined || narrative === data.narrative}
          onClick={() =>
            act(async () => {
              await put(`/clients/${id}/narrative`, { content: narrative });
              setNarrative(undefined);
            })
          }
        >
          Save narrative
        </button>
      </div>

      <h3>Conversation</h3>
      {(messages ?? []).slice().reverse().map((m) => (
        <div key={m.id} className={`msg ${m.direction}`}>
          {m.text}
          <div className="muted" style={{ fontSize: 10 }}>{m.createdAt}</div>
        </div>
      ))}

      <h3>Audit</h3>
      <table>
        <tbody>
          {audit.slice(0, 15).map((e) => (
            <tr key={e.id}>
              <td className="muted">{e.createdAt}</td>
              <td>{e.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
