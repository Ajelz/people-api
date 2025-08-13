create extension if not exists "uuid-ossp";

create table if not exists person (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  surname text not null,
  age int check (age is null or age between 0 and 150),
  gender text check (gender in ('male','female')),
  birthday date,
  phone text,
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists person_contacts (
  person_id uuid not null references person(id) on delete cascade,
  contact_id uuid not null references person(id) on delete cascade,
  primary key (person_id, contact_id),
  check (person_id <> contact_id)
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_person_updated on person;
create trigger trg_person_updated
before update on person
for each row execute function set_updated_at();
