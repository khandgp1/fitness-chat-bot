import { useState } from 'react';
import { get, post, type ClientRow } from '../api.js';
import { reportError, usePoll } from '../App.js';

interface ClockInfo {
  realNow: string;
  effectiveNow: string;
  offsetHours: number;
  snapshotExists: boolean;
}

export function DevPanel() {
  const { data: clock, refresh } = usePoll(() => get<ClockInfo>('/dev/clock'));
  const { data: clients } = usePoll(() => get<ClientRow[]>('/clients'));
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');

  const act = (fn: () => Promise<unknown>) => fn().then(refresh).catch(reportError);

  if (clock === undefined) return <p className="muted">Dev panel unavailable (DEV_MODE off?).</p>;

  return (
    <>
      <h2>Dev clock</h2>
      <div className="card">
        <div>effective now: <b>{clock.effectiveNow}</b></div>
        <div className="muted">real now: {clock.realNow} · offset {clock.offsetHours >= 0 ? '+' : ''}{clock.offsetHours}h</div>
        <div className="muted">
          snapshot: {clock.snapshotExists ? 'exists — full rewind via `npm run clock -- reset` (app stopped)' : 'none (first advance takes one)'}
        </div>
        <div className="row">
          <button onClick={() => act(() => post('/dev/clock/advance', { hours: 1 }))}>+1 hour</button>
          <button onClick={() => act(() => post('/dev/clock/advance', { hours: 24 }))}>+1 day</button>
          <button className="ghost" onClick={() => act(() => post('/dev/clock/reset'))}>Reset offset</button>
        </div>
      </div>

      <h2>Simulate inbound</h2>
      <div className="card">
        <div className="row">
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">— a brand-new stranger —</option>
            {(clients ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.displayName} ({c.status})</option>
            ))}
          </select>
        </div>
        <div className="row">
          <input placeholder='message text, e.g. "GM — should I deload?"' value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="row">
          <button
            disabled={text.trim() === ''}
            onClick={() =>
              act(async () => {
                await post('/dev/inbound', target === '' ? { externalId: `stranger-${Date.now()}`, text } : { clientId: target, text });
                setText('');
              })
            }
          >
            Send through real ingest
          </button>
          <span className="muted">messages debounce like real traffic — watch triage after the window</span>
        </div>
      </div>
    </>
  );
}
