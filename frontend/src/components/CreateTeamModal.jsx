import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';

export default function CreateTeamModal({ isOpen, onClose, onCreated }) {
  const { session } = useAuth();
  const [teamName, setTeamName]   = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!teamName.trim() || !repoFullName.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(apiUrl('/api/teams'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          name:        teamName.trim(),
          repoFullName: repoFullName.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create team');
      }

      const data = await res.json();
      setTeamName('');
      setRepoFullName('');
      onClose();
      onCreated(data.team, data.collaboratorCount);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setError(null);
    setTeamName('');
    setRepoFullName('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-950 p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">Create a Team</h2>
          <p className="mt-1 text-sm text-gray-400">
            Sync your GitHub repository collaborators into a team. They will automatically see the shared repository when they sign in to CodeLens.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              Team name
            </label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Backend squad"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none transition"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-300">
              GitHub repository
            </label>
            <input
              type="text"
              value={repoFullName}
              onChange={(e) => setRepoFullName(e.target.value)}
              placeholder="owner/repository"
              required
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm text-white placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none transition"
            />
            <p className="mt-1 text-xs text-gray-500">
              Must be a repository you have already connected to CodeLens. Collaborators will be fetched from GitHub.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-800 bg-red-900/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !teamName.trim() || !repoFullName.trim()}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Creating...' : 'Create team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
