import { GATEWAY_URL } from './config';

export const TOKEN_KEY = 'shopstream.token';

export class GraphQLRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly network = false,
  ) {
    super(message);
    this.name = 'GraphQLRequestError';
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Tiny GraphQL client: one POST to the federated gateway, typed result, readable errors. */
export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new GraphQLRequestError('The API is unreachable (it may be waking up).', 'NETWORK', true);
  }
  let body: { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  try {
    body = await res.json();
  } catch {
    throw new GraphQLRequestError(`Unexpected response (${res.status})`, 'BAD_RESPONSE', res.status >= 500);
  }
  if (body.errors?.length) {
    const first = body.errors[0]!;
    throw new GraphQLRequestError(first.message, first.extensions?.code);
  }
  if (!body.data) throw new GraphQLRequestError('Empty response');
  return body.data;
}
