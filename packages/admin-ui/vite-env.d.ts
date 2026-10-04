/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RTC_AGENT_URL: string;
  readonly VITE_ADMIN_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
