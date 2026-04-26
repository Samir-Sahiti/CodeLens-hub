// US-047: Attack surface mapping
// Classifies files as 'source' (externally reachable entry points),
// 'sink' (dangerous operations), 'both', or null.
// Pure regex — no AST — so it runs on every file during indexing without overhead.

const SOURCE_PATTERNS = {
  js: [
    /router\.(get|post|put|delete|patch|use)\s*\(/,
    /app\.(get|post|put|delete|patch|use)\s*\(/,
    /fastify\.(get|post|put|delete|patch|route)\s*\(/,
    /server\.(get|post|put|delete|patch|route)\s*\(/,
    /@(Get|Post|Put|Delete|Patch|All)\s*\(/,   // NestJS decorators
    /express\.Router\s*\(/,
    /process\.argv/,                            // CLI entry point
    /readline\.createInterface/,                // stdin reader
  ],
  py: [
    /@(app|router|bp|blueprint|api)\.(route|get|post|put|delete|patch)\s*\(/,
    /APIRouter\s*\(/,
    /Blueprint\s*\(/,
    /include_router\s*\(/,
    /sys\.argv/,
    /argparse\.ArgumentParser/,
    /\binput\s*\(/,                             // stdin
  ],
  go: [
    /http\.Handle(?:Func)?\s*\(/,
    /r\.(GET|POST|PUT|DELETE|PATCH|Handle)\s*\(/,
    /router\.(GET|POST|PUT|DELETE|PATCH|Handle)\s*\(/,
    /mux\.Handle(?:Func)?\s*\(/,
    /os\.Args/,
  ],
  rb: [
    /^\s*(get|post|put|delete|patch)\s+['"\/]/m,
    /Rails\.application\.routes/,
    /\bgets\b/,                                 // stdin
    /ARGV/,
  ],
  java: [
    /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)/,
    /@RestController/,
    /@Controller/,
    /public\s+static\s+void\s+main\s*\(/,      // CLI entry point
  ],
  cs: [
    /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|ApiController)\]/,
    /Environment\.GetCommandLineArgs/,
    /Console\.ReadLine\s*\(/,
  ],
  rs: [
    /#\[(get|post|put|delete|patch)\]/,         // actix-web
    /web::(get|post|put|delete|patch)\s*\(/,
    /Router::new\s*\(\s*\)/,                    // axum
    /std::env::args/,
  ],
};

// Sinks are cross-language — patterns are specific enough to avoid false matches.
const SINK_PATTERNS = [
  // SQL execution
  /\.query\s*\(\s*[`"']/,
  /\.execute\s*\(\s*[`"']/,
  /executeQuery\s*\(/,
  /\.raw\s*\(\s*[`"']/,                         // knex .raw()
  /SqlCommand\s*\(/,                            // ADO.NET
  /cursor\.execute\s*\(/,                       // Python DB-API
  /db\.execute\s*\(/,
  /session\.execute\s*\(/,

  // Shell / process execution
  /child_process/,
  /execSync\s*\(/,
  /spawnSync\s*\(/,
  /exec\s*\(\s*[`$]/,                           // exec with template literal — indicates dynamic arg
  /subprocess\.(run|call|Popen)\s*\(/,
  /os\.system\s*\(/,
  /os\.popen\s*\(/,
  /Runtime\.getRuntime\(\)\.exec\s*\(/,
  /Process\.Start\s*\(/,
  /std::process::Command::new/,

  // Filesystem writes (dynamic paths)
  /fs\.writeFile(?:Sync)?\s*\(/,
  /fs\.appendFile(?:Sync)?\s*\(/,
  /open\s*\([^)]+['"]\s*[wa]/,                  // Python open(..., 'w') / 'a'
  /File\.WriteAllText\s*\(/,
  /File\.AppendAllText\s*\(/,
  /java\.io\.FileWriter/,
  /std::fs::write\s*\(/,

  // Deserialisation
  /pickle\.loads?\s*\(/,
  /yaml\.load\s*\(\s*[^,)]+\)/,                 // yaml.load without SafeLoader (no second arg)
  /JSON\.parse\s*\(/,
  /\bdeserialize\s*\(/,
  /BinaryFormatter\.Deserialize/,
  /ObjectInputStream\s*\(/,
  /serde_json::from_str\s*\(/,

  // Outbound HTTP with dynamic URLs (non-literal first argument)
  /fetch\s*\(\s*[^'"]/,
  /axios\.(get|post|put|delete|patch)\s*\(\s*[^'"]/,
  /requests\.(get|post|put|delete|patch)\s*\(\s*[^'"]/,
  /http\.NewRequest\s*\(/,
  /HttpClient\b/,
  /HttpURLConnection\b/,
  /urllib\.request\.(urlopen|urlretrieve)\s*\(/,
];

function getLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (ext === 'rb') return 'rb';
  if (ext === 'java') return 'java';
  if (ext === 'cs') return 'cs';
  if (ext === 'rs') return 'rs';
  return null;
}

/**
 * Classifies a single file as 'source', 'sink', 'both', or null.
 *
 * @param {string} filePath - repo-relative path
 * @param {string} content  - file source text
 * @returns {'source'|'sink'|'both'|null}
 */
function classifyFile(filePath, content) {
  const lang = getLanguage(filePath);
  if (!lang) return null;

  const srcPatterns = SOURCE_PATTERNS[lang] || [];
  const isSource = srcPatterns.some(p => p.test(content));
  const isSink   = SINK_PATTERNS.some(p => p.test(content));

  if (isSource && isSink) return 'both';
  if (isSource) return 'source';
  if (isSink)   return 'sink';
  return null;
}

module.exports = { classifyFile };
