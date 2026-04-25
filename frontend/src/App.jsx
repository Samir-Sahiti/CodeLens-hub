import { Suspense, lazy } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider }    from './context/AuthContext';
import { RepoProvider }    from './context/RepoContext';
import ProtectedRoute      from './components/ProtectedRoute';
import { ToastProvider }   from './components/Toast';
import ErrorBoundary       from './components/ErrorBoundary';
import { LoadingMark }     from './components/ui/Primitives';

const Login        = lazy(() => import('./pages/Login'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const RepoView     = lazy(() => import('./pages/RepoView'));

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <div key={location.pathname}>
      <Suspense fallback={<LoadingMark label="Loading page..." />}>
        <Routes location={location}>
          {/* Public */}
          <Route path="/login"         element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Protected — unauthenticated users are sent to /login */}
          <Route element={<RepoProvider><ProtectedRoute /></RepoProvider>}>
            <Route path="/"            element={<Dashboard />} />
            <Route path="/dashboard"   element={<Dashboard />} />
            <Route path="/repo/:repoId" element={<RepoView />} />
          </Route>
        </Routes>
      </Suspense>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <AnimatedRoutes />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
