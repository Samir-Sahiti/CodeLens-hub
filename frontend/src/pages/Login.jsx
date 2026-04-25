import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Button, Badge, Panel, Banner } from '../components/ui/Primitives';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Code2,
  GitBranch,
  GitGraph,
  Search,
  ShieldAlert,
} from '../components/ui/Icons';

const CAPABILITIES = [
  { icon: GitGraph, label: 'Dependency graph', value: 'file-level impact map' },
  { icon: Search, label: 'Semantic search', value: 'answers with sources' },
  { icon: ShieldAlert, label: 'Risk triage', value: 'security and architecture issues' },
  { icon: BarChart3, label: 'Metrics', value: 'complexity, coupling, health' },
];

function ProductPreview() {
  const nodes = [
    { x: 54, y: 52, r: 9, c: '#4f8cff' },
    { x: 128, y: 40, r: 7, c: '#22c55e' },
    { x: 190, y: 78, r: 11, c: '#f59e0b' },
    { x: 116, y: 128, r: 8, c: '#8b5cf6' },
    { x: 222, y: 146, r: 6, c: '#ef4444' },
  ];
  const edges = [[0, 1], [1, 2], [0, 3], [3, 4], [2, 4]];

  return (
    <Panel className="relative overflow-hidden p-0">
      <div className="border-b border-surface-800 bg-surface-950/70 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Repository Intelligence</p>
            <h2 className="mt-1 font-mono text-sm font-semibold text-surface-50">api-platform</h2>
          </div>
          <Badge tone="success">Ready</Badge>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_18rem]">
        <div className="relative min-h-[21rem] border-b border-surface-800 bg-[radial-gradient(circle_at_45%_35%,rgba(79,140,255,0.14),transparent_18rem)] lg:border-b-0 lg:border-r">
          <svg viewBox="0 0 280 210" className="absolute inset-0 h-full w-full">
            {edges.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={nodes[a].x}
                y1={nodes[a].y}
                x2={nodes[b].x}
                y2={nodes[b].y}
                stroke="#64748b"
                strokeWidth="1.2"
                strokeOpacity="0.42"
              />
            ))}
            {nodes.map((node, i) => (
              <g key={i}>
                <circle cx={node.x} cy={node.y} r={node.r + 7} fill={node.c} opacity="0.08" />
                <circle cx={node.x} cy={node.y} r={node.r} fill={node.c} opacity="0.92" />
                <circle cx={node.x} cy={node.y} r={node.r} fill="none" stroke="#f8fafc" strokeOpacity="0.22" />
              </g>
            ))}
          </svg>
          <div className="absolute left-4 top-4 flex gap-2">
            <Badge tone="subtle">Canvas mode</Badge>
            <Badge tone="accent">Impact active</Badge>
          </div>
          <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            auth/session.ts has 4 direct and 17 transitive dependents.
          </div>
        </div>

        <div className="space-y-3 bg-surface-950/40 p-4">
          <div className="rounded-lg border border-surface-800 bg-surface-900/80 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-surface-500">Health</span>
              <span className="font-mono text-sm font-semibold text-emerald-300">87%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-800">
              <div className="h-full w-[87%] rounded-full bg-emerald-400" />
            </div>
          </div>
          {[
            ['High coupling', '3 files', 'text-amber-300'],
            ['Secrets', '0 found', 'text-emerald-300'],
            ['Circular deps', '1 chain', 'text-red-300'],
          ].map(([label, value, color]) => (
            <div key={label} className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-900/55 px-3 py-2">
              <span className="text-xs text-surface-400">{label}</span>
              <span className={`font-mono text-xs ${color}`}>{value}</span>
            </div>
          ))}
          <div className="rounded-lg border border-surface-800 bg-surface-900/55 p-3">
            <p className="text-xs uppercase tracking-[0.18em] text-surface-500">Ask CodeLens</p>
            <p className="mt-2 text-sm text-surface-200">Where is auth state refreshed?</p>
            <div className="mt-3 space-y-1.5">
              <div className="h-2 rounded bg-surface-700" />
              <div className="h-2 w-4/5 rounded bg-surface-800" />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default function Login() {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  if (session) return <Navigate to="/dashboard" replace />;

  const handleGitHubLogin = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin + '/auth/callback',
          scopes: 'repo',
        },
      });
      if (error) throw error;
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen app-shell-bg text-surface-100">
      <header className="border-b border-surface-800 bg-surface-950/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 font-mono text-xs font-bold text-accent-soft">
              CL
            </div>
            <span className="font-mono text-base font-bold tracking-tight text-white">CodeLens</span>
          </div>
          <Button onClick={handleGitHubLogin} loading={isLoading} icon={GitBranch} variant="outline">
            Sign in
          </Button>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
        <section>
          <Badge tone="accent" className="mb-5">
            <Activity className="mr-1.5 h-3.5 w-3.5" />
            Codebase command center
          </Badge>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Understand any repository without losing the thread.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-surface-300">
            CodeLens turns source code into an interactive map of dependencies, risk, metrics, and cited AI answers for engineers who need to move fast without guessing.
          </p>

          {error && (
            <Banner tone="danger" className="mt-6 max-w-xl">
              {error}
            </Banner>
          )}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button onClick={handleGitHubLogin} loading={isLoading} icon={GitBranch} variant="primary" size="lg">
              Sign in with GitHub
            </Button>
            <Button as="a" icon={ArrowRight} variant="outline" size="lg" href="https://github.com/Samir-Sahiti/CodeLens-hub" target="_blank" rel="noreferrer">
              View repository
            </Button>
          </div>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            {CAPABILITIES.map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-lg border border-surface-800 bg-surface-900/55 p-4">
                <Icon className="h-4 w-4 text-accent-soft" />
                <p className="mt-3 text-sm font-semibold text-surface-100">{label}</p>
                <p className="mt-1 text-sm text-surface-500">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="relative">
          <ProductPreview />
          <div className="mt-4 flex items-center gap-2 text-xs text-surface-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            Supports GitHub OAuth, uploaded archives, semantic search, AI review, SAST, SCA, and metrics.
          </div>
        </section>
      </main>
    </div>
  );
}
