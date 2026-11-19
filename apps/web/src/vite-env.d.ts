/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_KIOSK_DEVICE_ID?: string;
  readonly VITE_ACADEMY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
