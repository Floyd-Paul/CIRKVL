import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRoutes,requestRoute,RoutingError} from '../dist/planner.mjs';
import {distance} from '../dist/core.mjs';

const start=[18.30,57.64];
function response(points){let meters=0;for(let i=1;i<points.length;i++)meters+=distance(points[i-1],points[i]);return {type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'LineString',coordinates:points},properties:{messages:[['Distance','WayTags'],[String(meters),'highway=track surface=gravel']],'filtered ascend':'50'}}]};}
const options={start,startLabel:'Test location',targetKm:30,terrain:'gravel',seed:0};
test('planner produces five distinct closed options and refines distances',async()=>{
  let active=0,maxActive=0;const request=async points=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return response(points);};
  const result=await generateRoutes({...options,request});assert.equal(result.routes.length,5);assert.equal(maxActive,1);
  for(const r of result.routes){assert.ok(Math.abs(r.distanceKm-30)/30<.18);assert.deepEqual(r.coordinates[0],r.coordinates.at(-1));assert.equal(r.surfaces.gravel,100);}
});
test('duplicates never get padded to five fake route options',async()=>{
  let first;const result=await generateRoutes({...options,request:async points=>{first ||= response(points);return first;}});
  assert.equal(result.routes.length,1);assert.match(result.message,/Found 1 distinct loop/);assert.ok(result.requests<=16);
});
test('partial results remain usable when service rate limits further requests',async()=>{
  let calls=0;const result=await generateRoutes({...options,request:async points=>{if(++calls>2)throw new RoutingError('Busy',429);return response(points);}});
  assert.equal(result.routes.length,1);assert.ok(result.message);assert.equal(calls,3);
});
test('cancellation stops subsequent requests',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(()=>generateRoutes({...options,signal:controller.signal,request:async points=>{calls++;controller.abort();return response(points);}}),{name:'AbortError'});
  assert.ok(calls<=2);
});
test('network failure yields an honest error and stops after two calls',async()=>{
  let calls=0;const result=await generateRoutes({...options,request:async()=>{calls++;throw new RoutingError('Cannot reach service');}});
  assert.equal(result.routes.length,0);assert.equal(calls,2);assert.equal(result.message,'Cannot reach service');
});
test('routing request uses the selected real cycling profile and closed coordinates',async()=>{
  let url;const pts=[start,[18.31,57.64],start];
  await requestRoute(pts,'gravel',undefined,async input=>{url=new URL(input);return {ok:true,json:async()=>response(pts)};});
  assert.equal(url.searchParams.get('profile'),'gravel');assert.equal(url.searchParams.get('profile:prefer_unpaved_paths'),'1');assert.equal(url.searchParams.get('format'),'geojson');
  assert.equal(url.searchParams.get('profile:add_beeline'),'0');assert.equal(url.searchParams.get('profile:avoid_ferries'),null);
  const pairs=url.searchParams.get('lonlats').split('|');assert.equal(pairs[0],pairs.at(-1));assert.equal(url.searchParams.get('straight'),null);
});
test('known route-search failures are skipped even when BRouter reports HTTP 500',async()=>{
  await assert.rejects(()=>requestRoute([start,start],'road',undefined,async()=>({ok:false,status:500,text:async()=> 'via position 1 not mapped'})),error=>error.status===400);
});
