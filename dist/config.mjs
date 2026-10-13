// All URLs are public, keyless services. Swap these for your own providers as usage grows.
export const CONFIG = Object.freeze({
  routingEndpoint: 'https://brouter.de/brouter',
  geocodingEndpoint: 'https://nominatim.openstreetmap.org/search',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  defaultCenter: [57.72, 18.46],
  defaultZoom: 12,
  maxRoutingRequests: 16,
  requestTimeout: 45000,
});
