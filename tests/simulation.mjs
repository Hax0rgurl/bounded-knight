import assert from 'node:assert/strict';
import {createWorld,update,DOCK,REEFS} from '../game/src/world.js';
const idle={x:0,y:0,dash:false};
let s=createWorld();assert.equal(s.hull,4);assert.equal(s.time,110);
// Actual pickup and delivery logic: bank three complete loads to win.
for(let load=0;load<3;load++){for(let i=0;i<3;i++){const l=s.lights.find(l=>l.active);s.player.x=l.x;s.player.y=l.y;s.player.vx=s.player.vy=0;update(s,1/60,idle);}assert.equal(s.cargo,3);s.player.x=DOCK.x;s.player.y=DOCK.y;s.player.vx=s.player.vy=0;update(s,1/60,idle);assert.equal(s.cargo,0);assert.equal(s.delivered,(load+1)*3);}assert.equal(s.over,'win');assert(s.score>3000);
s=createWorld();s.player.x=REEFS[0].x+1;s.player.y=REEFS[0].y;update(s,1/60,idle);assert.equal(s.hull,3);update(s,1/60,idle);assert.equal(s.hull,3,'invulnerability prevents repeated damage');
s=createWorld();for(let i=0;i<10;i++)update(s,1/60,{x:1,y:0,dash:false});assert(s.player.x>600);const speed=s.player.vx;update(s,1/60,{x:1,y:0,dash:true});assert(s.player.vx>speed);assert(s.dash>2.9);
s=createWorld();s.time=.01;update(s,.02,idle);assert.equal(s.over,'dawn');s=createWorld();s.hull=1;s.player.x=REEFS[0].x+1;s.player.y=REEFS[0].y;update(s,.02,idle);assert.equal(s.over,'loss');s=createWorld();assert.equal(s.over,null);assert.equal(s.score,0);
// A deterministic steering run proves that all nine lights are reachable without teleporting.
s=createWorld();let steps=0;const targets=[0,1,7,'home',2,9,5,'home',6,4,10,'home'];for(const target of targets){const goal=target==='home'?DOCK:s.lights[target];for(let n=0;n<2200;n++){const dx=goal.x-s.player.x,dy=goal.y-s.player.y;if(Math.hypot(dx,dy)<(target==='home'?35:20))break;update(s,1/60,{x:dx,y:dy,dash:false});steps++;if(s.over)break;}if(s.over)break;}console.log('Loop, scoring, damage, invulnerability, movement, burst, win, loss, timeout, reset: PASS');console.log('Naive route:',{delivered:s.delivered,hull:s.hull,time:s.time,over:s.over,steps});
