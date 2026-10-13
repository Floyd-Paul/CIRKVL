const KEY = 'cirkvl.rides.v1';
export function validSavedRoute(r) {
  return !!(r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.createdAt === 'string'
    && ['gravel','singletrack','road'].includes(r.terrain) && Number.isFinite(r.distanceKm) && r.distanceKm > 0
    && Number.isFinite(r.preferredPercent) && Number.isFinite(r.bearing)
    && Number.isFinite(r.ascent) && Number.isFinite(r.durationMinutes) && Number.isFinite(r.targetKm)
    && Number.isFinite(r.retrace) && Number.isFinite(r.snapDistance) && typeof r.startLabel === 'string'
    && r.surfaces && Object.values(r.surfaces).every(n => Number.isFinite(n) && n >= 0 && n <= 100)
    && Array.isArray(r.coordinates) && r.coordinates.length > 2 && r.coordinates.length < 100000
    && r.coordinates.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0])<=180 && Math.abs(p[1])<=90));
}
export function readSaved(storage) {
  try {
    const routes = JSON.parse(storage.getItem(KEY) || '[]');
    return Array.isArray(routes) ? routes.filter(validSavedRoute).slice(0,50) : [];
  } catch {return [];}
}
export function writeSaved(storage, routes) {
  if (routes.length > 50) throw new Error('Your collection is full. Export a ride and remove one to make room.');
  try {storage.setItem(KEY, JSON.stringify(routes));}
  catch {throw new Error('Could not save on this device. Storage may be full or disabled. Export GPX to keep the ride.');}
}
