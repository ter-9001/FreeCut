import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // Importante: Garanta que o Tailwind esteja aqui!

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);