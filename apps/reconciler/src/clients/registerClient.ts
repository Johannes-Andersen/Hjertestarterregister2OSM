import { HjertestarterregisterApiClient } from "@repo/hjertestarterregister-sdk";

export const registerClient = new HjertestarterregisterApiClient({
  clientId: process.env.HJERTESTARTERREGISTER_CLIENT_ID || "",
  clientSecret: process.env.HJERTESTARTERREGISTER_CLIENT_SECRET || "",
  baseUrl: process.env.HJERTESTARTERREGISTER_API_BASE_URL,
  oauthTokenUrl: process.env.HJERTESTARTERREGISTER_OAUTH_TOKEN_URL,
});
