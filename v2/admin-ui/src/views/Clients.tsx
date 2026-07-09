import { get, post, type ClientRow } from '../api.js';
import { reportError, usePoll } from '../App.js';

export function Clients({ openClient }: { openClient: (id: string) => void }) {
  const { data, refresh } = usePoll(() => get<ClientRow[]>('/clients'));

  const act = (fn: () => Promise<unknown>) => fn().then(refresh).catch(reportError);

  if (data === undefined) return <p className="muted">loading…</p>;
  return (
    <>
      <h2>Clients</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Status</th><th>Streak</th><th>Timezone</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.id} className="click" onClick={() => openClient(c.id)}>
              <td>{c.displayName}</td>
              <td><span className="tag">{c.status}</span></td>
              <td>{c.streak}</td>
              <td className="muted">{c.timezone}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <div className="row" style={{ marginTop: 0 }}>
                  {c.status === 'pending_verification' && (
                    <button onClick={() => act(() => post(`/clients/${c.id}/verify`))}>Verify</button>
                  )}
                  {c.status !== 'blocked' ? (
                    <button className="ghost" onClick={() => act(() => post(`/clients/${c.id}/block`))}>Block</button>
                  ) : (
                    <button onClick={() => act(() => post(`/clients/${c.id}/unblock`))}>Unblock</button>
                  )}
                  <button
                    className="warn"
                    onClick={() =>
                      confirm(`Reset ${c.displayName}? Wipes messages & compliance; keeps the client + audit.`) &&
                      act(() => post(`/clients/${c.id}/reset`))
                    }
                  >
                    Reset
                  </button>
                  <button
                    className="warn"
                    onClick={() =>
                      confirm(`DELETE ${c.displayName} entirely? This cannot be undone (audit survives).`) &&
                      act(() => post(`/clients/${c.id}/delete`))
                    }
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
