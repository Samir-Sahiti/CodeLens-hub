import { Routes, Route } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import RepoView from './pages/RepoView';
import Search from './pages/Search';
import Login from './pages/Login';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/login" element={<Login />} />
      <Route path="/repo/:repoId" element={<RepoView />} />
      <Route path="/repo/:repoId/search" element={<Search />} />
    </Routes>
  );
}
