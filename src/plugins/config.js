import dotenv from "dotenv";
dotenv.config();

const required = ["DATABASE_URL"];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`Missing required env ${k}`);
    process.exit(1);
  }
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
};
