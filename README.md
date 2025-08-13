# People API

## Overview
Production-ready People API implementing CRUD over a `person` entity with PostgreSQL, Fastify, and Node.js **22.18.0** 
- includes both REST **and** (bonus) GraphQL endpoints  
- JSON I/O, public (no auth), pagination ordered by `email`  
- Contacts are real references to other people (updates propagate)  
- Caching via ETags, structured logging, environment-based config & health check

## Tech stack
- Node.js **22.18.0** (LTS)
- Fastify 5 + Pino
- PostgreSQL 16
- `@fastify/sensible`, `@fastify/caching`, `@fastify/cors`
- Mercurius (GraphQL)
- Docker & docker-compose

## Run it (Docker)
```bash
# 1) Start Postgres + API
docker compose up --build -d

# 2) Health check
curl -s http://localhost:3000/health | jq .
```

To stop:
```bash
docker compose down
```

## Run it (local, without Docker)
Prereqs: Postgres running and a database URL

```bash
# 0) Copy env and adjust if needed
cp .env.example .env
# make sure DATABASE_URL points to your Postgres

# 1) Install deps
npm ci

# 2) Run migration
npm run migrate

# 3) Start dev
npm run dev
# or
npm run start 
```

## Configuration
`.env`:
```
DATABASE_URL=postgres://postgres:postgres@db:5432/people
PORT=3000
```

## Data model
- Table `person` with `id (uuid)`, `name`, `surname`, `gender ('male'|'female')`, `birthday (date)`, `phone`, `email (unique)`, timestamps 
- Table `person_contacts(person_id, contact_id)` referencing `person(id)`; `ON DELETE CASCADE`; `person_id <> contact_id`

**Age**: not stored; **derived from `birthday`** in responses (to keep accurate)

## REST API

Base URL: `http://localhost:3000`

### Create person
`POST /people`  
Body (JSON):
```json
{
  "name": "Alice", // required
  "surname": "Anderson", // required
  "gender": "female",
  "birthday": "1997-02-14",
  "phone": "+1-555-123-4567", 
  "email": "alice.anderson@example.com", // required
  "contacts": ["<uuid-of-existing-person>", ".."]
}
```

**cURL**
```bash
curl -s -X POST http://localhost:3000/people \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice","surname":"Anderson","gender":"female","birthday":"1997-02-14","phone":"+1-555-123-4567","email":"alice.anderson@example.com","contacts":[]}' | jq .
```

### Get person
`GET /people/:id`  
Returns person with **contacts** (each contact: `id,name,surname,email`) and the derived `age` from `birthday (date)`

**cURL**
```bash
ID='<person-id>'
curl -i -s http://localhost:3000/people/$ID
curl -s  http://localhost:3000/people/$ID | jq .
```

### Update person (partial)
`PATCH /people/:id`  
Any subset of: `name, surname, gender, birthday, phone, email, contacts`  
- `contacts` replaces the entire set (idempotent)
- `age` is **not** accepted (derived)

**cURL**
```bash
ID='<person-id>'
curl -s -X PATCH http://localhost:3000/people/$ID \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+1-555-000-0000"}' | jq .
```

### Delete person
`DELETE /people/:id`

**cURL**
```bash
ID='<person-id>'
curl -i -s -X DELETE http://localhost:3000/people/$ID
```

### List people (paginated & ordered by email ASC)
`GET /people?limit=<1..100>&offset=<0..>`

**cURL**
```bash
curl -s "http://localhost:3000/people?limit=5&offset=0" | jq .
```

### Errors
- `400` invalid body / bad contact IDs
- `404` not found
- `409` duplicate email

## GraphQL (BONUS)

- Endpoint: `POST /graphql`  

### Query: person by ID
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"query($id:ID!){ person(id:$id){ id name surname age email contacts{ id name email } created modified } }","variables":{"id":"<person-id>"}}' | jq .
```

### Query: paginated people
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ people(limit:5, offset:0){ total limit offset items{ id name surname email age contacts{ id name email } } } }"}' | jq .
```

### Mutation: create person
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation($in:PersonInput!){ createPerson(input:$in){ id name surname email age } }","variables":{"in":{"name":"Bob","surname":"Brown","gender":"male","email":"bob.brown@example.com"}}}' | jq .
```

### Mutation: update person
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation($id:ID!,$in:PersonInput!){ updatePerson(id:$id,input:$in){ id phone } }","variables":{"id":"<person-id>","in":{"phone":"+1-555-222-3333"}}}' | jq .
```

### Mutation: delete person
```bash
curl -s -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation($id:ID!){ deletePerson(id:$id) }","variables":{"id":"<person-id>"}}' | jq .
```

## Implementation notes (how this meets the brief)
- **Contacts reference**: `person_contacts` references `person(id)`; reads always join back to `person`, so updates to people reflect instantly in any contacts list
- **Ordering & pagination**: SQL `ORDER BY email ASC` with `LIMIT/OFFSET`; `total` included for easy paging
- **Caching**: `@fastify/caching` (ETag / 304) + explicit ETags for list & item GET responses
- **Stability**: transactional create/update; email uniqueness; input validation via JSON schema; request timeout/body limit
- **Observability**: Pino logs; health check at `/health`
- **Runtime**: Dockerfile uses Node 22.18.0 LTS
- **Sync**: GraphQL & REST are synced

## Demo: seed & exercise the API (macOS / Linux)
> Requires `jq`. `BASE` defaults to `http://localhost:3000`.

### 1) Create five people (A, B, C, D, E)

```bash
BASE=${BASE:-http://localhost:3000}

A_ID=$(curl -sS -X POST "$BASE/people" -H 'Content-Type: application/json' \
  -d '{"name":"Alice","surname":"Anderson","gender":"female","birthday":"1997-02-14","phone":"+111","email":"alice@example.com","contacts":[]}' | jq -r .id)

B_ID=$(curl -sS -X POST "$BASE/people" -H 'Content-Type: application/json' \
  -d '{"name":"Bob","surname":"Brown","gender":"male","birthday":"1990-01-01","phone":"+222","email":"bob@example.com","contacts":[]}' | jq -r .id)

C_ID=$(curl -sS -X POST "$BASE/people" -H 'Content-Type: application/json' \
  -d '{"name":"Carol","surname":"Clark","gender":"female","birthday":"1991-06-06","phone":"+333","email":"carol@example.com","contacts":[]}' | jq -r .id)

D_ID=$(curl -sS -X POST "$BASE/people" -H 'Content-Type: application/json' \
  -d '{"name":"Dan","surname":"Doe","gender":"male","birthday":"1992-03-03","phone":"+444","email":"dan@example.com","contacts":[]}' | jq -r .id)

E_ID=$(curl -sS -X POST "$BASE/people" -H 'Content-Type: application/json' \
  -d '{"name":"Eve","surname":"Evans","gender":"female","birthday":"1993-04-04","phone":"+555","email":"eve@example.com","contacts":[]}' | jq -r .id)

echo "A_ID=$A_ID  B_ID=$B_ID  C_ID=$C_ID  D_ID=$D_ID  E_ID=$E_ID"
```

### 2) List all users

```bash
curl -sS "$BASE/people?limit=100&offset=0" | jq .
```

### 3) Set Alice’s contacts to Bob & Carol

```bash
curl -sS -X PATCH "$BASE/people/$A_ID" -H 'Content-Type: application/json' \
  -d "{\"contacts\":[\"$B_ID\",\"$C_ID\"]}" | jq '.contacts'
```

### 4) Get Alice (shows derived `age` + live `contacts`)

```bash
curl -sS "$BASE/people/$A_ID" | jq .
```

### 5) Update Bob’s name

```bash
curl -sS -X PATCH "$BASE/people/$B_ID" -H 'Content-Type: application/json' \
  -d '{"name":"Robert"}' | jq '.id,.name'
```

### 6) Get Alice again to confirm Bob’s new name appears in her contacts

```bash
curl -sS "$BASE/people/$A_ID" | jq --arg id "$B_ID" '.contacts[] | select(.id==$id)'
```

### 7) List (ordered by `email` ASC)

```bash
curl -sS "$BASE/people?limit=10&offset=0" | jq '.items[].email'
```

### 8) Delete Dan

```bash
curl -i -sS -X DELETE "$BASE/people/$D_ID" | head -n 1
```

> **Note:** If you re-run the create step without resetting the DB, you’ll get `409 Conflict` because emails are unique. Reset or delete the created records before re-running.

## Bonus: GraphQL quick demo (macOS / Linux)

> Requires `jq`. Assumes `A_ID`, `B_ID`, `C_ID`, `D_ID`, `E_ID` are set from the REST demo above.  
> Endpoint: `POST $BASE/graphql` (defaults to `http://localhost:3000/graphql`).

```bash
BASE_GRAPHQL=${BASE_GRAPHQL:-${BASE:-http://localhost:3000}/graphql}
```

### 1) Query Alice by ID
```bash
curl -sS -X POST "$BASE_GRAPHQL" -H 'Content-Type: application/json' -d @- <<JSON | jq .
{"query":"{ person(id:\"$A_ID\"){ id name surname email age contacts{ id name email } created modified } }"}
JSON
```

### 2) Set Alice’s contacts to Bob + Carol
```bash
curl -sS -X POST "$BASE_GRAPHQL" -H 'Content-Type: application/json' -d @- <<JSON | jq .
{"query":"mutation { updatePerson(id:\"$A_ID\", input:{ contacts:[\"$B_ID\",\"$C_ID\"] }) { id contacts{ id name email } } }"}
JSON
```

### 3) Update Bob’s name
```bash
curl -sS -X POST "$BASE_GRAPHQL" -H 'Content-Type: application/json' -d @- <<JSON | jq .
{"query":"mutation { updatePerson(id:\"$B_ID\", input:{ name:\"Robert\" }) { id name } }"}
JSON
```

### 4) Confirm Alice shows Bob as “Robert”
```bash
curl -sS -X POST "$BASE_GRAPHQL" -H 'Content-Type: application/json' -d @- <<JSON | jq --arg id "$B_ID" '.data.person.contacts[] | select(.id==$id)'
{"query":"{ person(id:\"$A_ID\"){ contacts{ id name email } } }"}
JSON
```

### 5) List (ordered by email ASC)
```bash
curl -sS -X POST "$BASE_GRAPHQL" -H 'Content-Type: application/json' -d @- <<'JSON' | jq '.data.people.items[].email'
{"query":"{ people(limit:10, offset:0){ items{ email } } }"}
JSON
```

### 6) Delete Dan
```bash
curl -sS -X POST "$BASE_GRAPHQL" -H 'Content-Type: application/json' -d @- <<JSON | jq .
{"query":"mutation { deletePerson(id:\"$D_ID\") }"}
JSON
```