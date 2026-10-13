# CIRKVL

**Good rides come full circle.** A responsive circular cycling route planner, built for GitHub Pages and phones.

Choose a start with GPS, place search, latitude/longitude, or the map. Choose gravel, single track, or road and a distance from 5 to 120 km. CIRKVL searches different directions for five distinct circular rides, shows individual route overviews and the actual distance-weighted surface breakdown, and exports a full-resolution GPX for Suunto and other route import apps. Rides are saved locally on the device, without an account. GeoJSON export is also available in Saved rides.

## Run

No build step, dependencies, API keys, or paid services are needed.

```sh
npm run dev
```

Open `http://localhost:4173`. Production must use HTTPS for browser GPS. Localhost also supports GPS. Online services are required to generate routes and view maps; this app does not download maps for offline use.

```sh
npm run check
npm test
```

## Publish on GitHub Pages

1. Create a repository called `CIRKVL` in your GitHub account. A public repository supports free GitHub Pages hosting. Private-repository Pages availability depends on your GitHub plan.
2. Push this source to its `main` branch, or upload the project files without changing their paths.
3. Open the repository's **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Run the **Test and publish CIRKVL** workflow from Actions, or push a new commit. The workflow validates the app and uploads `dist/` to Pages.
5. The deploy job reports the exact live URL. For a normal project repository it will be `https://YOUR-USERNAME.github.io/CIRKVL/`.

All app assets use relative paths. Project subpaths work without changes. The `.openai/hosting.json` file belongs to the private development preview and is not needed for GitHub Pages.

## How routes are made

The application requests real BRouter GeoJSON routes on OpenStreetMap's routable network. Profiles are `gravel` (with its unpaved preference enabled), `mtb`, and `fastbike-lowtraffic`. It constructs a closed set of waypoints in different directions and performs at most one length correction per direction. It uses at most 16 serial requests, stops once five distinct valid loops are found, rejects disconnected/open routes and excessive retracing, and ranks terrain match, closeness to the requested distance, and repeated sections. Geographic waypoints are only route constraints; they are never drawn or exported as a substitute for a successful routed track.

The selected distance is a target. Local networks can prevent an exact match, so actual distances and deviations are always shown. Fewer than five options can be returned where routes are sparse, directions enter water, services are unavailable, or distinct loops cannot be found. No mock or fabricated routes are substituted.

Surface shares use BRouter's `messages` → `Distance` and `WayTags`, weighted by section distance. The mutually exclusive surface shares add to 100%: gravel, paved, dirt/grass, rock/cobbles, sand, and unknown. Untagged surfaces and broad `surface=unpaved` tags remain unknown. Trail match is a separate estimate from non-paved OSM `highway=path` / MTB tags; it is **not a verified trail-width measurement** and is clearly labelled as estimated. Single-track width is not guaranteed. Elevation and travel times are estimates returned by the engine.

Every accepted route returns to its mapped start. A user-selected start may snap to a nearby routable road or path; larger offsets are shown, and offsets over 750 m are rejected. Surface colouring uses routing section endpoints, with a cumulative-distance fallback when an endpoint is absent from the geometry. Map overviews simplify only for display. GPX and GeoJSON preserve the complete routed geometry and available elevation.

## Suunto

Export a GPX and save it to your phone. In the Suunto app: **Maps → + → Import route (.gpx)**. Select the file, save the route, and enable/sync it to the watch. CIRKVL does not connect directly to a Suunto account or invent device-specific turn instructions. See [Suunto's file import guide](https://www.suunto.com/Support/faq-articles/suunto-app/what-files-can-i-import-to-the-suunto-app/).

## Services, privacy, and deployment limits

`dist/config.mjs` centralizes routing, geocoding, and tile URLs. The default public endpoints are BRouter, OSM Nominatim, and OSM raster tiles. These community services have no availability guarantee; a busy service is shown as an error and is not replaced with a fake result. For public growth, self-host BRouter and use a tile/geocoding provider with capacity for your traffic. The geocoder requires manual search, caches results in the browser session, and does not provide autocomplete. Public Nominatim's limit of one request per second is global to the application, not per browser, so multiple concurrent users require a shared rate-limited proxy or a different geocoding provider. Review the current provider policies before a larger public launch:

- [BRouter](https://brouter.de/) and [source](https://github.com/abrensch/brouter)
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)
- [OSM copyright and ODbL](https://www.openstreetmap.org/copyright)

GPS is requested only by a user tap. Coordinates/waypoints go to BRouter when routes are generated; search text goes to Nominatim when submitted; tile requests reveal the viewed map area. Saved rides remain in the browser's local storage and are limited to 50 entries. Clearing site data removes them. Export GPX or GeoJSON to keep a portable copy. There are no analytics or tracking scripts. Font requests go to Google Fonts; system fallbacks keep the app usable if they fail.

## Structure

- `dist/index.html`, `styles.css`, `app.mjs`: responsive planning, map, comparisons, saving, and exports.
- `dist/core.mjs`: geographic helpers, validation, surface/trail statistics, route ranking, overviews, GPX/GeoJSON.
- `dist/planner.mjs`: serial live route search, length refinement, deduplication, cancellation, and service errors.
- `dist/storage.mjs`: saved-route validation and storage error handling.
- `dist/config.mjs`: swappable open service endpoints.
- `dist/vendor/`: pinned Leaflet 1.9.4 and its license.
- `.github/workflows/pages.yml`: test and publish workflow.

App code is MIT licensed. Map data © OpenStreetMap contributors under ODbL. Routing by BRouter. Leaflet is BSD 2-Clause licensed. Retain the visible attribution and export credits.
