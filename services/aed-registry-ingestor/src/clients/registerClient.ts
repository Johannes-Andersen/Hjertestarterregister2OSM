import { HjertestarterregisterApiClient } from "@repo/hjertestarterregister-sdk";
import { runtimeEnv } from "../config.ts";

export const registerClient = new HjertestarterregisterApiClient({
  clientId: runtimeEnv.HJERTESTARTERREGISTER_CLIENT_ID,
  clientSecret: runtimeEnv.HJERTESTARTERREGISTER_CLIENT_SECRET,
  baseUrl: runtimeEnv.HJERTESTARTERREGISTER_API_BASE_URL,
  oauthTokenUrl: runtimeEnv.HJERTESTARTERREGISTER_OAUTH_TOKEN_URL,
});
