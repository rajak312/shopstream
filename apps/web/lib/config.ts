export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:4700/graphql';
/**
 * Origin of the gateway, used for the SSE endpoints. A relative GATEWAY_URL
 * (e.g. "/graphql" behind the Kubernetes ingress) means "same origin".
 */
export const API_ORIGIN = GATEWAY_URL.startsWith('/') ? '' : new URL(GATEWAY_URL).origin;
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3700';
export const REPO_URL = 'https://github.com/rajak312/shopstream';
export const GITOPS_REPO_URL = 'https://github.com/rajak312/shopstream-gitops';
