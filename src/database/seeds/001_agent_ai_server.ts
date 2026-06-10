import { Knex } from "knex";
import crypto from "crypto";

export async function seed(knex: Knex): Promise<void> {
  // 1. Bersihkan tabel terlebih dahulu (opsional, hati-hati di production)
  // await knex('agent_capabilities').del();
  // await knex('agent_registry').del();

  const agentCode = "ai-server";

  // Cek apakah agent sudah ada
  const existingAgent = await knex('agent_registry').where('agent_code', agentCode).first();

  if (!existingAgent) {
    // 2. Masukkan data ke agent_registry
    await knex("agent_registry").insert([
      {
        id: crypto.randomUUID(),
        agent_code: agentCode,
        agent_name: "AI Server Monitor",
        endpoint: "http://mcp-monitoring:9003",
        description: "Agen AI yang bertugas memantau status server, CPU, memori, disk, docker, nginx, rabbitmq, dan log error sistem.",
        enabled: true,
      }
    ]);

    // 3. Masukkan kapabilitas (capabilities) agent tersebut ke agent_capabilities
    const capabilities = [
      "Informasi CPU dan Memory (RAM)",
      "Informasi Disk Usage",
      "Status Network",
      "Status dan List Docker Containers",
      "Status Database PostgreSQL",
      "Status RabbitMQ",
      "Status Web Server Nginx",
      "Membaca file log error server"
    ];

    const capabilitiesData = capabilities.map((cap) => ({
      id: crypto.randomUUID(),
      agent_code: agentCode,
      capability: cap,
    }));

    await knex("agent_capabilities").insert(capabilitiesData);
    
    console.log(`[SEEDER] Agent ${agentCode} berhasil dimasukkan!`);
  } else {
    console.log(`[SEEDER] Agent ${agentCode} sudah ada di database, skip seeding.`);
  }
}
