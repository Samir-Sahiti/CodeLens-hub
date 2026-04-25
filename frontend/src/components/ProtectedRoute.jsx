import { Navigate } from 'react-router-dom';
import { useAuth }  from '../context/AuthContext';
import Layout       from './Layout';
import { LoadingMark } from './ui/Primitives';

/**
 * Wraps protected routes. Shows a branded pulsing CodeLens logo while
 * auth state is loading. Unauthenticated users are sent to /login.
 */
export default function ProtectedRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingMark label="Loading CodeLens" detail="Restoring your workspace" />;
  }

  return user ? <Layout /> : <Navigate to="/login" replace />;
}
