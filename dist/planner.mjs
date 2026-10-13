import {CONFIG} from './config.mjs';
import {TERRAINS, createWaypoints, parseRoute, rankRoutes, routeSimilarity} from './core.mjs';

export class RoutingError extends Error {
  constructor(message, status = 0) {super(message); this.name = 'RoutingError'; this.status = status;}
}

export async function requestRoute(points, terrain, signal, fetcher = fetch) {
  const url = new URL(CONFIG.routingEndpoint);
  url.searchParams.set('lonlats', points.map(p => p.slice(0, 2).map(x => x.toFixed(6)).join(',')).join('|'));
  url.searchParams.set('profile', TERRAINS[terrain].profile);
  url.searchParams.set('alternativeidx', '0');
  url.searchParams.set('format', 'geojson');
  // BRouter profile overrides accept numeric values, including 0/1 for booleans.
  // Sending JavaScript-style "true"/"false" produces a server error on the public service.
  if (terrain !== 'road') url.searchParams.set('profile:add_beeline', '0');
  url.searchParams.set('profile:correctMisplacedViaPoints', '1');
  if (terrain === 'gravel') url.searchParams.set('profile:prefer_unpaved_paths', '1');
  else {
    url.searchParams.set('profile:allow_ferries', '0');
    url.searchParams.set('profile:allow_steps', '0');
  }
  if (terrain === 'singletrack') url.searchParams.set('profile:StrictNOBicycleaccess', '1');
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  signal?.addEventListener('abort', abort, {once:true});
  let timedOut = false;
  const timer = setTimeout(() => {timedOut = true; controller.abort();}, CONFIG.requestTimeout);
  try {
    const response = await fetcher(url.toString(), {signal:controller.signal, headers:{Accept:'application/geo+json, application/json'}});
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      if (response.status === 429) throw new RoutingError('The public routing service is busy. Please wait a minute and try again.', 429);
      if (/not found|not mapped|position|waypoint|matching|no track|cannot find/i.test(body)) throw new RoutingError('No connected cycling route near these waypoints.', 400);
      if (response.status >= 500) throw new RoutingError('The routing service is temporarily unavailable. Please try again later.', response.status);
      throw new RoutingError(/not found|not mapped|position|waypoint|matching|cannot|no track/i.test(body) ? 'No connected cycling route near these waypoints.' : 'The routing service could not plan this loop.', response.status);
    }
    return await response.json();
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (timedOut) throw new RoutingError('The routing service took too long. Try a shorter distance.');
    if (error instanceof RoutingError) throw error;
    throw new RoutingError('Could not reach the routing service. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function generateRoutes({start, startLabel, targetKm, terrain, seed = Math.random() * 360, signal, onProgress = () => {}, request = requestRoute}) {
  if (!TERRAINS[terrain]) throw new Error('Choose a terrain preference.');
  if (!Array.isArray(start) || !start.slice(0, 2).every(Number.isFinite) || Math.abs(start[0]) > 180 || Math.abs(start[1]) > 90) throw new Error('Choose a starting point.');
  if (!Number.isFinite(targetKm) || targetKm < 5 || targetKm > 120) throw new Error('Choose a distance between 5 and 120 km.');
  const routes = [];
  let requests = 0, consecutiveServiceErrors = 0, lastError = '', failedDirections = 0;
  // Search around the start. Rotate by 36° between rounds to find inland options near coasts.
  const offsets = [0,72,144,216,288,36,108,180,252,324];
  for (const offset of offsets) {
    if (routes.length >= 5 || requests >= CONFIG.maxRoutingRequests) break;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const bearing = (seed + offset) % 360;
    onProgress({found:routes.length, requests, attempt:offsets.indexOf(offset) + 1, routes:rankRoutes(routes)});
    const context = {start, startLabel, targetKm, terrain, bearing};
    let scale = 1, candidate;
    try {
      requests++;
      const initialData=await request(createWaypoints(start, targetKm, bearing, scale), terrain, signal);
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      candidate = parseRoute(initialData, context);
      consecutiveServiceErrors = 0;
      // One distance correction per direction; always show the actual routed length.
      if (Math.abs(candidate.distanceKm - targetKm) / targetKm > .18 && requests < CONFIG.maxRoutingRequests) {
        scale = Math.min(1.8, Math.max(.45, targetKm / candidate.distanceKm));
        requests++;
        const correctedData=await request(createWaypoints(start, targetKm, bearing, scale), terrain, signal);
        if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
        const corrected = parseRoute(correctedData, context);
        if (Math.abs(corrected.distanceKm - targetKm) < Math.abs(candidate.distanceKm - targetKm)) candidate = corrected;
      }
      if (candidate.retrace > 35 || Math.abs(candidate.distanceKm - targetKm) / targetKm > .30) {failedDirections++; continue;}
      if (routes.some(r => routeSimilarity(r, candidate) > .88)) {failedDirections++; continue;}
      routes.push(candidate);
      onProgress({found:routes.length, requests, attempt:offsets.indexOf(offset) + 1, routes:rankRoutes(routes)});
    } catch (error) {
      if (signal?.aborted || error.name === 'AbortError') throw new DOMException('Cancelled', 'AbortError');
      lastError = error.message;
      if (error.status === 429) break;
      if (error.status >= 500 || (error instanceof RoutingError && error.status === 0)) {
        consecutiveServiceErrors++;
        if (consecutiveServiceErrors >= 2) break;
      } else {consecutiveServiceErrors = 0; failedDirections++;}
    }
  }
  const ranked = rankRoutes(routes);
  let message = '';
  if (ranked.length < 5) message = ranked.length
    ? `Found ${ranked.length} distinct ${ranked.length === 1 ? 'loop' : 'loops'} here. Try a different start or distance for more options.${lastError && !failedDirections ? ' ' + lastError : ''}`
    : lastError || 'No suitable circular rides found here. Try a point nearer connected trails, or change the distance.';
  return {routes:ranked, requests, message};
}
