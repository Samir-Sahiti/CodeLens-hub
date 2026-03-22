import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from './Layout';

/**
 * Wraps protected routes. Shows a full-screen spinner while the auth
 * state is loading (avoids a flash-redirect on page refresh).
 * Unauthenticated users are sent to /login.
 */
export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return user ? <Layout /> : <Navigate to="/login" replace />;
}
