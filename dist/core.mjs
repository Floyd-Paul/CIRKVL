export const SURFACES = Object.freeze({
  gravel: {label: 'Gravel', color: '#b89971'},
  paved: {label: 'Paved', color: '#697a79'},
  dirt: {label: 'Dirt & grass', color: '#75916c'},
  rock: {label: 'Rock & cobbles', color: '#a98e80'},
  sand: {label: 'Sand', color: '#dcc99c'},
  unknown: {label: 'Unknown', color: '#c6ccca'},
});

export const TERRAINS = Object.freeze({
  gravel: {label: 'Gravel', profile: 'gravel', matchLabel: 'gravel', speed: 18},
  singletrack: {label: 'Single track', profile: 'mtb', matchLabel: 'trail', speed: 13},
  road: {label: 'Road', profile: 'fastbike-lowtraffic', matchLabel: 'paved', speed: 24},
});

const rad = n => n * Math.PI / 180;
const deg = n => n * 180 / Math.PI;

// Coordinates throughout the routing/export code use GeoJSON order: longitude, latitude.
export function distance(a, b) {
  const dlat = rad(b[1] - a[1]), dlon = rad(b[0] - a[0]);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function destination(start, bearing, meters) {
  const d = meters / 6371008.8, b = rad(bearing), lat = rad(start[1]), lon = rad(start[0]);
  const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
  const lon2 = lon + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
  return [((deg(lon2) + 540) % 360) - 180, deg(lat2)];
}

export function createWaypoints(start, targetKm, bearing, scale = 1) {
  const radius = targetKm * 1000 / 5 * scale;
  return [start, destination(start, bearing - 40, radius), destination(start, bearing, radius * 1.5), destination(start, bearing + 40, radius), start];
}

export function parseTags(input) {
  const tags = {};
  for (const token of String(input || '').split(/\s+/)) {
    const equals = token.indexOf('=');
    if (equals > 0) tags[token.slice(0, equals)] = token.slice(equals + 1).toLowerCase();
  }
  return tags;
}

export function surfaceType(tags) {
  const value = tags.surface || '';
  if (/^(asphalt|paved|concrete(:.*)?|paving_stones(:.*)?|chipseal|metal|wood|rubber)$/.test(value)) return 'paved';
  if (/^(gravel|fine_gravel|compacted|pebblestone)$/.test(value)) return 'gravel';
  if (/^(ground|dirt|earth|grass|grass_paver|mud|clay)$/.test(value)) return 'dirt';
  if (/^(rock|stone|cobblestone(:.*)?|sett|unhewn_cobblestone)$/.test(value)) return 'rock';
  if (/^(sand)$/.test(value)) return 'sand';
  // 'unpaved' and tracktype describe a broad class, not an actual physical surface.
  return 'unknown';
}

export function isTrail(tags) {
  if (surfaceType(tags) === 'paved' || tags.bicycle === 'no' || tags.footway === 'sidewalk') return false;
  return tags.highway === 'path' || (tags['mtb:scale'] !== undefined && tags.highway !== 'track');
}

export function percentages(totals) {
  const keys = Object.keys(SURFACES), sum = keys.reduce((s, k) => s + (totals[k] || 0), 0);
  if (!sum) return Object.fromEntries(keys.map(k => [k, k === 'unknown' ? 100 : 0]));
  const raw = keys.map(key => ({key, value: (totals[key] || 0) / sum * 100}));
  const result = Object.fromEntries(raw.map(x => [x.key, Math.floor(x.value)]));
  let remaining = 100 - Object.values(result).reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b.value % 1) - (a.value % 1));
  for (let i = 0; i < remaining; i++) result[raw[i].key]++;
  return result;
}

export function summarizeSurfaces(messages, routeMeters) {
  const totals = Object.fromEntries(Object.keys(SURFACES).map(k => [k, 0]));
  let trail = 0, described = 0;
  if (Array.isArray(messages) && Array.isArray(messages[0])) {
    const header = messages[0], distIndex = header.indexOf('Distance'), tagsIndex = header.indexOf('WayTags');
    if (distIndex >= 0 && tagsIndex >= 0) for (const row of messages.slice(1)) {
      const meters = Number(row[distIndex]);
      if (!Number.isFinite(meters) || meters <= 0) continue;
      const tags = parseTags(row[tagsIndex]);
      totals[surfaceType(tags)] += meters;
      if (isTrail(tags)) trail += meters;
      described += meters;
    }
  }
  totals.unknown += Math.max(0, routeMeters - described);
  const denominator = Math.max(routeMeters, described);
  return {surfaces: percentages(totals), trailPercent: denominator > 0 ? Math.round(trail / denominator * 100) : 0};
}

export function surfaceSections(messages, coordinates) {
  if (!Array.isArray(messages?.[0])) return [{from:0,to:coordinates.length-1,type:'unknown'}];
  const header = messages[0], di = header.indexOf('Distance'), ti = header.indexOf('WayTags');
  const xi = header.indexOf('Longitude'), yi = header.indexOf('Latitude');
  if (di < 0 || ti < 0) return [{from:0,to:coordinates.length-1,type:'unknown'}];
  const sections = [], cumulative = [0];
  for (let i=1;i<coordinates.length;i++) cumulative.push(cumulative[i-1]+distance(coordinates[i-1],coordinates[i]));
  let cursor = 0, expectedDistance = 0;
  for (const row of messages.slice(1)) {
    const meters = Number(row[di]);
    if (!Number.isFinite(meters) || meters <= 0) continue;
    expectedDistance += meters;
    let end = -1;
    if (xi >= 0 && yi >= 0) {
      const target = [Number(row[xi])/1e6, Number(row[yi])/1e6];
      for (let j=cursor+1;j<coordinates.length;j++) {
        if (Math.abs(coordinates[j][0]-target[0]) < .000002 && Math.abs(coordinates[j][1]-target[1]) < .000002) {end=j;break;}
      }
    }
    if (end < 0) {
      end=cursor;
      while (end < coordinates.length-1 && cumulative[end] < expectedDistance) end++;
    }
    if (end <= cursor) continue;
    sections.push({from:cursor,to:end,type:surfaceType(parseTags(row[ti]))});
    cursor=end;
  }
  if (cursor < coordinates.length-1) sections.push({from:cursor,to:coordinates.length-1,type:'unknown'});
  return sections.length ? sections : [{from:0,to:coordinates.length-1,type:'unknown'}];
}

export function edgesFor(coordinates) {
  const edges = new Map();
  const key = p => p.slice(0, 2).map(n => n.toFixed(6)).join(',');
  for (let i = 1; i < coordinates.length; i++) {
    const a = key(coordinates[i - 1]), b = key(coordinates[i]), meters = distance(coordinates[i - 1], coordinates[i]);
    if (a === b || meters < 1) continue;
    const id = a < b ? `${a}|${b}` : `${b}|${a}`;
    const entry = edges.get(id);
    if (entry) { entry.total += meters; entry.count++; }
    else edges.set(id, {total: meters, first: meters, count: 1});
  }
  return edges;
}

export function retracePercent(coordinates) {
  const edges = edgesFor(coordinates);
  let total = 0, repeat = 0;
  for (const e of edges.values()) {total += e.total; repeat += e.total - e.first;}
  return total ? Math.round(repeat / total * 100) : 0;
}

export function routeSimilarity(a, b) {
  const one = edgesFor(a.coordinates), two = edgesFor(b.coordinates);
  let shared = 0, sizeA = 0, sizeB = 0;
  for (const [id, e] of one) {sizeA += e.first; if (two.has(id)) shared += Math.min(e.first, two.get(id).first);}
  for (const e of two.values()) sizeB += e.first;
  return shared / Math.max(1, Math.min(sizeA, sizeB));
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, x => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[x]));
}

function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {h ^= value.charCodeAt(i); h = Math.imul(h, 16777619);}
  return (h >>> 0).toString(36);
}

export function parseRoute(data, context) {
  const feature = data?.features?.find(f => f.geometry?.type === 'LineString');
  if (!feature || !Array.isArray(feature.geometry.coordinates) || feature.geometry.coordinates.length < 3) throw new Error('The routing service returned no usable trail.');
  const coordinates = feature.geometry.coordinates.map(p => {
    if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error('The routing service returned invalid coordinates.');
    return Number.isFinite(p[2]) && p[2] > -1000 && p[2] < 10000 ? p.slice(0, 3) : p.slice(0, 2);
  });
  let meters = 0;
  for (let i = 1; i < coordinates.length; i++) meters += distance(coordinates[i - 1], coordinates[i]);
  if (meters < 500) throw new Error('This loop is too short to ride.');
  if (distance(coordinates[0], coordinates.at(-1)) > 60) throw new Error('This route does not return to its start.');
  const snapDistance = distance(context.start, coordinates[0]);
  if (snapDistance > 750) throw new Error('The start is too far from a mapped cycling route. Choose a point closer to a road or trail.');
  const properties = feature.properties || {};
  if (Array.isArray(properties.messages?.[0])) {
    const tagIndex=properties.messages[0].indexOf('WayTags');
    if(tagIndex>=0&&properties.messages.slice(1).some(row=>parseTags(row[tagIndex]).route==='ferry')) throw new Error('This route needs a ferry. Trying a different direction.');
  }
  const terrain = TERRAINS[context.terrain] ? context.terrain : 'gravel';
  const stats = summarizeSurfaces(properties.messages, meters);
  const preferredPercent = terrain === 'singletrack' ? stats.trailPercent : stats.surfaces[terrain === 'road' ? 'paved' : 'gravel'];
  const time = Number(properties['total-time']);
  return {
    id: `c${hash(JSON.stringify(coordinates) + terrain)}`, coordinates, terrain,
    start: context.start.slice(0, 2), startLabel: context.startLabel || 'Chosen starting point',
    targetKm: context.targetKm, bearing: context.bearing,
    distanceKm: meters / 1000, ascent: Math.max(0, Number(properties['filtered ascend']) || 0),
    ascentAvailable: Number.isFinite(Number(properties['filtered ascend'])),
    durationMinutes: time > 0 ? Math.round(time / 60) : Math.round(meters / 1000 / TERRAINS[terrain].speed * 60),
    surfaces: stats.surfaces, trailPercent: stats.trailPercent, preferredPercent,
    surfaceSections: surfaceSections(properties.messages, coordinates),
    retrace: retracePercent(coordinates), snapDistance,
    createdAt: new Date().toISOString(), source: properties.creator || 'BRouter',
  };
}

export function rankRoutes(routes) {
  const score = r => r.preferredPercent * .75 - Math.abs(r.distanceKm - r.targetKm) / r.targetKm * 35 - r.retrace * .15;
  return [...routes].sort((a, b) => score(b) - score(a));
}

export function compass(bearing) {
  return ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'][Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}

export function formatDuration(minutes) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}

export function routeSVG(coordinates, color = '#e66a43', width = 130, height = 86) {
  const lats = coordinates.map(p => p[1]), lons = coordinates.map(p => p[0]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cos = Math.cos(rad(midLat));
  const xs = lons.map(x => x * cos), ys = lats.map(y => -y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 20) / Math.max(.00001, maxX - minX), (height - 20) / Math.max(.00001, maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2, offsetY = (height - (maxY - minY) * scale) / 2;
  const point = i => [(xs[i] - minX) * scale + offsetX, (ys[i] - minY) * scale + offsetY];
  // Downsample only the tiny overview. The map and exports retain every point.
  const step = Math.max(1, Math.floor(coordinates.length / 260)), points = [];
  for (let i = 0; i < coordinates.length; i += step) points.push(point(i).map(n => n.toFixed(1)).join(','));
  points.push(point(coordinates.length - 1).map(n => n.toFixed(1)).join(','));
  const [cx, cy] = point(0);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Route overview"><path d="M0 22H${width}M0 44H${width}M0 66H${width}M22 0V${height}M44 0V${height}M66 0V${height}M88 0V${height}M110 0V${height}" stroke="#e5e8e0" stroke-width=".6" fill="none"/><polyline points="${points.join(' ')}" fill="none" stroke="${escapeHTML(color)}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="#fff" stroke="${escapeHTML(color)}" stroke-width="2"/></svg>`;
}

export function toGPX(route) {
  const name = route.name || `${compass(route.bearing)} ${TERRAINS[route.terrain]?.label || 'cycling'} loop`;
  const desc = `CIRKVL circular cycling route. ${route.distanceKm.toFixed(1)} km. Map data © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright. Routing: BRouter. Surface data is mapped or unknown; trail width is not verified.`;
  const points = route.coordinates.map(p => `<trkpt lat="${p[1].toFixed(6)}" lon="${p[0].toFixed(6)}">${Number.isFinite(p[2]) ? `<ele>${p[2].toFixed(1)}</ele>` : ''}</trkpt>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="CIRKVL" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 https://www.topografix.com/GPX/1/1/gpx.xsd"><metadata><name>${escapeHTML(name)}</name><desc>${escapeHTML(desc)}</desc><link href="https://www.openstreetmap.org/copyright"><text>OpenStreetMap contributors</text></link></metadata><trk><name>${escapeHTML(name)}</name><desc>${escapeHTML(desc)}</desc><type>Cycling</type><trkseg>\n${points}\n</trkseg></trk></gpx>`;
}

export function toGeoJSON(route) {
  return {type:'FeatureCollection', features:[{type:'Feature',properties:{name:route.name, distanceKm:route.distanceKm, surfaces:route.surfaces, terrain:route.terrain, attribution:'© OpenStreetMap contributors, ODbL', routing:'BRouter'},geometry:{type:'LineString',coordinates:route.coordinates}}]};
}
