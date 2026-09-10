import { type ExpoConfig } from 'expo/config';
import base from './app.json';

/**
 * app.json stays the readable source; this adds what must come from the
 * environment.
 */
const webBasePath = process.env.WEB_BASE_PATH?.replace(/\/$/, '') ?? '';

/**
 * Play rejects an upload whose versionCode it has seen before, so it cannot be
 * a constant in app.json. CI passes the run number; a local build keeps the
 * value in app.json, which is only ever used for sideloading.
 */
const versionCode = process.env['ANDROID_VERSION_CODE'];

const config: ExpoConfig = {
  ...base.expo,
  ...(webBasePath ? { experiments: { ...base.expo.experiments, baseUrl: webBasePath } } : {}),
  android: {
    ...base.expo.android,
    ...(versionCode ? { versionCode: Number.parseInt(versionCode, 10) } : {}),
  },
};
export default config;
