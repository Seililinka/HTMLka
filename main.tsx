import React from "react";
import { createRoot } from "react-dom/client";
import EditorPage from "./pages/_index";
import "./base.css";
import "./reset.css";

createRoot(document.getElementById("root")!).render(<EditorPage />);

