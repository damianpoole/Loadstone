import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI, DesktopSnapshot } from "@loadstone/application";
import { channels } from "./protocol";

const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke(channels.snapshot),
  request: (request) => ipcRenderer.invoke(channels.request, request),
  subscribe(listener) {
    const handler = (_event: unknown, state: DesktopSnapshot) => listener(state);
    ipcRenderer.on(channels.changed, handler);
    return () => ipcRenderer.removeListener(channels.changed, handler);
  },
};
contextBridge.exposeInMainWorld("loadstone", api);
