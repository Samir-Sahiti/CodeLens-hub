import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import Modal from './ui/Modal';
import { AlertCircle, GitBranch, Users } from './ui/Icons';
import { Banner, Button, Input } from './ui/Primitives';

export default function CreateTeamModal({ isOpen, onClose, onCreated }) {
  const { session } = useAuth();
  const [teamName,     setTeamName]     = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error,        setError]        = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!teamName.trim() || !repoFullName.trim()) return;
    if (!/^[^/\s]+\/[^/\s]+$/.test(repoFullName.trim())) {
      setError('Use the GitHub full name format: owner/repository.');
      return;
    }

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
          name:         teamName.trim(),
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

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create Team" maxWidth="max-w-md">
      <div className="space-y-5 p-5 sm:p-6">
        <div className="rounded-xl border border-surface-800 bg-surface-900/55 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/20 bg-accent/10">
              <Users className="h-4 w-4 text-accent-soft" />
            </div>
            <p className="text-sm leading-relaxed text-surface-400">
              Sync GitHub collaborators into a shared CodeLens team for one connected repository.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            icon={Users}
            label="Team name"
            value={teamName}
            onChange={e => setTeamName(e.target.value)}
            placeholder="Backend squad"
            required
            disabled={isSubmitting}
          />

          <div>
            <Input
              icon={GitBranch}
              label="GitHub repository"
              value={repoFullName}
              onChange={e => setRepoFullName(e.target.value)}
              placeholder="owner/repository"
              required
              disabled={isSubmitting}
            />
            <p className="mt-1 text-xs text-gray-500">
              Must be a repository you have already connected to CodeLens.
            </p>
          </div>

          {error && (
            <Banner tone="danger" icon={AlertCircle}>
              {error}
            </Banner>
          )}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !teamName.trim() || !repoFullName.trim()}
              loading={isSubmitting}
              className="w-full sm:w-auto"
            >
              {isSubmitting ? 'Creating...' : 'Create team'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
