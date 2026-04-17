import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-8">
        <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900/60 p-7 shadow-2xl shadow-black/40">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/20">
              <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0 3h.01M10.25 4.5h3.5c.54 0 1.04.29 1.3.76l6.2 11.17c.56 1.01-.17 2.32-1.32 2.32H4.07c-1.15 0-1.88-1.31-1.32-2.32l6.2-11.17c.26-.47.76-.76 1.3-.76z" />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-semibold text-gray-100">Something went wrong</h1>
              <p className="mt-1 text-sm text-gray-400">
                An unexpected UI error occurred. Reload the page to recover.
              </p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition shadow-sm"
                >
                  Reload page
                </button>
                <button
                  onClick={() => this.setState({ hasError: false })}
                  className="rounded-xl border border-gray-700 bg-transparent px-4 py-2 text-sm font-semibold text-gray-200 hover:bg-gray-800 hover:border-gray-500 transition"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

