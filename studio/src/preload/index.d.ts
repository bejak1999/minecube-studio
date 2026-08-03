import type { MinecubeApi } from './index';

declare global {
  interface Window {
    minecube: MinecubeApi;
  }
}

export {};
