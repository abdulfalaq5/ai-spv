import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('wecom_chat_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    // WeCom sender_id
    table.string('user_id').notNullable();
    // WeCom open_kfid (customer service chat session)
    table.string('open_kfid').nullable();
    table.text('message').notNullable();
    table.text('response').nullable();
    // Intent detected (e.g., monitoring.enable, server.status, general)
    table.string('intent').nullable();
    table.integer('latency_ms').nullable();
    // 'success' | 'error' | 'rate_limited' | 'unauthorized'
    table.string('status').notNullable().defaultTo('success');
    // e.g., 'ai-server', 'ai-hr', monitoring.enable, etc.
    table.string('agent_used').nullable();
    table.string('error_message').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table.index('user_id');
    table.index('created_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wecom_chat_logs');
}
