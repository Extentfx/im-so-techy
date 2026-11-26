import { call } from './api';

export interface Device {
  entityId: string;
  name: string;
  domain: string;
  sensitive: boolean;
  state: string | null;
  actions: string[];
}
export interface Entity {
  entityId: string;
  name: string;
  domain: string;
  sensitive: boolean;
  allowlisted: boolean;
}
export interface Scene {
  id: string;
  name: string;
  steps: { entityId: string; action: string; value?: number }[];
  routine: 'wind-down' | 'wake' | null;
  routineEnabled: boolean;
}
export interface ActResponse {
  ok?: true;
  needsConfirm?: true;
  token?: string;
  message?: string;
}

export const homeConfig = () =>
  call<{ configured: boolean; host: string | null }>('GET', '/api/home/config');
export const connectHome = (url: string, token: string) =>
  call<{ configured: boolean; host: string }>('PUT', '/api/home/config', { url, token });
export const disconnectHome = () => call<{ ok: true }>('DELETE', '/api/home/config');
export const getDevices = () =>
  call<{ devices: Device[] }>('GET', '/api/home/devices').then((r) => r.devices ?? []);
export const getEntities = () =>
  call<{ entities: Entity[] }>('GET', '/api/home/entities').then((r) => r.entities ?? []);
export const allowDevice = (entityId: string, name: string) =>
  call<{ ok: true }>('POST', '/api/home/devices', { entityId, name });
export const removeDevice = (entityId: string) =>
  call<{ ok: true }>('DELETE', `/api/home/devices/${entityId}`);
export const actOnDevice = (b: {
  entityId: string;
  action: string;
  value?: number;
  confirmToken?: string;
}) => call<ActResponse>('POST', '/api/home/act', b);
export const getScenes = () =>
  call<{ scenes: Scene[] }>('GET', '/api/home/scenes').then((r) => r.scenes ?? []);
export const createScene = (b: {
  name: string;
  routine: 'wind-down' | 'wake' | null;
  steps: { entityId: string; action: string }[];
}) => call<{ id: string }>('POST', '/api/home/scenes', b);
export const runScene = (id: string) =>
  call<{ ran: number; failed: string[] }>('POST', `/api/home/scenes/${id}/run`);
export const setRoutine = (id: string, enabled: boolean) =>
  call<{ ok: true }>('POST', `/api/home/scenes/${id}/routine`, { enabled });
export const deleteScene = (id: string) => call<{ ok: true }>('DELETE', `/api/home/scenes/${id}`);
