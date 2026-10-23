import { Buffer } from "buffer";
import process from "process";

// near-api-js / wallet-selector expect Node globals in the browser
;(window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
;(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
;(window as unknown as { process: typeof process }).process = process;
;(globalThis as unknown as { process: typeof process }).process = process;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "@near-wallet-selector/modal-ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
