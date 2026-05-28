import postgres from "postgres";
import { runtimeEnv } from "../config.ts";

export const sql = postgres(runtimeEnv.DATABASE_URL, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 20,
  prepare: false,
});
