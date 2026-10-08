import type { NatsConnection, Subscription } from '@nats-io/transport-node';
import { FLOW_SUBJECT, flowMessageSchema, type FlowMessage } from '@shopstream/contracts';
import type { Logger } from '@shopstream/platform';
import type { Response } from 'express';
import { PUSH_WILDCARD } from '../notifications.service';

const FLOW_HISTORY = 100;

/**
 * Server-Sent Events hub. Every replica subscribes to the core-NATS fan-out
 * subjects and forwards to its own connected clients, so it scales out
 * horizontally without sticky sessions.
 */
export class StreamHub {
  private readonly userClients = new Map<string, Set<Response>>();
  private readonly flowClients = new Set<Response>();
  private readonly flowHistory: FlowMessage[] = [];
  private readonly subs: Subscription[] = [];
  private heartbeat?: NodeJS.Timeout;
  private seq = 0;

  constructor(
    private readonly nc: NatsConnection,
    private readonly logger: Logger,
    private readonly heartbeatMs: number,
  ) {}

  start(): void {
    const push = this.nc.subscribe(PUSH_WILDCARD);
    const flow = this.nc.subscribe(`${FLOW_SUBJECT}.>`);
    this.subs.push(push, flow);
    void (async () => {
      for await (const m of push) {
        const userId = m.subject.split('.').at(-1)!;
        const clients = this.userClients.get(userId);
        if (!clients?.size) continue;
        const payload = m.string();
        for (const res of clients) this.send(res, 'timeline', payload);
      }
    })();
    void (async () => {
      for await (const m of flow) {
        const parsed = flowMessageSchema.safeParse(m.json());
        if (!parsed.success) continue;
        this.flowHistory.push(parsed.data);
        if (this.flowHistory.length > FLOW_HISTORY) this.flowHistory.shift();
        const payload = JSON.stringify(parsed.data);
        for (const res of this.flowClients) this.send(res, 'flow', payload);
      }
    })();
    this.heartbeat = setInterval(() => {
      for (const res of this.allClients()) res.write(`: ping ${Date.now()}\n\n`);
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  attachUser(userId: string, res: Response): void {
    this.open(res);
    let set = this.userClients.get(userId);
    if (!set) this.userClients.set(userId, (set = new Set()));
    set.add(res);
    this.send(res, 'ready', JSON.stringify({ userId }));
    res.on('close', () => {
      set.delete(res);
      if (set.size === 0) this.userClients.delete(userId);
    });
  }

  attachFlow(res: Response): void {
    this.open(res);
    this.flowClients.add(res);
    this.send(res, 'history', JSON.stringify(this.flowHistory));
    res.on('close', () => this.flowClients.delete(res));
  }

  get clientCount(): number {
    return this.flowClients.size + [...this.userClients.values()].reduce((n, s) => n + s.size, 0);
  }

  async stop(): Promise<void> {
    clearInterval(this.heartbeat);
    for (const s of this.subs) s.unsubscribe();
    for (const res of this.allClients()) res.end();
    this.userClients.clear();
    this.flowClients.clear();
    this.logger.info('SSE hub stopped');
  }

  private *allClients(): Iterable<Response> {
    yield* this.flowClients;
    for (const set of this.userClients.values()) yield* set;
  }

  private open(res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
  }

  private send(res: Response, event: string, data: string): void {
    res.write(`id: ${++this.seq}\nevent: ${event}\ndata: ${data}\n\n`);
  }
}
