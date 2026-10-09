type ChartInput = {id: string; key?: string; name: string; kind: string; orientation?: string; points: {label: string; value: number; series?: string; color?: string}[]};
const escape = (v: unknown) => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const palette = ["#304cdb","#8395e8","#25a37a","#e7a145","#ab67c7","#54738f"];
const safeColor = (value: string | undefined,index: number) => value && /^(#[\da-f]{3,8}|[a-z]{3,24}|(?:rgb|hsl)a?\([\d.,%\s+-]+\))$/i.test(value) ? value : palette[index%palette.length];
const fmt = (v: number) => new Intl.NumberFormat("ru-RU",{maximumFractionDigits:3}).format(v);
const shorten = (v: string,n=20) => v.length>n ? v.slice(0,n-1)+"…" : v;

export function renderEditableChart(chart: ChartInput, preview = true) {
  const points=chart.points;
  const metadata=JSON.stringify({name:chart.name,kind:chart.kind,orientation:chart.orientation,points:points.map(p=>({label:p.label,value:p.value,series:p.series,color:p.color}))});
  const attr=' data-editor-chart="'+escape(metadata)+'"'+(chart.key?' data-editor-chart-key="'+escape(chart.key)+'"':"")+(preview?' data-page-chart="'+escape(chart.id)+'"':"");
  let shapes="",height=360;
  const text=(x:number,y:number,value:string,extra="")=>'<text x="'+x+'" y="'+y+'" font-size="14" fill="#526174" '+extra+'>'+escape(value)+'</text>';
  const categories=[...new Set(points.map(p=>p.label))], series=[...new Set(points.map(p=>p.series||""))];
  if(chart.kind==="pie"||chart.kind==="doughnut") {
    const total=points.reduce((s,p)=>s+Math.max(0,p.value),0),cx=190,cy=170,r=118;
    height=Math.max(340,points.length*30+50);
    let position=0;
    if(!total) shapes+=text(cx,cy,"Нет данных",'text-anchor="middle"');
    points.forEach((p,index)=>{
      const fraction=total?Math.max(0,p.value)/total:0;
      const color=safeColor(p.color,index);
      if(fraction>0) {
        if(chart.kind==="doughnut") {
          const circumference=2*Math.PI*90;
          shapes+='<circle cx="'+cx+'" cy="'+cy+'" r="90" fill="none" stroke="'+color+'" stroke-width="52" stroke-dasharray="'+(fraction*circumference)+' '+circumference+'" stroke-dashoffset="'+(-position*circumference)+'" transform="rotate(-90 '+cx+' '+cy+')" data-chart-point-index="'+index+'"><title>'+escape(p.label)+': '+escape(fmt(p.value))+'</title></circle>';
        } else if(fraction>=0.999999) {
          shapes+='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="'+color+'" data-chart-point-index="'+index+'"/>';
        } else {
          const a=position*Math.PI*2-Math.PI/2,b=(position+fraction)*Math.PI*2-Math.PI/2;
          const path="M "+cx+" "+cy+" L "+(cx+r*Math.cos(a))+" "+(cy+r*Math.sin(a))+" A "+r+" "+r+" 0 "+(fraction>0.5?1:0)+" 1 "+(cx+r*Math.cos(b))+" "+(cy+r*Math.sin(b))+" Z";
          shapes+='<path d="'+path+'" fill="'+color+'" data-chart-point-index="'+index+'"><title>'+escape(p.label)+': '+escape(fmt(p.value))+'</title></path>';
        }
      }
      const y=44+index*30;
      shapes+='<rect x="370" y="'+(y-12)+'" width="12" height="12" rx="3" fill="'+color+'"/>'+text(394,y,shorten(p.label,30))+text(760,y,fmt(p.value)+(total?" · "+fmt(fraction*100)+"%":""),'text-anchor="end"');
      position+=fraction;
    });
  } else {
    const rawMax=Math.max(0,...points.map(p=>p.value)),rawMin=Math.min(0,...points.map(p=>p.value));
    const span=rawMax-rawMin||1,power=Math.pow(10,Math.floor(Math.log10(span/4))),approx=span/4/power;
    const step=(approx<=1?1:approx<=2?2:approx<=5?5:10)*power;
    const max=Math.ceil((rawMax||1)/step)*step,min=Math.floor(rawMin/step)*step,range=max-min||1;
    const horizontal=chart.orientation==="horizontal"&&chart.kind!=="line";
    if(horizontal) height=Math.max(220,categories.length*Math.max(38,series.length*24)+50);
    const left=horizontal?170:62,right=42,top=26,bottom=54,w=800-left-right,h=height-top-bottom;
    const x=(v:number)=>left+(v-min)/range*w,y=(v:number)=>top+(max-v)/range*h;
    for(let i=0;i<=4;i++) {
      const v=min+(max-min)*i/4;
      if(horizontal) {
        const xx=x(v);
        shapes+='<line x1="'+xx+'" y1="'+top+'" x2="'+xx+'" y2="'+(top+h)+'" stroke="#e4e9f0"/>'+text(xx,top+h+28,fmt(v),'text-anchor="middle"');
      } else {
        const yy=y(v);
        shapes+='<line x1="'+left+'" y1="'+yy+'" x2="'+(left+w)+'" y2="'+yy+'" stroke="#e4e9f0"/>'+text(left-12,yy+5,fmt(v),'text-anchor="end"');
      }
    }
    const spacing=(horizontal?h:w)/Math.max(1,categories.length);
    if(chart.kind==="line") {
      series.forEach((name,si)=>{
        const values=points.map((p,index)=>({p,index})).filter(o=>(o.p.series||"")===name);
        const xy=values.map(({p})=>[left+(categories.indexOf(p.label)+0.5)*spacing,y(p.value)]);
        shapes+='<polyline points="'+xy.map(a=>a.join(",")).join(" ")+'" stroke="'+safeColor(values[0]?.p.color,si)+'" stroke-width="3" fill="none"/>';
        values.forEach(({p,index},j)=>{shapes+='<circle cx="'+xy[j][0]+'" cy="'+xy[j][1]+'" r="4" fill="'+safeColor(p.color,si)+'" data-chart-point-index="'+index+'"><title>'+escape(p.label)+': '+escape(fmt(p.value))+'</title></circle>';});
      });
    } else {
      points.forEach((p,index)=>{
        const ci=categories.indexOf(p.label),si=series.indexOf(p.series||"");
        const bar=Math.max(2,Math.min(38,(spacing-14)/Math.max(1,series.length)));
        let xx:number,yy:number,ww:number,hh:number;
        if(horizontal) {xx=Math.min(x(0),x(p.value));ww=Math.abs(x(p.value)-x(0));yy=top+ci*spacing+7+si*bar;hh=bar-3;}
        else {xx=left+ci*spacing+(spacing-series.length*bar)/2+si*bar;ww=bar-3;yy=Math.min(y(0),y(p.value));hh=Math.abs(y(p.value)-y(0));}
        shapes+='<rect x="'+xx+'" y="'+yy+'" width="'+Math.max(0,ww)+'" height="'+Math.max(0,hh)+'" rx="2" fill="'+safeColor(p.color,si)+'" data-chart-point-index="'+index+'" data-chart-value="'+p.value+'"><title>'+escape(p.label)+': '+escape(fmt(p.value))+'</title></rect>';
        if(series.length===1) shapes+=horizontal?text(x(p.value)+7,yy+hh/2+5,fmt(p.value)):text(xx+ww/2,yy-7,fmt(p.value),'text-anchor="middle"');
      });
    }
    categories.forEach((label,index)=>{shapes+=horizontal?text(left-14,top+(index+0.5)*spacing+4,shorten(label,22),'text-anchor="end"'):text(left+(index+0.5)*spacing,height-20,shorten(label,Math.max(5,Math.floor(spacing/8))),'text-anchor="middle"');});
    if(series.length>1) shapes+=series.map((name,index)=>text(62+index*180,height-2,shorten(name,18),'fill="'+safeColor(undefined,index)+'"')).join("");
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 '+height+'" role="img" aria-label="'+escape(chart.name)+'" style="width:100%;height:auto;display:block;max-width:100%;font-family:system-ui,sans-serif"'+attr+'><title>'+escape(chart.name)+'</title>'+shapes+'</svg>';
}
