// Section Map
// - Imports and dependencies
// - Constants/configuration
// - Helper functions/state handling
// - Main module logic and exports

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles-whatsapp.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  const publicUrl = process.env.PUBLIC_URL || "";
  const swUrl = `${publicUrl}/sw.js`;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Service worker registration failures should not break app boot.
    });
  });
}

