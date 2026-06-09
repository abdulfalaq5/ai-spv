import { Knex } from 'knex';

export async function seed(knex: Knex): Promise<void> {
  // Deletes ALL existing entries
  await knex('user_access').del();

  // Inserts seed entries
  await knex('user_access').insert([
    {
      email: 'devops@mail.com',
      access_rights: JSON.stringify(['ai-server'])
    },
    {
      email: 'hr@mail.com',
      access_rights: JSON.stringify(['ai-hr'])
    },
    {
      email: 'ceo@mail.com',
      access_rights: JSON.stringify(['ai-server', 'ai-hr'])
    },
    {
      email: 'admin@mail.com',
      access_rights: JSON.stringify(['*']) // '*' means access to everything
    }
  ]);
}
