export const SERVICE_INFO = Symbol('SERVICE_INFO');
export const LOGGER = Symbol('LOGGER');
export const METRICS = Symbol('METRICS');
export const CONFIG = Symbol('CONFIG');

export interface ServiceInfo {
  name: string;
  version: string;
  startedAt: Date;
}
