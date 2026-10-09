import { build } from "vite";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

await build({build:{outDir:"dist/client",emptyOutDir:true}});
const assets={};
const mime={"html":"text/html; charset=utf-8","js":"text/javascript; charset=utf-8",
  "css":"text/css; charset=utf-8","svg":"image/svg+xml","json":"application/json; charset=utf-8"};
async function collect(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory()){await collect(path);continue;}
    const extension=entry.name.split(".").at(-1);
    if(!mime[extension])throw new Error("Unsupported asset type: "+extension);
    assets["/"+relative("dist/client",path).replaceAll("\\","/")]={
      body:await readFile(path,"utf8"),type:mime[extension]
    };
  }
}
await collect("dist/client");
await mkdir("sites",{recursive:true});
await writeFile("sites/generated-assets.ts","export default "+JSON.stringify(assets)+";\n");
await build({configFile:false,ssr:{noExternal:true},build:{
  ssr:"sites/worker.ts",outDir:"dist/server",emptyOutDir:true,target:"es2022",
  rolldownOptions:{output:{entryFileNames:"index.js"}}
}});
