import { parse as parseHtml } from "parse5";
import { parse as parseJs } from "acorn";
import { renderEditableChart } from "./renderEditableChart";

type Location = {startOffset:number;endOffset:number;startTag?:Location;attrs?:Record<string,Location>};
type H = {nodeName:string;tagName?:string;value?:string;attrs?:{name:string;value:string}[];childNodes?:H[];parentNode?:H;sourceCodeLocation?:Location};
type Entry = {id:string;text:string;original?:string;start:number;end:number};
type Ref = {start:number;end:number;original:number|string};
type Geometry = {start:number;end:number;raw:string;property:string;unit:string;size:number;marker:string};
type Point = {label:string;value:number;series?:string;color?:string;originalLabel:string;originalValue:number;valueRef?:Ref;labelRef?:Ref;percent?:boolean;explicitTexts?:string[];valueTextId?:string;valueAliases?:string[];valueScales?:Record<string,number>;labelTextId?:string;geometry?:Geometry};
type Chart = {id:string;key:string;name:string;kind:string;orientation:string;provider:string;points:Point[];start:number;end:number;open:number;tag:string;rebuild:boolean;scale?:number;capacity?:number};
type Patch = {start:number;end:number;value:string};
const attr=(node:H,name:string)=>node.attrs?.find(a=>a.name===name)?.value||"";
const descendants=(root:H)=>{const result:H[]=[];const walk=(n:H)=>{result.push(n);for(const c of n.childNodes||[])walk(c);};walk(root);return result;};
const contents=(node:H):string=>node.nodeName==="#text"?node.value||"":["script","style","noscript"].includes(node.tagName||"")?"":(node.childNodes||[]).map(contents).join(" ");
const normalize=(s:string)=>s.trim().replace(/\s+/g," ").toLowerCase();
const jsonString=(s:string)=>JSON.stringify(s).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
const unitScale=(text:string)=>/млрд/i.test(text)?1e9:/млн/i.test(text)?1e6:/тыс/i.test(text)?1e3:1;
const isHidden=(node:H)=>{for(let n:H|undefined=node;n;n=n.parentNode)if(n.attrs?.some(a=>a.name==="hidden"||(a.name==="aria-hidden"&&a.value==="true")||(a.name==="style"&&/display\\s*:\\s*none|visibility\\s*:\\s*hidden/i.test(a.value))))return true;return false;};
const numberOf=(text:string):number|null=>{
  const match=text.trim().match(/^([-+]?\d[\d\s\u00a0\u202f]*(?:[.,]\d+)?)(?:\s*(?:%|₽|руб\.?|мин\.?|шт\.?|тыс\.?|млн\.?|млрд\.?|ч|кг))?$/i);
  if(!match)return null;const value=Number(match[1].replace(/[\s\u00a0\u202f]/g,"").replace(",","."));
  return Number.isFinite(value)?value:null;
};

export class HtmlCharts {
  readonly items:Chart[]=[];
  private elements:H[];
  private initial:Record<string,string>={};
  private initialBindings="";
  private disabledTexts=new Set<string>();
  private insideCache=new Map<H,Entry[]>();
  private textNodes=new Map<number,H>();
  private renderedStates=new WeakMap<Document,Map<string,string>>();
  constructor(private source:string,private entries:Entry[]) {
    const root=parseHtml(source,{sourceCodeLocationInfo:true}) as unknown as H;
    const nodes=descendants(root);
    this.elements=nodes.filter(n=>n.tagName&&n.sourceCodeLocation&&!isHidden(n));
    this.textNodes=new Map(nodes.filter(n=>n.nodeName==="#text"&&n.sourceCodeLocation).map(n=>[n.sourceCodeLocation!.startOffset,n]));
    this.discoverScripts();
    this.discoverCss();
    this.discoverSvg();
    for(const node of this.elements) {
      const tag=node.tagName||"",known=this.items.some(g=>g.start===node.sourceCodeLocation!.startOffset);
      const size=Number(attr(node,"width"))||Number(attr(node,"viewBox").split(/[ ,]+/)[2])||0;
      const container=["div","figure"].includes(tag)&&/^(?:chart|graph|plot|chart-container|bar-chart|pie-chart|donut-chart)$/i.test(attr(node,"class"))&&!this.items.some(g=>g.start>=node.sourceCodeLocation!.startOffset&&g.end<=node.sourceCodeLocation!.endOffset);
      if(!known&&(container||tag==="canvas" || (tag==="svg"&&size>100) || (tag==="img"&&/chart|graph|plot|diagram|график|диаграмм/i.test(attr(node,"class")+" "+attr(node,"id")+" "+attr(node,"alt"))))) this.add(node,"bar","vertical",[],"unknown");
    }
    this.autoBind();
    this.restoreSourceLinks();
    for(const g of this.items)this.initial[g.id]=this.signature(g);
    this.initialBindings=this.bindingSignature();
  }
  parseNumber(text:string){return numberOf(text);}
  get(id:string){return this.items.find(g=>g.id===id);}
  get dirtyCount(){return this.items.filter(g=>this.signature(g)!==this.initial[g.id]).length+(this.bindingSignature()!==this.initialBindings?1:0);}
  private signature(g:Chart){return JSON.stringify([g.kind,g.orientation,g.rebuild,g.points.map(p=>[p.label,p.value])]);}
  private bindingSignature(){return JSON.stringify([this.items.map(g=>g.points.map(p=>[p.explicitTexts,p.valueTextId,p.valueAliases,p.valueScales])),[...this.disabledTexts].sort()]);}
  capture(){return JSON.stringify({charts:this.items.map(g=>({id:g.id,kind:g.kind,orientation:g.orientation,rebuild:g.rebuild,points:g.points})),disabled:[...this.disabledTexts]});}
  restore(state:string){const data=JSON.parse(state);this.disabledTexts=new Set(data.disabled||[]);for(const item of Array.isArray(data)?data:data.charts){const g=this.get(item.id);if(g)Object.assign(g,item);}}
  links(id:string){return this.items.flatMap(g=>g.points.map((p,index)=>({chart:g,index,point:p}))).filter(o=>o.point.valueTextId===id||o.point.valueAliases?.includes(id)||o.point.labelTextId===id);}
  invalidLinks(){return this.items.flatMap(g=>g.points.filter(p=>[p.valueTextId,...p.valueAliases||[]].some(id=>id&&numberOf(this.entries.find(e=>e.id===id)?.text||"")===null)));}
  private name(node:H){
    let parent=node.parentNode;
    for(let depth=0;parent&&depth<5;depth++,parent=parent.parentNode) {
      const headings=descendants(parent).filter(n=>/^h[1-6]$/.test(n.tagName||"")&&n.sourceCodeLocation!.startOffset<node.sourceCodeLocation!.startOffset);
      if(headings.length)return contents(headings[headings.length-1]).trim().slice(0,100);
    }
    return attr(node,"aria-label")||attr(node,"alt")||"График "+(this.items.length+1);
  }
  private add(node:H,kind:string,orientation:string,points:Point[],provider:string){
    if(!node.sourceCodeLocation||this.items.some(g=>g.start===node.sourceCodeLocation!.startOffset))return undefined;
    if(points.length>200||points.some(p=>!Number.isFinite(p.value)))return undefined;
    const loc=node.sourceCodeLocation,open=loc.startTag?.endOffset||loc.startOffset;
    const g:Chart={id:"c"+this.items.length,key:attr(node,"data-editor-chart-key")||"chart_"+Math.random().toString(36).slice(2),name:this.name(node),kind,orientation,provider,points,start:loc.startOffset,end:loc.endOffset,open:open-(this.source[open-2]==="/"?2:1),tag:node.tagName||"div",rebuild:false};
    this.items.push(g);return g;
  }
  private inside(node:H){const cached=this.insideCache.get(node);if(cached)return cached;const loc=node.sourceCodeLocation;const result=loc?this.entries.filter(e=>e.start>=loc.startOffset&&e.end<=loc.endOffset):[];this.insideCache.set(node,result);return result;}
  private point(label:string,value:number,extra:Partial<Point>={}):Point{return {label,value,originalLabel:label,originalValue:value,...extra};}
  private discoverCss(){
    const groups=new Map<number,{root:H;points:Point[];orientation:string}>();
    for(const node of this.elements) {
      const style=attr(node,"style"),match=style.match(/(?:^|;)\s*(width|height)\s*:\s*(\d+(?:\.\d+)?)\s*(%|px)/i);
      if(!match||!/bar|fill|progress|meter/i.test(attr(node,"class")+" "+attr(node,"id")))continue;
      let row:H|undefined=node,values:Entry[]=[];
      for(let i=0;row&&i<5;i++,row=row.parentNode){values=this.inside(row).filter(e=>numberOf(e.text)!==null);if(values.length===1)break;}
      if(!row||values.length!==1)continue;
      const value=numberOf(values[0].text)!;if(value<0)continue;
      let chartRoot=row.parentNode;
      for(let ancestor=row.parentNode,depth=0;ancestor&&depth<5;depth++,ancestor=ancestor.parentNode) {
        if(/chart|graph|plot|bars|bar-chart|диаграмм/i.test(attr(ancestor,"class")+" "+attr(ancestor,"id"))){chartRoot=ancestor;break;}
      }
      if(!chartRoot?.sourceCodeLocation||["body","html"].includes(chartRoot.tagName||""))continue;
      const labelEntry=this.inside(row).find(e=>numberOf(e.text)===null&&e.text.trim());
      const location=node.sourceCodeLocation?.attrs?.style;if(!location)continue;
      const label=labelEntry?.text.trim()||"Категория "+(groups.get(chartRoot.sourceCodeLocation.startOffset)?.points.length||0);
      const point=this.point(label,value,{percent:/%\s*$/.test(values[0].text),valueTextId:values[0].id,labelTextId:labelEntry?.id,color:style.match(/(?:background(?:-color)?|color)\s*:\s*([^;]+)/i)?.[1]?.trim(),geometry:{start:location.startOffset,end:location.endOffset,raw:this.source.slice(location.startOffset,location.endOffset),property:match[1].toLowerCase(),unit:match[3],size:Number(match[2]),marker:"s"+node.sourceCodeLocation!.startOffset}});
      const key=chartRoot.sourceCodeLocation.startOffset;
      if(!groups.has(key))groups.set(key,{root:chartRoot,points:[],orientation:match[1].toLowerCase()==="width"?"horizontal":"vertical"});
      groups.get(key)!.points.push(point);
    }
    for(const group of groups.values()) {
      const unit=group.points[0].geometry!.unit,property=group.points[0].geometry!.property;
      if(group.points.some(p=>p.geometry?.unit!==unit||p.geometry?.property!==property))continue;
      const ratios=group.points.filter(p=>p.value>0).map(p=>p.geometry!.size/p.value);
      const ratio=ratios[0]||1;
      if(ratios.some(r=>Math.abs(r-ratio)>Math.max(.05,Math.abs(ratio)*.08)))continue;
      const g=this.add(group.root,"bar",group.orientation,group.points,"css");
      if(g){g.scale=ratio;g.capacity=unit==="%"?100:Math.max(1,...group.points.map(p=>p.geometry!.size));}
    }
  }
  private discoverSvg(){
    for(const node of this.elements.filter(n=>n.tagName==="svg")) {
      if(this.items.some(g=>g.start===node.sourceCodeLocation!.startOffset))continue;
      const metadata=attr(node,"data-editor-chart");
      if(metadata) {
        try {
          const data=JSON.parse(metadata);
          if(["bar","line","pie","doughnut"].includes(data.kind)&&Array.isArray(data.points)&&data.points.every((p:any)=>typeof p.label==="string"&&typeof p.value==="number"&&Number.isFinite(p.value))) {
            const points=data.points.map((p:any)=>this.point(p.label,p.value,{series:typeof p.series==="string"?p.series:"",color:typeof p.color==="string"?p.color:undefined}));
            const g=this.add(node,data.kind,data.orientation==="horizontal"?"horizontal":"vertical",points,"managed");
            if(g){g.name=typeof data.name==="string"?data.name:this.name(node);}continue;
          }
        } catch {}
      }
      const all=descendants(node),rects=all.filter(n=>n.tagName==="rect"&&Number(attr(n,"width"))>0&&Number(attr(n,"height"))>0);
      const texts=all.filter(n=>n.tagName==="text"&&Number.isFinite(Number(attr(n,"x")))&&Number.isFinite(Number(attr(n,"y"))));
      if(rects.length<2)continue;
      const widths=rects.map(n=>Number(attr(n,"width"))),heights=rects.map(n=>Number(attr(n,"height")));
      const vertical=Math.max(...widths)-Math.min(...widths)<Math.max(...heights)-Math.min(...heights);
      const points:Point[]=[],used=new Set<H>();
      for(const rect of rects) {
        const x=Number(attr(rect,"x")),y=Number(attr(rect,"y")),w=Number(attr(rect,"width")),h=Number(attr(rect,"height"));
        const candidates=texts.filter(t=>!used.has(t)&&numberOf(contents(t).trim())!==null).map(t=>({t,dx:Number(attr(t,"x"))-(vertical?x+w/2:x+w),dy:Number(attr(t,"y"))-(vertical?y:y+h/2)})).filter(c=>vertical?Math.abs(c.dx)<Math.max(20,w)&&c.dy>=-35&&c.dy<=15:c.dx>=-20&&c.dx<=55&&Math.abs(c.dy)<Math.max(15,h)).sort((a,b)=>Math.abs(a.dx)+Math.abs(a.dy)-Math.abs(b.dx)-Math.abs(b.dy));
        if(!candidates.length)continue;
        const valNode=candidates[0].t,value=numberOf(contents(valNode).trim())!,valueEntry=this.inside(valNode).find(e=>numberOf(e.text)===value);
        const labels=texts.filter(t=>numberOf(contents(t).trim())===null&&contents(t).trim()).map(t=>({t,dx:Number(attr(t,"x"))-(vertical?x+w/2:x),dy:Number(attr(t,"y"))-(vertical?y+h:y+h/2)})).filter(c=>vertical?Math.abs(c.dx)<Math.max(30,w)&&c.dy>=0&&c.dy<=70:c.dx<=0&&Math.abs(c.dy)<Math.max(20,h)).sort((a,b)=>Math.abs(a.dx)+Math.abs(a.dy)-Math.abs(b.dx)-Math.abs(b.dy));
        if(!labels.length)continue;
        const labelNode=labels[0].t,labelEntry=this.inside(labelNode).find(e=>e.text.trim()),label=contents(labelNode).trim();
        used.add(valNode);points.push(this.point(label,value,{valueTextId:valueEntry?.id,labelTextId:labelEntry?.id,color:attr(rect,"fill")||attr(rect,"style").match(/fill\s*:\s*([^;]+)/)?.[1]}));
      }
      if(points.length>=2)this.add(node,"bar",vertical?"vertical":"horizontal",points,"svg");
    }
  }
  private discoverScripts(){
    const byId=new Map(this.elements.filter(n=>attr(n,"id")).map(n=>[attr(n,"id"),n]));
    for(const script of this.elements.filter(n=>n.tagName==="script"&&!attr(n,"src")&&!/json/i.test(attr(n,"type")))) {
      const code=script.childNodes?.find(n=>n.nodeName==="#text");if(!code?.value||code.value.length>300000||!code.sourceCodeLocation)continue;
      let ast:any;try{ast=parseJs(code.value,{ecmaVersion:"latest",sourceType:"module"});}catch{continue;}
      const offset=code.sourceCodeLocation.startOffset,nodes:any[]=[],bindings=new Map<string,any>();
      const walk=(n:any)=>{if(!n||typeof n!=="object")return;if(typeof n.type==="string")nodes.push(n);for(const [key,value]of Object.entries(n))if(!["start","end","loc"].includes(key)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==="object")walk(value);}};
      walk(ast);
      for(const n of nodes.filter(n=>n.type==="VariableDeclarator"&&n.id?.type==="Identifier"))bindings.set(n.id.name,bindings.has(n.id.name)?null:n.init);
      const resolve=(n:any,seen=new Set<string>()):any=>{if(n?.type==="Identifier"){if(seen.has(n.name))return undefined;seen.add(n.name);return resolve(bindings.get(n.name),seen);}return n;};
      const key=(n:any)=>n?.type==="Identifier"?n.name:n?.value;
      const prop=(n:any,name:string)=>resolve(resolve(n)?.properties?.find((p:any)=>p.type==="Property"&&!p.computed&&key(p.key)===name)?.value);
      const array=(n:any):any[]=>resolve(n)?.type==="ArrayExpression"?resolve(n).elements||[]:[];
      const value=(n:any):any=>{n=resolve(n);if(n?.type==="Literal")return n.value;if(n?.type==="UnaryExpression"&&["+","-"].includes(n.operator)){const v=value(n.argument);return typeof v==="number"?(n.operator==="-"?-v:v):undefined;}return undefined;};
      const ref=(n:any):Ref|undefined=>{n=resolve(n);const v=value(n);return n&&["string","number"].includes(typeof v)?{start:offset+n.start,end:offset+n.end,original:v}:undefined;};
      const target=(n:any,seen=new Set<string>()):H|undefined=>{
        if(n?.type==="Literal"&&typeof n.value==="string")return byId.get(n.value);
        if(n?.type==="Identifier"){if(seen.has(n.name))return;seen.add(n.name);return target(bindings.get(n.name),seen);}
        if(n?.type==="CallExpression"&&n.callee?.type==="MemberExpression"){
          const method=key(n.callee.property);
          if(["getElementById","querySelector"].includes(method)){const name=value(n.arguments[0]);return typeof name==="string"?byId.get(method==="querySelector"?name.replace(/^#/,""):name):undefined;}
          if(method==="getContext")return target(n.callee.object,seen);
          if(method==="init")return target(n.arguments[0],seen);
        }
        return undefined;
      };
      const point=(labelNode:any,dataNode:any,fallbackLabel:string,series:string,color?:string):Point|undefined=>{
        const raw=prop(dataNode,"value")||dataNode,v=value(raw);if(typeof v!=="number"||!Number.isFinite(v))return;
        const label=["string","number"].includes(typeof value(labelNode))?String(value(labelNode)):fallbackLabel;
        return this.point(label,v,{series,color,valueRef:ref(raw),labelRef:ref(labelNode)});
      };
      for(const n of nodes) {
        let element:H|undefined,config:any,provider="",kind="bar",orientation="vertical",points:Point[]=[];
        if(n.type==="NewExpression"&&key(n.callee)==="Chart"){
          element=target(n.arguments[0]);config=resolve(n.arguments[1]);provider="chartjs";
          kind=String(value(prop(config,"type"))||"bar");
          orientation=value(prop(prop(config,"options"),"indexAxis"))==="y"?"horizontal":"vertical";
          const data=prop(config,"data"),labels=array(prop(data,"labels"));
          for(const dataset of array(prop(data,"datasets"))) {
            const name=String(value(prop(dataset,"label"))||""),colors=array(prop(dataset,"backgroundColor")),single=value(prop(dataset,"backgroundColor"))||value(prop(dataset,"borderColor"));
            array(prop(dataset,"data")).forEach((item,i)=>{const dataNode=prop(item,"y")||item;const label=labels[i]||prop(item,"x");const p=point(label,dataNode,"Категория "+(i+1),name,typeof value(colors[i])==="string"?value(colors[i]):typeof single==="string"?single:undefined);if(p)points.push(p);});
          }
        } else if(n.type==="CallExpression"&&n.callee?.type==="MemberExpression"&&key(n.callee.property)==="setOption"){
          element=target(n.callee.object);config=resolve(n.arguments[0]);provider="echarts";
          let labels=array(prop(prop(config,"xAxis"),"data"));if(!labels.length){labels=array(prop(prop(config,"yAxis"),"data"));if(labels.length)orientation="horizontal";}
          const colors=array(prop(config,"color"));
          for(const [si,series]of array(prop(config,"series")).entries()) {
            kind=String(value(prop(series,"type"))||"bar");const name=String(value(prop(series,"name"))||"");
            array(prop(series,"data")).forEach((item,i)=>{const label=labels[i]||prop(item,"name"),p=point(label,item,"Категория "+(i+1),name,value(prop(prop(item,"itemStyle"),"color"))||value(colors[si]));if(p)points.push(p);});
          }
        } else if(n.type==="CallExpression"&&n.callee?.type==="MemberExpression"&&key(n.callee.object)==="Plotly"&&["newPlot","react"].includes(key(n.callee.property))){
          element=target(n.arguments[0]);provider="plotly";
          for(const trace of array(n.arguments[1])) {
            const type=value(prop(trace,"type"));kind=type==="pie"?"pie":type==="bar"?"bar":"line";
            orientation=value(prop(trace,"orientation"))==="h"?"horizontal":"vertical";
            const labels=array(prop(trace,kind==="pie"?"labels":orientation==="horizontal"?"y":"x")),values=array(prop(trace,kind==="pie"?"values":orientation==="horizontal"?"x":"y"));
            const name=String(value(prop(trace,"name"))||""),color=value(prop(prop(trace,"marker"),"color"));
            values.forEach((item,i)=>{const p=point(labels[i],item,"Категория "+(i+1),name,typeof color==="string"?color:undefined);if(p)points.push(p);});
          }
        }
        if(element&&points.length&&["bar","line","pie","doughnut"].includes(kind))this.add(element,kind,orientation,points,provider);
      }
    }
  }
  private autoBind(){
    for(const g of this.items)for(const p of g.points){
      if(p.valueTextId)continue;
      const candidates=new Map<string,{value:Entry;label:Entry}>();
      for(const row of this.elements.filter(n=>["tr","li"].includes(n.tagName||"")||/row|item|stat|metric/i.test(attr(n,"class")))){
        const entries=this.inside(row),label=entries.find(e=>normalize(e.text)===normalize(p.label)),values=entries.filter(e=>numberOf(e.text)===p.value||(numberOf(e.text)!==null&&numberOf(e.text)!*unitScale(e.text)===p.value));
        if(label&&values.length===1)candidates.set(values[0].id,{value:values[0],label});
      }
      if(candidates.size===1){const choice=[...candidates.values()][0];p.valueTextId=choice.value.id;p.labelTextId=choice.label.id;p.valueScales={[choice.value.id]:numberOf(choice.value.text)===p.value?1:unitScale(choice.value.text)};}
    }
    const aliases=new Map<string,{point:Point;reference:string}[]>();
    for(const g of this.items)for(const p of g.points)if(p.valueTextId){
      const list=aliases.get(p.valueTextId)||[];list.push({point:p,reference:p.valueRef?String(p.valueRef.start):g.id});aliases.set(p.valueTextId,list);
    }
    for(const list of aliases.values())if(new Set(list.map(o=>o.reference)).size>1)for(const item of list){item.point.valueTextId=undefined;item.point.labelTextId=undefined;}
  }
  bind(textId:string,chartId:string,index:number){
    const entry=this.entries.find(e=>e.id===textId),g=this.get(chartId),p=g?.points[index];if(!entry||!p||numberOf(entry.text)===null)throw new Error("Выберите числовой текст.");
    this.unbind(textId);this.disabledTexts.delete(textId);
    p.explicitTexts=[...p.explicitTexts||[],textId];
    if(p.valueTextId&&p.valueTextId!==textId)p.valueAliases=[...p.valueAliases||[],textId];else p.valueTextId=textId;
    const original=entry.original??entry.text,base=numberOf(original),scale=unitScale(original);
    const multiplier=base!==null&&scale!==1&&Math.abs(base*scale-p.originalValue)<Math.max(0.00001,Math.abs(p.originalValue)*0.00001)?scale:1;
    p.valueScales={...p.valueScales,[textId]:multiplier};
    this.setPoint(chartId,index,{value:numberOf(entry.text)!*multiplier});
  }
  unbind(textId:string){this.disabledTexts.add(textId);for(const g of this.items)for(const p of g.points){if(p.valueTextId===textId)p.valueTextId=undefined;p.valueAliases=p.valueAliases?.filter(id=>id!==textId);p.explicitTexts=p.explicitTexts?.filter(id=>id!==textId);}}
  syncText(textId:string,text:string){
    for(const {chart,index,point}of this.links(textId)){
      if(point.valueTextId===textId||point.valueAliases?.includes(textId)){const value=numberOf(text);if(value!==null)this.setPoint(chart.id,index,{value:value*(point.valueScales?.[textId]||1)});}
      if(point.labelTextId===textId)this.setPoint(chart.id,index,{label:text},false);
    }
  }
  setPoint(chartId:string,index:number,input:{value?:number;label?:string},sync=true){
    const g=this.get(chartId),p=g?.points[index];if(!g||!p)return;
    if(input.value!==undefined&&(!Number.isFinite(input.value)||((g.provider==="css"||g.kind==="pie"||g.kind==="doughnut")&&input.value<0)))throw new Error("Для этого графика нужно неотрицательное число.");
    if(input.value!==undefined&&p.percent&&input.value>100)throw new Error("Процент должен быть от 0 до 100.");
    const targets=this.items.flatMap(graph=>graph.points).filter(q=>q===p||(input.value!==undefined&&p.valueRef&&q.valueRef?.start===p.valueRef.start)||(input.label!==undefined&&p.labelRef&&q.labelRef?.start===p.labelRef.start));
    for(const q of targets) {
      if(input.value!==undefined)q.value=input.value;
      if(input.label!==undefined)q.label=input.label;
      if(sync&&input.value!==undefined)for(const id of [q.valueTextId,...q.valueAliases||[]]){const e=this.entries.find(e=>e.id===id);if(e)e.text=e.text.replace(/[-+]?\d(?:[\d\s\u00a0\u202f]*\d)?(?:[.,]\d+)?/,new Intl.NumberFormat("ru-RU",{maximumFractionDigits:10,useGrouping:/\d[\s\u00a0\u202f]\d/.test(e.text)}).format(input.value/(q.valueScales?.[id!]||1)));}
      if(sync&&input.label!==undefined&&q.labelTextId){const e=this.entries.find(e=>e.id===q.labelTextId);if(e)e.text=input.label;}
    }
  }
  rebuild(chartId:string,kind:string,points:{label:string;value:number}[]){
    const g=this.get(chartId);if(!g||!["bar","line","pie","doughnut"].includes(kind)||!points.length||points.length>200||points.some(p=>!Number.isFinite(p.value)||(["pie","doughnut"].includes(kind)&&p.value<0)))throw new Error("Проверьте подписи и значения графика.");
    g.kind=kind;g.rebuild=true;g.points=points.map(p=>this.point(p.label,p.value));g.orientation="vertical";
  }
  private restoreSourceLinks(){
    for(const parent of this.elements){
      const raw=attr(parent,"data-editor-text-links");if(!raw||raw.length>100000)continue;
      let links:any;try{links=JSON.parse(raw);}catch{continue;}
      if(!Array.isArray(links)||links.length>500)continue;
      for(const link of links){
        if(!Number.isInteger(link.child)||link.child<0)continue;
        const node=parent.childNodes?.[link.child],entry=node?.sourceCodeLocation?this.entries.find(e=>e.start===node.sourceCodeLocation!.startOffset):undefined;
        if(!entry)continue;
        if(link.disabled===true){this.unbind(entry.id);continue;}
        const graph=this.items.find(g=>g.key===link.chart),point=graph?.points[link.point];
        if(!graph||!point||!Number.isInteger(link.point)||!Number.isFinite(link.scale)||link.scale<=0||link.scale>1e12||numberOf(entry.text)===null)continue;
        this.disabledTexts.delete(entry.id);
        if(!point.valueTextId)point.valueTextId=entry.id;
        else if(point.valueTextId!==entry.id&&!point.valueAliases?.includes(entry.id))point.valueAliases=[...point.valueAliases||[],entry.id];
        point.valueScales={...point.valueScales,[entry.id]:link.scale};
        point.explicitTexts=[...new Set([...point.explicitTexts||[],entry.id])];
      }
    }
  }
  private sourceLinkPatches():Patch[]{
    const groups=new Map<H,any[]>(),linkedCharts=new Set<Chart>();
    const add=(textId:string,link:Record<string,unknown>)=>{
      const entry=this.entries.find(e=>e.id===textId),node=entry?this.textNodes.get(entry.start):undefined,parent=node?.parentNode;
      if(!node||!parent?.sourceCodeLocation?.startTag)return;
      const child=parent.childNodes?.indexOf(node);if(child===undefined||child<0)return;
      const links=groups.get(parent)||[];links.push({child,...link});groups.set(parent,links);
    };
    for(const graph of this.items)for(const [index,point]of graph.points.entries())for(const id of point.explicitTexts||[]){
      add(id,{chart:graph.key,point:index,scale:point.valueScales?.[id]||1});linkedCharts.add(graph);
    }
    for(const id of this.disabledTexts)add(id,{disabled:true});
    const patches:Patch[]=[];
    const put=(node:H,name:string,value:string)=>{
      const location=node.sourceCodeLocation!,existing=location.attrs?.[name],encoded=value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
      const attribute=name+'="'+encoded+'"';
      if(existing)patches.push({start:existing.startOffset,end:existing.endOffset,value:attribute});
      else{const end=location.startTag!.endOffset,position=end-(this.source[end-2]==="/"?2:1);patches.push({start:position,end:position,value:" "+attribute});}
    };
    // Replace old link metadata as well, so removing a binding survives reopening.
    for(const node of this.elements)if(attr(node,"data-editor-text-links")&&!groups.has(node))groups.set(node,[]);
    for(const [node,links]of groups)put(node,"data-editor-text-links",JSON.stringify(links));
    for(const graph of linkedCharts){
      const node=this.elements.find(n=>n.sourceCodeLocation?.startOffset===graph.start);
      if(node&&node.sourceCodeLocation?.startTag&&!attr(node,"data-editor-chart-key"))put(node,"data-editor-chart-key",graph.key);
    }
    return patches;
  }
  private geometry(g:Chart,p:Point){
    const available=g.capacity||100,axis=Math.max(available/(g.scale||1),...g.points.map(p=>p.value));
    return Math.round((axis?p.value/axis*available:0)*10000)/10000;
  }
  patches(preview=false):Patch[]{
    const patches:Patch[]=[];
    for(const g of this.items){
      const changed=this.signature(g)!==this.initial[g.id],replacement=g.rebuild||((g.provider==="svg"||g.provider==="managed")&&changed);
      if(replacement){
        let value=renderEditableChart(g,preview);
        if(g.rebuild&&!["svg"].includes(g.tag)){const original=this.source.slice(g.start,g.end);value='<div hidden style="display:none!important">'+original+'</div>'+value;}
        patches.push({start:g.start,end:g.end,value});continue;
      }
      for(const p of g.points){
        if(p.value!==p.originalValue&&p.valueRef)patches.push({start:p.valueRef.start,end:p.valueRef.end,value:String(p.value)});
        if(p.label!==p.originalLabel&&p.labelRef)patches.push({start:p.labelRef.start,end:p.labelRef.end,value:jsonString(p.label)});
        if(p.geometry&&changed){const a=p.geometry,regexp=new RegExp('((?:[;\\"\\\']|^)\\s*'+a.property+'\\s*:\\s*)\\d+(?:\\.\\d+)?\\s*(?:%|px)','i');patches.push({start:a.start,end:a.end,value:a.raw.replace(regexp,"$1"+this.geometry(g,p)+a.unit)});}
      }
      if(preview){
        if(["chartjs","echarts","plotly"].includes(g.provider)){patches.push({start:g.start,end:g.end,value:renderEditableChart(g,true)});continue;}
        if(g.tag==="canvas"&&!g.points.length){patches.push({start:g.start,end:g.end,value:'<div data-page-chart="'+g.id+'" style="border:1px dashed #aab5c9;border-radius:8px;padding:28px;min-height:180px;cursor:pointer"><strong>График</strong><p>Нажмите, чтобы добавить данные и обновить диаграмму.</p></div>'});continue;}
        patches.push({start:g.open,end:g.open,value:' data-page-chart="'+g.id+'"'});
        for(const p of g.points)if(p.geometry){const shape=this.elements.find(n=>n.sourceCodeLocation?.attrs?.style?.startOffset===p.geometry!.start),end=shape?.sourceCodeLocation?.startTag?.endOffset;if(end)patches.push({start:end-1,end:end-1,value:' data-page-geometry="'+p.geometry.marker+'"'});}
      }
    }
    if(!preview&&this.bindingSignature()!==this.initialBindings)patches.push(...this.sourceLinkPatches());
    return patches;
  }
  refresh(doc:Document){
    let rendered=this.renderedStates.get(doc);if(!rendered){rendered=new Map();this.renderedStates.set(doc,rendered);}
    for(const g of this.items){
      const signature=this.signature(g);if(rendered.get(g.id)===signature)continue;
      const el=doc.querySelector('[data-page-chart="'+g.id+'"]');if(!el)continue;
      rendered.set(g.id,signature);
      const changed=this.signature(g)!==this.initial[g.id];
      if(["chartjs","echarts","plotly","managed"].includes(g.provider)||g.rebuild||(g.provider==="svg"&&changed)){el.outerHTML=renderEditableChart(g,true);continue;}
      if(g.provider==="css")for(const p of g.points)if(p.geometry){const shape=doc.querySelector('[data-page-geometry="'+p.geometry.marker+'"]') as HTMLElement|null;if(shape)shape.style.setProperty(p.geometry.property,this.geometry(g,p)+p.geometry.unit);}
    }
  }
}
