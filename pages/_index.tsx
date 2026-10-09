import React, { useEffect, useRef, useState } from "react";
import { FileText, Upload, Download, Undo2, Redo2, MousePointer2, Eye, Sparkles, Check, X, PencilLine, LoaderCircle, ShieldCheck, BarChart3, Link2 } from "lucide-react";
import { postRewrite } from "../endpoints/rewrite_POST.schema";
import { Button } from "../components/Button";
import { Textarea } from "../components/Textarea";
import { ChartEditor } from "../components/ChartEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/Tabs";
import { HtmlTextDocument } from "../helpers/HtmlTextDocument";
import { sampleDocument } from "../helpers/sampleDocument";
import { useEditorTools } from "../helpers/useEditorTools";
import styles from "./_index.module.css";

type Proposal = {id: string; identity: string; base: string; text: string};
export default function EditorPage() {
  const [model,setModel] = useState(() => new HtmlTextDocument(sampleDocument));
  const [frameHtml,setFrameHtml] = useState(() => model.preview());
  const [frameVersion,setFrameVersion] = useState(0);
  const [filename,setFilename] = useState("Пример отчёта.html");
  const [isSample,setIsSample] = useState(true);
  const [selectedId,setSelectedId] = useState(() => model.entries.find(e => e.kind === "Заголовок")?.id || "");
  const [revision,setRevision] = useState(0);
  const [mode,setMode] = useState("edit");
  const [tab,setTab] = useState("text");
  const [selectedChartId,setSelectedChartId] = useState(()=>model.charts.items[0]?.id||"");
  const [instruction,setInstruction] = useState("");
  const [proposal,setProposal] = useState<Proposal | null>(null);
  const [busy,setBusy] = useState(false);
  const [importing,setImporting] = useState(false);
  const [notice,setNotice] = useState("");
  const [aiError,setAiError] = useState("");
  const [cooldown,setCooldown] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const modeRef = useRef(mode);
  const selectedRef = useRef(selectedId);
  const requestRef = useRef(0);
  const exportRevision = useRef(-1);
  const savedScroll = useRef(0);
  const tabRef = useRef(tab);
  const chartRef = useRef(selectedChartId);
  tabRef.current=tab;
  chartRef.current=selectedChartId;
  modeRef.current = mode;
  selectedRef.current = selectedId;
  const selected = model.get(selectedId);
  useEditorTools({ filename, fragmentCount:model.entries.length, chartCount:model.charts.items.length,
    selected:selected ? { id:selected.id, kind:selected.kind, text:selected.text } : null });
  const words = selected?.text.trim().split(/\s+/).filter(Boolean).length || 0;
  const numericSelection=selected ? model.charts.parseNumber(selected.text) : null;
  const linkedNumber=model.charts.links(selectedId).find(o=>o.point.valueTextId===selectedId||o.point.valueAliases?.includes(selectedId));

  function highlight(id: string) {
    const doc = frameRef.current?.contentDocument;
    doc?.querySelectorAll("[data-selected]").forEach(el => el.removeAttribute("data-selected"));
    doc?.querySelector((id.startsWith("c")?'[data-page-chart="':'[data-page-text="') + id + '"]')?.setAttribute("data-selected","");
  }
  function selectText(id: string, scroll = false) {
    if (!model.get(id)) return;
    if (selectedRef.current !== id) { setProposal(null); setAiError(""); }
    selectedRef.current = id; setSelectedId(id); highlight(id);
    if(tabRef.current==="charts"){tabRef.current="text";setTab("text");}
    if (scroll && window.innerWidth < 780) panelRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function selectChart(id:string,scroll=false) {
    if(!model.charts.get(id))return;
    chartRef.current=id;setSelectedChartId(id);tabRef.current="charts";setTab("charts");highlight(id);
    if(scroll)frameRef.current?.contentDocument?.querySelector('[data-page-chart="'+id+'"]')?.scrollIntoView({behavior:"smooth",block:"center"});
    if(window.innerWidth<780)panelRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }
  function syncEntries(skipId?:string) {
    const doc=frameRef.current?.contentDocument;
    if(!doc)return;
    for(const e of model.entries)if(e.id!==skipId){const el=doc.querySelector('[data-page-text="'+e.id+'"]');if(el&&el.textContent!==model.displayText(e.id))el.textContent=model.displayText(e.id);}
    model.charts.refresh(doc);
    highlight(tabRef.current==="charts"?chartRef.current:selectedRef.current);
  }
  function chartChanged() {syncEntries();setRevision(v=>v+1);setNotice("");}
  function updateText(id: string, text: string, fromFrame = false) {
    try {
      if(model.update(id,text)){syncEntries(fromFrame?id:undefined);setRevision(v=>v+1);setNotice("");}
      return true;
    } catch(error){setNotice(error instanceof Error?error.message:"Не удалось изменить значение.");return false;}
  }
  function changeLink(value:string) {
    try{
      if(value==="none"){if(model.unbindChart(selectedId))chartChanged();}
      else{const [id,index]=value.split(":");if(model.bindChart(selectedId,id,Number(index)))chartChanged();}
    }catch(error){setNotice(error instanceof Error?error.message:"Не удалось связать значение с графиком.");}
  }
  function travel(direction: "undo" | "redo") {
    const doc=frameRef.current?.contentDocument;
    savedScroll.current=doc?.scrollingElement?.scrollTop||0;
    const id=model[direction]();
    if(id){if(id.startsWith("c"))selectChart(id);else selectText(id);setFrameHtml(model.preview());setFrameVersion(v=>v+1);setRevision(v=>v+1);setNotice("");}
  }
  function keyboard(event: KeyboardEvent) {
    if (!(event.metaKey || event.ctrlKey)) return;
    if((event.target as Element)?.closest?.("[data-chart-draft]"))return;
    if (event.key.toLowerCase() === "z") {event.preventDefault(); travel(event.shiftKey ? "redo" : "undo");}
    if (event.key.toLowerCase() === "y") {event.preventDefault(); travel("redo");}
  }
  function loadFrame() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.documentElement.dataset.editing = String(modeRef.current === "edit");
    const editable = (event: Event) => (event.target as Element)?.closest?.("[data-page-text]") as HTMLElement | null;
    doc.addEventListener("click",event => {
      const target = event.target as Element;
      if (target?.closest?.("a,button,input,select,label")) event.preventDefault();
      const el = editable(event);
      const graph=target?.closest?.("[data-page-chart]") as HTMLElement|null;
      const graphId=graph?.dataset.pageChart||"",graphModel=model.charts.get(graphId);
      if(modeRef.current==="edit"&&graph&&(!el||["svg","managed"].includes(graphModel?.provider||""))){event.preventDefault();selectChart(graphId);return;}
      if (el && modeRef.current === "edit") selectText(el.dataset.pageText || "",true);
    }, true);
    doc.addEventListener("submit",event => event.preventDefault(),true);
    doc.addEventListener("focusin",event => {
      const el = editable(event);
      if (el && modeRef.current === "edit") selectText(el.dataset.pageText || "");
    });
    doc.addEventListener("input",event => {
      const el = editable(event);
      if (el) updateText(el.dataset.pageText || "", model.fromDisplay(el.dataset.pageText || "",el.innerText ?? el.textContent ?? ""),true);
    });
    const insertPlain = (el: HTMLElement, text: string) => {
      const selection = doc.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      range.deleteContents();
      const node = doc.createTextNode(text);
      range.insertNode(node); range.setStartAfter(node); range.collapse(true);
      selection.removeAllRanges();selection.addRange(range);
      updateText(el.dataset.pageText || "",model.fromDisplay(el.dataset.pageText || "",el.innerText ?? el.textContent ?? ""),true);
    };
    doc.addEventListener("paste",event => {
      const el=editable(event);
      if (el) {event.preventDefault();insertPlain(el,(event as ClipboardEvent).clipboardData?.getData("text/plain") || "");}
    });
    doc.addEventListener("beforeinput",event => {
      const el=editable(event);
      if (el && ["insertParagraph","insertLineBreak"].includes((event as InputEvent).inputType)) {event.preventDefault();insertPlain(el,"\n");}
    });
    doc.addEventListener("keydown",keyboard);
    if(doc.scrollingElement)doc.scrollingElement.scrollTop=savedScroll.current;
    highlight(tabRef.current==="charts"?chartRef.current:selectedRef.current);
  }
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc) {
      doc.documentElement.dataset.editing=String(mode==="edit");
      doc.querySelectorAll("[data-page-text]").forEach(el => {
        if (el.tagName.toLowerCase() !== "tspan") el.setAttribute("contenteditable",mode==="edit" ? "plaintext-only" : "false");
      });
    }
  },[mode,frameHtml]);
  useEffect(()=>{highlight(tab==="charts"?selectedChartId:selectedId);},[tab,selectedChartId,selectedId,frameHtml]);
  useEffect(() => {
    window.addEventListener("keydown",keyboard);
    const beforeUnload = (event: BeforeUnloadEvent) => {if(model.dirtyCount && exportRevision.current !== revision){event.preventDefault();event.returnValue="";}};
    window.addEventListener("beforeunload",beforeUnload);
    return () => {window.removeEventListener("keydown",keyboard);window.removeEventListener("beforeunload",beforeUnload);};
  },[model,revision]);
  useEffect(() => {if(!cooldown)return; const timer=setTimeout(()=>setCooldown(false),60000);return()=>clearTimeout(timer);},[cooldown]);

  async function openFile(file?: File) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {setNotice("Выберите файл с расширением .html или .htm.");return;}
    if (file.size > 10 * 1024 * 1024) {setNotice("Этот файл слишком большой. Максимальный размер — 10 МБ.");return;}
    if (model.dirtyCount && exportRevision.current !== revision && !window.confirm("Открыть другой файл? Нескачанные правки текущей страницы будут потеряны.")) return;
    setImporting(true);setNotice("");
    try {
      const bytes=await file.arrayBuffer();
      const ascii=new TextDecoder("windows-1252").decode(bytes.slice(0,8192));
      const metaDoc=new DOMParser().parseFromString(ascii,"text/html");
      const declared=metaDoc.querySelector("meta[charset]")?.getAttribute("charset") || metaDoc.querySelector('meta[http-equiv="Content-Type" i]')?.getAttribute("content")?.match(/charset\s*=\s*([\w-]+)/i)?.[1];
      const bom=new Uint8Array(bytes).slice(0,3);
      const charset=bom[0]===239&&bom[1]===187&&bom[2]===191 ? "utf-8" : declared || "utf-8";
      const text=new TextDecoder(charset,{fatal:true}).decode(bytes);
      const next=new HtmlTextDocument(text);
      if (!next.entries.length&&!next.charts.items.length) {setNotice("В файле нет доступного текста или графиков. Данные, которые загружаются с другого сервера, пока не поддерживаются.");return;}
      requestRef.current++;setBusy(false);setProposal(null);setAiError("");
      const first=next.entries.find(e=>e.kind==="Заголовок") || next.entries[0];
      const firstChart=next.charts.items[0]?.id||"";savedScroll.current=0;
      setModel(next);setFrameHtml(next.preview());setFilename(file.name);setIsSample(false);setSelectedId(first?.id||"");selectedRef.current=first?.id||"";
      setSelectedChartId(firstChart);chartRef.current=firstChart;setTab(first?"text":"charts");tabRef.current=first?"text":"charts";
      setMode("edit");setRevision(0);exportRevision.current=-1;
    } catch {setNotice("Не удалось открыть файл. Проверьте, что это HTML-страница в поддерживаемой кодировке.");}
    finally {setImporting(false);if(fileRef.current)fileRef.current.value="";}
  }
  function download() {
    try {
    // A UTF-8 BOM makes exported Cyrillic readable even if the source used another charset.
    const blob = new Blob(["\uFEFF",model.export()],{type:"text/html;charset=utf-8"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url;a.download=filename.replace(/\.html?$/i,"")+" — исправлено.html";document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);exportRevision.current=revision;setNotice("Исправленная страница скачана.");
    } catch(error){setNotice(error instanceof Error?error.message:"Не удалось скачать страницу.");}
  }
  async function rewrite() {
    if (!selected || !selected.text.trim() || !instruction.trim() || busy || cooldown) return;
    const id=selected.id,base=selected.text,identity=model.identity,ticket=++requestRef.current;
    setBusy(true);setAiError("");setProposal(null);
    try {
      const body=await postRewrite({text:base,instruction:instruction.trim(),context:selected.kind});
      if (!body.text?.trim()) throw new Error("ИИ не предложил текст. Попробуйте уточнить задачу.");
      if (ticket===requestRef.current) setProposal({id,base,identity,text:body.text});
    } catch(error) {
      const detail=error as Error & {code?:string;status?:number};
      if(detail.code==="OUT_OF_CREDITS"){setAiError("ИИ временно недоступен.");return;}
      if(detail.status===429)setCooldown(true);
      if(ticket===requestRef.current)setAiError(error instanceof Error?error.message:"Не удалось получить вариант текста.");
    }
    finally {if(ticket===requestRef.current)setBusy(false);}
  }
  const validProposal=proposal?.id===selectedId && proposal?.identity===model.identity && proposal?.base===selected?.text;
  return <div className={styles.app}>
    <><title>Текст на странице — визуальный редактор HTML</title><meta name="description" content="Меняйте текст в HTML-странице вручную и с помощью ИИ. Без кода, с сохранением оформления."/></>
    <header className={styles.header}>
      <div className={styles.brand}><div className={styles.logo}><PencilLine size={21}/></div><div><strong>Текст на странице</strong><span>Визуальный редактор</span></div></div>
      <div className={styles.headerActions}>
        <Button variant="outline" onClick={()=>fileRef.current?.click()} disabled={importing} className={styles.openButton}>{importing?<LoaderCircle size={17} className={styles.spin}/>:<Upload size={17}/>}<span>Открыть HTML</span></Button>
        <Button onClick={download} className={styles.downloadButton}><Download size={17}/><span>Скачать</span></Button>
        <input ref={fileRef} type="file" accept=".html,.htm,text/html" hidden onChange={event=>openFile(event.target.files?.[0])}/>
      </div>
    </header>
    <div className={styles.toolbar}>
      <div className={styles.file}><FileText size={17}/><span>{filename}</span>{isSample&&<em>Пример</em>}</div>
      <div className={styles.tools}>
        <div className={styles.history}><Button variant="ghost" size="icon-sm" aria-label="Отменить правку" title="Отменить · Ctrl / ⌘ Z" disabled={!model.canUndo} onClick={()=>travel("undo")}><Undo2 size={17}/></Button><Button variant="ghost" size="icon-sm" aria-label="Повторить правку" disabled={!model.canRedo} onClick={()=>travel("redo")}><Redo2 size={17}/></Button></div>
        <div className={styles.mode}><Button variant={mode==="edit"?"secondary":"ghost"} size="sm" aria-pressed={mode==="edit"} onClick={()=>setMode("edit")}><MousePointer2 size={15}/>Правка</Button><Button variant={mode==="view"?"secondary":"ghost"} size="sm" aria-pressed={mode==="view"} onClick={()=>setMode("view")}><Eye size={15}/>Просмотр</Button></div>
      </div>
    </div>
    {notice&&<div className={styles.notice} role="status"><span>{notice}</span><Button variant="ghost" size="icon-sm" aria-label="Закрыть уведомление" onClick={()=>setNotice("")}><X size={15}/></Button></div>}
    <main className={styles.workspace}>
      <section className={styles.canvas} aria-label="Страница для редактирования" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();openFile(event.dataTransfer.files[0]);}}>
        <div className={styles.canvasHeading}><span>{mode==="edit"?"Нажмите на текст, чтобы изменить его":"Просмотр страницы"}</span><span className={styles.pageBadge}>СТРАНИЦА 01</span></div>
        <div className={styles.paper}><iframe key={model.identity+":"+frameVersion} ref={frameRef} title="Готовая HTML-страница" sandbox="allow-same-origin" srcDoc={frameHtml} onLoad={loadFrame}/></div>
        <div className={styles.canvasFooter}><ShieldCheck size={14}/><span>Файл открывается на вашем устройстве</span><span className={styles.footerCount}>{model.dirtyCount?model.dirtyCount+" фрагм. изменено":"Без изменений"}</span></div>
      </section>
      <aside className={styles.panel} ref={panelRef} aria-label="Редактор выбранного текста">
        <div className={styles.panelHeading}><span className={styles.eyebrow}>{tab==="charts"?"ГРАФИКИ НА СТРАНИЦЕ":"ВЫБРАННЫЙ ФРАГМЕНТ"}</span><h1>{tab==="charts"?"Данные графика":selected?.kind||"Выберите текст"}</h1><p>{tab==="charts"?"Меняйте значения вместе с диаграммой.":selected?"Правьте здесь или прямо на странице.":"Нажмите на любой текст страницы."}</p></div>
        <Tabs value={tab} onValueChange={setTab} className={styles.tabs}>
          <TabsList className={styles.tabList}><TabsTrigger value="text"><PencilLine size={15}/>Текст</TabsTrigger><TabsTrigger value="ai"><Sparkles size={15}/>С ИИ</TabsTrigger><TabsTrigger value="charts"><BarChart3 size={15}/>Графики</TabsTrigger></TabsList>
          <TabsContent value="text" className={styles.tabContent}>
            <label htmlFor="selected-text" className={styles.fieldLabel}>Текст на странице</label>
            <Textarea id="selected-text" value={selected?.text||""} disabled={!selected} onChange={event=>selected&&updateText(selected.id,event.target.value)} className={styles.textEditor} placeholder="Выберите текст на странице" spellCheck/>
            <div className={styles.textMeta}><span>{words} слов · {selected?.text.length||0} знаков</span><span><Check size={13}/>На странице</span></div>
            {selected&&model.charts.items.some(g=>g.points.length)&&(numericSelection!==null||linkedNumber)&&<div className={styles.chartBinding}><label htmlFor="text-chart-link"><Link2 size={14}/>График для этого числа</label><Select value={linkedNumber?linkedNumber.chart.id+":"+linkedNumber.index:"none"} onValueChange={changeLink}><SelectTrigger id="text-chart-link"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="none">Без связи с графиком</SelectItem>{model.charts.items.flatMap(g=>g.points.map((p,index)=><SelectItem key={g.id+":"+index} value={g.id+":"+index}>{g.name} · {p.series?p.series+" / ":""}{p.label}</SelectItem>))}</SelectContent></Select><p>{linkedNumber?"Изменение числа обновляет диаграмму.":"Выберите категорию графика, которую должно обновлять это число."}</p></div>}
            <div className={styles.tip}><div className={styles.tipIcon}><MousePointer2 size={17}/></div><p>Заголовки, абзацы, подписи и ячейки таблиц — просто нажмите на нужный текст.</p></div>
          </TabsContent>
          <TabsContent value="ai" className={styles.tabContent}>
            <div className={styles.selectedExcerpt}>{selected?.text||"Сначала выберите текст на странице."}</div>
            <label htmlFor="ai-instruction" className={styles.fieldLabel}>Что изменить?</label>
            <Textarea id="ai-instruction" value={instruction} onChange={event=>setInstruction(event.target.value)} placeholder="Например: сократи вдвое и сохрани все цифры" className={styles.prompt} disabled={busy}/>
            <div className={styles.presets}>{["Сократить","Сделать понятнее","Деловой стиль","Исправить ошибки"].map(command=><Button key={command} variant="outline" size="sm" className={styles.preset} disabled={busy} onClick={()=>setInstruction(command)}>{command}</Button>)}</div>
            <Button className={styles.generate} disabled={!selected?.text.trim()||!instruction.trim()||busy||cooldown} onClick={rewrite}>{busy?<LoaderCircle size={17} className={styles.spin}/>:<Sparkles size={17}/>} {busy?"Готовлю вариант…":cooldown?"Можно повторить через минуту":"Предложить вариант"}</Button>
            <p className={styles.aiNote}>ИИ получает только выбранный текст и вашу задачу. Предложение применяется после вашего подтверждения.</p>
            {aiError&&<p className={styles.aiError} role="alert">{aiError}</p>}
            {proposal&&proposal.id===selectedId&&<div className={styles.proposal}><div className={styles.proposalHeading}><Sparkles size={15}/><strong>Вариант ИИ</strong></div><p>{proposal.text}</p>{!validProposal&&<p className={styles.stale}>Исходный текст уже изменился. Запросите новый вариант.</p>}<div className={styles.proposalActions}><Button size="sm" disabled={!validProposal} onClick={()=>{if(validProposal&&proposal){if(updateText(proposal.id,proposal.text))setProposal(null);}}}><Check size={15}/>Применить</Button><Button variant="ghost" size="sm" onClick={()=>setProposal(null)}>Оставить мой текст</Button></div></div>}
          </TabsContent>
          <TabsContent value="charts" className={styles.tabContent}><ChartEditor model={model} selectedId={selectedChartId} onSelect={id=>selectChart(id,true)} onChange={chartChanged}/></TabsContent>
        </Tabs>
        <div className={styles.panelBottom}><span className={styles.smallLine}></span><p>Правки видны сразу.<br/><strong>Страницу можно скачать.</strong></p></div>
      </aside>
    </main>
  </div>;
}
