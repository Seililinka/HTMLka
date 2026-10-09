import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { HtmlTextDocument } from "./HtmlTextDocument";
import { ChartEditor } from "../components/ChartEditor";
import { sampleDocument } from "./sampleDocument";

describe("Chart editor interaction",()=>{
  afterEach(()=>cleanup());
  it("commits a typed value on blur and updates the actual exported graphic",()=>{
    const model=new HtmlTextDocument(sampleDocument);
    expect(model.charts.items.length).toBe(1);
    const changed=vi.fn();
    const view=render(React.createElement(ChartEditor,{model,selectedId:"c0",onSelect:()=>{},onChange:changed}));
    const input=view.getByLabelText("Значение: Сбор данных") as HTMLInputElement;
    fireEvent.change(input,{target:{value:"80"}});
    expect(model.charts.items[0].points[0].value).toBe(65);
    fireEvent.blur(input);
    expect(model.charts.items[0].points[0].value).toBe(80);
    expect(model.export()).toContain("width:80%");
    expect(model.export()).toContain("<strong>80%</strong>");
    expect(changed).toHaveBeenCalled();
  });
  it("keeps the old values when an input is invalid",()=>{
    const model=new HtmlTextDocument(sampleDocument);
    const view=render(React.createElement(ChartEditor,{model,selectedId:"c0",onSelect:()=>{},onChange:()=>{}}));
    const input=view.getByLabelText("Значение: Сбор данных") as HTMLInputElement;
    fireEvent.change(input,{target:{value:"текст"}});
    fireEvent.blur(input);
    expect(model.charts.items[0].points[0].value).toBe(65);
    expect(view.getByText("Введите число")).toBeDefined();
  });
});
