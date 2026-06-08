import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agent_registry', (table) => {
    table.uuid('id').primary();
    table.string('agent_code', 50).unique().notNullable();
    table.string('agent_name', 100).notNullable();
    table.string('endpoint', 255).notNullable();
    table.text('description');
    table.boolean('enabled').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('agent_registry');
}
