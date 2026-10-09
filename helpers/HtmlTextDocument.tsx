import { parse } from "parse5";
import { HtmlCharts } from "./HtmlCharts";

type TreeNode = { nodeName: string; tagName?: string; value?: string; childNodes?: TreeNode[]; attrs?: {name: string; value: string}[]; sourceCodeLocation?: {startOffset: number; endOffset: number} | null };
type TextEntry = { id: string; text: string; original: string; prefix: string; suffix: string; start: number; end: number; kind: string; svg: boolean; pre: boolean };
type Snapshot = {texts: string[]; charts: string};
type Change = { id: string; group: string; before: Snapshot; after: Snapshot; at: number };
const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class HtmlTextDocument {
  readonly source: string;
  readonly entries: TextEntry[] = [];
  readonly charts: HtmlCharts;
  private changes: Change[] = [];
  private cursor = 0;
  readonly identity = Math.random().toString(36).slice(2);
  constructor(source: string) {
    this.source = source;
    const tree = parse(source, { sourceCodeLocationInfo: true }) as unknown as TreeNode;
    const visit = (node: TreeNode, ancestors: TreeNode[]) => {
      const tag = node.tagName || node.nodeName;
      const excluded = ["head","script","style","noscript","template","iframe","object","embed","textarea","select","option","canvas"];
      if (excluded.includes(tag) || node.attrs?.some(a => a.name === "hidden" || (a.name === "aria-hidden" && a.value === "true") || (a.name === "style" && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.value)))) return;
      if (node.nodeName === "#text" && node.value?.trim() && node.sourceCodeLocation) {
        const svg = ancestors.some(a => a.tagName === "svg");
        if (svg && !ancestors.some(a => a.tagName === "text" || a.tagName === "tspan")) return;
        const pre = ancestors.some(a => a.tagName === "pre");
        const prefix = pre ? "" : node.value.match(/^\s*/)?.[0] || "";
        const suffix = pre ? "" : node.value.match(/\s*$/)?.[0] || "";
        const text = pre ? node.value : node.value.slice(prefix.length, node.value.length - suffix.length);
        const names = ancestors.map(a => a.tagName || "");
        const kind = names.some(n => /^h[1-6]$/.test(n)) ? "Заголовок" : names.some(n => n === "td" || n === "th") ? "Ячейка таблицы" : svg ? "Подпись графика" : names.includes("button") || names.includes("a") ? "Подпись" : names.includes("li") ? "Пункт списка" : "Текст";
        this.entries.push({id: "t" + this.entries.length, text, original: text, prefix, suffix, start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, kind, svg, pre});
      }
      for (const child of node.childNodes || []) visit(child, [...ancestors, node]);
    };
    visit(tree, []);
    this.charts = new HtmlCharts(source,this.entries);
  }
  get(id: string) { return this.entries.find(e => e.id === id); }
  get dirtyCount() { return this.entries.filter(e => e.text !== e.original).length + this.charts.dirtyCount; }
  get canUndo() { return this.cursor > 0; }
  get canRedo() { return this.cursor < this.changes.length; }
  private snapshot(): Snapshot { return {texts:this.entries.map(e=>e.text),charts:this.charts.capture()}; }
  private restore(state: Snapshot) {this.entries.forEach((e,index)=>e.text=state.texts[index]);this.charts.restore(state.charts);}
  private record(id:string,before:Snapshot,group=id) {
    const now=Date.now(),after=this.snapshot(),last=this.changes[this.cursor-1];
    if(JSON.stringify(before)===JSON.stringify(after))return false;
    const merge=this.cursor===this.changes.length&&last?.group===group&&now-last.at<700;
    if(merge){last.after=after;last.at=now;}
    else{this.changes=this.changes.slice(0,this.cursor);this.changes.push({id,group,before,after,at:now});this.cursor++;}
    return true;
  }
  update(id: string, text: string) {
    const entry=this.get(id);if(!entry||entry.text===text)return false;
    const before=this.snapshot();
    try{entry.text=text;this.charts.syncText(id,text);}
    catch(error){this.restore(before);throw error;}
    return this.record(id,before);
  }
  updateChart(id:string,index:number,input:{label?:string;value?:number}) {
    const before=this.snapshot();
    try{this.charts.setPoint(id,index,input);}
    catch(error){this.restore(before);throw error;}
    return this.record(id,before,id+":"+index+":"+(input.value!==undefined?"value":"label"));
  }
  bindChart(textId:string,chartId:string,index:number) {
    const before=this.snapshot();this.charts.bind(textId,chartId,index);return this.record(textId,before,textId+":binding");
  }
  unbindChart(textId:string) {const before=this.snapshot();this.charts.unbind(textId);return this.record(textId,before);}
  rebuildChart(id:string,kind:string,points:{label:string;value:number}[]) {
    const before=this.snapshot();this.charts.rebuild(id,kind,points);return this.record(id,before);
  }
  undo() {if(!this.canUndo)return undefined;const change=this.changes[--this.cursor];this.restore(change.before);return change.id;}
  redo() {if(!this.canRedo)return undefined;const change=this.changes[this.cursor++];this.restore(change.after);return change.id;}
  private applyPatches(patches:{start:number;end:number;value:string}[]) {
    const unique=new Map<string,{start:number;end:number;value:string}>();
    for(const patch of patches) {
      const key=patch.start+":"+patch.end;
      const previous=unique.get(key);
      if(previous&&patch.start===patch.end)previous.value+=patch.value;
      else unique.set(key,{...patch});
    }
    const sorted=[...unique.values()].sort((a,b)=>a.start-b.start||b.end-a.end);
    let result="",position=0;
    for(const patch of sorted){if(patch.start<position)continue;result+=this.source.slice(position,patch.start)+patch.value;position=patch.end;}
    return result+this.source.slice(position);
  }
  displayText(id: string) {
    const e = this.get(id); return e ? e.prefix + e.text + e.suffix : "";
  }
  fromDisplay(id: string, text: string) { const e = this.get(id); return e?.pre ? text : text.trim(); }
  export() {
    if(this.charts.invalidLinks().length)throw new Error("Исправьте связанные числовые значения перед скачиванием.");
    const patches=this.charts.patches(false);
    for(const e of this.entries)if(e.text!==e.original)patches.push({start:e.start,end:e.end,value:escapeText(this.displayText(e.id))});
    return this.applyPatches(patches);
  }
  preview() {
    const patches=this.charts.patches(true);
    for(const e of this.entries) {
      const tag=e.svg?"tspan":"span",value=e.text===e.original?this.source.slice(e.start,e.end):escapeText(this.displayText(e.id));
      const marked="<"+tag+' data-page-text="'+e.id+'"'+(e.svg?"":' contenteditable="plaintext-only" spellcheck="true"')+">"+value+"</"+tag+">";
      patches.push({start:e.start,end:e.end,value:marked});
    }
    const marked=this.applyPatches(patches);
    const doc = new DOMParser().parseFromString(marked, "text/html");
    doc.querySelectorAll("script,iframe,object,embed,applet,meta[http-equiv]").forEach(el => el.remove());
    doc.querySelectorAll("*").forEach(el => {
      for (const attr of Array.from(el.attributes)) if (/^on/i.test(attr.name) || attr.name === "srcdoc" || attr.name === "autofocus") el.removeAttribute(attr.name);
      if (el.matches("input,select,textarea")) el.setAttribute("disabled", "");
    });
    const style = doc.createElement("style");
    style.textContent = '[data-page-text]{cursor:text;outline-offset:4px;border-radius:2px;caret-color:#304cdb}html[data-editing="true"] [data-page-text]:hover{outline:1px dashed #8193e7}html[data-editing="true"] [data-page-text][data-selected]{outline:2px solid #304cdb;background:rgb(48 76 219 / 5%)}[data-page-text]:focus{outline:2px solid #304cdb!important}html[data-editing="false"] [data-page-text]{cursor:default}html[data-editing="false"] [data-page-text]:focus{outline:none!important}[data-page-text]:empty:before{content:"Пустой текст";color:#6b7385;font-size:14px}';
    style.textContent += ' html[data-editing="true"] [data-page-chart]:hover{outline:1px dashed #8193e7;outline-offset:3px;cursor:pointer}[data-page-chart][data-selected]{outline:2px solid #304cdb;outline-offset:3px}';
    doc.head.appendChild(style);
    doc.documentElement.dataset.editing = "true";
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  }
}
