import { Component, type ReactNode } from 'react';

/** If one page crashes, show a calm message on that page and keep the rest of the app (and the page selector) working. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="glass mt-8 rounded-3xl p-6">
        <h1 className="font-display text-3xl">Something went wrong on this page</h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Your data is safe. Pick another page from the round button, or reload.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-11 rounded-full bg-[var(--accent)] px-5 text-sm font-medium text-white"
        >
          Reload
        </button>
      </div>
    );
  }
}
