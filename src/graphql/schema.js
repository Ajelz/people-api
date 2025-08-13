export const typeDefs = `
  type Person {
    id: ID!
    name: String!
    surname: String!
    age: Int
    gender: String
    birthday: String
    phone: String
    email: String!
    contacts: [Person!]!
    created: String!
    modified: String!
  }

  type PeoplePage {
    total: Int!
    limit: Int!
    offset: Int!
    items: [Person!]!
  }

  type Query {
    person(id: ID!): Person
    people(limit: Int = 20, offset: Int = 0): PeoplePage!
  }

  # Removed 'age' from input; it's derived from birthday
  input PersonInput {
    name: String
    surname: String
    gender: String
    birthday: String
    phone: String
    email: String
    contacts: [ID!]
  }

  type Mutation {
    createPerson(input: PersonInput!): Person!
    updatePerson(id: ID!, input: PersonInput!): Person!
    deletePerson(id: ID!): Boolean!
  }
`;
