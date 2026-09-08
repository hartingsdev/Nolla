import { type ExpoConfig } from 'expo/config';
import base from './app.json';

/**
 * app.json stays the readable source; this adds what must come from the
 * environment: the web base path (GitHub Pages serves the site under /<repo>/).
 */
const webBasePath = process.env.WEB_BASE_PATH?.replace(/\/$/, '') ?? '';

const config: ExpoConfig = {
  ...base.expo,
  ...(webBasePath ? { experiments: { ...base.expo.experiments, baseUrl: webBasePath } } : {}),
};
export default config;
