// Versões lidas da fonte, nunca escritas à mão:
//   app de desktop: a do executável em uso (tauri.conf.json, que o GitHub Actions
//                   numera a cada release)
//   site:           o commit que o Vercel publicou (vite.config.js, no build)
import { isDesktop } from "./desktop.js";

/* global __SITE_COMMIT__ */
export const SITE_COMMIT = __SITE_COMMIT__;

export async function getAppVersion() {
  if (!isDesktop) return null;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}
