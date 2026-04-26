import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { PeecOAuthService } from './peec-oauth.service.js';

interface StartBody {
  redirectUri?: string;
  /**
   * The organization the OAuth flow is for. Required — multi-tenant.
   * The web bridge route reads it from the signed-in user's session
   * and forwards it; we never let an anonymous caller start a flow
   * because the resulting Integration row needs an owner.
   */
  organizationId?: string;
}

interface CallbackBody {
  state?: string;
  code?: string;
}

@Controller('peec/oauth')
export class PeecOAuthController {
  constructor(private readonly oauth: PeecOAuthService) {}

  /**
   * Begin an OAuth flow. The caller (the web's bridge route handler)
   * provides its own callback URL and the organization id the
   * resulting integration should be persisted against.
   */
  @Post('start')
  async start(@Body() body: StartBody) {
    if (!body?.redirectUri) {
      throw new BadRequestException('redirectUri is required');
    }
    if (!body?.organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    return this.oauth.start(body.redirectUri, body.organizationId);
  }

  /**
   * Complete the flow. The web bridge forwards the `code` and `state` it
   * received from the Peec authorization server. We resolve the org from
   * the in-memory pending state — the browser cannot tamper with it.
   */
  @Post('callback')
  async callback(@Body() body: CallbackBody) {
    if (!body?.state || !body?.code) {
      throw new BadRequestException('state and code are required');
    }
    return this.oauth.callback(body.state, body.code);
  }
}
