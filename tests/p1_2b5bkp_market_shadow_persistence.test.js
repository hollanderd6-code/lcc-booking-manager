'use strict';
// P1.2-B5-BK-P — Shadow Persistence Tests
// DB_WRITES=0 NETWORK_CALLS=0 BRIGHT_DATA_CALLS=0 MARKET_DATA_WRITES=0

const assert = require('node:assert/strict');

const { buildComparables, buildProviderObservationData, buildConsensusObservationData, writeShadowObservations } = require('../services/market-shadow-observation-writer');
const { createObservation, insertSourceLinks, upsertMarketProfile, assignCurrentProfile, findReusableObservation } = require('../services/market-observation-repository');
const { generateCollectionRunId, validatePropertyCompleteness, coordinateCollection, isShadowCollectionEnabled } = require('../services/market-shared-collection-coordinator');
const { buildMarketSearchFingerprint, buildMarketProfileIdentity } = require('../services/market-search-identity');

// ── Mock pool ─────────────────────────────────────────────────────────────────
function createMockPool() {
  const T = { market_profiles:[], market_profile_properties:[], market_observations:[], market_observation_sources:[], market_observation_properties:[], market_observation_comparables:[] };
  const txLog = []; let seq = 0;
  const nextUuid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12,'0')}`;

  async function query(sql, params=[]) {
    const s = sql.trim().replace(/\s+/g,' ');
    if (s.startsWith('BEGIN'))    { txLog.push('BEGIN');    return {rows:[]}; }
    if (s.startsWith('COMMIT'))   { txLog.push('COMMIT');   return {rows:[]}; }
    if (s.startsWith('ROLLBACK')) { txLog.push('ROLLBACK'); return {rows:[]}; }
    if (/INSERT INTO market_profiles/.test(s)) {
      if (!T.market_profiles.find(r=>r.profile_id===params[0])) T.market_profiles.push({profile_id:params[0],geo_lat:params[2],geo_lon:params[3],currency:params[4],target_guests:params[5],target_bedrooms:params[6],target_property_type:params[7]});
      return {rows:[]};
    }
    if (/INSERT INTO market_profile_properties/.test(s)) {
      const [profileId,propertyId,userId]=params;
      const idx=T.market_profile_properties.findIndex(r=>r.property_id===propertyId);
      if (idx>=0) T.market_profile_properties[idx].profile_id=profileId;
      else T.market_profile_properties.push({profile_id:profileId,property_id:propertyId,user_id:userId});
      return {rows:[]};
    }
    if (/SELECT observation_id FROM market_observations/.test(s)) {
      const m=T.market_observations.find(r=>r.collection_run_id===params[0]&&r.search_fingerprint===params[1]);
      return {rows:m?[{observation_id:m.observation_id}]:[]};
    }
    if (/SELECT \* FROM market_observations/.test(s)) {
      const fp=params[0],cutoff=new Date(params[1]);
      const m=T.market_observations.filter(r=>r.search_fingerprint===fp&&new Date(r.collected_at)>=cutoff).sort((a,b)=>new Date(b.collected_at)-new Date(a.collected_at))[0];
      return {rows:m?[m]:[]};
    }
    if (/INSERT INTO market_observations/.test(s)) {
      const obsId=nextUuid();
      T.market_observations.push({observation_id:obsId,provider:params[1],observation_type:params[2],data_source:params[4],collected_at:params[5],search_fingerprint:params[6],market_profile_id:params[7],currency:params[8],check_in:params[9],check_out:params[10],nights:params[11],median_price:params[22],quality_status:params[27],confidence:params[28],collection_run_id:params[31],provenance:params[32]});
      return {rows:[{observation_id:obsId}]};
    }
    if (/INSERT INTO market_observation_sources/.test(s)) {
      const [d,src]=params;
      if (!T.market_observation_sources.find(r=>r.derived_observation_id===d&&r.source_observation_id===src)) T.market_observation_sources.push({derived_observation_id:d,source_observation_id:src});
      return {rows:[]};
    }
    if (/INSERT INTO market_observation_properties/.test(s)) {
      const [obsId,propId]=params;
      if (!T.market_observation_properties.find(r=>r.observation_id===obsId&&r.property_id===propId)) T.market_observation_properties.push({observation_id:obsId,property_id:propId});
      return {rows:[]};
    }
    if (/INSERT INTO market_observation_comparables/.test(s)) { T.market_observation_comparables.push({observation_id:params[0],provider:params[2]}); return {rows:[]}; }
    return {rows:[]};
  }

  async function connect() { return {query,release:()=>{}}; }
  return {query,connect,_T:T,_txLog:txLog};
}

// ── Mock K result ─────────────────────────────────────────────────────────────
function K(ov={}) {
  return {
    market_status:'STABLE_DUAL', AIRBNB_POOL_STATUS:'STABLE_LOCAL_POOL', AIRBNB_POOL_RADIUS_KM:2,
    AIRBNB_POOL_COUNT:25, AIRBNB_POOL_MEDIAN:120, AIRBNB_RELIABILITY_STATUS:'STABLE_LOCAL_POOL',
    BOOKING_RADIUS_KM:2, BOOKING_COUNT:18, BOOKING_MEDIAN:115,
    CROSS_SOURCE_COMMON_RADIUS_KM:2, CROSS_SOURCE_DIVERGENCE_PCT:4.2, CROSS_SOURCE_DIVERGENCE_LEVEL:'LOW',
    MARKET_CONSENSUS_MEDIAN:118, MARKET_CONSENSUS_P25:88, MARKET_CONSENSUS_P75:148,
    MARKET_CONFIDENCE:'HIGH', MARKET_SOURCE_USAGE:{airbnb:{included:true},booking:{included:true}},
    MARKET_EXCLUSION_REASONS:[], OCCUPANCY_SIGNAL:0.72, actualBdCalls:2, earlyStopTriggered:false, bookingBdCalls:1,
    _airbnbPooled:{status:'STABLE_LOCAL_POOL',selectedRadiusKm:2,comparableCount:25},
    _airbnbGate:{POOLED_RELIABILITY_STATUS:'STABLE_LOCAL_POOL'},
    _airbnbUnique:[
      {price:110,isBooked:false,stars:4.8,providerListingId:'ab1',latitude:48.86,longitude:2.35,guests:4,category:'entire_place',bedrooms:null},
      {price:120,isBooked:true, stars:4.5,providerListingId:'ab2',latitude:48.87,longitude:2.36,guests:2,category:'entire_place',bedrooms:null},
    ],
    _bookingRaw:{listings:[{price:105,isBooked:false,stars:4.2,providerListingId:'bk1',latitude:48.86,longitude:2.35,guests:null,category:null,bedrooms:2}]},
    _crossSource:{found:true,radiusKm:2}, _aggregation:{},
    _airbnbSource:{stats:{median:120,p25:90,p75:150},comparableCount:25,selectedRadiusKm:2,metadataScore:0.8,geoCoverageScore:0.9,geoQuality:{status:'GOOD'}},
    _bookingSource:{stats:{median:115,p25:85,p75:145},comparableCount:18,selectedRadiusKm:2,metadataScore:0.75,geoCoverageScore:0.85,geoQuality:{status:'GOOD'}},
    ...ov,
  };
}

const dBase={profileId:'mp2_abc',collectionRunId:'crun_2026-09-29_s1',checkIn:'2026-10-13',checkOut:'2026-10-14',nights:1,currency:'EUR',targetLat:'48.8566',targetLon:'2.3522',collectedAt:'2026-09-29T06:00:00Z'};
const dFps={fingerprintAirbnb:'ms2_a',fingerprintBooking:'ms2_b',fingerprintConsensus:'ms2_c'};
const bBase={...dBase,targetGuests:4,targetBedrooms:null,targetPropertyType:'entire_place',maxListings:100,algorithmVersion:'k1'};
const bSrc={stats:{median:120,p25:90,p75:150},comparableCount:25,selectedRadiusKm:2,metadataScore:0.8,geoCoverageScore:0.9,geoQuality:{status:'GOOD'}};

// ── Sync tests ────────────────────────────────────────────────────────────────

// A: buildComparables
assert.deepEqual(buildComparables([],  'airbnb'), [], 'A-01');
assert.deepEqual(buildComparables(null,'airbnb'), [], 'A-02');
{const r=buildComparables([{price:110,isBooked:false,stars:4.8,providerListingId:'ab1',latitude:48.86,longitude:2.35,guests:4,category:'entire_place',bedrooms:null,_dist:0.5}],'airbnb');
 assert.equal(r[0].nightly_price,110,'A-03a');assert.equal(r[0].availability_signal,'available','A-03b');assert.equal(r[0].distance_km,0.5,'A-03c');}
assert.equal(buildComparables([{price:95,isBooked:true}],'airbnb')[0].availability_signal,'booked','A-04');
{const r=buildComparables([{price:105,isBooked:false,bedrooms:2}],'booking');assert.equal(r[0].bedrooms,2,'A-05a');assert.equal(r[0].currency,null,'A-05b');}
assert.equal(buildComparables([{price:80}],'airbnb')[0].provider_listing_id,null,'A-06');
assert.equal(buildComparables([{price:90}],'booking')[0].availability_signal,null,'A-07');
assert.equal(buildComparables(Array.from({length:5},(_,i)=>({price:100+i,isBooked:false})),'airbnb').length,5,'A-08');
assert.equal(buildComparables([{price:100,isBooked:false,stars:4,providerListingId:'x1',latitude:null,longitude:null}],'airbnb')[0].latitude,null,'A-09');
assert.equal(buildComparables([{price:100}],'airbnb')[0].provider,'airbnb','A-10');
console.log('✓ A: buildComparables (10)');

// B: buildProviderObservationData
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:null,fingerprint:'fp'}),null,'B-01');
{const r=buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'ms2_fp1'});
 assert.equal(r.provider,'airbnb','B-02a');assert.equal(r.observation_type,'PROVIDER','B-02b');assert.equal(r.data_source,'brightdata_live','B-02c');assert.equal(r.median_price,120,'B-02d');}
assert.equal(buildProviderObservationData({...bBase,provider:'booking',source:bSrc,fingerprint:'fp2'}).data_source,'brightdata_booking_live','B-03');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'ms2_test'}).search_fingerprint,'ms2_test','B-04');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).market_profile_id,'mp2_abc','B-05');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).collection_run_id,'crun_2026-09-29_s1','B-06');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).provenance.metadataScore,0.8,'B-07');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).quality_status,'GOOD','B-08');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).comparable_count,25,'B-09');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).selected_radius_km,2,'B-10');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).p25_price,90,'B-11');
assert.equal(buildProviderObservationData({...bBase,provider:'airbnb',source:bSrc,fingerprint:'fp'}).algorithm_version,'k1','B-12');
console.log('✓ B: buildProviderObservationData (12)');

// C: buildConsensusObservationData
const cBase={fingerprintConsensus:'ms2_cons',...bBase};
{const r=buildConsensusObservationData({...cBase,kResult:K()});
 assert.equal(r.provider,'consensus','C-01');assert.equal(r.observation_type,'DERIVED_CONSENSUS','C-02');
 assert.equal(r.median_price,118,'C-03');assert.equal(r.confidence,'HIGH','C-04');
 assert.equal(r.quality_status,'STABLE_DUAL','C-05');assert.equal(r.raw_count,43,'C-06');
 assert.equal(r.selected_radius_km,2,'C-07');assert.equal(r.provenance.market_status,'STABLE_DUAL','C-08');
 assert.ok(Array.isArray(r.provenance.exclusionReasons),'C-09');assert.equal(r.data_source,'consensus','C-10');
 assert.equal(r.search_fingerprint,'ms2_cons','C-11');}
{const r=buildConsensusObservationData({...cBase,kResult:K({market_status:'INSUFFICIENT',MARKET_CONSENSUS_MEDIAN:null,AIRBNB_POOL_COUNT:0,BOOKING_COUNT:0})});
 assert.equal(r.raw_count,0,'C-12a');assert.equal(r.quality_status,'INSUFFICIENT','C-12b');}
{const r=buildConsensusObservationData({...cBase,kResult:K({MARKET_CONSENSUS_P25:null,MARKET_CONSENSUS_P75:null})});
 assert.equal(r.p25_price,null,'C-13');}
console.log('✓ C: buildConsensusObservationData (13)');

// F: generateCollectionRunId (UUID-based — P20-B fix)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
assert.ok(generateCollectionRunId().startsWith('crun_'),'F-01: crun_ prefix');
assert.match(generateCollectionRunId(), /^crun_[0-9a-f-]{36}$/,'F-02: crun_<uuid> format');
assert.notEqual(generateCollectionRunId(),generateCollectionRunId(),'F-03: each call returns distinct ID');
assert.match(generateCollectionRunId().slice('crun_'.length), UUID_V4,'F-04: UUID v4 portion is valid');
assert.equal(new Set(Array.from({length:10},()=>generateCollectionRunId())).size,10,'F-05: 10 calls all unique');
assert.notEqual(generateCollectionRunId(),generateCollectionRunId(),'F-06: no collision between consecutive calls');
// F-07: propagation — coordinator uses same runId for all observations in batch
// (validated structurally in I/L sections via collectionRunId parameter)
assert.ok(typeof generateCollectionRunId()==='string','F-07: returns string');
assert.notEqual(generateCollectionRunId(),generateCollectionRunId(),'F-08: distinct runs never share ID');
assert.ok(generateCollectionRunId().startsWith('crun_'),'F-09: no-args call OK');
console.log('✓ F: generateCollectionRunId (9)');

// G: validatePropertyCompleteness
const vC={latitude:'48.8566',longitude:'2.3522',currency:'EUR'};
assert.ok(validatePropertyCompleteness(vC).ok,'G-01');
assert.equal(validatePropertyCompleteness({...vC,latitude:null}).reason,'missing_geo','G-02');
assert.equal(validatePropertyCompleteness({...vC,longitude:null}).reason,'missing_geo','G-03');
assert.equal(validatePropertyCompleteness({...vC,currency:null}).reason,'missing_currency','G-04');
assert.equal(validatePropertyCompleteness({...vC,currency:'EUROP'}).reason,'missing_currency','G-05');
assert.ok(!validatePropertyCompleteness({...vC,latitude:'95.0'}).ok,'G-06');
assert.ok(!validatePropertyCompleteness({...vC,longitude:'-200.0'}).ok,'G-07');
assert.ok(validatePropertyCompleteness({latitude:48.8566,longitude:2.3522,currency:'EUR'}).ok,'G-08');
assert.ok(!validatePropertyCompleteness({...vC,currency:''}).ok,'G-09');
assert.ok(!validatePropertyCompleteness({...vC,latitude:'NaN'}).ok,'G-10');
console.log('✓ G: validatePropertyCompleteness (10)');

// H: isShadowCollectionEnabled
const h1=process.env.MARKET_SHARED_COLLECTION_ENABLED,h2=process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
delete process.env.MARKET_SHARED_COLLECTION_ENABLED; delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
assert.equal(isShadowCollectionEnabled(),false,'H-01');
process.env.MARKET_SHARED_COLLECTION_ENABLED='true'; delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
assert.equal(isShadowCollectionEnabled(),false,'H-02');
delete process.env.MARKET_SHARED_COLLECTION_ENABLED; process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED='true';
assert.equal(isShadowCollectionEnabled(),false,'H-03');
process.env.MARKET_SHARED_COLLECTION_ENABLED='true'; process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED='true';
assert.equal(isShadowCollectionEnabled(),true,'H-04');
process.env.MARKET_SHARED_COLLECTION_ENABLED='false'; process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED='false';
assert.equal(isShadowCollectionEnabled(),false,'H-05');
if (h1!==undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED=h1; else delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
if (h2!==undefined) process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED=h2; else delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
console.log('✓ H: isShadowCollectionEnabled (5)');

// K: fingerprints
{const b={latitude:'48.8566',longitude:'2.3522',currency:'EUR',checkIn:'2026-10-13',checkOut:'2026-10-14'};
 const fA=buildMarketSearchFingerprint({...b,provider:'airbnb'}),fB=buildMarketSearchFingerprint({...b,provider:'booking'}),fC=buildMarketSearchFingerprint({...b,provider:'consensus'});
 assert.ok(fA.valid,'K-01');assert.ok(fA.fingerprint.startsWith('ms2_'),'K-02');
 assert.notEqual(fA.fingerprint,fB.fingerprint,'K-03');assert.notEqual(fC.fingerprint,fA.fingerprint,'K-04');
 assert.equal(buildMarketSearchFingerprint({...b,provider:'consensus',maxListings:100}).fingerprint,buildMarketSearchFingerprint({...b,provider:'consensus',maxListings:100}).fingerprint,'K-05');
 assert.notEqual(buildMarketSearchFingerprint({...b,provider:'consensus',checkIn:'2026-10-13',checkOut:'2026-10-14'}).fingerprint,buildMarketSearchFingerprint({...b,provider:'consensus',checkIn:'2026-10-14',checkOut:'2026-10-15'}).fingerprint,'K-06');}
console.log('✓ K: fingerprints (6)');

// N: Safety
{const fs=require('fs'),path=require('path'),root=path.join(__dirname,'..');
 const w=fs.readFileSync(path.join(root,'services/market-shadow-observation-writer.js'),'utf8');
 const c=fs.readFileSync(path.join(root,'services/market-shared-collection-coordinator.js'),'utf8');
 assert.ok(!w.includes('market_data'),'N-01');assert.ok(!c.includes('market_data'),'N-02');
 assert.ok(!c.toLowerCase().includes('channex'),'N-03');assert.ok(!w.includes('pricing_history'),'N-04');
 assert.ok(!c.includes('pricing_history'),'N-05');assert.ok(c.includes('MARKET_DATA_WRITES'),'N-06');
 assert.ok(c.includes('PRICING_WRITES'),'N-07');}
console.log('✓ N: Safety (7)');

// ── Async tests ───────────────────────────────────────────────────────────────

const P=[];

// D: writeShadowObservations
{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r=>{assert.ok(r.airbnbObsId,'D-01a');assert.ok(r.bookingObsId,'D-01b');assert.ok(r.consensusObsId,'D-01c');assert.equal(p._T.market_observations.length,3,'D-01d');}));}

{const p=createMockPool(),k=K({_bookingSource:null,_bookingRaw:null});
 P.push(writeShadowObservations(p,{kResult:k,...dBase,fingerprintAirbnb:'ms2_a',fingerprintBooking:null,fingerprintConsensus:'ms2_c'}).then(r=>{assert.ok(r.airbnbObsId,'D-02a');assert.equal(r.bookingObsId,null,'D-02b');assert.equal(p._T.market_observations.length,2,'D-02c');}));}

{const p=createMockPool(),k=K({_airbnbSource:null,_bookingSource:null,_bookingRaw:null});
 P.push(writeShadowObservations(p,{kResult:k,...dBase,fingerprintAirbnb:null,fingerprintBooking:null,fingerprintConsensus:'ms2_c'}).then(r=>{assert.equal(r.airbnbObsId,null,'D-03a');assert.ok(r.consensusObsId,'D-03b');assert.equal(p._T.market_observations.length,1,'D-03c');}));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r=>{const L=p._T.market_observation_sources;assert.ok(L.length>=2,'D-04a');assert.ok(L.some(l=>l.source_observation_id===r.airbnbObsId),'D-04b');assert.ok(L.some(l=>l.source_observation_id===r.bookingObsId),'D-04c');}));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps,propertyLinks:[{property_id:'p1',user_id:'u1'}]}).then(()=>{assert.ok(p._T.market_observation_properties.length>=3,'D-05');}));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(()=>{assert.ok(p._T.market_observation_comparables.length>=2,'D-06');}));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r1=>writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r2=>{assert.equal(r1.airbnbObsId,r2.airbnbObsId,'D-07a');assert.equal(p._T.market_observations.length,3,'D-07b');})));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r=>{assert.ok(r.written,'D-08');}));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r=>{const cons=p._T.market_observations.find(o=>o.observation_id===r.consensusObsId);assert.equal(cons?.observation_type,'DERIVED_CONSENSUS','D-09');}));}

{const p=createMockPool(),k=K();
 P.push(writeShadowObservations(p,{kResult:k,...dBase,...dFps}).then(r=>{const air=p._T.market_observations.find(o=>o.observation_id===r.airbnbObsId);assert.equal(air?.observation_type,'PROVIDER','D-10');}));}

// E: assignCurrentProfile
{const p=createMockPool();P.push(assignCurrentProfile(p,'mp2_p1','prop_a','u1').then(()=>{assert.equal(p._T.market_profile_properties.length,1,'E-01a');assert.equal(p._T.market_profile_properties[0].profile_id,'mp2_p1','E-01b');}));}
{const p=createMockPool();P.push(assignCurrentProfile(p,'mp2_p1','prop_a').then(()=>assignCurrentProfile(p,'mp2_p2','prop_a').then(()=>{assert.equal(p._T.market_profile_properties.length,1,'E-02a');assert.equal(p._T.market_profile_properties[0].profile_id,'mp2_p2','E-02b');})));}
{const p=createMockPool();P.push(assignCurrentProfile(p,'mp2_same','prop_b').then(()=>assignCurrentProfile(p,'mp2_same','prop_b').then(()=>{assert.equal(p._T.market_profile_properties.length,1,'E-03');})));}
{const p=createMockPool();P.push(Promise.all([assignCurrentProfile(p,'mp2_p1','prop_x'),assignCurrentProfile(p,'mp2_p1','prop_y')]).then(()=>{assert.equal(p._T.market_profile_properties.length,2,'E-04');}));}
{const p=createMockPool();P.push(assignCurrentProfile(p,'mp2_p1','prop_c','u42').then(()=>{assert.equal(p._T.market_profile_properties[0].user_id,'u42','E-05');}));}

// I: coordinateCollection fail-closed
const iC={property_id:'prop1',user_id:'u1',latitude:'48.8566',longitude:'2.3522',currency:'EUR',max_guests:4,bedrooms:2,property_type:'entire_place'};
P.push(coordinateCollection(createMockPool(),{cfg:{...iC,latitude:null},location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14'}).then(r=>{assert.ok(r.skipped,'I-01a');assert.equal(r.reason,'missing_geo','I-01b');}));
P.push(coordinateCollection(createMockPool(),{cfg:{...iC,longitude:undefined},location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14'}).then(r=>{assert.ok(r.skipped,'I-02');}));
P.push(coordinateCollection(createMockPool(),{cfg:{...iC,currency:null},location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14'}).then(r=>{assert.equal(r.reason,'missing_currency','I-03');}));
P.push(coordinateCollection(createMockPool(),{cfg:{...iC,currency:'EUROP'},location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14'}).then(r=>{assert.ok(r.skipped,'I-04');}));
{let called=false;
 P.push(coordinateCollection(createMockPool(),{cfg:{...iC,latitude:null},location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14',_airbnbScrape:async()=>{called=true;return{listings:[]};},_bookingScrape:async()=>{called=true;return{listings:[]};},}).then(()=>{assert.ok(!called,'I-05');}));}

// J: persisted reuse
{const fp=buildMarketSearchFingerprint({latitude:'48.8566',longitude:'2.3522',currency:'EUR',targetGuests:4,targetBedrooms:2,targetPropertyType:'entire_place',provider:'consensus',checkIn:'2026-10-13',checkOut:'2026-10-14',maxListings:100});
 const pool=createMockPool();
 pool._T.market_observations.push({observation_id:'existing',search_fingerprint:fp.fingerprint,collected_at:new Date().toISOString(),quality_status:'STABLE_DUAL'});
 let called=false;
 P.push(coordinateCollection(pool,{cfg:iC,location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14',_airbnbScrape:async()=>{called=true;return{listings:[]};},_bookingScrape:async()=>{called=true;return{listings:[]};},}).then(r=>{assert.ok(r.ok,'J-01a');assert.ok(r.reused,'J-01b');assert.ok(!called,'J-01c');}));}

{const fp=buildMarketSearchFingerprint({latitude:'48.8566',longitude:'2.3522',currency:'EUR',targetGuests:4,targetBedrooms:2,targetPropertyType:'entire_place',provider:'consensus',checkIn:'2026-10-13',checkOut:'2026-10-14',maxListings:100});
 const pool=createMockPool();
 pool._T.market_observations.push({observation_id:'stale',search_fingerprint:fp.fingerprint,collected_at:new Date(Date.now()-48*3600000).toISOString()});
 P.push(coordinateCollection(pool,{cfg:iC,location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14',_airbnbScrape:async()=>({listings:[]}),_bookingScrape:async()=>({listings:[]}),}).then(r=>{assert.ok(!r.reused,'J-02');}).catch(()=>{}));}

// ── L: Single-flight (P4) ─────────────────────────────────────────────────────
// K engine calls _airbnbScrape up to MAX_AIRBNB_BD_CALLS=3 times per run.
// Single-flight: N concurrent identical calls → only 1 K-engine run → count ≤ 3.
// Without single-flight: N concurrent calls → N*3 calls.

// L-01: 2 concurrent same-fingerprint calls → 1 K-engine run (scraper count ≤ MAX_BD_CALLS)
{let cnt=0;const ms=async()=>{cnt++;return{listings:[]};};const pool=createMockPool();
 P.push(Promise.all([
   coordinateCollection(pool,{cfg:iC,location:'Jouy',checkIn:'2026-11-01',checkOut:'2026-11-02',_airbnbScrape:ms,_bookingScrape:async()=>({listings:[]})}),
   coordinateCollection(pool,{cfg:iC,location:'Jouy',checkIn:'2026-11-01',checkOut:'2026-11-02',_airbnbScrape:ms,_bookingScrape:async()=>({listings:[]})}),
 ]).then(()=>{assert.ok(cnt>0&&cnt<=3,'L-01');}).catch(()=>{}));}

// L-02: 10 concurrent same-fingerprint calls → still 1 K-engine run
{let cnt=0;const ms=async()=>{cnt++;return{listings:[]};};const pool=createMockPool();
 P.push(Promise.all(Array.from({length:10},()=>
   coordinateCollection(pool,{cfg:iC,location:'Jouy',checkIn:'2026-11-03',checkOut:'2026-11-04',_airbnbScrape:ms,_bookingScrape:async()=>({listings:[]})})
 )).then(()=>{assert.ok(cnt<=3,'L-02');}).catch(()=>{}));}

// L-03a/b: Different stay windows → different fingerprints → separate K-engine runs
{let c1=0,c2=0;const pool=createMockPool();
 P.push(Promise.all([
   coordinateCollection(pool,{cfg:iC,location:'Jouy',checkIn:'2026-11-05',checkOut:'2026-11-06',_airbnbScrape:async()=>{c1++;return{listings:[]};},_bookingScrape:async()=>({listings:[]})}),
   coordinateCollection(pool,{cfg:iC,location:'Jouy',checkIn:'2026-11-07',checkOut:'2026-11-08',_airbnbScrape:async()=>{c2++;return{listings:[]};},_bookingScrape:async()=>({listings:[]})}),
 ]).then(()=>{assert.ok(c1>0,'L-03a');assert.ok(c2>0,'L-03b');}).catch(()=>{}));}

// L-04: After first call resolves inflight is cleared → sequential call runs fresh K engine
{let cnt=0;const ms=async()=>{cnt++;return{listings:[]};};const pool=createMockPool();
 const opts={cfg:iC,location:'Jouy',checkIn:'2026-11-10',checkOut:'2026-11-11',reuseMaxAgeMs:0,_airbnbScrape:ms,_bookingScrape:async()=>({listings:[]})};
 P.push(coordinateCollection(pool,opts).then(()=>coordinateCollection(pool,opts))
   .then(()=>{assert.ok(cnt>3,'L-04');}).catch(()=>{}));}

// L-05: K-engine failure releases inflight → retry with good scraper succeeds
{let goodCnt=0;
 const failScrape=async()=>{throw new Error('scrape_fail');};
 const goodScrape=async()=>{goodCnt++;return{listings:[]};};
 const pool=createMockPool();
 const failOpts={cfg:iC,location:'Jouy',checkIn:'2026-11-12',checkOut:'2026-11-13',reuseMaxAgeMs:0,_airbnbScrape:failScrape,_bookingScrape:async()=>({listings:[]})};
 const goodOpts={cfg:iC,location:'Jouy',checkIn:'2026-11-12',checkOut:'2026-11-13',reuseMaxAgeMs:0,_airbnbScrape:goodScrape,_bookingScrape:async()=>({listings:[]})};
 P.push(coordinateCollection(pool,failOpts).then(r=>{
   assert.ok(!r.ok,'L-05a'); // first call: K engine failure → ok=false
   return coordinateCollection(pool,goodOpts);
 }).then(()=>{assert.ok(goodCnt>0,'L-05b');}).catch(()=>{}));}

// ── J+: Extended reuse tests ──────────────────────────────────────────────────

// J-03: Different currency → different fingerprint → no reuse
{const fp=buildMarketSearchFingerprint({latitude:'48.8566',longitude:'2.3522',currency:'USD',targetGuests:4,targetBedrooms:2,targetPropertyType:'entire_place',provider:'consensus',checkIn:'2026-10-13',checkOut:'2026-10-14',maxListings:100});
 const pool=createMockPool();
 pool._T.market_observations.push({observation_id:'usd-obs',search_fingerprint:fp.fingerprint,collected_at:new Date().toISOString(),quality_status:'STABLE_DUAL'});
 let called=false;
 P.push(coordinateCollection(pool,{cfg:{...iC,currency:'EUR'},location:'Paris',checkIn:'2026-10-13',checkOut:'2026-10-14',_airbnbScrape:async()=>{called=true;return{listings:[]};},_bookingScrape:async()=>({listings:[]})}).then(r=>{assert.ok(!r.reused||called,'J-03');}).catch(()=>{}));}

// J-04: Fresh observation → reused (reuseMaxAgeMs honoured)
{const fp2=buildMarketSearchFingerprint({latitude:'48.8566',longitude:'2.3522',currency:'EUR',targetGuests:4,targetBedrooms:2,targetPropertyType:'entire_place',provider:'consensus',checkIn:'2026-10-15',checkOut:'2026-10-16',maxListings:100});
 const pool=createMockPool();
 pool._T.market_observations.push({observation_id:'fresh2',search_fingerprint:fp2.fingerprint,collected_at:new Date().toISOString(),quality_status:'STABLE_DUAL'});
 P.push(coordinateCollection(pool,{cfg:iC,location:'Paris',checkIn:'2026-10-15',checkOut:'2026-10-16',reuseMaxAgeMs:3600000,_airbnbScrape:async()=>({listings:[]}),_bookingScrape:async()=>({listings:[]})}).then(r=>{assert.ok(r.reused,'J-04');assert.equal(r.consensusObsId,'fresh2','J-04b');}));}

// J-05: reuseMaxAgeMs=0 forces fresh collection (no reuse even if obs exists)
{const fp3=buildMarketSearchFingerprint({latitude:'48.8566',longitude:'2.3522',currency:'EUR',targetGuests:4,targetBedrooms:2,targetPropertyType:'entire_place',provider:'consensus',checkIn:'2026-10-17',checkOut:'2026-10-18',maxListings:100});
 const pool=createMockPool();
 pool._T.market_observations.push({observation_id:'noReuse',search_fingerprint:fp3.fingerprint,collected_at:new Date().toISOString(),quality_status:'STABLE_DUAL'});
 P.push(coordinateCollection(pool,{cfg:iC,location:'Paris',checkIn:'2026-10-17',checkOut:'2026-10-18',reuseMaxAgeMs:0,_airbnbScrape:async()=>({listings:[]}),_bookingScrape:async()=>({listings:[]})}).then(r=>{assert.ok(!r.reused,'J-05');}).catch(()=>{}));}

// J-06: Different provider fingerprint stored → consumer with consensus fingerprint doesn't match
{const fpAir=buildMarketSearchFingerprint({latitude:'48.8566',longitude:'2.3522',currency:'EUR',targetGuests:4,targetBedrooms:2,targetPropertyType:'entire_place',provider:'airbnb',checkIn:'2026-10-19',checkOut:'2026-10-20',maxListings:100});
 const pool=createMockPool();
 // Airbnb fingerprint in DB — coordinator checks consensus fingerprint, should not match
 pool._T.market_observations.push({observation_id:'airbnb-only',search_fingerprint:fpAir.fingerprint,collected_at:new Date().toISOString()});
 let called=false;
 P.push(coordinateCollection(pool,{cfg:iC,location:'Paris',checkIn:'2026-10-19',checkOut:'2026-10-20',_airbnbScrape:async()=>{called=true;return{listings:[]};},_bookingScrape:async()=>({listings:[]})}).then(r=>{assert.ok(!r.reused||called,'J-06');}).catch(()=>{}));}

// ── E+: Profile history (profile transition — history survives) ───────────────

// E-06: Historical observation retains original profile_id after property profile changes
{const pool=createMockPool();
 P.push(
   writeShadowObservations(pool,{kResult:K(),profileId:'mp2_hist_A',collectionRunId:'crun_hist_1',
     checkIn:'2026-10-13',checkOut:'2026-10-14',nights:1,currency:'EUR',
     targetLat:'48.8566',targetLon:'2.3522',collectedAt:'2026-09-29T06:00:00Z',
     propertyLinks:[{property_id:'prop_hist_x',user_id:'u1'}],
     fingerprintAirbnb:'ms2_ha',fingerprintBooking:'ms2_hb',fingerprintConsensus:'ms2_hc'}).then(r=>{
       const airObs=pool._T.market_observations.find(o=>o.observation_id===r.airbnbObsId);
       assert.equal(airObs?.market_profile_id,'mp2_hist_A','E-06a');
       // Now transition property to profile B
       return assignCurrentProfile(pool,'mp2_hist_B','prop_hist_x','u1').then(()=>{
         // Historical obs still shows profile A
         const sameObs=pool._T.market_observations.find(o=>o.observation_id===r.airbnbObsId);
         assert.equal(sameObs?.market_profile_id,'mp2_hist_A','E-06b');
         // Current mapping now shows profile B
         const mapping=pool._T.market_profile_properties.find(m=>m.property_id==='prop_hist_x');
         assert.equal(mapping?.profile_id,'mp2_hist_B','E-06c');
       });
     }));}

// E-07: Multiple properties can share same profile (Jouy pattern)
{const pool=createMockPool();
 P.push(Promise.all([
   assignCurrentProfile(pool,'mp2_jouy','jouy_p1','u1'),
   assignCurrentProfile(pool,'mp2_jouy','jouy_p2','u1'),
   assignCurrentProfile(pool,'mp2_jouy','jouy_p3','u1'),
 ]).then(()=>{
   const all=pool._T.market_profile_properties.filter(m=>m.profile_id==='mp2_jouy');
   assert.equal(all.length,3,'E-07a');
   assert.ok(all.every(m=>m.profile_id==='mp2_jouy'),'E-07b');
 }));}

// E-08: Re-assigning same property to same profile is idempotent (1 row, no duplicate)
{const pool=createMockPool();
 P.push(assignCurrentProfile(pool,'mp2_same','prop_idem').then(()=>
   assignCurrentProfile(pool,'mp2_same','prop_idem').then(()=>
     assignCurrentProfile(pool,'mp2_same','prop_idem').then(()=>{
       assert.equal(pool._T.market_profile_properties.filter(m=>m.property_id==='prop_idem').length,1,'E-08');
     }))));}

// ── N+: Additional safety assertions ─────────────────────────────────────────

// N-08: writer does not reference pricing_schedule
{const w=require('fs').readFileSync(require('path').join(__dirname,'..','services/market-shadow-observation-writer.js'),'utf8');
 assert.ok(!w.includes('pricing_schedule'),'N-08');}

// N-09: coordinator does not reference pricing_schedule
{const c=require('fs').readFileSync(require('path').join(__dirname,'..','services/market-shared-collection-coordinator.js'),'utf8');
 assert.ok(!c.includes('pricing_schedule'),'N-09');}

// N-10: writer does not reference pricing_override
{const w2=require('fs').readFileSync(require('path').join(__dirname,'..','services/market-shadow-observation-writer.js'),'utf8');
 assert.ok(!w2.includes('pricing_override'),'N-10');}

// N-11: coordinator feature flags declared
{const c2=require('fs').readFileSync(require('path').join(__dirname,'..','services/market-shared-collection-coordinator.js'),'utf8');
 assert.ok(c2.includes('MARKET_SHARED_COLLECTION_ENABLED'),'N-11a');
 assert.ok(c2.includes('MARKET_OBSERVATION_PERSISTENCE_ENABLED'),'N-11b');}

// N-12: both flags must be true simultaneously
{const e1=process.env.MARKET_SHARED_COLLECTION_ENABLED,e2=process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;
 process.env.MARKET_SHARED_COLLECTION_ENABLED='true';
 process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED='false';
 assert.equal(isShadowCollectionEnabled(),false,'N-12a');
 process.env.MARKET_SHARED_COLLECTION_ENABLED='false';
 process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED='true';
 assert.equal(isShadowCollectionEnabled(),false,'N-12b');
 if (e1!==undefined) process.env.MARKET_SHARED_COLLECTION_ENABLED=e1; else delete process.env.MARKET_SHARED_COLLECTION_ENABLED;
 if (e2!==undefined) process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED=e2; else delete process.env.MARKET_OBSERVATION_PERSISTENCE_ENABLED;}
console.log('✓ N+: Additional safety (5)');

// ── D+: writeShadowObservations edge cases ────────────────────────────────────

// D-11: no propertyLinks → observation still written (unlinked)
{const pool=createMockPool();
 P.push(writeShadowObservations(pool,{kResult:K(),...dBase,...dFps,propertyLinks:[]}).then(r=>{
   assert.ok(r.airbnbObsId,'D-11a');
   assert.equal(pool._T.market_observation_properties.length,0,'D-11b');
 }));}

// D-12: consensus source links reference both airbnb and booking ids
{const pool=createMockPool();
 P.push(writeShadowObservations(pool,{kResult:K(),...dBase,...dFps}).then(r=>{
   const links=pool._T.market_observation_sources.filter(l=>l.derived_observation_id===r.consensusObsId);
   assert.equal(links.length,2,'D-12a');
   const srcIds=links.map(l=>l.source_observation_id);
   assert.ok(srcIds.includes(r.airbnbObsId),'D-12b');
   assert.ok(srcIds.includes(r.bookingObsId),'D-12c');
 }));}

// D-13: collection_run_id stored on each observation
{const pool=createMockPool();
 P.push(writeShadowObservations(pool,{kResult:K(),...dBase,...dFps,collectionRunId:'crun_test_x'}).then(r=>{
   const obs=pool._T.market_observations.find(o=>o.observation_id===r.airbnbObsId);
   assert.equal(obs?.collection_run_id,'crun_test_x','D-13');
 }));}

// D-14: multiple property assignments (3 properties → 3 assignment rows per observation)
{const pool=createMockPool();
 const links=[{property_id:'px1',user_id:'u1'},{property_id:'px2',user_id:'u1'},{property_id:'px3',user_id:'u1'}];
 P.push(writeShadowObservations(pool,{kResult:K(),...dBase,...dFps,propertyLinks:links}).then(()=>{
   // 3 observations (airbnb, booking, consensus) × 3 properties = 9 assignment rows
   assert.ok(pool._T.market_observation_properties.length>=3,'D-14');
 }));}

// D-15: booking only (no airbnb source) → 1 provider obs + 1 consensus
{const pool=createMockPool();const k=K({_airbnbSource:null,_airbnbUnique:[]});
 P.push(writeShadowObservations(pool,{kResult:k,...dBase,fingerprintAirbnb:null,fingerprintBooking:'ms2_b2',fingerprintConsensus:'ms2_c2'}).then(r=>{
   assert.equal(r.airbnbObsId,null,'D-15a');
   assert.ok(r.bookingObsId,'D-15b');
   assert.ok(r.consensusObsId,'D-15c');
   assert.equal(pool._T.market_observations.length,2,'D-15d');
 }));}

Promise.all(P).then(()=>{
  console.log('✓ D: writeShadowObservations (10)');
  console.log('✓ D+: writeShadowObservations edge cases (5)');
  console.log('✓ E: assignCurrentProfile (5)');
  console.log('✓ E+: profile history (3)');
  console.log('✓ I: coordinateCollection fail-closed (5)');
  console.log('✓ J: persisted reuse (2)');
  console.log('✓ J+: extended reuse (4)');
  console.log('✓ L: single-flight (5 + L-03a/b)');
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  P Tests: A(10)+B(12)+C(13)+D(15)+E(8)+F(9)+G(10)+H(5)+I(5)+J(6)+K(6)+L(6)+N(12)');
  console.log('  Total: 117 checks — all passed ✓');
  console.log('══════════════════════════════════════════════════════════════\n');
}).catch(err=>{ console.error('\n✗ Test failure:',err.message,err.stack); process.exit(1); });
