import Pusher from 'pusher';
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

// $env/dynamic/private leaves out PUBLIC_ variables, so the key comes from
// the public env, which the browser uses too.
export const pusher = new Pusher({
  appId: env.HIBIRA_APP_ID,
  key: publicEnv.PUBLIC_HIBIRA_KEY,
  secret: env.HIBIRA_SECRET,
  host: env.HIBIRA_HOST ?? 'api.hibira.io',
  port: env.HIBIRA_PORT,
  useTLS: env.HIBIRA_TLS !== '0',
});
