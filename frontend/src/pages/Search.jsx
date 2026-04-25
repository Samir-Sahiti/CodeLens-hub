import { Navigate } from 'react-router-dom';

/**
 * Legacy route shim.
 * Search now lives inside RepoView so it can stay scoped to a selected repository.
 */
export default function Search() {
  return <Navigate to="/dashboard" replace />;
}
