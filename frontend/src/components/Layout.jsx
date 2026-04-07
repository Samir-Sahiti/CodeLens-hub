import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OnboardingModal from './OnboardingModal';

export default function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  // Show onboarding modal on first dashboard visit
  useEffect(() => {
    if (
      location.pathname === '/dashboard' &&
      !localStorage.getItem('codelens_onboarding_complete')
    ) {
      setIsOnboardingOpen(true);
    }
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
  };

  const navLinks = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  ];

  return (
    <div className="flex min-h-screen bg-gray-950">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-gray-800 bg-gray-900">
        <div className="flex h-16 items-center px-6 border-b border-gray-800">
          <span className="text-xl font-bold tracking-tight text-white">CodeLens</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navLinks.map((item) => {
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* User / Sign Out Footer */}
        <div className="border-t border-gray-800 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-8 w-8 overflow-hidden rounded-full bg-gray-800">
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400 uppercase">
                  {user?.email?.charAt(0) || user?.user_metadata?.user_name?.charAt(0) || '?'}
                </div>
              )}
            </div>
            <div className="flex flex-col text-sm">
              <span className="font-medium text-white truncate max-w-[140px]">
                {user?.user_metadata?.user_name || user?.email || 'User'}
              </span>
            </div>
          </div>

          {/* Show introduction again — positioned above sign out */}
          <button
            onClick={() => setIsOnboardingOpen(true)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors mb-1"
          >
            <InfoIcon className="h-4 w-4 shrink-0" />
            Show introduction again
          </button>

          <button
            onClick={handleSignOut}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <SignOutIcon className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />
    </div>
  );
}

// Simple SVG Icons
function HomeIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function SignOutIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}

function InfoIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}
