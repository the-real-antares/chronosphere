import { useAppState, useActions, type ToastKind } from '../state/store.tsx';

/** Toasts (screens.md §7): bottom-right stack, newest at bottom, kind-colored rail. */

const KIND_CLASS: Record<ToastKind, string> = {
  ok: 'ok',
  err: 'err',
  flavor: 'flavor',
  info: '',
};

export function ToastLayer() {
  const { toasts } = useAppState();
  const actions = useActions();

  return (
    <div className="toast-layer" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${KIND_CLASS[toast.kind]}`.trim()}>
          <span className="toast-glyph">{toast.glyph}</span>
          <div className="toast-body">
            <div className="toast-title">{toast.title}</div>
            {toast.sub !== null ? <div className="toast-sub">{toast.sub}</div> : null}
            {toast.actionLabel !== null ? (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  toast.onAction?.();
                  actions.dismissToast(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => actions.dismissToast(toast.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
