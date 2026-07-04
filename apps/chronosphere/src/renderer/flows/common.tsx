import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PreviewData } from '../../ipc.ts';
import { useStore } from '../state/store.tsx';

/**
 * Shared flow plumbing: the modal shell, local-preview thumbnails (decoded
 * embedded previews via IPC), the Discord / DEV-MODE sign-in pathway, and the
 * external-link helper. Owned by the flows tree.
 */

/**
 * Open a URL outside the app. The renderer-side call is window.open — main.ts's
 * setWindowOpenHandler routes http(s) URLs through shell.openExternal and
 * denies the in-app window, so this always lands in the system browser.
 */
export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Website install-tutorials URL for this platform (ARCHITECTURE.md web routes). */
export function tutorialsUrl(apiBase: string, platform: string): string {
  const slug =
    platform === 'darwin'
      ? 'macos'
      : platform === 'win32'
        ? 'windows'
        : platform === 'linux'
          ? 'linux'
          : 'client';
  return `${apiBase.replace(/\/+$/, '')}/tutorials/${slug}`;
}

// ---------------------------------------------------------------------------
// Modal shell (scrim + panel; click-outside closes)

export function ModalShell(props: {
  className?: string | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  const { className, onClose, children } = props;
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${className !== undefined ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader(props: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-header">
      {props.children}
      <button type="button" className="modal-close" aria-label="Close" onClick={props.onClose}>
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local preview thumbnail — embedded PreviewPack decoded in main, drawn here.

export function LocalPreviewThumb(props: {
  path: string;
  size: number;
  frameClassName?: string | undefined;
}) {
  const { path, size } = props;
  const frame = props.frameClassName ?? 'pick-thumb';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  useEffect(() => {
    let live = true;
    setPreview(null);
    window.chrono.preview
      .getPreview(path)
      .then((data) => {
        if (live) setPreview(data);
      })
      .catch(() => {
        if (live) setPreview(null);
      });
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || preview === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const bin = atob(preview.rgbBase64);
    const px = preview.width * preview.height;
    const rgba = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) {
      rgba[i * 4] = bin.charCodeAt(i * 3);
      rgba[i * 4 + 1] = bin.charCodeAt(i * 3 + 1);
      rgba[i * 4 + 2] = bin.charCodeAt(i * 3 + 2);
      rgba[i * 4 + 3] = 255;
    }
    ctx.putImageData(new ImageData(rgba, preview.width, preview.height), 0, 0);
  }, [preview]);

  const frameStyle: CSSProperties = { width: size, height: size };
  if (preview === null) {
    // Placeholder tile — never a broken image (spec §4.3).
    return <div className={`${frame} thumb-placeholder`} style={frameStyle} aria-hidden="true" />;
  }
  return (
    <canvas
      ref={canvasRef}
      width={preview.width}
      height={preview.height}
      className={frame}
      style={{ ...frameStyle, imageRendering: 'pixelated', objectFit: 'cover' }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Sign-in pathway: probe auth mode → Discord (external) or DEV MODE (labeled).

export function SignInControls(props: {
  onSignedIn?: (() => void) | undefined;
  onExternalOpened?: (() => void) | undefined;
  align?: 'start' | 'center' | undefined;
}) {
  const { state, actions, api } = useStore();
  const [devOpen, setDevOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  // Fire onSignedIn on the session flip (covers both the dev path and a
  // completed external sign-in confirmed via "check again").
  const onSignedInRef = useRef(props.onSignedIn);
  onSignedInRef.current = props.onSignedIn;
  const signedIn = state.session.signedIn;
  const prevSignedIn = useRef(signedIn);
  useEffect(() => {
    if (signedIn && !prevSignedIn.current) onSignedInRef.current?.();
    prevSignedIn.current = signedIn;
  }, [signedIn]);

  const start = async (): Promise<void> => {
    if (busy) return;
    setNote(null);
    setBusy(true);
    const mode = await actions.checkAuthMode();
    setBusy(false);
    if (mode === 'dev') {
      setDevOpen(true);
      return;
    }
    if (mode === 'discord') {
      setWaiting(true);
      props.onExternalOpened?.();
      const ok = await actions.signInWithDiscord();
      setWaiting(false);
      if (!ok) setNote('Sign-in didn’t complete — try again.');
      return;
    }
    setNote('Couldn’t reach the server — try again, or sign in later from Settings.');
  };

  const devSubmit = async (): Promise<void> => {
    const h = handle.trim();
    if (h === '' || busy) return;
    setBusy(true);
    await actions.devSignIn(h);
    setBusy(false);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: props.align === 'start' ? 'flex-start' : 'center',
      }}
    >
      {devOpen ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="chip chip-flag-gold">DEV MODE</span>
          <input
            className="input"
            style={{ width: 180 }}
            placeholder="Discord handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void devSubmit();
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || handle.trim() === ''}
            onClick={() => void devSubmit()}
          >
            Sign in
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-discord" disabled={busy} onClick={() => void start()}>
          Sign in with Discord
        </button>
      )}
      {waiting ? (
        <button type="button" className="link link-dim" onClick={() => void actions.checkSession()}>
          Signed in from the browser? Check again
        </button>
      ) : null}
      {note !== null ? (
        <div style={{ fontSize: 11.5, color: 'var(--error-text)' }}>{note}</div>
      ) : null}
    </div>
  );
}

/** Centered sign-in step body (contribute + review modals). */
export function SignInStep(props: {
  heading: string;
  body: string;
  onSignedIn?: (() => void) | undefined;
}) {
  return (
    <div style={{ textAlign: 'center', padding: '18px 8px' }}>
      <div className="pane-state-title" style={{ marginBottom: 8 }}>
        {props.heading}
      </div>
      <div className="onb-body-sm" style={{ maxWidth: 360, margin: '0 auto 16px' }}>
        {props.body}
      </div>
      <SignInControls onSignedIn={props.onSignedIn} />
    </div>
  );
}
