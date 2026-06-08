# AI-SPV (Supervisor AI)

> 🧠 **AI Supervisor, Router, Orchestrator, and Aggregator**

AI-SPV adalah sebuah *Enterprise AI Platform Router*. Sistem ini tidak memiliki knowledge base secara langsung (bukan *knowledge agent*), melainkan bertugas untuk mengklasifikasikan intent pertanyaan dari user dan meneruskannya (routing) ke *downstream agent* yang tepat (seperti AI-HR, AI-SERVER, AI-FINANCE).

Stack: **Node.js 22** · **Express** · **PostgreSQL** · **OpenAI API** · **Docker**

---

## 🏗 Arsitektur

```text
Discord / WhatsApp / Web Chat
      │
      ▼
   OpenClaw
      │
      ▼
    AI-SPV
      │
      ▼
 Agent Registry
      │
 ┌────┼────┐
 │    │    │
 ▼    ▼    ▼
AI-HR   AI-SERVER   AI-FINANCE
```

---

## 🚀 Cara Setup & Instalasi

### 1. Prasyarat
- **Docker & Docker Compose** terinstall.
- Network Docker internal `infra_net` sudah tersedia. Jika belum, buat dengan:
  ```bash
  docker network create infra_net
  ```

### 2. Kloning Repository
```bash
git clone <repo-url> ai-spv
cd ai-spv
```

### 3. Setup Environment Variables
Buat dan ubah file `.env` (atau salin dari `.env.example`) untuk mengonfigurasi aplikasi. Beberapa variabel utamanya adalah:

```env
# Konfigurasi OpenAI (Digunakan untuk Classifier & Aggregator)
OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o

# Konfigurasi Database AI-SPV
POSTGRES_HOST=shared-prod-postgres
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=msiserver
POSTGRES_PASSWORD=password_db

# Konfigurasi OpenClaw (Opsional, bawaan untuk gateway bot)
OPENCLAW_PORT=9001
DISCORD_ENABLED=true
DISCORD_BOT_TOKEN=...
```

### 4. Menyiapkan Database
AI-SPV membutuhkan tabel `agent_registry` dan `agent_capabilities` di PostgreSQL.
Anda bisa menjalankan script migrasi Knex (di lokal atau server dev):
```bash
npm install
npm run migrate:latest
```
Atau Anda bisa membuat tabel tersebut secara manual menggunakan skema yang ada di dalam `src/database/migrations/`.

---

## 🏃 Cara Menjalankan

Jalankan seluruh service menggunakan Docker Compose:

```bash
docker compose up -d --build
```

Command ini akan menjalankan:
1. **`openclaw`**: AI Agent Gateway ke platform chat pihak ketiga (Discord/Telegram dll).
2. **`ai-spv`**: Node container utama AI-SPV di network internal.

Anda bisa memeriksa proses dan memastikan tidak ada error pada log dengan perintah:
```bash
docker compose logs -f ai-spv
```

---

## 🔗 Cara Menyambungkan AI Lainnya (Downstream Agents)

AI-SPV didesain secara modular. Untuk menambahkan agen AI baru (seperti `ai-legal`, `ai-purchasing`, `ai-inventory`) Anda **TIDAK PERLU** memodifikasi source code dari AI-SPV. 

Cukup ikuti langkah-langkah di bawah ini:

### 1. Deploy Agent Baru
Deploy agent AI Anda menggunakan Docker dan taruh di dalam network yang sama (`infra_net`). Pastikan AI tersebut memiliki endpoint API `POST /ask`.

**Format Request ke Agent:**
```json
{
  "question": "Berapa budget divisi IT?"
}
```
**Format Respon dari Agent:**
```json
{
  "answer": "Budget divisi IT untuk tahun ini adalah Rp 500.000.000."
}
```

### 2. Daftarkan Agen di Tabel `agent_registry`
Masukkan data agen baru Anda langsung ke database PostgreSQL ke dalam tabel `agent_registry`.

Contoh eksekusi SQL:
```sql
INSERT INTO agent_registry (id, agent_code, agent_name, endpoint, description, enabled)
VALUES (
    gen_random_uuid(),
    'ai-finance',
    'Finance Agent',
    'http://ai-finance:3000',
    'Agen AI yang menangani laporan keuangan, budget, dan purchasing',
    TRUE
);
```

### 3. Daftarkan Kemampuannya di Tabel `agent_capabilities`
LLM Intent Classifier yang ada di AI-SPV perlu mengetahui detail kemampuan (kapabilitas) agen untuk proses routing secara cerdas.

Contoh eksekusi SQL:
```sql
INSERT INTO agent_capabilities (id, agent_code, capability)
VALUES 
    (gen_random_uuid(), 'ai-finance', 'Budget Approval'),
    (gen_random_uuid(), 'ai-finance', 'Laporan Keuangan');
```

**Selesai! 🎉** 
Service AI-SPV memiliki auto-refresh caching setiap 60 detik. Anda tidak perlu merestart AI-SPV. Setelah data di database diperbarui, AI-SPV akan otomatis mengenali agen AI baru dan mulai meneruskan pertanyaan user jika sesuai dengan kapabilitasnya.
