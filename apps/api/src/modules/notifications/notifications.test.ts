import { describe, expect, it } from 'vitest';
import { parsePrUrl, parseRepoSpec } from './github.service.js';

describe('parseRepoSpec', () => {
  it('parses "owner/repo"', () => {
    expect(parseRepoSpec('acme/site')).toEqual({ owner: 'acme', repo: 'site' });
  });
  it('parses "owner/repo.git"', () => {
    expect(parseRepoSpec('acme/site.git')).toEqual({ owner: 'acme', repo: 'site' });
  });
  it('parses an HTTPS GitHub URL', () => {
    expect(parseRepoSpec('https://github.com/acme/site')).toEqual({
      owner: 'acme',
      repo: 'site',
    });
  });
  it('parses an HTTPS GitHub URL with trailing path', () => {
    expect(parseRepoSpec('https://github.com/acme/site/blob/main/README.md')).toEqual({
      owner: 'acme',
      repo: 'site',
    });
  });
  it('returns null for garbage', () => {
    expect(parseRepoSpec('')).toBeNull();
    expect(parseRepoSpec('not-a-repo')).toBeNull();
    expect(parseRepoSpec('https://example.com/foo/bar')).toBeNull();
  });
});

describe('parsePrUrl', () => {
  it('extracts owner/repo/prNumber from a PR URL', () => {
    expect(parsePrUrl('https://github.com/acme/site/pull/123')).toEqual({
      owner: 'acme',
      repo: 'site',
      prNumber: 123,
    });
  });
  it('returns null for non-PR URLs', () => {
    expect(parsePrUrl('https://github.com/acme/site/issues/123')).toBeNull();
    expect(parsePrUrl('https://example.com/foo/bar/pull/1')).toBeNull();
    expect(parsePrUrl(null)).toBeNull();
    expect(parsePrUrl(undefined)).toBeNull();
  });
});
