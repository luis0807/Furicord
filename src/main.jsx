import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { applyTheme, loadTheme } from "./lib/theme.js";
import "./index.css";
import "./personalization.css";

// Antes do primeiro desenho, para não piscar o tema padrão.
applyTheme(loadTheme());

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
