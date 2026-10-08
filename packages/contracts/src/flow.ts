import { z } from 'zod';
import { SERVICE_NAMES } from './events';

export const FLOW_ACTIONS = ['published', 'consumed', 'retried', 'dead_lettered', 'duplicate'] as const;
export type FlowAction = (typeof FLOW_ACTIONS)[number];

export const flowMessageSchema = z.object({
  eventId: z.string(),
  type: z.string(),
  service: z.enum(SERVICE_NAMES),
  action: z.enum(FLOW_ACTIONS),
  attempt: z.number().int().nonnegative(),
  correlationId: z.string(),
  durationMs: z.number().nonnegative().optional(),
  traceId: z.string().optional(),
  error: z.string().optional(),
  at: z.string(),
});

export type FlowMessage = z.infer<typeof flowMessageSchema>;
