import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeScene } from '../src/services/promovideo.js';
const good = (t) => ({t, cover:.5, maxFont:80, minFont:30, cy:.5, boxes:[[1,t*5,10,200,50]],bg:{gradient:true}});
test('persistent clipping and collisions block publication; a brief transition does not', () => {
 const frames = Array.from({length:12}, (_,i)=>good(i/2));
 assert.deepEqual(judgeScene(frames,{width:720,height:1280}).errors,[]);
 frames[3].clipped=['Nom du produit'];frames[4].clipped=['Nom du produit'];
 frames[5].collisions=['Ancien titre / Nouveau titre'];frames[6].collisions=['Ancien titre / Nouveau titre'];
 const errors=judgeScene(frames,{width:720,height:1280}).errors.join(' ');
 assert.match(errors,/Texte coupé/);assert.match(errors,/Textes superposés/);
 delete frames[4].clipped;delete frames[6].collisions;
 assert.deepEqual(judgeScene(frames,{width:720,height:1280}).errors,[]);
 frames[11].clipped=['Nom final'];
 assert.match(judgeScene(frames,{width:720,height:1280}).errors.join(' '),/Texte coupé/);
 assert.match(judgeScene([],{width:720,height:1280}).errors.join(' '),/aucune mesure/);
});
