import postgres from "postgres";

export const createSql = (connectionString: string) => {
  return postgres(connectionString, {
    max: 5,
    fetch_types: false,
    prepare: false,
  });
};
