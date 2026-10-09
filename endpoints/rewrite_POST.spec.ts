import superjson from "superjson";
import { handle } from "./rewrite_POST";

const input={text:"Длинный текст 150",instruction:"Сократи",context:"Заголовок"};
const env={AI_API_KEY:"test-only-key",AI_MODEL:"test-only-model",AI_API_BASE_URL:"https://provider.invalid/v1"};
const request=(body:unknown=input,origin="http://localhost:3000")=>
  new Request("http://localhost:3000/_api/rewrite",{method:"POST",headers:{"Origin":origin},body:superjson.stringify(body)});
const decode=async(response:Response)=>superjson.parse<{text?:string;code?:string;error?:string}>(await response.text());

describe("Standalone AI adapter",()=>{
  it("shows a usable explanation when AI has not been configured",async()=>{
    const response=await handle(request(),{},vi.fn());
    expect(response.status).toBe(503);
    expect((await decode(response)).code).toBe("AI_NOT_CONFIGURED");
  });
  it("rejects a cross-origin request before contacting a provider",async()=>{
    const provider=vi.fn();
    const response=await handle(request(input,"https://other.invalid"),env,provider);
    expect(response.status).toBe(403);
    expect(provider).not.toHaveBeenCalled();
  });
  it("validates the user input before contacting a provider",async()=>{
    const provider=vi.fn();
    const response=await handle(request({...input,instruction:""}),env,provider);
    expect(response.status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
  });
  it("sends only the selected fragment and returns the schema expected by the UI",async()=>{
    const provider=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({text:"Короткий текст 150"})}}]})));
    const response=await handle(request(),env,provider);
    expect(response.status).toBe(200);
    expect(await decode(response)).toEqual({text:"Короткий текст 150"});
    const [url,options]=provider.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe("https://provider.invalid/v1/chat/completions");
    const body=JSON.parse(options.body as string);
    expect(JSON.parse(body.messages[1].content)).toEqual({fragment:input.text,task:input.instruction,fragmentType:input.context});
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.store).toBe(false);
  });
  it("preserves rate-limit information for the UI cooldown",async()=>{
    const response=await handle(request(),env,vi.fn(async()=>new Response("",{status:429})));
    expect(response.status).toBe(429);
    expect((await decode(response)).code).toBe("RATE_LIMITED");
  });
  it("rejects incomplete or malformed AI replies without returning arbitrary output",async()=>{
    for(const choice of [{finish_reason:"length",message:{content:'{"text":"fragment"}'}},{finish_reason:"stop",message:{content:'not JSON'}}]){
      const response=await handle(request(),env,vi.fn(async()=>new Response(JSON.stringify({choices:[choice]}))));
      expect(response.status).toBe(502);
      expect((await decode(response)).text).toBeUndefined();
    }
  });
  it("handles provider connection failures without leaking credentials",async()=>{
    const response=await handle(request(),env,vi.fn(async()=>{throw new Error("test-only-key");}));
    expect(response.status).toBe(502);
    const body=await response.text();
    expect(body).not.toContain("test-only-key");
    expect(superjson.parse<{code:string}>(body).code).toBe("AI_UNAVAILABLE");
  });
});

