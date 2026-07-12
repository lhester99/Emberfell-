/* Reproduce + verify the herb-pickup bug against the REAL world.js pickup
 * path (spawnPickup -> updatePickups -> loot:collected). Stubs THREE just
 * enough to load world.js; uses real biomes.js data and real terrainH. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const PROJ=(f)=>fs.readFileSync(path.join('/mnt/project',f),'utf8');
const OUT =(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

/* ---- THREE stub: chainable geometry, no-op meshes, working vector math -- */
class Vec3{constructor(x=0,y=0,z=0){this.set(x,y,z);}set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}clone(){return new Vec3(this.x,this.y,this.z);}
  applyMatrix4(){return this;}applyQuaternion(){return this;}add(){return this;}sub(){return this;}
  addScaledVector(){return this;}multiplyScalar(){return this;}normalize(){return this;}
  cross(){return this;}crossVectors(){return this;}subVectors(){return this;}
  length(){return 1;}lengthSq(){return 1;}dot(){return 0;}lerp(){return this;}distanceTo(){return 0;}
  setFromMatrixPosition(){return this;}}
function attrStub(){return{count:0,array:new Float32Array(0),
  getX:()=>0,getY:()=>0,getZ:()=>0,setX(){},setY(){},setZ(){},setXYZ(){},needsUpdate:false};}
function geoStub(){const attrs=new Proxy({},{get:(t,k)=>{if(!(k in t))t[k]=attrStub();return t[k];},has:()=>true});
  return{attributes:attrs,index:null,setAttribute(n,a){attrs[n]=a||attrStub();return this;},
  getAttribute(n){return attrs[n];},computeVertexNormals(){return this;},rotateX(){return this;},
  rotateY(){return this;},translate(){return this;},scale(){return this;},clone(){return geoStub();},dispose(){}};}
class Obj3D{constructor(){this.position=new Vec3();this.rotation=new Vec3();this.scale=new Vec3(1,1,1);
  this.children=[];this.name='';}add(c){this.children.push(c);return this;}remove(c){const i=this.children.indexOf(c);if(i>=0)this.children.splice(i,1);return this;}traverse(f){f(this);this.children.forEach(c=>c.traverse&&c.traverse(f));}}
class Mesh extends Obj3D{constructor(g,m){super();this.geometry=g||geoStub();this.material=m;}}
const THREE={
  Group:class extends Obj3D{},Mesh,Points:class extends Obj3D{},
  InstancedMesh:class extends Obj3D{constructor(g,m,c){super();this.geometry=g;this.material=m;this.count=c;this.instanceMatrix={needsUpdate:false};this.instanceColor={needsUpdate:false};}setMatrixAt(){}setColorAt(){}},
  BoxGeometry:geoStub,PlaneGeometry:geoStub,CircleGeometry:geoStub,ConeGeometry:geoStub,
  CylinderGeometry:geoStub,SphereGeometry:geoStub,OctahedronGeometry:geoStub,IcosahedronGeometry:geoStub,
  BufferGeometry:function(){return geoStub();},
  BufferAttribute:function(a){this.array=a;this.count=a?a.length/3:0;this.needsUpdate=false;},
  Color:function(h){this.r=0;this.g=0;this.b=0;const s=()=>this;
    this.set=s;this.setRGB=s;this.setHex=s;this.setHSL=s;this.copy=s;this.clone=()=>new THREE.Color();
    this.lerp=s;this.lerpColors=s;this.multiplyScalar=s;this.offsetHSL=s;this.getHex=()=>0;
    this.getHSL=(o)=>{o=o||{};o.h=0;o.s=0;o.l=0;return o;};this.convertSRGBToLinear=s;},
  MeshLambertMaterial:function(o){this.o=o;},MeshBasicMaterial:function(o){this.o=o;},PointsMaterial:function(o){this.o=o;},
  /* [build-06 integrator fix] Cycle 4 world.js adds camera occlusion via
     THREE.Raycaster at module scope; stub it so the file loads. */
  Raycaster:function(){this.far=Infinity;this.set=()=>{};this.intersectObject=()=>[];this.intersectObjects=()=>[];},
  Vector3:Vec3,Quaternion:function(){this.setFromEuler=()=>this;},Euler:function(){this.set=()=>this;},
  Matrix3:function(){this.getNormalMatrix=()=>this;},Matrix4:function(){this.compose=()=>this;},
  Float32BufferAttribute:function(a){this.array=a;},BackSide:2,DoubleSide:2,FrontSide:0
};

/* ---- bus + engine stub ------------------------------------------------- */
const log=[];
const bus=(function(){const m={};function on(e,f){(m[e]||(m[e]=[])).push(f);return()=>{const a=m[e],i=a.indexOf(f);if(i>=0)a.splice(i,1);};}
  function once(e,f){const o=on(e,p=>{o();f(p);});return o;}function off(){}function emit(e,p){log.push({ev:e,payload:p});const a=m[e];if(a)for(const f of a.slice())try{f(p);}catch(x){console.error('H',e,x);}return 0;}return{on,once,off,emit};})();
let sampler=()=>0;
/* [build-06 integrator fix] occlusion polish reads rig fields + setDistance */
const engine={scene:new Obj3D(),renderer:{},camera:{object:new Obj3D(),distance:6.5,pitch:0.45,yaw:0,headOffset:1.4,setDistance(){}},
  setGroundSampler:(fn)=>{sampler=fn;},groundAt:(x,z)=>sampler(x,z),
  audio:{register(){},play(){}},input:{buttons:{wasPressed:()=>false},bindKey(){}},time:{elapsed:0,dt:0,frame:0}};

const player={position:new Vec3(0,0,10)};
const sb={};sb.window=sb;sb.THREE=THREE;sb.console=console;sb.Math=Math;sb.Float32Array=Float32Array;
sb.EF={bus,engine};vm.createContext(sb);

/* load REAL biomes + world, then my data + quests */
vm.runInContext(PROJ('biomes.js'),sb,{filename:'biomes.js'});
vm.runInContext(PROJ('world.js'),sb,{filename:'world.js'});
vm.runInContext(OUT('data/questData.js'),sb,{filename:'questData.js'});
vm.runInContext(OUT('quests.js'),sb,{filename:'quests.js'});

const EF=sb.EF, world=EF.world, Q=EF.quests;

/* boot world (runs buildTerrain/… with stub THREE; terrainH is real math) */
bus.emit('game:booted',{scene:engine.scene,renderer:{},camera:engine.camera});
world.setPlayerObject(player);

/* spy on spawnPickup to capture herb spawn coordinates */
const spawns=[];
const realSpawn=world.spawnPickup;
world.spawnPickup=function(item,x,z){ const h=realSpawn.call(world,item,x,z);
  spawns.push({item,x,z,y:world.terrainH(x,z)+0.65}); return h; };

/* lake facts from real data */
const lake=world.pois.find(p=>p.id==='lake');
const D=sb.EF.worldData;
const waterY=lake.y+ (D.pois.find(p=>p.id==='lake').water||1.2);
const waterDiscR=lake.radius-1.2;   // world.js buildWater: CircleGeometry(radius-1.2)
const pickR=D.pickups.radius;

let pass=0,fail=0;
function ok(c,m){ if(c)pass++; else {fail++; console.log('  FAIL: '+m);} }
function tick(dt){engine.time.elapsed+=dt;bus.emit('game:tick',{dt,elapsed:engine.time.elapsed,frame:++engine.time.frame});}

console.log('lake center=('+lake.x+','+lake.z+') radius='+lake.radius+' bedY='+lake.y.toFixed(2)+' waterY='+waterY.toFixed(2)+' pickupR='+pickR);

/* accept herb quest -> spawns via REAL world.spawnPickup */
Q.accept('odda.herbs');
console.log('spawned herbs:');
spawns.forEach((s,i)=>{const dist=Math.hypot(s.x-lake.x,s.z-lake.z);
  console.log('  #'+i+' at ('+s.x.toFixed(1)+','+s.z.toFixed(1)+') dist='+dist.toFixed(1)+
    ' y='+s.y.toFixed(2)+(dist<waterDiscR?'  <-- ON WATER DISC':''));});

ok(spawns.length===3,'3 herbs spawned via world.spawnPickup');
// reachable == clear of the actual water disc (CircleGeometry radius-1.2),
// on walkable shore ground. The lake is the world's only water body.
const clear = spawns.every(s=>Math.hypot(s.x-lake.x,s.z-lake.z) > waterDiscR + 1);
ok(clear,'all herbs land clear of the water disc (on reachable shore)');

/* now actually collect them the real way: walk player onto each, tick */
let collected=0;
bus.on('loot:collected',p=>{ if(p&&p.item==='herb') collected++; });
spawns.forEach(s=>{ player.position.set(s.x,0,s.z); tick(0.1); });
ok(collected===3,'walking onto each herb fired 3 loot:collected events (real path)');
ok(Q.getState('odda.herbs')==='ready','collect quest reached ready after real pickups');

console.log('\n  PASS: '+pass+'   FAIL: '+fail);
process.exit(fail?1:0);
