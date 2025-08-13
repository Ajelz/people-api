export default function buildResolvers(db) {
  const baseSelect = `select * from person where id=$1`;
  const contactsOf = `select c.id, c.name, c.surname, c.email
                            from person_contacts pc join person c on c.id=pc.contact_id
                            where pc.person_id=$1 order by c.email asc`;

  // calculate whole-years age from date
  function computeAge(bday) {
    if (!bday) return null;
    const today = new Date();
    let years = today.getUTCFullYear() - bday.getUTCFullYear();
    const m = today.getUTCMonth() - bday.getUTCMonth();
    if (m < 0 || (m === 0 && today.getUTCDate() < bday.getUTCDate())) years--;
    return years >= 0 && years <= 150 ? years : null;
  }

  // Map of DB row
  const toDTO = (r, contacts = []) => {
    const birthdayDate = r.birthday instanceof Date ? r.birthday : null;
    return {
      id: r.id,
      name: r.name,
      surname: r.surname,
      age: computeAge(birthdayDate),
      gender: r.gender ?? null,
      birthday: birthdayDate ? birthdayDate.toISOString().slice(0, 10) : null,
      phone: r.phone ?? null,
      email: r.email,
      contacts,
      created: r.created_at.toISOString(),
      modified: r.updated_at.toISOString(),
    };
  };

  return {
    Query: {
      // get a single person with contacts
      person: async (_, { id }) => {
        const p = await db.query(baseSelect, [id]);
        if (!p.rowCount) return null;
        const c = await db.query(contactsOf, [id]);
        return toDTO(p.rows[0], c.rows);
      },

      // paginated list ordered by email asc
      people: async (_, { limit = 20, offset = 0 }) => {
        const page = await db.query(
          `select * from person order by email asc limit $1 offset $2`,
          [limit, offset]
        );
        const total = await db.query(
          `select count(*)::int as count from person`
        );
        return {
          total: total.rows[0].count,
          limit,
          offset,
          items: await Promise.all(
            page.rows.map(async (r) => {
              const c = await db.query(contactsOf, [r.id]);
              return toDTO(r, c.rows);
            })
          ),
        };
      },
    },

    Mutation: {
      // add person
      createPerson: async (_, { input }) => {
        const res = await db.query(
          `insert into person (name,surname,gender,birthday,phone,email)
                 values ($1,$2,$3,$4,$5,$6) returning *`,
          [
            input.name,
            input.surname,
            input.gender ?? null,
            input.birthday ?? null,
            input.phone ?? null,
            input.email,
          ]
        );
        const p = res.rows[0];

        if (input.contacts?.length) {
          await db.query(
            `insert into person_contacts (person_id,contact_id)
                                select $1, unnest($2::uuid[])`,
            [p.id, input.contacts]
          );
        }

        const c = await db.query(contactsOf, [p.id]);
        return toDTO(p, c.rows);
      },

      // Partial update
      updatePerson: async (_, { id, input }) => {
        const fields = [
          "name",
          "surname",
          "gender",
          "birthday",
          "phone",
          "email",
        ];
        const updates = [];
        const vals = [];

        // dynamic SET clause
        for (const f of fields) {
          if (f in input) {
            updates.push(`${f}=$${updates.length + 1}`);
            vals.push(input[f] ?? null);
          }
        }

        if (updates.length) {
          await db.query(
            `update person set ${updates.join(
              ", "
            )}, updated_at=now() where id=$${vals.length + 1}`,
            [...vals, id]
          );
        }

        // replace contacts if the key is present
        if ("contacts" in input) {
          await db.query(`delete from person_contacts where person_id=$1`, [
            id,
          ]);
          if (input.contacts?.length) {
            await db.query(
              `insert into person_contacts (person_id,contact_id)
                                  select $1, unnest($2::uuid[])`,
              [id, input.contacts]
            );
          }
        }

        const p = await db.query(baseSelect, [id]);
        if (!p.rowCount) throw new Error("not found");

        const c = await db.query(contactsOf, [id]);
        return toDTO(p.rows[0], c.rows);
      },

      // delete by id
      deletePerson: async (_, { id }) => {
        const d = await db.query(`delete from person where id=$1`, [id]);
        return d.rowCount > 0;
      },
    },
  };
}
