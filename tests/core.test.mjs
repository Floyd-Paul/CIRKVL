import test from 'node:test';
import assert from 'node:assert/strict';
import {distance,destination,createWaypoints,summarizeSurfaces,percentages,surfaceType,isTrail,parseRoute,toGPX,routeSimilarity,retracePercent,routeSVG,rankRoutes} from '../dist/core.mjs';
import {readSaved,writeSaved} from '../dist/storage.mjs';
import {readFile} from 'node:fs/promises';

const start=[18.30,57.64];
const line=[start,[18.31,57.645],[18.315,57.638],start];
const data=(coordinates=line,messages=[['Distance','WayTags'],['800','highway=track surface=gravel'],['400','highway=residential surface=asphalt']])=>({type:'FeatureCollection',features:[{type:'Feature',properties:{messages,'filtered ascend':'23','total-time':'720'},geometry:{type:'LineString',coordinates}}]});
const context={start,targetKm:5,terrain:'gravel',bearing:45,startLabel:'Test start'};

test('geographic helpers preserve distance and handle the antimeridian',()=>{
  assert.ok(Math.abs(distance(start,destination(start,37,10000))-10000)<.001);
  assert.ok(distance([179.99,0],[-179.99,0])<2300);
  const points=createWaypoints(start,30,45);assert.deepEqual(points[0],points.at(-1));
});
test('surface percentages are weighted by distance and total exactly 100',()=>{
  const s=summarizeSurfaces([['Distance','WayTags'],['300','surface=gravel'],['100','surface=asphalt']],400);
  assert.equal(s.surfaces.gravel,75);assert.equal(s.surfaces.paved,25);
  assert.equal(Object.values(percentages({gravel:1,paved:1,dirt:1})).reduce((a,b)=>a+b,0),100);
});
test('missing physical surfaces and undescribed distance remain unknown',()=>{
  assert.equal(surfaceType({highway:'track',tracktype:'grade2'}),'unknown');
  assert.equal(surfaceType({surface:'unpaved'}),'unknown');
  const s=summarizeSurfaces([['Distance','WayTags'],['500','surface=asphalt']],1000);
  assert.equal(s.surfaces.unknown,50);assert.equal(summarizeSurfaces(null,1000).surfaces.unknown,100);
});
test('paved paths are not counted as single track; trail match is separate from surface',()=>{
  assert.equal(isTrail({highway:'path',surface:'asphalt'}),false);
  const s=summarizeSurfaces([['Distance','WayTags'],['200','highway=path surface=dirt'],['100','highway=path'],['700','surface=asphalt']],1000);
  assert.equal(s.trailPercent,30);assert.equal(s.surfaces.dirt,20);assert.equal(s.surfaces.unknown,10);
});
test('open routes and remote start snaps are rejected',()=>{
  assert.throws(()=>parseRoute(data(line.slice(0,-1)),context),/return to its start/);
  assert.throws(()=>parseRoute(data(),{...context,start:[0,0]}),/too far/);
});
test('invalid coordinates are rejected and unavailable elevation is dropped',()=>{
  assert.throws(()=>parseRoute(data([[NaN,57],...line]),context),/invalid coordinates/);
  const r=parseRoute(data(line.map(p=>[...p,-32768])),context);assert.equal(r.coordinates[0].length,2);
});
test('an out-and-back is detected and near-identical options can be removed',()=>{
  const back=[start,[18.31,57.64],[18.32,57.64],[18.31,57.64],start];assert.equal(retracePercent(back),50);
  assert.equal(routeSimilarity({coordinates:line},{coordinates:[...line].reverse()}),1);
});
test('GPX preserves latitude/longitude, available elevation, and XML-safe names',()=>{
  const route={...parseRoute(data(line.map(p=>[...p,42])),context),name:'Ride <around> & back'};
  const gpx=toGPX(route);assert.match(gpx,/Ride &lt;around&gt; &amp; back/);assert.match(gpx,/lat="57.640000" lon="18.300000"/);assert.match(gpx,/<ele>42.0<\/ele>/);
  assert.equal([...gpx.matchAll(/<trkpt /g)].length,line.length);assert.match(gpx,/OpenStreetMap/);
});
test('route overview uses the routed geometry and ranking considers target distance',()=>{
  assert.match(routeSVG(line),/polyline/);
  const routes=[{preferredPercent:75,distanceKm:30,targetKm:30,retrace:0},{preferredPercent:75,distanceKm:38,targetKm:30,retrace:0}];
  assert.equal(rankRoutes(routes)[0].distanceKm,30);
});
test('saved rides survive a reload and corrupt/unavailable storage fails gracefully',()=>{
  let value=null;const storage={getItem:()=>value,setItem:(_k,v)=>value=v};const route={...parseRoute(data(),context),name:'Loop'};
  writeSaved(storage,[route]);assert.equal(readSaved(storage)[0].id,route.id);
  value='broken json';assert.deepEqual(readSaved(storage),[]);
  assert.throws(()=>writeSaved({setItem(){throw new Error('quota');}},[route]),/Could not save/);
});
test('real Gotland routing response parses its section data and closed geometry',async()=>{
  const fixture=JSON.parse(await readFile(new URL('./fixtures/gotland-brouter.geojson',import.meta.url),'utf8'));
  const route=parseRoute(fixture,{start:[18.4748443,57.6700497],targetKm:25,terrain:'gravel',bearing:45,startLabel:'Bro, Gotland'});
  assert.ok(route.distanceKm>25&&route.distanceKm<26);assert.equal(route.coordinates.length,319);
  assert.deepEqual(route.coordinates[0].slice(0,2),route.coordinates.at(-1).slice(0,2));
  assert.equal(Object.values(route.surfaces).reduce((a,b)=>a+b,0),100);assert.ok(route.surfaces.unknown>0);
  assert.equal(route.surfaceSections[0].from,0);assert.equal(route.surfaceSections.at(-1).to,route.coordinates.length-1);
  assert.ok(toGPX(route).includes('lat="57.'));assert.equal(route.ascent,11);
});
