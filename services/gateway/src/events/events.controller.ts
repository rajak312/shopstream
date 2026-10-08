import { Controller, Get, Inject, Query, Req, Res } from '@nestjs/common';
import { CONFIG, LOGGER, verifyAccessToken, type Logger } from '@shopstream/platform';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { GatewayConfig } from '../config';

/**
 * Live updates for the browser via Server-Sent Events, proxied to the
 * notifications service. EventSource cannot set headers, so the JWT comes in
 * the `access_token` query parameter (short-lived token, HTTPS only in prod)
 * and is verified here before the stream is opened.
 */
@Controller('events')
export class EventsController {
  private readonly notificationsBase: string;

  constructor(
    @Inject(CONFIG) private readonly config: GatewayConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.notificationsBase = new URL(config.NOTIFICATIONS_URL).origin;
  }

  @Get('me')
  async me(@Query('access_token') token: string | undefined, @Req() req: Request, @Res() res: Response) {
    const user = token ? await verifyAccessToken(token, this.config.JWT_SECRET) : null;
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    await this.proxy(`${this.notificationsBase}/stream/me`, req, res, { authorization: `Bearer ${token}` });
  }

  @Get('flow')
  async flow(@Req() req: Request, @Res() res: Response) {
    await this.proxy(`${this.notificationsBase}/stream/flow`, req, res, {});
  }

  private async proxy(url: string, req: Request, res: Response, headers: Record<string, string>) {
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    try {
      const upstream = await fetch(url, {
        headers: { accept: 'text/event-stream', ...headers },
        signal: abort.signal,
      });
      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status === 401 ? 401 : 502).json({ error: 'stream unavailable' });
        return;
      }
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      const body = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
      body.on('error', () => res.end());
      body.pipe(res);
    } catch (err) {
      if (abort.signal.aborted) return;
      this.logger.warn({ err: (err as Error).message }, 'SSE upstream failed');
      if (!res.headersSent) res.status(502).json({ error: 'stream unavailable' });
      else res.end();
    }
  }
}
