import { useEffect, useRef } from "react";

type Snapshot = {
  filename:string; fragmentCount:number; chartCount:number;
  selected:{id:string;kind:string;text:string} | null;
};
type ToolContext = {
  registerTool(tool:{name:string;title:string;description:string;inputSchema:object;
    annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};
    execute(input:unknown):unknown}, options:{signal:AbortSignal}):void | Promise<void>;
};

export function useEditorTools(snapshot:Snapshot) {
  const current=useRef(snapshot);current.current=snapshot;
  useEffect(()=>{
    const context=(document as Document & {modelContext?:ToolContext}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    try {
      void Promise.resolve(context.registerTool({
        name:"read_editor_document",title:"Прочитать выбранный фрагмент",
        description:"Прочитать имя открытого HTML-файла, число фрагментов и графиков и выбранный текст. Не изменяет страницу.",
        inputSchema:{type:"object",properties:{},additionalProperties:false},
        annotations:{readOnlyHint:true,untrustedContentHint:true},
        execute(input:unknown){
          if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).length)
            throw new Error("Передайте пустой объект.");
          const value=current.current;
          return {...value,selected:value.selected ? {...value.selected,
            text:value.selected.text.slice(0,5000),truncated:value.selected.text.length>5000} : null};
        }
      },{signal:lifecycle.signal})).catch(()=>{});
    } catch { /* Editing remains available without browser tool support. */ }
    return ()=>lifecycle.abort();
  },[]);
}
