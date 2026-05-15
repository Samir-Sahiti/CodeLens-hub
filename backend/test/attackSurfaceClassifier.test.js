import { describe, expect, it } from 'vitest';

import { classifyFile } from '../src/services/attackSurfaceClassifier.js';

describe('attackSurfaceClassifier', () => {
  it('returns null for unsupported languages', () => {
    expect(classifyFile('docs/README.md', '# hello')).toBeNull();
    expect(classifyFile('Makefile', 'all:\n\techo')).toBeNull();
  });

  it('classifies an Express route file as a source', () => {
    const content = `
      const router = express.Router();
      router.get('/users', (req, res) => res.json([]));
    `;
    expect(classifyFile('backend/src/routes/users.js', content)).toBe('source');
  });

  it('classifies a SQL-executing module as a sink', () => {
    const content = `
      function fetchAll(db, table) {
        return db.query(\`SELECT * FROM \${table}\`);
      }
    `;
    expect(classifyFile('backend/src/db/queries.js', content)).toBe('sink');
  });

  it('classifies a file that both registers a route and shells out as "both"', () => {
    const content = `
      const { execSync } = require('child_process');
      app.post('/run', (req, res) => {
        execSync(\`do-thing \${req.body.cmd}\`);
        res.end();
      });
    `;
    expect(classifyFile('backend/src/routes/run.js', content)).toBe('both');
  });

  it('returns null when nothing matches', () => {
    expect(classifyFile('src/utils/math.js', 'export const add = (a, b) => a + b;')).toBeNull();
  });

  it('detects Python FastAPI routes as sources', () => {
    const content = `
      from fastapi import APIRouter
      router = APIRouter()
      @router.get('/items')
      def list_items():
          return []
    `;
    expect(classifyFile('app/routes/items.py', content)).toBe('source');
  });
});
