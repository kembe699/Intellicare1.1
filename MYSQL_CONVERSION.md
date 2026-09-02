# MySQL Conversion Guide for Universal HMIS

This document provides instructions for converting the application from Firebase Firestore to MySQL database.

## Overview

The application has been converted from using Firestore (NoSQL) to MySQL (relational database). This conversion involves:

1. Setting up a MySQL database
2. Creating models for database tables
3. Setting up repositories for database operations
4. Updating components to use MySQL repositories
5. Migrating data from Firestore to MySQL

## Setup Instructions

### 1. Database Setup

1. Create a MySQL database named `universal_hmis`
2. Run the SQL schema file to create all required tables:

```bash
mysql -u root -p universal_hmis < schema.sql
```

### 2. Environment Configuration

Create a `.env` file in the project root with your database configuration:

```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=universal_hmis
DB_PORT=3306
```

### 3. Install Required Dependencies

```bash
npm install mysql2 sequelize dotenv
```

### 4. Running the Migration Script

To migrate existing data from Firestore to MySQL:

```bash
npm run migrate-data
```

This script will:
- Read data from your Firestore database
- Convert it to the MySQL schema format
- Insert the data into your MySQL database

## Project Structure Changes

### New Files and Directories

1. **Database Connection**: `src/lib/database.ts` - MySQL connection setup
2. **Models**: `src/models/` - Sequelize models for database tables
3. **Repositories**: `src/repositories/` - Data access layer for MySQL operations
4. **Migrations**: `src/scripts/migrateData.ts` - Script to migrate from Firestore to MySQL
5. **MySQL Components**: Files with `.mysql.tsx` suffix are MySQL versions of components

### Key Components

- **DatabaseProvider**: Context for accessing repositories throughout the application
- **AuthContext.mysql.tsx**: Authentication provider updated for MySQL
- **MySQL Models**: Defined in the `src/models/` directory
- **Repository Classes**: Data access layer in `src/repositories/`

## Converting Components

When converting a component to use MySQL:

1. Import from the MySQL version of files:
   ```typescript
   import { useAuth } from '@/contexts/AuthContext.mysql';
   ```

2. Use the database provider to access repositories:
   ```typescript
   import { useDatabase } from '@/contexts/DatabaseContext';
   // ...
   const { userRepo } = useDatabase();
   ```

3. Replace Firestore queries with repository calls:
   ```typescript
   // Instead of:
   const snapshot = await getDocs(collection(db, 'users'));
   
   // Use:
   const users = await userRepo.findAll();
   ```

## Association Setup

The database relationships are defined in `src/models/associations.ts`. This file defines all the foreign key relationships between tables.

## Switching Between Versions

To switch between Firestore and MySQL versions:

1. For development, use the original imports
2. For MySQL, use the `.mysql.tsx` versions of components

## Database Design Notes

1. **ID Generation**: UUIDs are used for primary keys
2. **Foreign Keys**: Proper constraints are set up between tables
3. **Timestamps**: All tables include created_at/updated_at fields where appropriate
4. **Data Types**: SQL-appropriate data types are used for each field

## Testing

Before fully migrating to production:

1. Test all CRUD operations
2. Verify data integrity across relationships
3. Check authentication flows
4. Test performance under load

## Troubleshooting

- **Connection Issues**: Verify MySQL server is running and credentials are correct
- **Migration Failures**: Check the console output for specific error messages
- **Type Errors**: Ensure model types match the database schema
- **Missing Associations**: Check that all relationships are properly defined

## Support

For questions or issues with the MySQL conversion, please contact the development team.
