# Supabase Migration Guide for IntelliCare HMIS

## Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up with GitHub
3. Create new project: `intellicare-hmis`
4. Choose region closest to you
5. Set strong database password

## Step 2: Install Dependencies

```bash
cd server
npm install pg pg-hstore @supabase/supabase-js
npm uninstall mysql2
```

## Step 3: Get Supabase Connection Details

From your Supabase dashboard → Settings → Database:

```bash
# Connection String
postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres

# Individual Components
Host: db.[project-ref].supabase.co
Port: 5432
Database: postgres
User: postgres
Password: [your-password]
```

From Settings → API:
```bash
URL: https://[project-ref].supabase.co
Anon Key: [your-anon-key]
Service Role Key: [your-service-key]
```

## Step 4: Update Environment Variables

Create `.env` file in server directory:

```bash
# Supabase PostgreSQL Database
DATABASE_URL=postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres
DB_HOST=db.[project-ref].supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=your-supabase-password

# Supabase API
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Other configs
JWT_SECRET=your-jwt-secret
NODE_ENV=development
PORT=3001
```

## Step 5: MySQL to PostgreSQL Differences

### Key Changes Made:
1. **Sequelize dialect**: Changed from 'mysql' to 'postgres'
2. **SSL configuration**: Added for production
3. **Port**: Changed from 3306 to 5432
4. **Dependencies**: Replaced mysql2 with pg and pg-hstore

### SQL Syntax Differences:
- **Auto-increment**: `SERIAL` instead of `AUTO_INCREMENT`
- **Boolean**: `BOOLEAN` instead of `TINYINT(1)`
- **Text types**: `TEXT` instead of `LONGTEXT`
- **Date functions**: `NOW()` instead of `CURRENT_TIMESTAMP`
- **String concatenation**: `||` instead of `CONCAT()`
- **Limit syntax**: Same (`LIMIT n`)
- **Case sensitivity**: PostgreSQL is case-sensitive for identifiers

## Step 6: Test Connection

```bash
cd server
npm run dev
```

Check console for successful database connection.

## Step 7: Create Tables

Run your existing migration scripts or use Sequelize sync:

```javascript
// In your server startup
await sequelize.sync({ force: false });
```

## Step 8: Data Migration (if needed)

If you have existing MySQL data:

1. Export from MySQL:
```bash
mysqldump -u root -p intellicare_db > backup.sql
```

2. Convert MySQL dump to PostgreSQL format using tools like:
   - `mysql2postgres`
   - `pgloader`
   - Manual conversion

3. Import to Supabase via SQL Editor in dashboard

## Step 9: Deploy

Your app is now ready for deployment with:
- **Frontend**: Vercel
- **Backend**: Railway or Vercel Functions
- **Database**: Supabase (PostgreSQL)

## Benefits of Supabase:

✅ **Free tier**: 500MB database, 2GB bandwidth  
✅ **Built-in auth**: User management included  
✅ **Real-time**: Live data updates  
✅ **REST API**: Auto-generated API  
✅ **Dashboard**: Easy database management  
✅ **Backups**: Automatic daily backups  
✅ **SSL**: Built-in security  

## Troubleshooting:

- **Connection issues**: Check firewall and SSL settings
- **Query errors**: Review PostgreSQL syntax differences
- **Performance**: Add indexes for frequently queried columns
- **Auth**: Use Supabase Auth instead of custom JWT (optional)

Your IntelliCare HMIS is now ready for modern, scalable deployment! 🚀
