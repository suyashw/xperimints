import { Injectable, Logger } from '@nestjs/common';

interface CreateLinearIssueInput {
  title: string;
  description?: string;
  /** Linear team UUID. Falls back to LINEAR_TEAM_ID env. */
  teamId?: string;
  /** Optional label IDs. */
  labelIds?: string[];
}

interface LinearIssueRef {
  id: string;
  identifier: string; // e.g. "PEEC-42"
  url: string;
  title: string;
}

/**
 * Linear client over the public GraphQL API. We only need one mutation today
 * (issueCreate) so we keep the client small and dependency-free instead of
 * pulling the @linear/sdk package.
 */
@Injectable()
export class LinearService {
  private readonly logger = new Logger(LinearService.name);
  private readonly endpoint = 'https://api.linear.app/graphql';

  private get apiKey(): string | null {
    return process.env.LINEAR_API_KEY ?? null;
  }
  private get defaultTeamId(): string | null {
    return process.env.LINEAR_TEAM_ID ?? null;
  }

  enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async createIssue(input: CreateLinearIssueInput): Promise<LinearIssueRef | null> {
    if (!this.apiKey) {
      this.logger.warn(
        `LINEAR_API_KEY missing — would have opened issue: "${input.title}"`,
      );
      return null;
    }
    const teamId = input.teamId ?? this.defaultTeamId;
    if (!teamId) {
      throw new Error('LinearService.createIssue: teamId is required (set LINEAR_TEAM_ID).');
    }
    const query = /* GraphQL */ `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            url
            title
          }
        }
      }
    `;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          input: {
            teamId,
            title: input.title,
            description: input.description,
            labelIds: input.labelIds,
          },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Linear createIssue HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as {
      data?: {
        issueCreate?: {
          success: boolean;
          issue?: { id: string; identifier: string; url: string; title: string };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(`Linear createIssue: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    const issue = json.data?.issueCreate?.issue;
    if (!issue) throw new Error('Linear createIssue: no issue in response');
    return issue;
  }
}
