import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import { CONFIG, userFromAuthorization } from '@shopstream/platform';
import type { Request, Response } from 'express';
import type { NotificationsConfig } from '../config';
import { StreamHub } from './stream.hub';

/** Internal SSE endpoints. The gateway authenticates the browser and proxies here with the JWT. */
@Controller('stream')
export class StreamController {
  constructor(
    private readonly hub: StreamHub,
    @Inject(CONFIG) private readonly config: NotificationsConfig,
  ) {}

  @Get('me')
  async me(@Req() req: Request, @Res() res: Response) {
    const user = await userFromAuthorization(req.headers.authorization, this.config.JWT_SECRET);
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    this.hub.attachUser(user.id, res);
  }

  /** Public, anonymised delivery telemetry for the event-flow visualizer. */
  @Get('flow')
  flow(@Res() res: Response) {
    this.hub.attachFlow(res);
  }
}
