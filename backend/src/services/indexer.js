const { supabaseAdmin } = require('../db/supabase');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

/**
 * Valid file extensions for indexing.
 */
const VALID_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs']);

/**
 * Placeholder for the background indexing pipeline.
 * Full implementation in US-008.
 *
 * For now, this just updates the status from 'pending' -> 'indexing' -> 'ready'.
 */
const { indexRepository } = require('./indexerService');

const startGitHubIndexing = async (repoId, githubToken, repoFullName) => {
  const [owner, name] = repoFullName.split('/');
  // The service handles marking it ready or failed, and the full try/catch pipeline
  await indexRepository({ repoId, owner, name, token: githubToken, source: 'github' });
};


/**
 * Handles processing of a local uploaded repository ZIP.
 */
const startLocalIndexing = async (repoId, zipFilePath, repoName) => {
  let extractPath;
  try {
    await supabaseAdmin.from('repositories').update({ status: 'indexing' }).eq('id', repoId);

    // Dynamic import to avoid crash if user hasn't installed it yet
    const AdmZip = require('adm-zip');

    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries();

    // Check if zip contains supported files
    let hasSupportedFiles = false;
    let fileCount = 0;

    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        fileCount++;
        const ext = path.extname(entry.entryName).toLowerCase();
        if (VALID_EXTENSIONS.has(ext)) {
          hasSupportedFiles = true;
        }
      }
    }

    if (!hasSupportedFiles) {
      throw new Error(`No supported files found in ${repoName}. Supported: .js, .jsx, .ts, .tsx, .py, .cs`);
    }

    extractPath = await fs.mkdtemp(path.join(os.tmpdir(), `codelens-repo-${repoId}-`));
    zip.extractAllTo(extractPath, true); // Fix: add this between the two lines above
    // Trigger the real indexing pipeline
    await indexRepository({ repoId, extractPath, source: 'upload' });

    console.log(`[Indexer] Successfully triggered real indexing for ${repoName}`);

  } catch (err) {
    console.error(`[Indexer] Failed indexing for local upload ${repoName}:`, err.message);
    await supabaseAdmin.from('repositories').update({ status: 'failed' }).eq('id', repoId);
  } finally {
    // Cleanup the uploaded zip file from multer
    try {
      if (zipFilePath) await fs.unlink(zipFilePath);
    } catch (e) {
      console.error(`[Indexer] Failed to clean up ZIP file: ${zipFilePath}`);
    }

    // Cleanup extracted temp directory
    try {
      if (extractPath) await fs.rm(extractPath, { recursive: true, force: true });
    } catch (e) {
      console.error(`[Indexer] Failed to clean up temp dir: ${extractPath}`);
    }
  }
};

module.exports = { startGitHubIndexing, startLocalIndexing };
