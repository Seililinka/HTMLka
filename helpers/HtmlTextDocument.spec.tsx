import { HtmlTextDocument } from "./HtmlTextDocument";

describe("HtmlTextDocument", () => {
  const html='<!DOCTYPE html><html lang="ru"><head><style>.x{color:red}</style><script>const saved = "<div>unchanged</div>";</script></head><body><h1 class="x">Отчёт &amp; план</h1><p>Текст <strong>важно</strong> и <a href="/target" data-other="ok">ссылка</a>.</p><table><tbody><tr><td>150</td></tr></tbody></table><svg><text x="10">График</text></svg><div hidden>Скрыто</div></body></html>';
  it("returns the original source exactly if no text changed", () => {
    expect(new HtmlTextDocument(html).export()).toBe(html);
  });
  it("changes only one text range and preserves scripts, styles, links, tables and inline formatting", () => {
    const doc=new HtmlTextDocument(html);
    const title=doc.entries.find(e=>e.text==="Отчёт & план")!;
    doc.update(title.id,"Новый <отчёт> & план");
    expect(doc.export()).toBe(html.replace("Отчёт &amp; план","Новый &lt;отчёт&gt; &amp; план"));
    const link=doc.entries.find(e=>e.text==="ссылка")!;
    doc.update(link.id,"перейти");
    expect(doc.export()).toContain('<a href="/target" data-other="ok">перейти</a>');
    expect(doc.export()).toContain("<strong>важно</strong>");
    expect(doc.export()).toContain('<script>const saved = "<div>unchanged</div>";</script>');
  });
  it("keeps exported markup intact when inserting code-like text", () => {
    const doc=new HtmlTextDocument("<p>Исходный текст</p>");
    doc.update(doc.entries[0].id,'<script>alert("x")</script>');
    expect(doc.export()).toBe('<p>&lt;script&gt;alert("x")&lt;/script&gt;</p>');
  });
  it("undoes and redoes edits without changing the original markup", () => {
    const doc=new HtmlTextDocument("<p>Один</p><p>Два</p>");
    doc.update("t0","Первый");doc.update("t1","Второй");
    doc.undo();expect(doc.export()).toBe("<p>Первый</p><p>Два</p>");
    doc.undo();expect(doc.export()).toBe("<p>Один</p><p>Два</p>");
    doc.redo();doc.redo();expect(doc.export()).toBe("<p>Первый</p><p>Второй</p>");
    doc.undo();doc.update("t1","Третий");expect(doc.canRedo).toBe(false);
  });
  it("makes an inert preview while keeping active source content for export", () => {
    const doc=new HtmlTextDocument('<!doctype html><html><head><meta http-equiv="refresh" content="1;url=https://example.com"><script>alert(1)</script></head><body onload="alert(2)"><p onclick="alert(3)">Текст</p><iframe src="https://example.com"></iframe></body></html>');
    const preview = new DOMParser().parseFromString(doc.preview(),"text/html");
    expect(preview.querySelector("script,iframe,meta[http-equiv]")).toBeNull();
    expect(preview.body.hasAttribute("onload")).toBe(false);
    expect(preview.querySelector("p")?.hasAttribute("onclick")).toBe(false);
    expect(doc.export()).toContain("<script>alert(1)</script>");
    expect(preview.querySelector("[data-page-text]")?.textContent).toBe("Текст");
  });
  it("preserves repeated texts, entity spacing and SVG label geometry", () => {
    const doc=new HtmlTextDocument('<p> A&nbsp;&amp;&nbsp;B </p><p>A</p><p>A</p><svg><text x="10" y="20">Подпись</text></svg>');
    expect(doc.entries[0].text).toBe("A\u00a0&\u00a0B");
    doc.update("t2","C");doc.update("t3","Название");
    expect(doc.export()).toBe('<p> A&nbsp;&amp;&nbsp;B </p><p>A</p><p>C</p><svg><text x="10" y="20">Название</text></svg>');
    const preview=new DOMParser().parseFromString(doc.preview(),"text/html");
    expect(preview.querySelector("text")?.getAttribute("x")).toBe("10");
    expect(preview.querySelector("tspan")?.textContent).toBe("Название");
  });
});
