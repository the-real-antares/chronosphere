import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { StoreProvider } from './state/store.tsx';
import './styles/app.css';

/** Renderer entry: store provider + app shell behind a boot error boundary. */

interface BoundaryState {
  error: string | null;
}

class BootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('render crash:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <div className="boot-error">
          <div className="boot-error-glyph">⚠</div>
          <div className="boot-error-title">Chronosphere hit a wall.</div>
          <div className="boot-error-body">
            The screen crashed while rendering. Restart the app — your maps and quarantine are
            untouched on disk. Detail: {this.state.error}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('missing #root element');
createRoot(rootElement).render(
  <StrictMode>
    <BootErrorBoundary>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BootErrorBoundary>
  </StrictMode>,
);
