import { composeServices } from '@apollo/composition';
import type { SupergraphSdlHook } from '@apollo/gateway';
import type { Logger } from '@shopstream/platform';
import { parse } from 'graphql';

export interface SubgraphDef {
  name: string;
  url: string;
  /** Static SDL for in-process subgraphs (identity). */
  sdl?: string;
}

export async function fetchSdl(url: string, timeoutMs = 5_000): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ _service { sdl } }' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  const body = (await res.json()) as { data?: { _service?: { sdl?: string } }; errors?: unknown };
  const sdl = body.data?._service?.sdl;
  if (!sdl) throw new Error(`${url} returned no SDL`);
  return sdl;
}

export async function composeSupergraph(subgraphs: SubgraphDef[]): Promise<string> {
  const defs = await Promise.all(
    subgraphs.map(async (s) => ({
      name: s.name,
      url: s.url,
      typeDefs: parse(s.sdl ?? (await fetchSdl(s.url))),
    })),
  );
  const result = composeServices(defs);
  if (result.errors?.length || !result.supergraphSdl) {
    throw new Error(`Composition failed: ${(result.errors ?? []).map((e) => e.message).join('; ')}`);
  }
  return result.supergraphSdl;
}

/**
 * Like IntrospectAndCompose, but tolerant of start-up order: it keeps retrying
 * until every subgraph answers (no crash-loop when the gateway boots first),
 * then polls for schema changes and hot-swaps the supergraph.
 */
export function resilientSupergraph(
  subgraphs: SubgraphDef[],
  logger: Logger,
  opts: { pollIntervalMs: number; startupTimeoutMs?: number },
): SupergraphSdlHook {
  return async ({ update }) => {
    const deadline = Date.now() + (opts.startupTimeoutMs ?? 120_000);
    let sdl: string | undefined;
    for (let attempt = 1; !sdl; attempt++) {
      try {
        sdl = await composeSupergraph(subgraphs);
      } catch (err) {
        if (Date.now() > deadline) throw err;
        logger.warn({ attempt, err: (err as Error).message }, 'supergraph not composable yet, retrying');
        await new Promise((r) => setTimeout(r, Math.min(1_000 * attempt, 5_000)));
      }
    }
    logger.info({ subgraphs: subgraphs.map((s) => s.name) }, 'supergraph composed');
    let current = sdl;
    let timer: NodeJS.Timeout | undefined;
    if (opts.pollIntervalMs > 0) {
      timer = setInterval(() => {
        composeSupergraph(subgraphs)
          .then((next) => {
            if (next !== current) {
              current = next;
              update(next);
              logger.info('supergraph updated');
            }
          })
          .catch((err: unknown) =>
            logger.warn({ err: (err as Error).message }, 'supergraph poll failed; keeping last good schema'),
          );
      }, opts.pollIntervalMs);
      timer.unref();
    }
    return { supergraphSdl: sdl, cleanup: async () => clearInterval(timer) };
  };
}
