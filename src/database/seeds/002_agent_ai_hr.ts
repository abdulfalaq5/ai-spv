import { Knex } from "knex";
import crypto from "crypto";

export async function seed(knex: Knex): Promise<void> {
  const agentCode = "ai-hr";

  // Cek apakah agent sudah ada
  const existingAgent = await knex('agent_registry').where('agent_code', agentCode).first();

  if (!existingAgent) {
    // 1. Masukkan data ke agent_registry
    await knex("agent_registry").insert([
      {
        id: crypto.randomUUID(),
        agent_code: agentCode,
        agent_name: "AI HR Assistant",
        endpoint: "http://ai-hr:3000",
        description: "Agen AI yang bertugas mengelola data karyawan, absensi, cuti, payroll, dan kebijakan perusahaan.",
        enabled: true,
      }
    ]);

    // 2. Masukkan kapabilitas (capabilities) agent tersebut ke agent_capabilities
    const capabilities = [
      "Informasi Peraturan Perusahaan",
      "Informasi Data Karyawan",
      "Informasi Sisa Cuti dan Pengajuan Cuti",
      "Data Kehadiran dan Absensi",
      "Informasi Gaji dan Payroll",
      "Informasi Kebijakan Perusahaan (SOP HR)",
      "Informasi Tunjangan dan Benefit",
      "Proses Rekrutmen dan Onboarding"
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
