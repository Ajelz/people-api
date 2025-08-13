const personSchema = {
  // Body schema
  type: "object",
  required: ["name", "surname", "email"],
  additionalProperties: false, // rejects unknwon fields
  properties: {
    name: { type: "string", minLength: 1 },
    surname: { type: "string", minLength: 1 },
    gender: {
      anyOf: [{ type: "string", enum: ["male", "female"] }, { type: "null" }],
    },
    birthday: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
    },
    phone: {
      anyOf: [{ type: "string" }, { type: "null" }],
    },
    email: { type: "string", format: "email" },
    contacts: {
      anyOf: [
        {
          type: "array",
          items: { type: "string", format: "uuid" },
          uniqueItems: true,
        },
        { type: "null" },
      ],
    },
  },
};

const idParam = {
  // path param validator for /people/:id
  params: {
    type: "object",
    properties: { id: { type: "string", format: "uuid" } },
    required: ["id"],
  },
};

// helper to derive age from js date
function computeAge(bday) {
  if (!bday) return null;
  const today = new Date();
  let years = today.getUTCFullYear() - bday.getUTCFullYear();
  const m = today.getUTCMonth() - bday.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < bday.getUTCDate())) years--;
  return years >= 0 && years <= 150 ? years : null;
}

export default async function peopleRoutes(fastify) {
  const { db } = fastify;

  // Map DB row
  const toDTO = (row, contacts = []) => {
    const birthdayDate = row.birthday instanceof Date ? row.birthday : null;
    return {
      id: row.id,
      name: row.name,
      surname: row.surname,
      age: computeAge(birthdayDate),
      gender: row.gender ?? null,
      birthday: birthdayDate ? birthdayDate.toISOString().slice(0, 10) : null,
      phone: row.phone ?? null,
      email: row.email,
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        surname: c.surname,
        email: c.email,
      })),
      created: row.created_at.toISOString(),
      modified: row.updated_at.toISOString(),
    };
  };

  // Create person 
  fastify.post(
    "/people",
    { schema: { body: personSchema } },
    async (req, reply) => {
      const b = req.body;
      return await db.withClient(async (client) => {
        try {
          await client.query("begin");

          const ins = await client.query(
            `insert into person (name,surname,gender,birthday,phone,email)
                   values ($1,$2,$3,$4,$5,$6) returning *`,
            [
              b.name,
              b.surname,
              b.gender ?? null,
              b.birthday ?? null,
              b.phone ?? null,
              b.email,
            ]
          );
          const p = ins.rows[0];

          // Attach contacts
          if (Array.isArray(b.contacts) && b.contacts.length) {
            const existing = await client.query(
              `select id from person where id = any($1::uuid[])`,
              [b.contacts]
            );
            if (existing.rowCount !== b.contacts.length) {
              throw fastify.httpErrors.badRequest(
                "One or more contact IDs do not exist"
              );
            }
            await client.query(
              `insert into person_contacts (person_id, contact_id)
                     select $1, unnest($2::uuid[])`,
              [p.id, b.contacts]
            );
          }

          const contacts = await client.query(
            `select c.id, c.name, c.surname, c.email
                   from person_contacts pc
                   join person c on c.id = pc.contact_id
                   where pc.person_id = $1
                   order by c.email asc`,
            [p.id]
          );

          await client.query("commit");
          reply.code(201);
          return toDTO(p, contacts.rows);
        } catch (e) {
          await client.query("rollback");
          if (e?.code === "23505")
            throw fastify.httpErrors.conflict("Email already exists");
          throw e;
        }
      });
    }
  );

  // Read person by id
  fastify.get("/people/:id", { schema: idParam }, async (req, reply) => {
    const { id } = req.params;
    const person = await db.query(`select * from person where id=$1`, [id]);
    if (!person.rowCount) throw fastify.httpErrors.notFound();

    const contacts = await db.query(
      `select c.id, c.name, c.surname, c.email
             from person_contacts pc
             join person c on c.id = pc.contact_id
             where pc.person_id = $1
             order by c.email asc`,
      [id]
    );

    const dto = toDTO(person.rows[0], contacts.rows);
    const etag = `"${person.rows[0].updated_at.getTime()}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    reply.header("ETag", etag);
    return dto;
  });

  // Partial PATCH update
  fastify.patch(
    "/people/:id",
    { schema: { ...idParam, body: { ...personSchema, required: [] } } },
    async (req, reply) => {
      const { id } = req.params;
      const b = req.body;

      return await db.withClient(async (client) => {
        try {
          await client.query("begin");

          const existing = await client.query(
            `select * from person where id=$1`,
            [id]
          );
          if (!existing.rowCount) throw fastify.httpErrors.notFound();

          // can only update these fields
          const fields = [
            "name",
            "surname",
            "gender",
            "birthday",
            "phone",
            "email",
          ];
          const updates = [];
          const values = [];
          fields.forEach((f) => {
            if (f in b) {
              updates.push(`${f}=$${updates.length + 1}`);
              values.push(b[f] ?? null);
            }
          });
          // Apply partial update
          if (updates.length) {
            values.push(id);
            await client.query(
              `update person set ${updates.join(
                ", "
              )}, updated_at=now() where id=$${values.length}`,
              values
            );
          }

          // Replace contacts set if key is present
          if ("contacts" in b) {
            await client.query(
              `delete from person_contacts where person_id=$1`,
              [id]
            );
            if (Array.isArray(b.contacts) && b.contacts.length) {
              const check = await client.query(
                `select id from person where id = any($1::uuid[])`,
                [b.contacts]
              );
              if (check.rowCount !== b.contacts.length)
                throw fastify.httpErrors.badRequest(
                  "One or more contact IDs do not exist"
                );
              await client.query(
                `insert into person_contacts (person_id, contact_id)
                       select $1, unnest($2::uuid[])`,
                [id, b.contacts]
              );
            }
          }

          const p = await client.query(`select * from person where id=$1`, [
            id,
          ]);
          const contacts = await client.query(
            `select c.id, c.name, c.surname, c.email
                   from person_contacts pc
                   join person c on c.id = pc.contact_id
                   where pc.person_id = $1
                   order by c.email asc`,
            [id]
          );

          await client.query("commit");
          return toDTO(p.rows[0], contacts.rows);
        } catch (e) {
          await client.query("rollback");
          if (e?.code === "23505")
            throw fastify.httpErrors.conflict("Email already exists");
          throw e;
        }
      });
    }
  );

  // Delete person by id (204)
  fastify.delete("/people/:id", { schema: idParam }, async (req, reply) => {
    const { id } = req.params;
    const del = await db.query(`delete from person where id=$1`, [id]);
    if (!del.rowCount) throw fastify.httpErrors.notFound();
    reply.code(204).send();
  });

  // List people - pagination, ordered by email ASC
  fastify.get(
    "/people",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      const limit = req.query.limit ?? 20;
      const offset = req.query.offset ?? 0;

      const page = await db.query(
        `select * from person order by email asc limit $1 offset $2`,
        [limit, offset]
      );
      const total = await db.query(
        `select count(*)::int as count, max(updated_at) as maxu from person`
      );

      // create ETAG (paging inputs + max updated_at)
      const tagSeed = {
        limit,
        offset,
        total: total.rows[0].count,
        maxu: total.rows[0].maxu ? new Date(total.rows[0].maxu).getTime() : 0,
      };
      const etag = `"list-${tagSeed.limit}-${tagSeed.offset}-${tagSeed.total}-${tagSeed.maxu}"`;
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      reply.header("ETag", etag);

      const items = page.rows.map((r) => {
        const birthdayDate = r.birthday instanceof Date ? r.birthday : null;
        return {
          id: r.id,
          name: r.name,
          surname: r.surname,
          age: computeAge(birthdayDate),
          gender: r.gender ?? null,
          birthday: birthdayDate
            ? birthdayDate.toISOString().slice(0, 10)
            : null,
          phone: r.phone ?? null,
          email: r.email,
          created: r.created_at.toISOString(),
          modified: r.updated_at.toISOString(),
        };
      });

      return { total: total.rows[0].count, limit, offset, items };
    }
  );
}
