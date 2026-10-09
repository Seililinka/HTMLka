import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import worker from "../dist/server/index.js";

const origin="https://editor.example.com";
const call=(path,init)=>worker.fetch(new Request(origin+path,init),{});
assert.equal(typeof worker.fetch,"function");
const root=await call("/");assert.equal(root.status,200);
const html=await root.text();
const files=[...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(x=>x[1]);
assert.ok(files.length>=2,"Client script and stylesheet must be present");
for(const path of files){
  const response=await call(path);assert.equal(response.status,200);
  assert.equal(await response.text(),await readFile("dist/client"+path,"utf8"));
}
assert.equal((await call("/missing.js")).status,404);
assert.equal(await (await call("/",{method:"HEAD"})).text(),"");
assert.equal((await call("/_api/rewrite")).status,405);
const input=superjson.stringify({text:"Исходный текст",instruction:"Сделай короче"});
const missing=await call("/_api/rewrite",{method:"POST",headers:{Origin:origin},body:input});
assert.equal(missing.status,503);
assert.equal(superjson.parse(await missing.text()).code,"AI_NOT_CONFIGURED");
assert.equal((await call("/_api/rewrite",{method:"POST",body:"broken"})).status,400);
assert.equal((await call("/_api/rewrite",{method:"POST",body:"x".repeat(100001)})).status,413);
const originalFetch=globalThis.fetch;
let providerCalls=0;
try{
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,"https://provider.invalid/v1/chat/completions");
    assert.equal(JSON.parse(init.body).store,false);providerCalls++;
    return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({text:"Новый текст"})}}]}),{headers:{"Content-Type":"application/json"}});
  };
  const response=await worker.fetch(new Request(origin+"/_api/rewrite",{method:"POST",headers:{Origin:origin},body:input}),
    {AI_API_KEY:"test-only",AI_MODEL:"test-model",AI_API_BASE_URL:"https://provider.invalid/v1"});
  assert.equal(response.status,200);assert.equal(providerCalls,1);
  assert.equal(superjson.parse(await response.text()).text,"Новый текст");
}finally{globalThis.fetch=originalFetch;}
console.log("Worker routes, client assets, request limits and AI adapter passed. Native WebMCP validation is unavailable in this runtime.");
