import React from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, Copy, Check } from './ui/Icons';
import { Button, Panel } from './ui/Primitives';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
    this.setState({ errorInfo: info });
  }

  handleCopy = async () => {
    const text = [
      `Error: ${this.state.error?.message || 'Unknown error'}`,
      '',
      this.state.error?.stack || '',
      '',
      this.state.errorInfo?.componentStack || '',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {}
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { copied } = this.state;

    return (
      <div className="flex min-h-screen items-center justify-center bg-app-bg p-4 text-white sm:p-8">
        <Panel className="w-full max-w-lg p-5 sm:p-7" style={{ animation: 'fadeIn 180ms ease forwards' }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-gray-100">Something went wrong</h1>
              <p className="mt-1 text-sm text-gray-400">
                An unexpected UI error occurred. Reload the page to recover.
              </p>

              {this.state.error?.message && (
                <pre className="mt-3 overflow-x-auto rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-xs text-red-300 font-mono leading-relaxed max-h-32">
                  {this.state.error.message}
                </pre>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  onClick={() => window.location.reload()}
                  variant="primary"
                  icon={RefreshCw}
                >
                  Reload page
                </Button>
                <Button
                  onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                  variant="outline"
                  icon={RotateCcw}
                >
                  Try again
                </Button>
                <Button
                  onClick={this.handleCopy}
                  variant="ghost"
                  icon={copied ? Check : Copy}
                >
                  {copied ? 'Copied' : 'Copy error'}
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    );
  }
}
