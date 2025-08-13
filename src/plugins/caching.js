import fastifyCaching from "@fastify/caching";

export default async function cachingPlugin(fastify) {
  // add reply.etag(), handles If-None-Match, plugin should autosend 304
  await fastify.register(fastifyCaching, {
    privacy: "public",
  });

  // uniform cache headers for Gets
  fastify.addHook("onSend", async (req, reply, payload) => {
    reply.header("Cache-Control", "public, max-age=60");
    return payload;
  });
}
