import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('telegram_chat_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.bigInteger('chat_id').notNullable();
    table.bigInteger('user_id').notNullable();
    table.string('username').nullable();
    table.text('message').notNullable();
    table.text('response').nullable();
    table.integer('latency_ms').nullable();
    // 'success' | 'error' | 'rate_limited' | 'unauthorized'
    table.string('status').notNullable().defaultTo('success');
    // e.g., 'ai-server', 'ai-hr', 'ai-crm', 'llm', null
    table.string('agent_used').nullable();
    table.string('error_message').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('chat_id');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('telegram_chat_logs');
}
