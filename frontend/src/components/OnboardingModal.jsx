import { useState, useEffect } from 'react';
import Modal from './ui/Modal';
import { Badge, Button } from './ui/Primitives';
import { BarChart3, GitBranch, GitGraph, Search } from './ui/Icons';

const STEPS = [
  {
    title: 'Map the repository',
    description: 'Connect GitHub or upload a project. CodeLens indexes files, dependencies, metrics, and issues into one workspace.',
    icon: GitBranch,
    preview: 'Indexing pipeline',
  },
  {
    title: 'Trace impact fast',
    description: 'Use the dependency graph to inspect critical files, dependents, clusters, and blast radius before changing code.',
    icon: GitGraph,
    preview: 'Graph and impact',
  },
  {
    title: 'Ask with sources',
    description: 'Search and file chat answer questions with cited snippets so you can verify the path from answer to code.',
    icon: Search,
    preview: 'Cited AI answers',
  },
  {
    title: 'Triage risk',
    description: 'Review complexity, coupling, architectural issues, hardcoded secrets, and dependency vulnerabilities in focused panels.',
    icon: BarChart3,
    preview: 'Metrics and risk',
  },
];

function StepPreview({ step }) {
  const Icon = step.icon;
  return (
    <div className="relative h-44 overflow-hidden border-b border-surface-800 bg-surface-950/70 px-4 py-6 sm:px-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(79,140,255,0.16),transparent_15rem)]" />
      <div className="relative mx-auto flex h-full max-w-sm flex-col justify-between rounded-xl border border-surface-800 bg-surface-900/75 p-4 shadow-panel">
        <div className="flex items-center justify-between">
          <Badge tone="accent">{step.preview}</Badge>
          <Icon className="h-4 w-4 text-accent-soft" />
        </div>
        <div className="space-y-2">
          <div className="h-2 w-4/5 rounded bg-surface-700" />
          <div className="h-2 w-2/3 rounded bg-surface-800" />
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="h-10 rounded-lg border border-surface-800 bg-surface-950/70" />
            <div className="h-10 rounded-lg border border-surface-800 bg-surface-950/70" />
            <div className="h-10 rounded-lg border border-surface-800 bg-surface-950/70" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingModal({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (isOpen) setCurrentStep(0);
  }, [isOpen]);

  if (!isOpen) return null;

  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;
  const step = STEPS[currentStep];

  const completeOnboarding = () => {
    localStorage.setItem('codelens_onboarding_complete', 'true');
    onClose();
  };

  const handleNext = () => {
    if (isLast) {
      completeOnboarding();
      return;
    }
    setCurrentStep(s => s + 1);
  };

  return (
    <Modal isOpen={isOpen} onClose={completeOnboarding} maxWidth="max-w-lg">
      <StepPreview step={step} />
      <div className="space-y-6 p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-surface-500">{currentStep + 1} of {STEPS.length}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">{step.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-surface-400">{step.description}</p>
        </div>

        <div className="flex items-center justify-center gap-2" aria-hidden="true">
          {STEPS.map((_, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentStep ? 'w-6 bg-accent' : 'w-1.5 bg-surface-700'}`} />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={completeOnboarding}>Skip</Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCurrentStep(s => Math.max(0, s - 1))} disabled={isFirst}>Back</Button>
            <Button variant="primary" onClick={handleNext}>{isLast ? 'Get started' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
