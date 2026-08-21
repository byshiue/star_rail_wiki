import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/wiki.css";
import "./styles/simulator.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到应用挂载节点");
}

createRoot(root).render(
  <StrictMode><App /></StrictMode>,
);
