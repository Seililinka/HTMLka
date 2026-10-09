import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import { handle, fail } from "./endpoints/rewrite_POST";

const root=fileURLToPath(new URL(".",import.meta.url));
if(existsSync(resolve(root,".env")))loadEnvFile(resolve(root,".env"));
const development=process.argv.includes("--dev");
const port=Number(process.env.PORT || 3000);
const host=process.env.HOST || "127.0.0.1";
const limits=new Map<string,{count:number;until:number}>();
const contentTypes:Record<string,string>={
  ".html":"text/html; charset=utf-8",".js":"application/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",
  ".woff2":"font/woff2",".webp":"image/webp"
};
async function send(response:Response,res:ServerResponse){
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
async function api(req:IncomingMessage,res:ServerResponse){
  if(req.method!=="POST"){res.setHeader("Allow","POST");await send(fail("Используйте POST.",405),res);return;}
  const now=Date.now(),ip=req.socket.remoteAddress || "local";
  if(limits.size>1000)for(const [key,value] of limits)if(value.until<now)limits.delete(key);
  const limit=limits.get(ip);
  if(limit&&limit.until>now&&limit.count>=20){res.setHeader("Retry-After","60");await send(fail("Повторите запрос через минуту.",429,"RATE_LIMITED"),res);return;}
  if(!limit||limit.until<=now)limits.set(ip,{count:1,until:now+60000});else limit.count++;
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;
    if(size>100000){await send(fail("Выберите более короткий фрагмент.",413),res);return;}
    chunks.push(bytes);
  }
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(", "):value);
  const request=new Request("http://"+(req.headers.host || "localhost:"+port)+"/_api/rewrite",{
    method:"POST",headers,body:Buffer.concat(chunks).toString("utf8")
  });
  await send(await handle(request),res);
}
const dist=resolve(root,"dist");
async function staticFile(req:IncomingMessage,res:ServerResponse){
  if(!["GET","HEAD"].includes(req.method || "")){res.writeHead(405);res.end();return;}
  let pathname:string;
  try{pathname=decodeURIComponent(new URL(req.url || "/","http://localhost").pathname);}catch{res.writeHead(400);res.end();return;}
  let path=resolve(dist,"."+pathname);
  if(path!==dist&&!path.startsWith(dist+sep)){res.writeHead(403);res.end();return;}
  let info=await stat(path).catch(()=>null);
  if(!info?.isFile()){
    if(extname(path)){res.writeHead(404);res.end();return;}
    path=resolve(dist,"index.html");info=await stat(path).catch(()=>null);
  }
  if(!info?.isFile()){res.writeHead(503,{"Content-Type":"text/plain; charset=utf-8"});res.end("Сначала выполните npm run build.");return;}
  res.writeHead(200,{"Content-Type":contentTypes[extname(path)] || "application/octet-stream","Cache-Control":extname(path)===".html"?"no-cache":"public, max-age=31536000, immutable"});
  if(req.method==="HEAD"){res.end();return;}
  createReadStream(path).on("error",()=>res.destroy()).pipe(res);
}
let developmentHandler:((req:IncomingMessage,res:ServerResponse,next:()=>void)=>void)|undefined;
const server=createServer((req,res)=>{
  const route=new URL(req.url || "/","http://localhost").pathname;
  if(route==="/_api/rewrite"){void api(req,res).catch(()=>send(fail("Не удалось обработать запрос.",500),res));return;}
  if(route.startsWith("/_api/")){res.writeHead(404);res.end();return;}
  if(developmentHandler){developmentHandler(req,res,()=>{res.writeHead(404);res.end();});return;}
  void staticFile(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
});
if(development){
  const {createServer:createViteServer}=await import("vite");
  const vite=await createViteServer({root,server:{middlewareMode:true,hmr:{server}}});
  developmentHandler=vite.middlewares;
}
server.listen(port,host,()=>console.log("Редактор: http://"+host+":"+port+(development?" (разработка)":"")));

