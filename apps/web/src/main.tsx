import { StrictMode } from "react";

import "./styles/tokens.css";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import { SessionProvider } from "./auth/session";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html is missing #root.");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
