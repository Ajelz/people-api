import Fastify from "fastify";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import caching from "./plugins/caching.js";
import dbPlugin from "./plugins/db.js";
import { config } from "./plugins/config.js";
import peopleRoutes from "./routes/people.js";
import mercurius from "mercurius";
import { typeDefs } from "./graphql/schema.js";
import buildResolvers from "./graphql/resolvers.js";

const pretty = process.env.PRETTY_LOGS === "true";

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    transport: pretty ? { target: "pino-pretty" } : undefined,
  },
  requestTimeout: 15000,
  bodyLimit: 1048576,
});

await fastify.register(sensible);
await fastify.register(cors, { origin: true });
await fastify.register(dbPlugin);
await fastify.register(caching);

// REST
await fastify.register(peopleRoutes);

// Health
fastify.get("/health", async () => ({ status: "ok" }));

// GraphQL
await fastify.register(mercurius, {
  schema: typeDefs,
  resolvers: buildResolvers(fastify.db),
  graphiql: process.env.NODE_ENV !== "production",
});

fastify.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  fastify.log.error(err);
  process.exit(1);
});
