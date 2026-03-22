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
const startGitHubIndexing = async (repoId, githubToken, repoFullName) => {
  try {
    // 1. Mark as indexing immediately
    await supabaseAdmin
      .from('repositories')
      .update({ status: 'indexing' })
      .eq('id', repoId);

    // 2. Simulate ~3s of network/indexing work
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Mark as ready
    await supabaseAdmin
      .from('repositories')
      .update({
        status: 'ready',
        indexed_at: new Date().toISOString(),
        file_count: Math.floor(Math.random() * 150) + 10 // Dummy file count
      })
      .eq('id', repoId);

    console.log(`[Indexer] Successfully finished simulated indexing for ${repoFullName}`);
  } catch (err) {
    console.error(`[Indexer] Failed indexing for ${repoFullName}`, err);
    await supabaseAdmin
      .from('repositories')
      .update({ status: 'failed' })
      .eq('id', repoId);
  }
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
    
    // Simulate ~3s of network/indexing work
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Mark as ready
    await supabaseAdmin
      .from('repositories')
      .update({
        status: 'ready',
        indexed_at: new Date().toISOString(),
        file_count: fileCount
      })
      .eq('id', repoId);

    console.log(`[Indexer] Successfully processed local upload for ${repoName}`);

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
