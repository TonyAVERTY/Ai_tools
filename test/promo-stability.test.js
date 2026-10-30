import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rasterDifference} from '../src/services/promovideo.js';
test('stabilité : petites variations de rendu tolérées, changement réel refusé',()=>{
 const a=new Uint8Array(100*100*4).fill(100), b=a.slice();
 for(let i=0;i<b.length;i+=4) {b[i]+=3;b[i+1]+=2;}
 assert.equal(rasterDifference(a,b).different,false);
 const c=a.slice();
 for(let i=0;i<1000*4;i+=4) {c[i]=240;c[i+1]=240;c[i+2]=240;}
 assert.equal(rasterDifference(a,c).different,true);
 assert.equal(rasterDifference(a,a).different,false);
 assert.throws(()=>rasterDifference(a,[]));
});
