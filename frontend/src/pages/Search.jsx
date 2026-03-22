// Search — natural language code search (RAG)
import { useParams } from 'react-router-dom';

export default function Search() {
  const { repoId } = useParams();

  return (
    <div className="min-h-screen bg-gray-950 p-8 text-white">
      <h1 className="mb-4 text-3xl font-bold">Code Search</h1>
      <p className="text-gray-400 text-sm">Repo ID: {repoId}</p>
      {/* Natural language search UI will be built in Sprint 4 */}
    </div>
  );
}
