import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Monitoring rules configured by WeCom users
  await knex.schema.createTable('wecom_monitoring_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    // WeCom sender_id yang mengaktifkan monitoring
    table.string('user_id').notNullable();
    // WeCom chat session untuk pengiriman notifikasi (nullable jika bukan mode KF)
    table.string('open_kfid').nullable();
    // Email linked dari user_access (nullable: user mungkin belum login email)
    table.string('email').nullable();
    // Metric yang dipantau: cpu | ram | disk
    table.string('metric').notNullable();
    // Threshold (persentase), e.g. 70.0
    table.decimal('threshold', 5, 2).notNullable();
    // Cooldown antar alert (menit)
    table.integer('cooldown_minutes').notNullable().defaultTo(10);
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamps(true, true);

    table.index('user_id');
    table.index('enabled');
    table.index(['user_id', 'enabled']);
  });

  // Alert history untuk audit dan debugging
  await knex.schema.createTable('wecom_alert_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table
      .uuid('rule_id')
      .notNullable()
      .references('id')
      .inTable('wecom_monitoring_rules')
      .onDelete('CASCADE');
    table.string('metric').notNullable();
    table.decimal('value', 6, 2).notNullable();
    table.text('message').nullable();
    table.timestamp('sent_at').notNullable().defaultTo(knex.fn.now());

    table.index('rule_id');
    table.index('sent_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wecom_alert_logs');
  await knex.schema.dropTableIfExists('wecom_monitoring_rules');
}
