import { Injectable, Logger } from '@nestjs/common';

interface ParsedRepo {
  owner: string;
  repo: string;
}

/**
 * Parse a "owner/repo" string or any github URL pointing to a repo.
 */
export function parseRepoSpec(spec: string): ParsedRepo | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;
  // owner/repo
  const m = trimmed.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (m) return { owner: m[1] as string, repo: m[2] as string };
  // https://github.com/owner/repo[/...]
  try {
    const u = new URL(trimmed);
    if (u.hostname.endsWith('github.com')) {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return { owner: parts[0] as string, repo: (parts[1] as string).replace(/\.git$/, '') };
      }
    }
  } catch {
    // not a URL
  }
  return null;
}

interface PrCoordinates {
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Extract { owner, repo, prNumber } from a PR URL like
 * https://github.com/acme/site/pull/123.
 */
export function parsePrUrl(url: string | null | undefined): PrCoordinates | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('github.com')) return null;
    const m = u.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
    if (!m) return null;
    return { owner: m[1] as string, repo: m[2] as string, prNumber: Number(m[3]) };
  } catch {
    return null;
  }
}

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly apiBase = process.env.GITHUB_API_BASE ?? 'https://api.github.com';

  /**
   * For the hackathon we use a single, env-scoped PAT. The real plan calls for
   * a per-org GitHub App; that gets wired up via IntegrationsModule once the
   * KMS pipeline is in place. See PLAN.md §5.8 + §11.
   */
  private get token(): string | null {
    return process.env.GITHUB_TOKEN ?? process.env.GITHUB_PAT ?? null;
  }

  enabled(): boolean {
    return Boolean(this.token);
  }

  /**
   * Fetch the raw contents of a single file at a specific ref. Used to pull
   * `experiment.yaml` from a PR head when the GitHub webhook fires.
   *
   * Returns null on 404 (file not present in this PR).
   */
  async fetchFileFromRef(args: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  }): Promise<string | null> {
    if (!this.token) {
      this.logger.warn('GITHUB_TOKEN missing — cannot fetch file from PR.');
      return null;
    }
    const url = `${this.apiBase}/repos/${args.owner}/${args.repo}/contents/${encodeURIComponent(
      args.path,
    )}?ref=${encodeURIComponent(args.ref)}`;
    const res = await fetch(url, {
      headers: {
        accept: 'application/vnd.github.raw+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'peec-experiment-lab',
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(
        `GitHub fetchFileFromRef ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    return res.text();
  }

  /**
   * Post a comment on a PR (which is, GitHub-API-wise, an issue comment).
   */
  async commentOnPr(args: {
    owner: string;
    repo: string;
    prNumber: number;
    body: string;
  }): Promise<{ id: number; html_url: string } | null> {
    if (!this.token) {
      this.logger.warn(
        `GITHUB_TOKEN missing — would have commented on ${args.owner}/${args.repo}#${args.prNumber}`,
      );
      return null;
    }
    const url = `${this.apiBase}/repos/${args.owner}/${args.repo}/issues/${args.prNumber}/comments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'peec-experiment-lab',
      },
      body: JSON.stringify({ body: args.body }),
    });
    if (!res.ok) {
      throw new Error(`GitHub commentOnPr ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as { id: number; html_url: string };
  }
}
