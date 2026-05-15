import { describe, expect, it } from 'vitest';

import { isManifestFile, parseManifest, MANIFEST_BASENAMES } from '../src/services/manifestParser.js';

describe('manifestParser', () => {
  it('recognises supported manifest basenames case-insensitively', () => {
    expect(isManifestFile('frontend/package.json')).toBe(true);
    expect(isManifestFile('frontend/Package.json')).toBe(true);
    expect(isManifestFile('backend/yarn.lock')).toBe(true);
    expect(isManifestFile('service/go.mod')).toBe(true);
    expect(isManifestFile('api/MyApi.csproj')).toBe(true);
    expect(isManifestFile('README.md')).toBe(false);
    expect(isManifestFile('src/index.js')).toBe(false);
  });

  it('exposes the canonical manifest basename set', () => {
    expect(MANIFEST_BASENAMES.has('package.json')).toBe(true);
    expect(MANIFEST_BASENAMES.has('cargo.lock')).toBe(true);
    expect(MANIFEST_BASENAMES.has('pipfile.lock')).toBe(true);
  });

  it('parses package.json direct dependencies as npm ecosystem entries', () => {
    const content = JSON.stringify({
      name: 'demo',
      dependencies: { express: '^4.18.2', lodash: '4.17.21' },
      devDependencies: { vitest: '^3.2.4' },
    });

    const deps = parseManifest('frontend/package.json', content);
    const express = deps.find((d) => d.name === 'express');
    const lodash = deps.find((d) => d.name === 'lodash');
    const vitest = deps.find((d) => d.name === 'vitest');

    expect(express).toMatchObject({ ecosystem: 'npm', version: '4.18.2', manifest_path: 'frontend/package.json', is_transitive: false });
    expect(lodash.version).toBe('4.17.21');
    expect(vitest).toBeDefined();
  });

  it('parses requirements.txt entries with == pins', () => {
    const content = [
      '# top-level requirements',
      'flask==2.3.2',
      'requests==2.31.0',
      '',
      '-e ./local-pkg',
    ].join('\n');

    const deps = parseManifest('backend/requirements.txt', content);
    const flask = deps.find((d) => d.name === 'flask');
    expect(flask).toMatchObject({ ecosystem: 'PyPI', version: '2.3.2' });
    expect(deps.some((d) => d.name === 'requests' && d.version === '2.31.0')).toBe(true);
  });

  it('returns [] for unknown manifest types', () => {
    expect(parseManifest('src/index.js', 'console.log("hi");')).toEqual([]);
  });

  it('swallows JSON parse errors instead of throwing', () => {
    expect(() => parseManifest('frontend/package.json', '{not json')).not.toThrow();
    expect(parseManifest('frontend/package.json', '{not json')).toEqual([]);
  });
});
