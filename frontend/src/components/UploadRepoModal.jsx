import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';

// 50MB in bytes
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export default function UploadRepoModal({ isOpen, onClose, onConnected }) {
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    setError(null);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    setError(null);
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (selectedFile) => {
    if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a valid .zip file.');
      return;
    }
    
    if (selectedFile.size > MAX_FILE_SIZE) {
      setError(`File size exceeds the 50MB limit (selected: ${(selectedFile.size / 1024 / 1024).toFixed(1)}MB).`);
      return;
    }
    
    setFile(selectedFile);
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

      // We use XMLHttpRequest here to get real upload progress
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(percentComplete);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            let errorMsg = 'Upload failed';
            try {
              const res = JSON.parse(xhr.responseText);
              if (res.error) errorMsg = res.error;
            } catch (e) { /* ignore */ }
            reject(new Error(errorMsg));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error occurred during upload.'));
        });

        xhr.open('POST', apiUrl('/api/repos/upload'), true);
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        xhr.send(formData);
      });

      onConnected();
      resetAndClose();
    } catch (err) {
      console.error(err);
      setError(err.message);
      setIsUploading(false);
    }
  };

  const resetAndClose = () => {
    setFile(null);
    setUploadProgress(0);
    setIsUploading(false);
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-lg flex-col rounded-xl bg-gray-900 border border-gray-800 shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 p-6">
          <h2 className="text-xl font-semibold text-white">Upload Repository</h2>
          <button 
            onClick={resetAndClose} 
            disabled={isUploading}
            className="text-gray-400 hover:text-white transition disabled:opacity-50"
          >
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-md bg-red-900/50 p-3 border border-red-800 text-sm text-red-200">
              {error}
            </div>
          )}

          <div 
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors ${
              isDragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-950/50'
            } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <svg className="mb-4 h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            
            {file ? (
              <div className="text-center">
                <p className="font-medium text-white">{file.name}</p>
                <p className="text-sm text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                {!isUploading && (
                  <button 
                    onClick={() => setFile(null)}
                    className="mt-3 text-sm text-red-400 hover:text-red-300 font-medium"
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center">
                <p className="font-medium text-gray-300">Drag & drop your .zip file here</p>
                <p className="text-sm text-gray-500 mt-1">or click to browse from your computer</p>
                <p className="text-xs text-gray-600 mt-4">Max file size: 50MB</p>
              </div>
            )}

            {/* Hidden Input field mapped to the entire container visually */}
            {!file && (
              <input
                type="file"
                ref={fileInputRef}
                accept=".zip"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            )}
          </div>

          {/* Upload Progress Bar */}
          {isUploading && (
            <div className="mt-6">
              <div className="flex justify-between text-xs font-medium text-gray-400 mb-2">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300 ease-out" 
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 p-6 flex justify-end gap-3 bg-gray-900/50 rounded-b-xl">
          <button
            onClick={resetAndClose}
            disabled={isUploading}
            className="rounded-md px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white hover:bg-gray-800 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? 'Uploading...' : 'Upload & Process'}
          </button>
        </div>

      </div>
    </div>
  );
}
