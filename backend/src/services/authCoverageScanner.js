// US-049: Authentication coverage check
// Heuristic two-layer detection:
//   1. In-file: auth markers in source text
//   2. Import-based: imported paths that sound like auth middleware

const ROUTE_PATTERNS = {
  js: [
    /router\.(get|post|put|delete|patch|use)\s*\(/,
    /app\.(get|post|put|delete|patch|use)\s*\(/,
    /express\.Router\s*\(/,
    /@(Get|Post|Put|Delete|Patch|All)\s*\(/,
    /route\.(get|post|put|delete|patch)\s*\(/,
    /fastify\.(get|post|put|delete|patch|route)\s*\(/,
    /server\.(get|post|put|delete|patch|route)\s*\(/,
    /hapi.*route\s*\(/,
  ],
  py: [
    /@(app|router|bp|blueprint|api)\.(route|get|post|put|delete|patch)\s*\(/,
    /APIRouter\s*\(/,
    /Blueprint\s*\(/,
    /include_router\s*\(/,
  ],
  go: [
    /http\.Handle(?:Func)?\s*\(/,
    /r\.(GET|POST|PUT|DELETE|PATCH|Handle)\s*\(/,
    /router\.(GET|POST|PUT|DELETE|PATCH|Handle)\s*\(/,
    /mux\.Handle(?:Func)?\s*\(/,
  ],
  rb: [
    /^\s*(get|post|put|delete|patch)\s+['"/]/m,
    /resources\s+:/,
    /Rails\.application\.routes/,
  ],
  java: [
    /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)/,
    /@RestController/,
    /@Controller/,
  ],
  cs: [
    /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|Route|ApiController)\]/,
  ],
};

// Patterns that indicate auth is being enforced within the file
const AUTH_MARKERS = [
  /passport\.authenticate\s*\(/,
  /\brequireAuth\b/,
  /\brequiresAuth\b/,
  /\brequireAuthentication\b/,
  /\bisAuthenticated\b/,
  /\bisAuthorized\b/,
  /\bverifyToken\b/,
  /\bcheckAuth\b/,
  /\bensureAuth\b/,
  /\bauthMiddleware\b/,
  /\bauthGuard\b/,
  /\bAuthGuard\b/,
  /\bJwtAuthGuard\b/,
  /\bRolesGuard\b/,
  /\b@UseGuards\b/,
  /\bauth\.required\b/,
  /\bjwtAuth\b/,
  /\btokenAuth\b/,
  /@login_required/,
  /@authorize/,
  /@requires_auth/,
  /\[Authorize\]/,
  /\bauthenticate\s*,/,
  /\bverifyJWT\b/,
  /\bverifyJwt\b/,
  /\bcurrentUser\b/,
  /\brequiresAuthentication\b/,
  /login_required/,
  /requires_authentication/,
  /\bauth\.verify\b/,
  /\bcheckJwt\b/,
  /\bAuthenticationRequired\b/,
  /\bProtected\b/,
  /\bguardedBy\b/,
  /middleware.*auth/i,
  /auth.*middleware/i,
  // Ruby / Rails (Devise, Sorcery)
  /authenticate_user!/,
  /before_action\s*:authenticate/,
  /require_login/,
  /authenticate_with_http_basic/,
];

// Patterns matching import paths that suggest auth middleware
const AUTH_IMPORT_PATTERNS = [
  /\bauth\b/i,
  /\bauthn\b/i,
  /\bauthz\b/i,
  /\bauthenticate\b/i,
  /\brequireAuth\b/i,
  /middleware[\\/]auth/i,
  /guards[\\/]/i,
  /\bjwt\b/i,
  /passport/i,
  /\bauthMiddleware\b/i,
  /\bcanActivate\b/i,
  /\bauthGuard\b/i,
];

// Routes that are intentionally public and should not be flagged
const PUBLIC_ROUTE_ALLOWLIST = [
  /^\/health\b/,
  /^\/healthz\b/,
  /^\/ping\b/,
  /^\/status\b/,
  /^\/metrics\b/,
  /^\/favicon\.ico\b/,
  /^\/login\b/,
  /^\/signin\b/,
  /^\/signup\b/,
  /^\/register\b/,
  /^\/auth\//,
  /^\/oauth\//,
  /^\/.well-known\//,
  /^\/public\//,
  /^\/static\//,
  /^\/assets\//,
];

function getLanguage(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext)) return 'js';
  if (ext === 'py') return 'py';
  if (ext === 'go') return 'go';
  if (ext === 'rb') return 'rb';
  if (ext === 'java') return 'java';
  if (ext === 'cs') return 'cs';
  return null;
}

function isRouteHandlerFile(filePath, content) {
  const lang = getLanguage(filePath);
  if (!lang) return false;
  const patterns = ROUTE_PATTERNS[lang] || [];
  return patterns.some(p => p.test(content));
}

function extractRoutePaths(lang, content) {
  const found = new Set();
  let m;

  if (lang === 'js') {
    const verbRegex = /\.(get|post|put|delete|patch|all|use)\s*\(\s*['"`]([^'"`\n]+)['"`]/g;
    while ((m = verbRegex.exec(content)) !== null) found.add(m[2]);
    // NestJS decorators
    const nestRegex = /@(Get|Post|Put|Delete|Patch|All)\s*\(\s*['"`]([^'"`\n]*)['"`]/g;
    while ((m = nestRegex.exec(content)) !== null) found.add(m[2] || '/');
  } else if (lang === 'py') {
    const routeRegex = /@\w+(?:\.\w+)*\.(route|get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
    while ((m = routeRegex.exec(content)) !== null) found.add(m[2]);
  } else if (lang === 'go') {
    const verbRegex = /\.(GET|POST|PUT|DELETE|PATCH|Handle|HandleFunc)\s*\(\s*["']([^"'\n]+)["']/g;
    while ((m = verbRegex.exec(content)) !== null) found.add(m[2]);
    const httpRegex = /http\.HandleFunc\s*\(\s*["']([^"'\n]+)["']/g;
    while ((m = httpRegex.exec(content)) !== null) found.add(m[1]);
  } else if (lang === 'rb') {
    const routeRegex = /^\s*(get|post|put|delete|patch)\s+['"]([^'"]+)['"]/gm;
    while ((m = routeRegex.exec(content)) !== null) found.add(m[2]);
  } else if (lang === 'java') {
    const mappingRegex = /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["'{]([^'"{}]+)["']/g;
    while ((m = mappingRegex.exec(content)) !== null) found.add(m[1]);
  } else if (lang === 'cs') {
    const routeRegex = /\[Route\s*\(\s*["']([^"']+)["']/g;
    while ((m = routeRegex.exec(content)) !== null) found.add(m[1]);
  }

  return Array.from(found);
}

function hasInFileAuthCoverage(content) {
  return AUTH_MARKERS.some(p => p.test(content));
}

function hasImportAuthCoverage(imports) {
  return imports.some(imp => AUTH_IMPORT_PATTERNS.some(p => p.test(imp)));
}

function isPublicRoute(routePath) {
  return PUBLIC_ROUTE_ALLOWLIST.some(p => p.test(routePath));
}

/**
 * Scans a single file for route handlers that lack authentication coverage.
 *
 * @param {string} filePath  - repo-relative file path
 * @param {string} content   - file source text
 * @param {string[]} imports - resolved import paths from the parser
 * @returns {Array}          - zero or one issue objects (with _meta for suppression)
 */
function scanFileForMissingAuth(filePath, content, imports = []) {
  if (!isRouteHandlerFile(filePath, content)) return [];

  if (hasInFileAuthCoverage(content)) return [];
  if (hasImportAuthCoverage(imports)) return [];

  const lang = getLanguage(filePath);
  const routes = extractRoutePaths(lang, content);
  const unprotected = routes.filter(r => !isPublicRoute(r));

  // If every extracted route is on the allow-list, this file is fine
  if (routes.length > 0 && unprotected.length === 0) return [];

  const routeDesc = unprotected.length > 0
    ? unprotected.slice(0, 6).join(', ') + (unprotected.length > 6 ? ` (+${unprotected.length - 6} more)` : '')
    : 'route paths not statically determinable';

  return [{
    repo_id: null, // filled by indexer
    type: 'missing_auth',
    severity: 'medium',
    file_paths: [filePath],
    description: `Potentially unauthenticated routes: ${routeDesc}. No auth middleware or markers detected in this file. (Rule ID: missing_auth)`,
    _meta: { rule_id: 'missing_auth', line_number: 0 },
  }];
}

module.exports = { scanFileForMissingAuth };
