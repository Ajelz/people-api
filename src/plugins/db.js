import pg from "pg";
import fp from "fastify-plugin";
import { config } from "./config.js";

async function dbPlugin(fastify) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

  fastify.decorate("db", {
    async query(text, params) {
      return pool.query(text, params);
    },
    async withClient(fn) {
      const client = await pool.connect();
      try {
        return await fn(client);
      } finally {
        client.release();
      }
    },
  });

  fastify.addHook("onClose", async () => {
    await pool.end();
  });
}

export default fp(dbPlugin, {
  name: "db",
});
