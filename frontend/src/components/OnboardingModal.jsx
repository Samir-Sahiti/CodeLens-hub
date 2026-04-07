import { useState, useEffect, useRef } from 'react';

const STEPS = [
  {
    title: 'Welcome to CodeLens',
    description:
      'Understand any codebase in minutes, not days. CodeLens indexes your repositories and gives you a complete picture of how everything connects.',
    illustration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* Central lens/eye motif */}
        <ellipse cx="100" cy="80" rx="60" ry="36" stroke="#6366f1" strokeWidth="2" strokeOpacity="0.4" />
        <ellipse cx="100" cy="80" rx="60" ry="36" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.15" strokeDasharray="4 4" />
        <circle cx="100" cy="80" r="18" fill="#6366f1" fillOpacity="0.15" stroke="#6366f1" strokeWidth="1.5" />
        <circle cx="100" cy="80" r="9" fill="#6366f1" fillOpacity="0.4" />
        <circle cx="100" cy="80" r="3.5" fill="#818cf8" />
        {/* Radiating lines */}
        {[0, 60, 120, 180, 240, 300].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const x1 = 100 + 22 * Math.cos(rad);
          const y1 = 80 + 22 * Math.sin(rad) * 0.6;
          const x2 = 100 + 56 * Math.cos(rad);
          const y2 = 80 + 56 * Math.sin(rad) * 0.6;
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6366f1" strokeWidth="1" strokeOpacity="0.3" />
          );
        })}
        {/* Small orbiting dots */}
        {[30, 150, 270].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const x = 100 + 52 * Math.cos(rad);
          const y = 80 + 52 * Math.sin(rad) * 0.6;
          return <circle key={i} cx={x} cy={y} r="4" fill="#6366f1" fillOpacity="0.5" />;
        })}
        {/* Code lines suggestion */}
        <rect x="20" y="120" width="40" height="4" rx="2" fill="#4b5563" />
        <rect x="20" y="128" width="28" height="4" rx="2" fill="#374151" />
        <rect x="140" y="120" width="40" height="4" rx="2" fill="#4b5563" />
        <rect x="148" y="128" width="28" height="4" rx="2" fill="#374151" />
      </svg>
    ),
  },
  {
    title: 'Connect a Repo',
    description:
      'Connect a GitHub repo or upload a project — we\'ll index it and map how everything connects. Supports JavaScript, TypeScript, Python, and C#.',
    illustration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* GitHub-style repo icon */}
        <rect x="60" y="30" width="80" height="100" rx="8" fill="#1f2937" stroke="#374151" strokeWidth="1.5" />
        {/* Branch lines */}
        <line x1="80" y1="55" x2="80" y2="110" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.6" />
        <line x1="80" y1="75" x2="110" y2="95" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.6" />
        <circle cx="80" cy="55" r="5" fill="#6366f1" />
        <circle cx="80" cy="110" r="5" fill="#6366f1" fillOpacity="0.6" />
        <circle cx="110" cy="95" r="5" fill="#818cf8" />
        {/* File lines */}
        <rect x="90" y="42" width="30" height="3" rx="1.5" fill="#4b5563" />
        <rect x="90" y="49" width="22" height="3" rx="1.5" fill="#374151" />
        {/* Upload arrow */}
        <path d="M100 140 L100 125 M93 132 L100 125 L107 132" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7" />
        {/* Dots suggesting connection */}
        <circle cx="40" cy="80" r="5" fill="#6366f1" fillOpacity="0.3" />
        <circle cx="160" cy="80" r="5" fill="#6366f1" fillOpacity="0.3" />
        <line x1="45" y1="80" x2="60" y2="80" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="3 3" />
        <line x1="140" y1="80" x2="155" y2="80" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="3 3" />
      </svg>
    ),
  },
  {
    title: 'Explore the Graph',
    description:
      'Explore the dependency graph — see which files are critical, risky, or unused at a glance. Colour-coded nodes reveal architectural issues instantly.',
    illustration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* Graph nodes and edges */}
        {/* Edges */}
        <line x1="100" y1="80" x2="60" y2="45" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.4" />
        <line x1="100" y1="80" x2="145" y2="50" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.4" />
        <line x1="100" y1="80" x2="55" y2="118" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.4" />
        <line x1="100" y1="80" x2="148" y2="115" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.4" />
        <line x1="60" y1="45" x2="30" y2="70" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.25" />
        <line x1="145" y1="50" x2="170" y2="75" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.25" />
        <line x1="55" y1="118" x2="28" y2="115" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.25" />
        <line x1="148" y1="115" x2="170" y2="130" stroke="#6366f1" strokeWidth="1" strokeOpacity="0.25" />
        {/* Central large node */}
        <circle cx="100" cy="80" r="14" fill="#6366f1" fillOpacity="0.25" stroke="#6366f1" strokeWidth="2" />
        <circle cx="100" cy="80" r="6" fill="#6366f1" />
        {/* Satellite nodes */}
        <circle cx="60" cy="45" r="9" fill="#3b82f6" fillOpacity="0.2" stroke="#3b82f6" strokeWidth="1.5" />
        <circle cx="60" cy="45" r="4" fill="#60a5fa" />
        <circle cx="145" cy="50" r="9" fill="#3b82f6" fillOpacity="0.2" stroke="#3b82f6" strokeWidth="1.5" />
        <circle cx="145" cy="50" r="4" fill="#60a5fa" />
        {/* Risk node (red) */}
        <circle cx="55" cy="118" r="9" fill="#ef4444" fillOpacity="0.15" stroke="#ef4444" strokeWidth="1.5" />
        <circle cx="55" cy="118" r="4" fill="#ef4444" />
        <circle cx="148" cy="115" r="7" fill="#facc15" fillOpacity="0.15" stroke="#facc15" strokeWidth="1.5" />
        <circle cx="148" cy="115" r="3" fill="#facc15" />
        {/* Outer small nodes */}
        <circle cx="30" cy="70" r="5" fill="#4b5563" stroke="#374151" strokeWidth="1" />
        <circle cx="170" cy="75" r="5" fill="#4b5563" stroke="#374151" strokeWidth="1" />
        <circle cx="28" cy="115" r="5" fill="#4b5563" stroke="#374151" strokeWidth="1" />
        <circle cx="170" cy="130" r="5" fill="#4b5563" stroke="#374151" strokeWidth="1" />
      </svg>
    ),
  },
  {
    title: 'Ask Questions',
    description:
      'Ask anything — natural language search tells you how features work without digging through files. Powered by AI with full code context.',
    illustration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        {/* Search bar */}
        <rect x="30" y="35" width="140" height="32" rx="8" fill="#1f2937" stroke="#374151" strokeWidth="1.5" />
        <circle cx="52" cy="51" r="7" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.7" />
        <line x1="57" y1="56" x2="62" y2="61" stroke="#6366f1" strokeWidth="1.5" strokeOpacity="0.7" strokeLinecap="round" />
        <rect x="68" y="47" width="60" height="4" rx="2" fill="#4b5563" />
        <rect x="68" y="55" width="40" height="3" rx="1.5" fill="#374151" />
        {/* Answer block */}
        <rect x="30" y="80" width="140" height="55" rx="8" fill="#111827" stroke="#1f2937" strokeWidth="1.5" />
        {/* AI indicator */}
        <circle cx="46" cy="96" r="7" fill="#6366f1" fillOpacity="0.2" stroke="#6366f1" strokeWidth="1" />
        <path d="M43 96 L46 93 L49 96 L46 99 Z" fill="#818cf8" />
        {/* Answer lines */}
        <rect x="60" y="91" width="70" height="3" rx="1.5" fill="#4b5563" />
        <rect x="60" y="98" width="90" height="3" rx="1.5" fill="#374151" />
        {/* Code snippet */}
        <rect x="40" y="108" width="110" height="18" rx="4" fill="#0f172a" stroke="#1e293b" strokeWidth="1" />
        <rect x="48" y="113" width="50" height="3" rx="1.5" fill="#6366f1" fillOpacity="0.5" />
        <rect x="48" y="119" width="35" height="3" rx="1.5" fill="#374151" />
        {/* Sparkle hints */}
        <circle cx="170" cy="35" r="2.5" fill="#818cf8" fillOpacity="0.6" />
        <circle cx="30" cy="145" r="2" fill="#6366f1" fillOpacity="0.4" />
      </svg>
    ),
  },
];

export default function OnboardingModal({ isOpen, onClose }) {
  const [currentStep, setCurrentStep] = useState(0);
  const closeButtonRef = useRef(null);
  const modalRef = useRef(null);

  // Focus trap and ESC key handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleSkip();
      }
      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Auto-focus the first interactive element
    setTimeout(() => {
      if (closeButtonRef.current) closeButtonRef.current.focus();
    }, 50);

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Reset step when modal reopens
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
    } else {
      setCurrentStep((s) => s + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) setCurrentStep((s) => s - 1);
  };

  const handleSkip = () => {
    completeOnboarding();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      aria-label="Onboarding overlay"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="flex w-full max-w-lg flex-col rounded-xl bg-gray-900 border border-gray-800 shadow-2xl overflow-hidden"
      >
        {/* Illustration area */}
        <div className="relative bg-gray-950/60 border-b border-gray-800 h-44 flex items-center justify-center px-8">
          <div className="w-48 h-36 opacity-90 transition-opacity duration-300">
            {step.illustration}
          </div>
          {/* Step counter pill */}
          <div className="absolute top-4 right-4 rounded-full bg-gray-800/80 border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-400">
            {currentStep + 1} / {STEPS.length}
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-5 p-6">
          <div className="space-y-2">
            <h2
              id="onboarding-title"
              className="text-xl font-semibold text-white tracking-tight"
            >
              {step.title}
            </h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              {step.description}
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2" aria-hidden="true">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`rounded-full transition-all duration-300 ${
                  i === currentStep
                    ? 'w-5 h-2 bg-indigo-500'
                    : i < currentStep
                    ? 'w-2 h-2 bg-indigo-500/40'
                    : 'w-2 h-2 bg-gray-700'
                }`}
              />
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button
              onClick={handleSkip}
              ref={closeButtonRef}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded"
            >
              Skip
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handlePrev}
                disabled={isFirst}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors border ${
                  isFirst
                    ? 'border-gray-800 text-gray-700 cursor-not-allowed'
                    : 'border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                Back
              </button>

              <button
                onClick={handleNext}
                className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-sm transition-colors"
              >
                {isLast ? 'Get started' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
