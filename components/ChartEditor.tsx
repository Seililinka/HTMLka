import React, { useEffect, useState } from "react";
import { BarChart3, Plus, Trash2, Check } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import { HtmlTextDocument } from "../helpers/HtmlTextDocument";
import styles from "./ChartEditor.module.css";

type Props={model:HtmlTextDocument;selectedId:string;onSelect:(id:string)=>void;onChange:()=>void;className?:string};
function NumberField({value,onCommit,label}:{value:number;onCommit:(value:number)=>boolean;label:string}) {
  const [draft,setDraft]=useState(String(value));
  const [error,setError]=useState("");
  useEffect(()=>{setDraft(String(value));setError("");},[value]);
  const commit=()=>{
    const normalized=draft.trim().replace(/[\s\u00a0\u202f]/g,"").replace(",",".");
    if(!normalized||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)||!Number.isFinite(Number(normalized))){setError("Введите число");return;}
    setError("");if(!onCommit(Number(normalized)))setDraft(String(value));
  };
  return <div className={styles.numberField}><Input data-chart-draft inputMode="decimal" value={draft} aria-label={label} aria-invalid={!!error} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();}}/>{error&&<span role="alert">{error}</span>}</div>;
}
export const ChartEditor=({model,selectedId,onSelect,onChange,className}:Props)=>{
  const [error,setError]=useState("");
  const [kind,setKind]=useState("bar");
  const [rows,setRows]=useState([{label:"",value:""},{label:"",value:""}]);
  const charts=model.charts.items,chart=model.charts.get(selectedId)||charts[0];
  useEffect(()=>{setError("");setKind("bar");setRows([{label:"",value:""},{label:"",value:""}]);},[chart?.id,model.identity]);
  const mutate=(action:()=>boolean)=>{
    try{setError("");if(action())onChange();return true;}
    catch(e){setError(e instanceof Error?e.message:"Не удалось изменить график.");return false;}
  };
  const create=()=>{
    if(!chart)return;
    const points=rows.map(row=>({label:row.label.trim(),value:model.charts.parseNumber(row.value)}));
    if(points.some(p=>!p.label||p.value===null)){setError("Заполните подписи и числовые значения всех строк.");return;}
    mutate(()=>model.rebuildChart(chart.id,kind,points as {label:string;value:number}[]));
  };
  if(!charts.length)return <div className={[styles.root,className].filter(Boolean).join(" ")}><div className={styles.empty}><BarChart3 size={28}/><strong>Графиков не найдено</strong><p>Откройте HTML-файл с диаграммой. Для редактирования нужен сам график и его данные, а не только число рядом с ним.</p></div></div>;
  return <div className={[styles.root,className].filter(Boolean).join(" ")}>
    <label className={styles.label} htmlFor="selected-chart">График на странице</label>
    <Select value={chart?.id} onValueChange={id=>{setError("");onSelect(id);}}><SelectTrigger id="selected-chart"><SelectValue/></SelectTrigger><SelectContent>{charts.map((g,i)=><SelectItem key={g.id} value={g.id}>{i+1}. {g.name}</SelectItem>)}</SelectContent></Select>
    {chart?.points.length?<><div className={styles.description}><Check size={15}/><span>Подписи и значения связаны с диаграммой.</span></div>
      <div className={styles.tableHeading}><span>Подпись</span><span>Значение</span></div>
      <div className={styles.rows}>{chart.points.map((point,index)=><div className={styles.row} key={index}><div>{point.series&&<span className={styles.series}>{point.series}</span>}<Input aria-label={"Подпись "+(index+1)} value={point.label} maxLength={2000} onChange={event=>mutate(()=>model.updateChart(chart.id,index,{label:event.target.value}))}/></div><NumberField value={point.value} label={"Значение: "+(point.series?point.series+" / ":"")+point.label} onCommit={value=>mutate(()=>model.updateChart(chart.id,index,{value}))}/></div>)}</div>
      <p className={styles.note}>Измените число и нажмите Enter или перейдите к другому полю. График пересчитается, правка сохранится при скачивании.</p>
      {chart.provider==="svg"&&<p className={styles.note}>Эта диаграмма будет построена заново с теми же данными и цветами.</p>}
    </>:<div className={styles.rebuild}><p>Данные этой диаграммы не удалось распознать. Введите значения, чтобы заменить её редактируемым графиком.</p>
      <label className={styles.label} htmlFor="new-chart-type">Вид диаграммы</label><Select value={kind} onValueChange={setKind}><SelectTrigger id="new-chart-type"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="bar">Столбчатая</SelectItem><SelectItem value="line">Линейная</SelectItem><SelectItem value="pie">Круговая</SelectItem><SelectItem value="doughnut">Кольцевая</SelectItem></SelectContent></Select>
      <div className={styles.tableHeading}><span>Подпись</span><span>Значение</span></div>
      {rows.map((row,index)=><div key={index} className={styles.newRow} data-chart-draft><Input value={row.label} placeholder={"Категория "+(index+1)} aria-label={"Подпись новой категории "+(index+1)} onChange={e=>setRows(rows.map((r,i)=>i===index?{...r,label:e.target.value}:r))}/><Input value={row.value} inputMode="decimal" placeholder="Число" aria-label={"Значение новой категории "+(index+1)} onChange={e=>setRows(rows.map((r,i)=>i===index?{...r,value:e.target.value}:r))}/><Button variant="ghost" size="icon-sm" aria-label={"Удалить строку "+(index+1)} disabled={rows.length<2} onClick={()=>setRows(rows.filter((_,i)=>i!==index))}><Trash2 size={15}/></Button></div>)}
      <Button variant="ghost" size="sm" onClick={()=>setRows([...rows,{label:"",value:""}])} disabled={rows.length>=200}><Plus size={15}/>Добавить строку</Button>
      <Button className={styles.buildButton} onClick={create}><BarChart3 size={17}/>Построить по этим данным</Button>
    </div>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
  </div>;
};
