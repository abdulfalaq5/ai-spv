import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('telegram_users', (table) => {
    table.bigInteger('telegram_user_id').primary();
    table
      .string('email')
      .nullable()
      .references('email')
      .inTable('user_access')
      .onDelete('SET NULL');
    table.string('username').nullable();
    table.string('display_name').nullable();
    table.boolean('is_blocked').notNullable().defaultTo(false);
    table.timestamp('last_seen_at').nullable();
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('telegram_users');
}
