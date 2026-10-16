import type { FastifyRequest } from 'fastify';

/**
 * The path a request is routed to: the matched route's pattern (`/api/accounts/:id`), or the raw path when no route
 * matched. Decide on this, never on `req.url`: the router decodes `/%61pi/overview` to the `/api/overview` route,
 * so the raw path can hide an /api request from a check.
 */
export function routedPath(req: FastifyRequest): string {
  return req.routeOptions.url ?? req.url.split('?')[0];
}

/** Routed to an /api route, or written as one (an unknown /api path is routed to the static files' catch-all). */
export const isApiRequest = (req: FastifyRequest) =>
  routedPath(req).startsWith('/api') || req.url.startsWith('/api');
