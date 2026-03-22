import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login        from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import Dashboard    from './pages/Dashboard';
import RepoView     from './pages/RepoView';
import Search       from './pages/Search';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public */}
        <Route path="/login"         element={<Login />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Protected — unauthenticated users are sent to /login */}
        <Route element={<ProtectedRoute />}>
          <Route path="/"                        element={<Dashboard />} />
          <Route path="/dashboard"               element={<Dashboard />} />
          <Route path="/repo/:repoId"            element={<RepoView />} />
          <Route path="/repo/:repoId/search"     element={<Search />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
