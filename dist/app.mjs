import {CONFIG} from './config.mjs';
import {SURFACES, TERRAINS, compass, formatDuration, routeSVG, escapeHTML, toGPX, toGeoJSON} from './core.mjs';
import {generateRoutes} from './planner.mjs';
import {readSaved, writeSaved} from './storage.mjs';

const $ = id => document.getElementById(id);
const icon = name => `<svg class="icon"><use href="#i-${name}"/></svg>`;
const colors = ['#e46b46','#6e9271','#738faa','#b69051','#9e7ea3'];
const state = {start:null, startLabel:'', terrain:'gravel', distance:30, routes:[], selected:null, generating:false, picking:false, surface:false, saved:[], controller:null};
let map, marker, routeLayers, tileErrors = 0, toastTimer, searchController, lastSearch = 0;
try {state.saved=readSaved(localStorage);} catch {}

function message(text, error=false) {$('form-message').textContent=text; $('form-message').classList.toggle('error',error);}
function toast(text) {clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4800);}
function hideResults() {
  state.routes=[];state.selected=null;
  $('results-panel').hidden=true;$('selected-panel').hidden=true;$('map-legend').hidden=true;
  document.querySelector('.map-workspace').classList.remove('has-results','has-notice');
  routeLayers?.clearLayers();$('map-empty').hidden=false;
}
function cancelSearch() {state.controller?.abort();}
function setStart(point,label) {
  cancelSearch();setPicking(false);hideResults();
  state.start=point;state.startLabel=label;
  $('start-name').textContent=label;$('start-coordinates').textContent=`${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
  $('start-display').hidden=false;$('search-results').hidden=true;
  $('map-area').textContent=label.toUpperCase();
  if (map) {
    if(marker)map.removeLayer(marker);
    marker=L.marker([point[1],point[0]],{icon:L.divIcon({className:'start-marker',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
    marker.bindTooltip(document.createTextNode('Start & finish'),{direction:'top',offset:[0,-11]});
    map.setView([point[1],point[0]],Math.max(12,map.getZoom()));
  }
  message('Starting point ready. Find your way around.');
}
function setPicking(value) {
  if(value&&!map){message('The map is unavailable. Search for a place or enter coordinates instead.',true);return;}
  state.picking=value;$('pick-banner').hidden=!value;$('pick-button').classList.toggle('active',value);
  document.querySelector('.map-workspace').classList.toggle('picking',value);
  if(value){$('map-empty').hidden=true;document.querySelector('.map-workspace').scrollIntoView({behavior:'smooth',block:'start'});}
  else if(!state.routes.length)$('map-empty').hidden=false;
}

function initMap() {
  if(!window.L){$('map-unavailable').hidden=false;return;}
  try {
    map=L.map('map',{zoomControl:false,attributionControl:true}).setView(CONFIG.defaultCenter,CONFIG.defaultZoom);
    L.control.zoom({position:'topright'}).addTo(map);
    L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
    const tiles=L.tileLayer(CONFIG.tileUrl,{maxZoom:19,attribution:CONFIG.tileAttribution,updateWhenIdle:true,keepBuffer:1}).addTo(map);
    tiles.on('tileerror',()=>{tileErrors++;if(tileErrors>=8){$('map-unavailable').hidden=false;$('map-unavailable').innerHTML='<strong>The base map couldn’t load.</strong><p>Routes can still be generated, viewed as outlines, and exported. Reload to try the map again.</p>';}});
    tiles.on('tileload',()=>{tileErrors=0;$('map-unavailable').hidden=true;});
    routeLayers=L.layerGroup().addTo(map);
    map.on('click',event=>{if(state.picking)setStart([event.latlng.lng,event.latlng.lat],'Pinned starting point');});
    new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('map'));
  } catch {$('map-unavailable').hidden=false;map=null;}
}

async function locate() {
  if(!navigator.geolocation){message('Location is unavailable. Search or choose a point on the map.',true);return;}
  const button=$('locate-button');button.disabled=true;message('Waiting for your location…');
  navigator.geolocation.getCurrentPosition(position=>{
    button.disabled=false;setStart([position.coords.longitude,position.coords.latitude],'Your location');
  },error=>{
    button.disabled=false;
    message(error.code===1?'Location access was declined. Search or pick your start on the map.':'Could not get your location. Search for a place or choose a point on the map.',true);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}

function parseCoordinates(input) {
  const match=input.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if(!match)return null;
  const lat=Number(match[1]),lon=Number(match[2]);
  if(Math.abs(lat)>90||Math.abs(lon)>180)throw new Error('Enter valid latitude, longitude — for example 57.64, 18.30.');
  return [lon,lat];
}

async function searchPlace() {
  const query=$('place-input').value.trim();
  if(query.length<2){message('Enter a town, place, or latitude, longitude.',true);return;}
  try {const coords=parseCoordinates(query);if(coords){setStart(coords,'Entered coordinates');return;}}catch(e){message(e.message,true);return;}
  if(Date.now()-lastSearch<1100)return;
  lastSearch=Date.now();searchController?.abort();searchController=new AbortController();
  const thisController=searchController, timer=setTimeout(()=>thisController.abort(),15000);
  $('search-button').disabled=true;message('Looking for that place…');
  try {
    let cache;try{cache=JSON.parse(sessionStorage.getItem(`cirkvl.search.${query.toLowerCase()}`)||'null');}catch{}
    let results=cache;
    if(!results){
      const url=new URL(CONFIG.geocodingEndpoint);url.searchParams.set('q',query);url.searchParams.set('format','jsonv2');url.searchParams.set('limit','5');
      const response=await fetch(url,{signal:thisController.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(response.status===429?'Place search is busy. Please wait a moment, or use the map.':'Place search is unavailable. Use your location, coordinates, or the map.');
      results=await response.json();
      if(!Array.isArray(results))throw new Error('Place search returned an unexpected response. Try the map instead.');
      try{sessionStorage.setItem(`cirkvl.search.${query.toLowerCase()}`,JSON.stringify(results));}catch{}
    }
    const valid=results.filter(r=>Number.isFinite(Number(r.lon))&&Number.isFinite(Number(r.lat))&&Math.abs(Number(r.lon))<=180&&Math.abs(Number(r.lat))<=90);
    const box=$('search-results');box.replaceChildren();box.hidden=false;
    if(!valid.length){const p=document.createElement('p');p.textContent='No places found. Try a nearby town or choose a point on the map.';box.append(p);message('Try another search or a point on the map.');return;}
    for(const place of valid){const button=document.createElement('button');button.type='button';button.textContent=place.display_name||place.name||'Found place';button.addEventListener('click',()=>setStart([Number(place.lon),Number(place.lat)],String(place.display_name||place.name||'Chosen place').split(',').slice(0,2).join(', ')));box.append(button);}
    message('Select your starting place from the results.');
  }catch(error){if(searchController===thisController)message(error.name==='AbortError'?'Place search timed out. Try again or use the map.':error.message,true);}
  finally{clearTimeout(timer);if(searchController===thisController)$('search-button').disabled=false;}
}

function surfaceBar(route) {
  return `<div class="surface-bar" aria-label="Surface breakdown">${Object.entries(SURFACES).map(([k,v])=>`<span style="width:${route.surfaces[k]||0}%;background:${v.color}" title="${v.label}: ${route.surfaces[k]||0}%"></span>`).join('')}</div>`;
}
function nameRoute(route) {return route.name||`${compass(route.bearing)} ${TERRAINS[route.terrain].label.toLowerCase()} loop`;}
function labelMatch(route) {return `${route.terrain==='singletrack'?'≈ ':''}${route.preferredPercent}% ${TERRAINS[route.terrain].matchLabel}`;}
function renderCards() {
  const container=$('route-cards');container.replaceChildren();
  state.routes.forEach((route,index)=>{
    const button=document.createElement('button');button.type='button';button.className=`route-card${state.selected?.id===route.id?' selected':''}`;
    button.setAttribute('aria-pressed',String(state.selected?.id===route.id));
    button.setAttribute('aria-label',`${nameRoute(route)}, ${route.distanceKm.toFixed(1)} kilometres, ${labelMatch(route)}, ${route.surfaces.unknown||0} percent unknown surface`);
    const delta=Math.round((route.distanceKm-route.targetKm)/route.targetKm*100);
    button.innerHTML=`<div class="route-head"><span class="route-title"><span class="route-number">0${index+1}</span>${escapeHTML(compass(route.bearing))} loop</span>${index===0?'<span class="best-badge">BEST MATCH</span>':''}</div><div class="route-middle"><div class="route-mini">${routeSVG(route.coordinates,colors[index])}</div><div class="route-measures"><div class="route-distance">${route.distanceKm.toFixed(1)}<small>km</small></div><div class="route-stats"><span>${icon('mountain')}${route.ascentAvailable?`${route.ascent} m`:'—'}</span><span>${icon('time')}${formatDuration(route.durationMinutes)}</span></div></div></div><div class="match-line"><strong>${labelMatch(route)}</strong><span>${Math.abs(delta)<2?'Close to target':`${delta>0?'+':''}${delta}% distance`}</span></div>${surfaceBar(route)}<div class="surface-labels">${Object.entries(SURFACES).filter(([k])=>route.surfaces[k]>0).map(([k,v])=>`<span>${route.surfaces[k]}% ${v.label.toLowerCase()}</span>`).join('')}</div>`;
    button.addEventListener('click',()=>selectRoute(route,true));container.append(button);
  });
  $('result-count').textContent=`${state.routes.length} ${state.routes.length===1?'loop':'loops'}`;
  $('results-title').textContent=state.generating?'Your loops are taking shape.':'Your next ride, found.';
  $('results-panel').hidden=!state.routes.length;
  document.querySelector('.map-workspace').classList.toggle('has-results',!!state.routes.length);
}

function renderSelected() {
  const r=state.selected;if(!r){$('selected-panel').hidden=true;return;}
  const isSaved=state.saved.some(x=>x.id===r.id);
  $('selected-panel').innerHTML=`<div class="selected-summary"><span class="eyebrow">START AND FINISH · ${escapeHTML(r.startLabel)}</span><h3>${escapeHTML(nameRoute(r))}</h3><div class="selected-metrics"><span>${icon('loop')}${r.distanceKm.toFixed(1)} km</span><span>${icon('mountain')}${r.ascentAvailable?`${r.ascent} m ascent`:'No ascent data'}</span><span>${icon('time')}~${formatDuration(r.durationMinutes)}</span></div><p class="selected-footnote">${r.retrace?`${r.retrace}% repeated sections · `:''}${r.terrain==='singletrack'?'Trail share inferred from path tags.':'Surface share from mapped tags.'}${r.snapDistance>80?` Start snapped ${Math.round(r.snapDistance)} m to the network.`:''}</p></div><div class="selected-surfaces">${surfaceBar(r)}<div class="surface-grid">${Object.entries(SURFACES).map(([k,v])=>`<span><i class="surface-dot" style="background:${v.color}"></i>${v.label} ${r.surfaces[k]||0}%</span>`).join('')}</div></div><div class="selected-actions"><button type="button" class="save-button${isSaved?' is-saved':''}" id="save-selected" aria-label="${isSaved?'Ride saved on this device':'Save this ride'}" title="${isSaved?'Saved on this device':'Save ride'}">${icon(isSaved?'check':'bookmark')}</button><div><button type="button" class="export-button" id="export-selected">${icon('download')}Export GPX</button><button type="button" class="export-choice" id="share-selected">Share to an app</button></div></div>`;
  $('selected-panel').hidden=false;
  $('save-selected').addEventListener('click',()=>saveRide(r));$('export-selected').addEventListener('click',()=>exportRide(r));$('share-selected').addEventListener('click',()=>shareRide(r));
}

function drawRoutes() {
  if(!map)return;routeLayers.clearLayers();
  state.routes.forEach((r,index)=>{
    if(r.id===state.selected?.id)return;
    const line=L.polyline(r.coordinates.map(p=>[p[1],p[0]]),{color:colors[index],weight:3,opacity:.4}).addTo(routeLayers);
    line.on('click',()=>selectRoute(r,false));
  });
  const r=state.selected;
  if(r){
    const latlngs=r.coordinates.map(p=>[p[1],p[0]]);
    L.polyline(latlngs,{color:'#fffef9',weight:8,opacity:.9,interactive:false}).addTo(routeLayers);
    if(state.surface&&Array.isArray(r.surfaceSections)){
      r.surfaceSections.forEach(s=>L.polyline(latlngs.slice(s.from,s.to+1),{color:SURFACES[s.type]?.color||SURFACES.unknown.color,weight:5,opacity:1,interactive:false}).addTo(routeLayers));
    }else L.polyline(latlngs,{color:colors[Math.max(0,state.routes.findIndex(x=>x.id===r.id))],weight:4,opacity:1,interactive:false}).addTo(routeLayers);
  }
  $('map-legend').innerHTML=Object.entries(SURFACES).map(([k,v])=>`<span><i class="surface-dot" style="background:${v.color}"></i>${v.label}</span>`).join('');
  $('map-legend').hidden=!(state.surface&&r);
}
function fitRoute(route) {
  if(!map)return;
  if(route){const size=map.getSize(),mobile=window.innerWidth<=760;
    map.fitBounds(L.latLngBounds(route.coordinates.map(p=>[p[1],p[0]])),{paddingTopLeft:[20,mobile?110:85],paddingBottomRight:[mobile?20:Math.min(330,size.x*.4),mobile?Math.min(510,size.y*.55):190],maxZoom:15,animate:false});
  }else if(state.start)map.setView([state.start[1],state.start[0]],13);else map.setView(CONFIG.defaultCenter,CONFIG.defaultZoom);
}
function selectRoute(route,fit) {state.selected=route;renderCards();renderSelected();drawRoutes();if(fit)fitRoute(route);}

async function plan(event) {
  event?.preventDefault();if(state.generating)return;
  if(!state.start){message('Choose a starting point first — your location, a search, or a point on the map.',true);$('locate-button').focus();return;}
  setPicking(false);hideResults();state.generating=true;state.controller=new AbortController();
  const controller=state.controller;let progressTimer;
  $('generate-button').disabled=true;$('cancel-button').hidden=false;$('search-progress').hidden=false;$('map-empty').hidden=true;
  document.querySelector('.map-workspace').classList.add('has-progress');
  $('result-notice').hidden=true;$('progress-count').textContent='0 / 5';$('progress-heading').textContent='Finding your way around…';
  $('progress-text').textContent='Following real roads and trails. This can take a minute.';message('Searching the mapped cycling network…');
  if(window.innerWidth<=760)document.querySelector('.map-workspace').scrollIntoView({behavior:'smooth',block:'start'});
  try{
    const result=await generateRoutes({start:[...state.start],startLabel:state.startLabel,targetKm:state.distance,terrain:state.terrain,signal:controller.signal,onProgress:progress=>{
      if(controller.signal.aborted)return;
      state.routes=progress.routes;if(!state.selected&&state.routes.length)state.selected=state.routes[0];
      $('progress-count').textContent=`${progress.found} / 5`;
      $('progress-heading').textContent=progress.found?'A few good ways back…':'Finding your way around…';
      $('progress-text').textContent=`${progress.found} ${progress.found===1?'loop':'loops'} found · Exploring another direction.`;
      renderCards();renderSelected();drawRoutes();if(progress.found===1&&!progressTimer){fitRoute(state.selected);progressTimer=true;}
    }});
    if(controller.signal.aborted)return;
    state.routes=result.routes;state.selected=state.routes[0]||null;
    if(result.routes.length){selectRoute(state.selected,true);message(`${result.routes.length} circular ${result.routes.length===1?'ride':'rides'} found. Pick the one that feels right.`);}
    else{$('map-empty').hidden=false;message(result.message,true);}
    $('result-notice').hidden=!result.message;$('result-notice').textContent=result.message;
    document.querySelector('.map-workspace').classList.toggle('has-notice',!!result.message&&!!result.routes.length);
  }catch(error){
    if(error.name==='AbortError')message('Search cancelled. You can change your plan and try again.');else message(error.message,true);
    if(!state.routes.length)$('map-empty').hidden=false;
  }finally{
    state.generating=false;$('generate-button').disabled=false;$('cancel-button').hidden=true;$('search-progress').hidden=true;
    document.querySelector('.map-workspace').classList.remove('has-progress');renderCards();
  }
}

function saveRide(route) {
  if(state.saved.some(r=>r.id===route.id)){toast('This ride is already saved on this device.');return;}
  const next=[{...route,name:nameRoute(route)},...state.saved];
  try{writeSaved(localStorage,next);state.saved=next;updateSaved();renderSelected();toast('Ride saved. Find it in Saved rides.');}catch(error){toast(error.message);}
}
function updateSaved() {$('saved-count').textContent=String(state.saved.length);}
function showSaved() {
  const container=$('saved-list');container.replaceChildren();
  if(!state.saved.length)container.innerHTML=`<div class="saved-empty">${icon('bookmark')}<h3>Your next favourite starts here.</h3><p>Find a loop and tap the bookmark<br>to keep it for another day.</p></div>`;
  state.saved.forEach(route=>{
    const row=document.createElement('article');row.className='saved-row';
    row.innerHTML=`<div class="route-mini">${routeSVG(route.coordinates)}</div><div><h3>${escapeHTML(nameRoute(route))}</h3><p>${route.distanceKm.toFixed(1)} km · ${labelMatch(route)}<br>${escapeHTML(route.startLabel)}</p><div class="saved-actions"><button type="button" data-action="view">View ride</button><button type="button" data-action="export">Export GPX</button><button type="button" data-action="geojson">GeoJSON</button><button type="button" data-action="remove">Remove</button></div></div>`;
    row.querySelector('[data-action=view]').addEventListener('click',()=>{
      cancelSearch();$('saved-dialog').close();hideResults();state.start=route.start||route.coordinates[0].slice(0,2);state.startLabel=route.startLabel;state.distance=route.targetKm||Math.round(route.distanceKm/5)*5;state.terrain=route.terrain;
      $('distance').value=String(Math.min(120,Math.max(5,state.distance)));updateDistance();updateTerrain();setStart(state.start,state.startLabel);state.routes=[route];selectRoute(route,true);$('map-empty').hidden=true;message('Viewing a saved ride. Find fresh loops whenever you’re ready.');
      if(window.innerWidth<=760)document.querySelector('.map-workspace').scrollIntoView({behavior:'smooth'});
    });
    row.querySelector('[data-action=export]').addEventListener('click',()=>exportRide(route));
    row.querySelector('[data-action=geojson]').addEventListener('click',()=>download(JSON.stringify(toGeoJSON(route),null,2),filename(route,'.geojson'),'application/geo+json'));
    row.querySelector('[data-action=remove]').addEventListener('click',()=>{
      const next=state.saved.filter(r=>r.id!==route.id);try{writeSaved(localStorage,next);state.saved=next;updateSaved();showSaved();renderSelected();toast('Ride removed from this device.');}catch(e){toast(e.message);}
    });container.append(row);
  });
  if(!$('saved-dialog').open)$('saved-dialog').showModal();
}
function filename(route,extension='.gpx') {return `CIRKVL-${nameRoute(route).normalize('NFKD').replace(/[^a-zA-Z0-9-]+/g,'-').toLowerCase()}-${route.distanceKm.toFixed(1)}km${extension}`;}
function download(content,name,mime) {
  const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function exportRide(route) {download(toGPX(route),filename(route),'application/gpx+xml');toast('GPX exported. Suunto app → Maps → + → Import route (.gpx).');}
async function shareRide(route) {
  const file=new File([toGPX(route)],filename(route),{type:'application/gpx+xml'});
  if(navigator.canShare?.({files:[file]})){
    try{await navigator.share({files:[file],title:nameRoute(route)});}catch(error){if(error.name!=='AbortError')exportRide(route);}
  }else{exportRide(route);}
}
function updateDistance() {
  state.distance=Number($('distance').value);$('distance-output').value=String(state.distance);
  $('distance').setAttribute('aria-valuetext',`${state.distance} kilometres`);$('distance').style.setProperty('--range',`${(state.distance-5)/115*100}%`);
}
function updateTerrain() {
  document.querySelectorAll('.terrain').forEach(b=>{const active=b.dataset.terrain===state.terrain;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  $('terrain-hint').textContent={gravel:'Prefer gravel and compacted tracks, with paved links where needed.',singletrack:'Prefer MTB trails. Trail share is estimated from mapped paths; widths may be unknown.',road:'Prefer paved roads and cycleways, with a routing profile that favours lower traffic.'}[state.terrain];
}

$('planner-form').addEventListener('submit',plan);$('locate-button').addEventListener('click',locate);$('search-button').addEventListener('click',searchPlace);
$('place-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchPlace();}});
$('pick-button').addEventListener('click',()=>setPicking(!state.picking));$('cancel-pick').addEventListener('click',()=>setPicking(false));
$('clear-start').addEventListener('click',()=>{cancelSearch();state.start=null;hideResults();$('start-display').hidden=true;if(marker){map?.removeLayer(marker);marker=null;}message('Choose a new starting point.');$('map-area').textContent='CHOOSE YOUR START';});
$('distance').addEventListener('input',()=>{cancelSearch();updateDistance();if(state.routes.length)message('Distance changed. Generate again for fresh loops at this distance.');});
document.querySelectorAll('.terrain').forEach(b=>b.addEventListener('click',()=>{cancelSearch();state.terrain=b.dataset.terrain;updateTerrain();if(state.routes.length)message('Terrain changed. Generate again to explore this preference.');}));
$('cancel-button').addEventListener('click',cancelSearch);$('fit-button').addEventListener('click',()=>fitRoute(state.selected));
$('surface-button').addEventListener('click',()=>{state.surface=!state.surface;$('surface-button').setAttribute('aria-pressed',String(state.surface));drawRoutes();if(!state.selected)toast('Choose a route to see its mapped surfaces.');});
$('saved-nav').addEventListener('click',showSaved);$('plan-nav').addEventListener('click',()=>document.querySelector('.planner').scrollIntoView({behavior:'smooth'}));
[$('about-nav'),$('data-button')].forEach(b=>b.addEventListener('click',()=>$('about-dialog').showModal()));
document.querySelectorAll('[data-close-dialog]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const rect=d.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)d.close();}}));
$('try-gotland').addEventListener('click',()=>{$('place-input').value='Bro kyrka, Gotland';searchPlace();document.querySelector('.start-section').scrollIntoView({behavior:'smooth',block:'center'});});
initMap();updateTerrain();updateDistance();updateSaved();
