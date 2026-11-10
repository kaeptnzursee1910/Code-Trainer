// Web Worker für WebLLM: das Sprachmodell rechnet hier auf der Grafikeinheit (WebGPU),
// ohne die Oberfläche zu blockieren.
import { WebWorkerMLCEngineHandler } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
