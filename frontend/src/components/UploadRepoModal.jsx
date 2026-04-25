import { useState, useRef } from 'react';
import { supabase }  from '../lib/supabase';
import { apiUrl }    from '../lib/api';
import Modal         from './ui/Modal';
import { AlertCircle, CheckCircle2, FileArchive, Loader2, Upload, X } from './ui/Icons';
import { Banner, Button } from './ui/Primitives';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default function UploadRepoModal({ isOpen, onClose, onConnected }) {
  const [file,            setFile]            = useState(null);
  const [isDragging,      setIsDragging]      = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState(0);
  const [isUploading,     setIsUploading]     = useState(false);
  const [uploadComplete,  setUploadComplete]  = useState(false);
  const [error,           setError]           = useState(null);
  const fileInputRef = useRef(null);

  const handleDragOver  = (e) => { e.preventDefault(); setIsDragging(true);  };
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);
    if (e.dataTransfer.files?.length) validateAndSetFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e) => {
    setError(null);
    if (e.target.files?.length) validateAndSetFile(e.target.files[0]);
  };

  const validateAndSetFile = (f) => {
    if (!f.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a valid .zip file.');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setError(`File size exceeds the 50MB limit (selected: ${(f.size / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('repoZip', file);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let msg = 'Upload failed';
            try { const r = JSON.parse(xhr.responseText); if (r.error) msg = r.error; } catch {}
            reject(new Error(msg));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload.')));
        xhr.open('POST', apiUrl('/api/repos/upload'), true);
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        xhr.send(formData);
      });

      // Success animation
      setUploadComplete(true);
      setUploadProgress(100);
      onConnected();

      // Auto-close after success animation
      setTimeout(() => {
        setUploadComplete(false);
        resetAndClose();
      }, 1500);

    } catch (err) {
      setError(err.message);
      setIsUploading(false);
    }
  };

  const resetAndClose = () => {
    setFile(null);
    setUploadProgress(0);
    setIsUploading(false);
    setUploadComplete(false);
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={isUploading ? undefined : resetAndClose} title="Upload Repository">
      <div className="space-y-5 p-5 sm:p-6">
        {error && (
          <Banner tone="danger" icon={AlertCircle}>
            {error}
          </Banner>
        )}

        {/* Drop zone */}
        <div
          className={`relative flex min-h-56 flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 transition-all duration-200 sm:p-10 ${
            uploadComplete
              ? 'border-emerald-500 bg-emerald-500/10'
              : isDragging
              ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]'
              : 'border-gray-700 hover:border-gray-600 bg-gray-950/50'
          } ${isUploading ? 'opacity-60 pointer-events-none' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {uploadComplete ? (
            /* Success state */
            <div className="flex flex-col items-center gap-3" style={{ animation: 'scaleIn 300ms ease' }}>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
                <CheckCircle2 className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="font-semibold text-emerald-400">Upload complete!</p>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <FileArchive className="h-10 w-10 text-indigo-400 mb-1" />
              <p className="max-w-full break-all font-semibold text-white">{file.name}</p>
              <p className="text-sm text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              {!isUploading && (
                <button
                  onClick={() => setFile(null)}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-400 transition hover:text-red-300"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
              <FileArchive className="h-10 w-10 text-gray-600 mb-1" />
              <p className="font-medium text-gray-300">Drop your .zip file here</p>
              <p className="text-sm text-gray-500">or click to browse</p>
              <p className="text-xs text-gray-600 mt-2">Max size: 50MB</p>
            </div>
          )}

          {!file && !uploadComplete && (
            <input
              type="file"
              ref={fileInputRef}
              accept=".zip"
              onChange={handleFileChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          )}
        </div>

        {/* Upload progress */}
        {isUploading && (
          <div>
            <div className="flex justify-between text-xs font-medium text-gray-400 mb-2">
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Uploading…
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className="relative h-2 rounded-full bg-indigo-500 transition-all duration-300 ease-out overflow-hidden"
                style={{ width: `${uploadProgress}%` }}
              >
                {/* Shimmer leading edge */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-col-reverse gap-3 rounded-b-xl border-t border-gray-800 bg-gray-900/40 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button
          onClick={resetAndClose}
          disabled={isUploading}
          variant="secondary"
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={handleUpload}
          disabled={!file || isUploading || uploadComplete}
          loading={isUploading}
          className="w-full sm:w-auto"
        >
          {isUploading
            ? 'Uploading...'
            : <><Upload className="h-4 w-4" /> Upload & Process</>
          }
        </Button>
      </div>
    </Modal>
  );
}
