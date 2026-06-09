import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create user_access table
  await knex.schema.createTable('user_access', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('email').notNullable().unique();
    table.jsonb('access_rights').notNullable().defaultTo('[]');
    table.timestamps(true, true);
  });

  // Create user_sessions table
  await knex.schema.createTable('user_sessions', (table) => {
    table.string('session_id').primary();
    table.string('email').notNullable().references('email').inTable('user_access').onDelete('CASCADE');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_sessions');
  await knex.schema.dropTableIfExists('user_access');
}
