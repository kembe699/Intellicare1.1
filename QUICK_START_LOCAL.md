# Quick Start - Local PostgreSQL Setup

## 🚀 Fast Setup (3 Steps)

### 1. Install PostgreSQL
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

### 2. Run Setup Script
```bash
cd /home/levi96/Documents/Int/universal/src/server
chmod +x setup-local-db.sh
bash setup-local-db.sh
```

This script will:
- ✅ Create database `intellicare_hmis`
- ✅ Create user `intellicare_user`
- ✅ Run all schema migrations
- ✅ Generate `.env` file with secure secrets
- ✅ Set up all tables and indexes

### 3. Start Your Server
```bash
npm run dev
```

## ✅ That's It!

Your application now uses **local PostgreSQL** instead of Supabase.

---

## 📋 What Changed?

### Database Configuration
- **Before**: Remote Supabase PostgreSQL with SSL
- **After**: Local PostgreSQL (no SSL needed)

The code automatically detects if you're using local or remote PostgreSQL based on your `DATABASE_URL`.

### Connection Details
```
Database: intellicare_hmis
User: intellicare_user
Password: intellicare2024 (change in .env)
Host: localhost
Port: 5432
```

---

## 🔧 Manual Setup (Alternative)

If you prefer manual setup:

```bash
# 1. Create database
sudo -u postgres psql
```

```sql
CREATE DATABASE intellicare_hmis;
CREATE USER intellicare_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE intellicare_hmis TO intellicare_user;
\c intellicare_hmis
GRANT ALL ON SCHEMA public TO intellicare_user;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
\q
```

```bash
# 2. Run schema
cd /home/levi96/Documents/Int/universal/src/server
PGPASSWORD=your_password psql -U intellicare_user -d intellicare_hmis -f migrations/supabase-schema.sql

# 3. Copy and edit .env
cp .env.local.example .env
nano .env  # Update password and secrets
```

---

## 🔄 Switch Between Local and Remote

Just change `DATABASE_URL` in `.env`:

**Local:**
```bash
DATABASE_URL=postgresql://intellicare_user:password@localhost:5432/intellicare_hmis
```

**Remote (Supabase):**
```bash
DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres
```

The code automatically handles SSL and connection settings!

---

## 🛠️ Useful Commands

```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Restart PostgreSQL
sudo systemctl restart postgresql

# Connect to database
psql -U intellicare_user -d intellicare_hmis

# View tables
psql -U intellicare_user -d intellicare_hmis -c "\dt"

# Backup database
pg_dump -U intellicare_user intellicare_hmis > backup.sql

# Restore database
psql -U intellicare_user intellicare_hmis < backup.sql

# Test connection
npm run test:connection
```

---

## ❓ Troubleshooting

### PostgreSQL not starting?
```bash
sudo systemctl restart postgresql
sudo systemctl status postgresql
```

### Connection refused?
```bash
# Check if PostgreSQL is listening
sudo netstat -plnt | grep 5432

# Check PostgreSQL config
sudo nano /etc/postgresql/*/main/postgresql.conf
# Ensure: listen_addresses = 'localhost'
```

### Permission denied?
```bash
sudo -u postgres psql -d intellicare_hmis
GRANT ALL ON ALL TABLES IN SCHEMA public TO intellicare_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO intellicare_user;
```

### Reset everything?
```bash
sudo -u postgres psql -c "DROP DATABASE intellicare_hmis;"
bash setup-local-db.sh
```

---

## 📊 Database Management Tools

### Command Line
```bash
psql -U intellicare_user -d intellicare_hmis
```

### GUI Tools (Optional)
- **pgAdmin**: Full-featured PostgreSQL GUI
- **DBeaver**: Universal database tool
- **TablePlus**: Modern database GUI

Install pgAdmin:
```bash
sudo apt install pgadmin4
```

---

## 🔐 Security Notes

1. **Change default password** in `.env` file
2. **Never commit** `.env` to git (already in `.gitignore`)
3. **Use strong passwords** for production
4. **Regular backups** with `pg_dump`

---

## 📈 Performance Tips

```sql
-- Add indexes for better performance (already in schema)
CREATE INDEX idx_patients_patient_id ON patients(patient_id);
CREATE INDEX idx_visits_patient_id ON visits(patient_id);

-- Analyze tables for query optimization
ANALYZE patients;
ANALYZE visits;

-- View slow queries
SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;
```

---

## 🎯 Next Steps

1. ✅ Install PostgreSQL
2. ✅ Run `setup-local-db.sh`
3. ✅ Update password in `.env`
4. ✅ Test: `npm run test:connection`
5. ✅ Start: `npm run dev`
6. 🚀 Build your application!

**Your IntelliCare HMIS is now running on local PostgreSQL!** 🎉
