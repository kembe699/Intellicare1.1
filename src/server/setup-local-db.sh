#!/bin/bash
# Local PostgreSQL Database Setup Script for IntelliCare HMIS

set -e  # Exit on error

DB_NAME="intellicare_hmis"
DB_USER="intellicare_user"
DB_PASSWORD="intellicare2024"  # CHANGE THIS TO A SECURE PASSWORD!

echo "=========================================="
echo "IntelliCare HMIS - Local PostgreSQL Setup"
echo "=========================================="
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed!"
    echo ""
    echo "Install it with:"
    echo "  sudo apt update"
    echo "  sudo apt install postgresql postgresql-contrib"
    echo "  sudo systemctl start postgresql"
    echo "  sudo systemctl enable postgresql"
    echo ""
    exit 1
fi

echo "✅ PostgreSQL is installed"
echo ""

# Check if PostgreSQL service is running
if ! sudo systemctl is-active --quiet postgresql; then
    echo "⚠️  PostgreSQL service is not running. Starting it..."
    sudo systemctl start postgresql
    echo "✅ PostgreSQL service started"
else
    echo "✅ PostgreSQL service is running"
fi
echo ""

# Create database and user
echo "Creating database and user..."
sudo -u postgres psql <<EOF
-- Drop existing database if it exists (optional - comment out if you want to keep existing data)
-- DROP DATABASE IF EXISTS $DB_NAME;
-- DROP USER IF EXISTS $DB_USER;

-- Create database
CREATE DATABASE $DB_NAME;

-- Create user
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;

-- Connect to database
\c $DB_NAME

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO $DB_USER;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Grant future table privileges
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;

EOF

if [ $? -eq 0 ]; then
    echo "✅ Database and user created successfully"
else
    echo "⚠️  Database might already exist. Continuing..."
fi
echo ""

# Run schema migration
echo "Running database schema migration..."
SCHEMA_FILE="./migrations/supabase-schema.sql"

if [ -f "$SCHEMA_FILE" ]; then
    PGPASSWORD=$DB_PASSWORD psql -U $DB_USER -d $DB_NAME -f $SCHEMA_FILE
    echo "✅ Schema migration completed"
else
    echo "⚠️  Schema file not found at $SCHEMA_FILE"
    echo "   You'll need to run it manually later"
fi
echo ""

# Create .env file
echo "Creating .env file..."
ENV_FILE=".env"

cat > $ENV_FILE <<EOF
# Local PostgreSQL Database
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# JWT Configuration
JWT_SECRET=$(openssl rand -base64 32)

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGIN=http://localhost:5173

# Session Configuration
SESSION_SECRET=$(openssl rand -base64 32)

# File Upload Configuration
UPLOAD_PATH=./uploads
MAX_FILE_SIZE=10485760

# Logging Configuration
LOG_LEVEL=info
EOF

echo "✅ .env file created"
echo ""

echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Database Details:"
echo "  Database: $DB_NAME"
echo "  User: $DB_USER"
echo "  Password: $DB_PASSWORD"
echo "  Host: localhost"
echo "  Port: 5432"
echo ""
echo "Connection String:"
echo "  postgresql://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo ""
echo "Next Steps:"
echo "  1. Review and update the password in .env file"
echo "  2. Test connection: npm run test:connection"
echo "  3. Start server: npm run dev"
echo ""
echo "⚠️  IMPORTANT: Change the default password in .env for production!"
echo ""
