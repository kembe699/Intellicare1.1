# Local PostgreSQL Setup Guide

## Step 1: Install PostgreSQL

```bash
# Update package list
sudo apt update

# Install PostgreSQL and additional tools
sudo apt install postgresql postgresql-contrib

# Start and enable PostgreSQL service
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Verify installation
psql --version
```

## Step 2: Create Database and User

```bash
# Switch to postgres user
sudo -u postgres psql

# Inside PostgreSQL prompt, run these commands:
```

```sql
-- Create a new database
CREATE DATABASE intellicare_hmis;

-- Create a new user with password
CREATE USER intellicare_user WITH PASSWORD 'your_secure_password_here';

-- Grant all privileges on the database to the user
GRANT ALL PRIVILEGES ON DATABASE intellicare_hmis TO intellicare_user;

-- Connect to the new database
\c intellicare_hmis

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO intellicare_user;

-- Enable UUID extension (required for your schema)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Exit PostgreSQL
\q
```

## Step 3: Update Environment Variables

Create or update `/home/levi96/Documents/Int/universal/src/server/.env`:

```bash
# Local PostgreSQL Database
DATABASE_URL=postgresql://intellicare_user:your_secure_password_here@localhost:5432/intellicare_hmis
DB_HOST=localhost
DB_PORT=5432
DB_NAME=intellicare_hmis
DB_USER=intellicare_user
DB_PASSWORD=your_secure_password_here

# JWT Configuration
JWT_SECRET=your-secret-key-minimum-32-characters

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Session Configuration
SESSION_SECRET=your-session-secret-key-change-this-in-production

# File Upload Configuration
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760

# Logging Configuration
LOG_LEVEL=info
```

## Step 4: Run Database Schema

```bash
# Navigate to server directory
cd /home/levi96/Documents/Int/universal/src/server

# Run the schema file
sudo -u postgres psql -d intellicare_hmis -f migrations/supabase-schema.sql

# OR connect as your user:
PGPASSWORD=your_secure_password_here psql -U intellicare_user -d intellicare_hmis -f migrations/supabase-schema.sql
```

## Step 5: Test Connection

```bash
cd /home/levi96/Documents/Int/universal/src/server
npm run test:connection
```

## Quick Setup Script

Run this after installing PostgreSQL:

```bash
#!/bin/bash
# Save this as setup-local-db.sh and run: bash setup-local-db.sh

DB_NAME="intellicare_hmis"
DB_USER="intellicare_user"
DB_PASSWORD="intellicare2024"  # Change this!

echo "Creating database and user..."
sudo -u postgres psql <<EOF
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EOF

echo "Database setup complete!"
echo ""
echo "Add this to your .env file:"
echo "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
```

## Troubleshooting

### Connection Issues

```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Restart PostgreSQL
sudo systemctl restart postgresql

# Check PostgreSQL logs
sudo tail -f /var/log/postgresql/postgresql-*-main.log
```

### Permission Issues

```bash
# If you get permission errors, grant additional privileges:
sudo -u postgres psql -d intellicare_hmis -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO intellicare_user;"
sudo -u postgres psql -d intellicare_hmis -c "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO intellicare_user;"
```

### Reset Database

```bash
# Drop and recreate database
sudo -u postgres psql <<EOF
DROP DATABASE IF EXISTS intellicare_hmis;
CREATE DATABASE intellicare_hmis;
GRANT ALL PRIVILEGES ON DATABASE intellicare_hmis TO intellicare_user;
EOF
```

## Key Differences from Supabase

| Aspect | Supabase | Local PostgreSQL |
|--------|----------|------------------|
| Host | Remote (aws-0-eu-west-1...) | localhost |
| Port | 6543 (pooler) or 5432 | 5432 |
| SSL | Required | Not required locally |
| Authentication | Supabase managed | Local user/password |
| Backups | Automatic | Manual (pg_dump) |

## Backup Your Local Database

```bash
# Create backup
pg_dump -U intellicare_user -d intellicare_hmis > backup_$(date +%Y%m%d).sql

# Restore backup
psql -U intellicare_user -d intellicare_hmis < backup_20240323.sql
```

## Next Steps

1. Install PostgreSQL
2. Run the setup script or manual commands
3. Update your `.env` file
4. Run the schema migration
5. Test the connection
6. Start your server: `npm run dev`

Your application will now use local PostgreSQL instead of Supabase! 🚀
