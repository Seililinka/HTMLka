import { handle, fail } from "../endpoints/rewrite_POST";
import builtAssets from "./generated-assets";

type Env=Partial<Record<"AI_API_KEY"|"AI_API_BASE_URL"|"AI_MODEL"|"APP_ORIGIN",string>>;
const assets:Record<string,{body:string;type:string}>=builtAssets;
const limits=new Map<string,{count:number;until:number}>();

export default {
  async fetch(request:Request,env:Env={}) {
    const path=new URL(request.url).pathname;
    if(path==="/_api/rewrite"){
      if(request.method!=="POST"){
        const response=fail("Используйте POST.",405);response.headers.set("Allow","POST");return response;
      }
      const now=Date.now(),ip=request.headers.get("CF-Connecting-IP")||"owner";
      if(limits.size>1000)for(const [key,value] of limits)if(value.until<now)limits.delete(key);
      const previous=limits.get(ip);
      if(previous&&previous.until>now&&previous.count>=20){
        const response=fail("Повторите запрос через минуту.",429,"RATE_LIMITED");
        response.headers.set("Retry-After","60");return response;
      }
      if(!previous||previous.until<=now)limits.set(ip,{count:1,until:now+60000});else previous.count++;
      const reader=request.body?.getReader();
      const chunks:Uint8Array[]=[];let size=0;
      if(reader)for(;;){
        const item=await reader.read();if(item.done)break;
        size+=item.value.byteLength;
        if(size>100000){await reader.cancel();return fail("Выберите более короткий фрагмент.",413);}
        chunks.push(item.value);
      }
      const body=new Uint8Array(size);let offset=0;
      for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
      return handle(new Request(request.url,{method:"POST",headers:request.headers,body}),env);
    }
    if(path.startsWith("/_api/"))return new Response("Not found",{status:404});
    if(!["GET","HEAD"].includes(request.method))return new Response("Method not allowed",{status:405,headers:{Allow:"GET, HEAD"}});
    const asset=assets[path]||(path==="/"||!path.split("/").at(-1)?.includes(".")?assets["/index.html"]:undefined);
    if(!asset)return new Response("Not found",{status:404});
    return new Response(request.method==="HEAD"?null:asset.body,{headers:{
      "Content-Type":asset.type,"X-Content-Type-Options":"nosniff",
      "Cache-Control":asset.type.startsWith("text/html")?"no-cache":"public, max-age=31536000, immutable"
    }});
  }
};
