import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store.tsx';
import { openExternal, SignInControls, tutorialsUrl } from './common.tsx';

/**
 * First-run onboarding (screens.md §1 + DESIGN.md §1): five steps with the
 * step indicator and back navigation. Step 4 runs the REAL first sync + scan
 * (catalog load + folder scan) and lands in the library via
 * actions.completeOnboarding — which fires the summary toast with real counts.
 *
 * Failure variants handled per spec: zero local maps → completes normally
 * (empty disk pane encourages browsing); catalog sync fails but the scan
 * works → still completes, the archive pane lands in its connection-lost
 * state (a short note flags it here too).
 */

const STEP_COUNT = 5;

type SyncPhase = 'idle' | 'sync' | 'scan' | 'done';

export function OnboardingFlow() {
  const { state, actions } = useStore();

  const [step, setStep] = useState(0);

  // --- step 1: folders -------------------------------------------------------
  const [folders, setFolders] = useState<string[]>(() =>
    (state.settings?.gameFolders ?? []).map((f) => f.path),
  );
  const [detected, setDetected] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const detectRan = useRef(false);
  const [chooseOpen, setChooseOpen] = useState(false);
  const [choosePath, setChoosePath] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  const [checkingPath, setCheckingPath] = useState(false);
  const [platform, setPlatform] = useState('');

  // --- step 4: first sync + scan ----------------------------------------------
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle');
  const [syncPct, setSyncPct] = useState(0);
  const syncStarted = useRef(false);
  const [finishing, setFinishing] = useState(false);
  // Catalog-sync failure is read reactively — spec variant (b): the scan still
  // completes and the archive pane lands in its connection-lost state.
  const syncFailed = syncPhase !== 'idle' && syncPhase !== 'sync' && state.archive.error !== null;

  useEffect(() => {
    window.chrono
      .appInfo()
      .then((info) => setPlatform(info.platform))
      .catch(() => {
        /* tutorials link falls back to the generic page */
      });
  }, []);

  // Auto-detect installs the first time the locate step is shown.
  useEffect(() => {
    if (step !== 1 || detectRan.current) return;
    detectRan.current = true;
    setDetecting(true);
    actions
      .autoDetectFolders()
      .then((paths) => {
        setDetected(paths);
        setFolders((cur) => {
          const first = paths[0];
          return cur.length === 0 && first !== undefined ? [first] : cur;
        });
      })
      .catch(() => {
        /* no detection — the choose-folder path still works */
      })
      .finally(() => setDetecting(false));
  }, [step, actions]);

  // Step 4: persist the folders, then real combined progress — catalog sync
  // (0–50) then the folder scan (50–100, from real ScanProgress events).
  useEffect(() => {
    if (step !== 4 || syncStarted.current) return;
    syncStarted.current = true;
    void (async () => {
      setSyncPhase('sync');
      await actions.updateSettings({
        gameFolders: folders.map((path, i) => ({ path, isDefault: i === 0 })),
      });
      await actions.loadArchive(true);
      setSyncPhase('scan');
      await actions.rescan(true);
      setSyncPhase('done');
    })();
  }, [step, actions, folders]);

  // The catalog side has no granular progress — tick toward 45 while it runs.
  useEffect(() => {
    if (syncPhase !== 'sync') return;
    const timer = window.setInterval(() => setSyncPct((p) => Math.min(45, p + 3)), 130);
    return () => window.clearInterval(timer);
  }, [syncPhase]);

  const scanProgress = state.disk.scanProgress;
  const pct =
    syncPhase === 'done'
      ? 100
      : syncPhase === 'scan'
        ? scanProgress !== null && scanProgress.total > 0
          ? Math.min(99, Math.max(50, Math.round(50 + (scanProgress.done / scanProgress.total) * 49)))
          : 50
        : syncPct;

  const counts = state.disk.counts;
  const progressLabel =
    syncPhase === 'done'
      ? `Scanned ${counts.total} maps · ${counts.unknown} we’ve never seen · ${counts.broken} look broken.`
      : syncPhase === 'scan'
        ? 'Scanning your folder…'
        : 'Syncing the catalog…';

  const addChosenPath = async (): Promise<void> => {
    const p = choosePath.trim();
    if (p === '' || checkingPath) return;
    setCheckingPath(true);
    setPathError(null);
    try {
      const v = await window.chrono.gameFolder.validate(p);
      if (!v.ok) {
        setPathError(v.reason);
        return;
      }
      setFolders((cur) => (cur.includes(p) ? cur : [...cur, p]));
      setChoosePath('');
      setChooseOpen(false);
    } finally {
      setCheckingPath(false);
    }
  };

  const finish = (): void => {
    if (finishing) return;
    setFinishing(true);
    void actions.completeOnboarding(folders);
  };

  const apiBase = state.settings?.apiBase ?? 'http://localhost:3000';
  const unaddedDetected = detected.filter((p) => !folders.includes(p));

  return (
    <div className="onboarding">
      <div className="onb-steps">
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <div
            key={i}
            className={`onb-step-bar${i < step ? ' done' : i === step ? ' active' : ''}`}
          />
        ))}
      </div>
      <div className="onb-content">
        {step === 0 ? (
          <div className="onb-card centered starfield">
            <div className="onb-mark">
              <span className="onb-mark-pip" />
              <span className="onb-eyebrow">The Real Antares</span>
            </div>
            <div className="display-title">Chronosphere</div>
            <p className="onb-body" style={{ margin: '18px 0 0' }}>
              Point me at your game and I’ll take it from here. Browse a verified archive of the
              community’s maps, see your own folder scored against it, and install anything with one
              chronoshift.
            </p>
            <div className="onb-nav" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-primary btn-cta" onClick={() => setStep(1)}>
                Get started →
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="onb-card">
            <div className="onb-eyebrow gold">Step 2 // Locate your game</div>
            <div className="h-screen" style={{ margin: '10px 0 8px' }}>
              {folders.length > 0 || detected.length > 0 ? 'Found your install' : detecting ? 'Looking…' : 'No install detected'}
            </div>
            <p className="onb-body-sm" style={{ margin: '0 0 8px' }}>
              {folders.length > 0 || detected.length > 0
                ? 'We auto-detected a Yuri’s Revenge install. Confirm it, or choose another folder.'
                : 'Choose the folder your Yuri’s Revenge install lives in — Chronosphere checks it looks right.'}
            </p>

            {folders.map((path) => (
              <div key={path} className="detected-card">
                <span className="pip-green" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="detected-path" title={path}>
                    {path}
                  </div>
                  <div className="detected-sub">looks like a valid YR install ✓</div>
                </div>
                <button
                  type="button"
                  className="modal-close"
                  title="Remove"
                  aria-label={`Remove ${path}`}
                  onClick={() => setFolders((cur) => cur.filter((p) => p !== path))}
                >
                  ✕
                </button>
              </div>
            ))}
            {unaddedDetected.map((path) => (
              <div key={path} className="detected-card" style={{ borderColor: 'var(--line)' }}>
                <span className="pip-green" style={{ opacity: 0.4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="detected-path" title={path}>
                    {path}
                  </div>
                  <div className="detected-sub">also detected</div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFolders((cur) => (cur.includes(path) ? cur : [...cur, path]))}
                >
                  + Add
                </button>
              </div>
            ))}
            {detecting ? <div className="onb-body-sm">Looking for installs…</div> : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setChooseOpen((v) => !v)}
              >
                Choose folder…
              </button>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              <button
                type="button"
                className="link link-dim"
                onClick={() => openExternal(tutorialsUrl(apiBase, platform))}
              >
                Can’t find it?
              </button>
            </div>
            {chooseOpen ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                  className="input mono"
                  style={{ fontSize: 12.5 }}
                  placeholder="Path to your Yuri’s Revenge folder"
                  value={choosePath}
                  onChange={(e) => {
                    setChoosePath(e.target.value);
                    setPathError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addChosenPath();
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={checkingPath || choosePath.trim() === ''}
                  onClick={() => void addChosenPath()}
                >
                  Add
                </button>
              </div>
            ) : null}
            {pathError !== null ? (
              <div style={{ color: 'var(--error-text)', fontSize: 12, marginTop: 8 }}>
                ⚠ {pathError}
              </div>
            ) : null}

            <div className="onb-nav">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(0)}>
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={folders.length === 0}
                onClick={() => setStep(2)}
              >
                Confirm →
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="onb-card">
            <div className="onb-eyebrow gold">Step 3 // Folder permission</div>
            <div className="h-screen" style={{ margin: '10px 0 14px' }}>
              Plain and simple
            </div>
            <div className="consent-row">
              <span className="consent-glyph yes">✓</span>
              <span>Chronosphere reads the maps in this folder to score them against the archive.</span>
            </div>
            <div className="consent-row">
              <span className="consent-glyph yes">✓</span>
              <span>It only writes or removes files when you ask — chronoshift, quarantine, tidy.</span>
            </div>
            <div className="consent-row">
              <span className="consent-glyph no">✕</span>
              <span>Nothing is deleted silently. Removals go to a recoverable quarantine.</span>
            </div>
            <div className="onb-nav">
              <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
                Allow access →
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="onb-card centered">
            <div className="onb-eyebrow gold">Step 4 // Optional</div>
            <div className="h-screen" style={{ margin: '10px 0 8px' }}>
              Sign in with Discord
            </div>
            <p className="onb-body-sm" style={{ margin: '0 0 20px' }}>
              To review, tag, and contribute — the community already lives there. Browsing,
              installing, and scanning need no account.
            </p>
            <SignInControls
              onSignedIn={() => setStep(4)}
              onExternalOpened={() => setStep(4)}
            />
            <div className="onb-nav" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setStep(4)}>
                Skip for now
              </button>
            </div>
            <button
              type="button"
              className="link link-dim"
              style={{ marginTop: 8 }}
              onClick={() => setStep(2)}
            >
              ← Back
            </button>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="onb-card narrow-card centered">
            <div className="onb-eyebrow gold">Step 5 // First sync + scan</div>
            <div className="h-screen" style={{ margin: '10px 0 8px' }}>
              Getting your bearings
            </div>
            <div className="onb-progress-track">
              <div className="onb-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="onb-progress-label">{progressLabel}</div>
            {syncFailed ? (
              <div style={{ fontSize: 12, color: 'var(--error-text)', marginTop: 8 }}>
                Couldn’t reach the archive — your disk still works. Retry from the library.
              </div>
            ) : null}
            {syncPhase === 'done' ? (
              <div className="onb-nav" style={{ justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-cta"
                  disabled={finishing}
                  onClick={finish}
                >
                  Enter Chronosphere →
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
