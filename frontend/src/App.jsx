import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { RepoProvider } from './context/RepoContext';
import ProtectedRoute from './components/ProtectedRoute';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';

import Login        from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Dashboard    from './pages/Dashboard';
import RepoView     from './pages/RepoView';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <Routes>
        {/* Public */}
        <Route path="/login"         element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected — unauthenticated users are sent to /login */}
          <Route element={<RepoProvider><ProtectedRoute /></RepoProvider>}>
            <Route path="/"                        element={<Dashboard />} />
            <Route path="/dashboard"               element={<Dashboard />} />
            <Route path="/repo/:repoId"            element={<RepoView />} />
          </Route>
        </Routes>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
