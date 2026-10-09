import { HtmlTextDocument } from "./HtmlTextDocument";

const css='<div class="chart"><h2>Доля задач</h2><div class="row"><span>Команда А</span><strong>40%</strong><div class="bar" style="width:40%;background:#304cdb"></div></div><div class="row"><span>Команда Б</span><strong>20%</strong><div class="bar" style="width:20%;background:#25a37a"></div></div></div><p>40</p>';
const js='<!doctype html><html><head><style>canvas{height:300px}</style></head><body><h2>Продажи</h2><table><tr><td>Январь</td><td>10</td></tr><tr><td>Февраль</td><td>20</td></tr></table><canvas id="sales"></canvas><script>const months=["Январь","Февраль"];const counts=[10,20];new Chart(document.getElementById("sales"),{type:"bar",data:{labels:months,datasets:[{label:"Продажи",data:counts,backgroundColor:"#304cdb"}]}});window.unrelated="do not edit";</script></body></html>';
describe("Chart data editing",()=>{
  it("detects CSS bars and updates both their labels and their sizes",()=>{
    const model=new HtmlTextDocument(css);
    expect(model.charts.items.length).toBe(1);
    expect(model.charts.items[0].points.map(p=>p.value)).toEqual([40,20]);
    const entry=model.entries.find(e=>e.text==="40%")!;
    model.update(entry.id,"80%");
    expect(model.export()).toContain('<strong>80%</strong>');
    expect(model.export()).toContain('style="width:80%;background:#304cdb"');
    expect(model.charts.items[0].points[0].value).toBe(80);
    const preview=new DOMParser().parseFromString(model.preview(),"text/html");
    expect((preview.querySelector(".bar") as HTMLElement).style.width).toBe("80%");
  });
  it("leaves unrelated identical numbers independent and handles explicit links",()=>{
    const model=new HtmlTextDocument(css),entry=model.entries.find(e=>e.text==="40")!;
    model.update(entry.id,"70");
    expect(model.export()).toContain('width:40%');
    model.bindChart(entry.id,"c0",0);
    expect(model.export()).toContain('width:70%');
    expect(model.entries.find(e=>e.original==="40%")?.text).toBe("70%");
    model.update(entry.id,"90");
    expect(model.export()).toContain('width:90%');
  });
  it("recognizes literal Chart.js data without executing scripts and changes their real source values",()=>{
    const model=new HtmlTextDocument(js);
    expect(model.charts.items.length).toBe(1);
    expect(model.charts.items[0].provider).toBe("chartjs");
    model.updateChart("c0",0,{value:25});
    const output=model.export();
    expect(output).toContain("const counts=[25,20]");
    expect(output).toContain("<td>25</td>");
    expect(output).toContain('window.unrelated="do not edit";');
    expect(output).toContain("<style>canvas{height:300px}</style>");
    const preview=new DOMParser().parseFromString(model.preview(),"text/html");
    expect(preview.querySelector("script")).toBeNull();
    expect(preview.querySelector('[data-page-chart="c0"]')).not.toBeNull();
    expect(preview.querySelector('[data-chart-value="25"]')).not.toBeNull();
  });
  it("propagates a linked table edit into chart data, and undoes the whole operation",()=>{
    const model=new HtmlTextDocument(js),entry=model.entries.find(e=>e.text==="10")!;
    expect(model.charts.links(entry.id).length).toBe(1);
    model.update(entry.id,"35");
    expect(model.export()).toContain("const counts=[35,20]");
    expect(model.export()).toContain("<td>35</td>");
    model.undo();expect(model.export()).toBe(js);
    model.redo();expect(model.export()).toContain("const counts=[35,20]");
  });
  it("does not export a broken numeric link",()=>{
    const model=new HtmlTextDocument(js),entry=model.entries.find(e=>e.text==="10")!;
    model.update(entry.id,"");
    expect(()=>model.export()).toThrowError(/числовые/);
    model.unbindChart(entry.id);expect(()=>model.export()).not.toThrow();
  });
  it("escapes labels that resemble closing script tags",()=>{
    const model=new HtmlTextDocument(js);
    model.updateChart("c0",0,{label:'</script><img src=x onerror=alert(1)>'});
    expect(model.export()).toContain('\\u003c/script\\u003e');
    const parsed=new DOMParser().parseFromString(model.export(),"text/html");
    expect(parsed.querySelectorAll("script").length).toBe(1);
    expect(parsed.querySelector("img")).toBeNull();
  });
  it("supports ECharts and Plotly static category series",()=>{
    const html='<div id="ec"></div><div id="pl"></div><script>const ec=echarts.init(document.getElementById("ec"));const option={xAxis:{data:["A","B"]},series:[{type:"bar",data:[12,18]}]};ec.setOption(option);Plotly.newPlot("pl",[{x:["A","B"],y:[7,9],type:"bar"}]);</script>';
    const model=new HtmlTextDocument(html);
    expect(model.charts.items.map(g=>g.provider)).toEqual(["echarts","plotly"]);
    model.updateChart("c0",1,{value:22});model.updateChart("c1",0,{value:11});
    expect(model.export()).toContain("data:[12,22]");
    expect(model.export()).toContain("y:[11,9]");
  });
  it("keeps shared data synchronized across graphs",()=>{
    const html='<canvas id="a"></canvas><canvas id="b"></canvas><script>const values=[5,10];const labels=["A","B"];new Chart(document.getElementById("a"),{type:"bar",data:{labels,datasets:[{data:values}]}});new Chart(document.getElementById("b"),{type:"line",data:{labels,datasets:[{data:values}]}});</script>';
    const model=new HtmlTextDocument(html);expect(model.charts.items.length).toBe(2);
    model.updateChart("c0",0,{value:8});
    expect(model.charts.items[1].points[0].value).toBe(8);
    expect(model.export()).toContain("values=[8,10]");
  });
  it("rebuilds a recognized SVG bar chart and preserves accurate values on reimport",()=>{
    const html='<svg width="200" height="220"><rect x="20" y="110" width="40" height="40" fill="#304cdb"/><text x="40" y="100">40</text><text x="40" y="175">A</text><rect x="100" y="70" width="40" height="80" fill="#25a37a"/><text x="120" y="60">80</text><text x="120" y="175">B</text></svg>';
    const model=new HtmlTextDocument(html);
    expect(model.charts.items[0]?.provider).toBe("svg");
    model.updateChart("c0",0,{value:60});
    const output=model.export(),reopened=new HtmlTextDocument(output);
    expect(reopened.charts.items[0]?.points.map(p=>p.value)).toEqual([60,80]);
    model.undo();expect(model.export()).toBe(html);
  });
  it("lets a user supply data for an unknown chart, without fabricating values",()=>{
    const model=new HtmlTextDocument('<canvas id="unknown"></canvas><script>drawUnknownChart();</script>');
    expect(model.charts.items[0].points.length).toBe(0);
    model.rebuildChart("c0","pie",[{label:"А",value:30},{label:"Б",value:70}]);
    const output=model.export(),reopened=new HtmlTextDocument(output);
    expect(output).toContain("drawUnknownChart();");
    expect(reopened.charts.items.find(g=>g.provider==="managed")?.points.map(p=>p.value)).toEqual([30,70]);
    model.undo();expect(model.export()).toBe('<canvas id="unknown"></canvas><script>drawUnknownChart();</script>');
  });
  it("converts visible millions to the chart's base units and back",()=>{
    const html='<table><tr><td>Оборот</td><td>1 млн</td></tr></table><canvas id="units"></canvas><script>new Chart(document.getElementById("units"),{type:"bar",data:{labels:["Оборот"],datasets:[{data:[1000000]}]}});</script>';
    const model=new HtmlTextDocument(html),entry=model.entries.find(e=>e.text==="1 млн")!;
    expect(model.charts.links(entry.id).length).toBe(1);
    model.update(entry.id,"2 млн");expect(model.export()).toContain("data:[2000000]");
    model.updateChart("c0",0,{value:500000});
    expect(entry.text).toBe("0,5 млн");expect(model.export()).toContain("data:[500000]");
  });
  it("undoes two different point edits separately",()=>{
    const model=new HtmlTextDocument(js);
    model.updateChart("c0",0,{value:25});model.updateChart("c0",1,{value:30});
    model.undo();expect(model.export()).toContain("const counts=[25,20]");
    model.undo();expect(model.export()).toBe(js);
  });
  it("keeps percentage values within their actual range",()=>{
    const model=new HtmlTextDocument(css);
    expect(()=>model.updateChart("c0",0,{value:120})).toThrowError(/Процент/);
    expect(model.export()).toBe(css);
  });
  it("preserves a manual link when the edited HTML is reopened",()=>{
    const model=new HtmlTextDocument(css),entry=model.entries.find(e=>e.text==="40")!;
    model.bindChart(entry.id,"c0",0);model.update(entry.id,"60");
    const output=model.export(),reopened=new HtmlTextDocument(output);
    const alias=reopened.entries.find(e=>e.original==="60")!;
    expect(reopened.charts.links(alias.id).length).toBe(1);
    reopened.update(alias.id,"80");
    expect(reopened.export()).toContain('width:80%');
    expect(reopened.entries.some(e=>e.text==="80%")).toBe(true);
  });
  it("preserves the user's decision to unlink a number",()=>{
    const model=new HtmlTextDocument(js),entry=model.entries.find(e=>e.text==="10")!;
    model.unbindChart(entry.id);
    const reopened=new HtmlTextDocument(model.export()),value=reopened.entries.find(e=>e.text==="10")!;
    expect(reopened.charts.links(value.id).length).toBe(0);
    reopened.update(value.id,"90");
    expect(reopened.export()).toContain("const counts=[10,20]");
  });
});
