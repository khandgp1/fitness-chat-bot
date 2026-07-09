import { useCallback, useEffect, useState } from 'react';
import { ApiError, get, post } from './api.js';
import { Clients } from './views/Clients.js';
import { ClientDetail } from './views/ClientDetail.js';
import { DevPanel } from './views/DevPanel.js';
import { Triage } from './views/Triage.js';

type View = { name: 'triage' } | { name: 'clients' } | { name: 'dev' } | { name: 'client'; id: string };

export function App() {
  const [authed, setAuthed] = useState<boolean | undefined>(undefined);
  const [view, setView] = useState<View>({ name: 'triage' });
  const [token, setToken] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    get('/triage').then(
      () => setAuthed(true),
      (e: unknown) => setAuthed(e instanceof ApiError && e.status === 401 ? false : true)
    );
  }, []);

  const login = useCallback(async () => {
    try {
      await post('/login', { token });
      setAuthed(true);
    } catch {
      setLoginError('Invalid token');
    }
  }, [token]);

  const openClient = useCallback((id: string) => setView({ name: 'client', id }), []);

  if (authed === undefined) return null;
  if (!authed) {
    return (
      <div className="login card">
        <h3>Coach Admin</h3>
        <input
          type="password"
          placeholder="admin token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void login()}
        />
        <div className="row">
          <button onClick={() => void login()}>Log in</button>
          <span className="muted">{loginError}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <HealthBanner />
      <nav>
        <span className="brand">Coach Admin</span>
        <button className={view.name === 'triage' ? 'active' : 'ghost'} onClick={() => setView({ name: 'triage' })}>
          Triage
        </button>
        <button className={view.name === 'clients' ? 'active' : 'ghost'} onClick={() => setView({ name: 'clients' })}>
          Clients
        </button>
        <button className={view.name === 'dev' ? 'active' : 'ghost'} onClick={() => setView({ name: 'dev' })}>
          Dev
        </button>
      </nav>
      <main>
        {view.name === 'triage' && <Triage openClient={openClient} />}
        {view.name === 'clients' && <Clients openClient={openClient} />}
        {view.name === 'client' && <ClientDetail id={view.id} back={() => setView({ name: 'clients' })} />}
        {view.name === 'dev' && <DevPanel />}
      </main>
    </>
  );
}

function HealthBanner() {
  const { data } = usePoll(() => get<{ warnings: string[] }>('/health'));
  if (data === undefined || data.warnings.length === 0) return null;
  return (
    <div style={{ background: '#744210', padding: '8px 20px', fontSize: 13 }}>
      ⚠ {data.warnings.join(' · ')}
    </div>
  );
}

/** Poll helper: refetch every 5s (Phase 1 accepted polling). */
export function usePoll<T>(fetcher: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; refresh: () => void } {
  const [data, setData] = useState<T>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () => fetcher().then((d) => live && setData(d), () => undefined);
    void run();
    const t = setInterval(run, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, refresh: () => setTick((n) => n + 1) };
}

export function reportError(err: unknown): void {
  alert(err instanceof Error ? err.message : String(err));
}
