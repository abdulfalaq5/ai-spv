import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agent_capabilities', (table) => {
    table.uuid('id').primary();
    table.string('agent_code', 50).notNullable();
    table.string('capability', 100).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('agent_capabilities');
}
