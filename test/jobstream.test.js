import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJobStream} from '../src/services/jobstream.js';
test('les fragments arrivent avant la fin et le bloc complet ne les duplique pas',async()=>{
 const entries=[], stream=createJobStream((kind,text)=>entries.push({kind,text}));
 stream.delta('Bonjour ');
 await new Promise(r=>setTimeout(r,760));
 assert.equal(entries.map(e=>e.text).join(''),'Bonjour ');
 stream.delta('le monde');stream.block('Bonjour le monde');stream.finish();
 assert.equal(entries.map(e=>e.text).join(''),'Bonjour le monde');
});
test('un secret coupé entre fragments reste masqué et un appel sans flux conserve sa sortie',async()=>{
 const entries=[], secret='SUPER_SECRET_TOKEN123';
 const stream=createJobStream((kind,text)=>entries.push(text),[secret]);
 stream.delta('Début SUPER_');
 await new Promise(r=>setTimeout(r,760));
 assert.equal(entries.join(''),'Début ');
 stream.delta('SECRET_TOKEN123 fin');stream.finish();
 assert.equal(entries.join(''),'Début [secret masqué] fin');
 stream.block('Autre réponse');
 assert.equal(entries.at(-1),'Autre réponse');
});
