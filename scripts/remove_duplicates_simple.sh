#!/bin/bash
# ============================================================================
# Simple Script to Remove Duplicate Drugs from Inventory
# ============================================================================
# This script safely removes duplicate drug entries, keeping only one per drug name
# Usage: bash remove_duplicates_simple.sh
# ============================================================================

DB_USER="root"
DB_PASS="${DB_PASSWORD:?set DB_PASSWORD before running}"
DB_NAME="universal_hmis"

echo "============================================================================"
echo "Drug Inventory Deduplication Script"
echo "============================================================================"
echo ""

# Step 1: Show current duplicates
echo "Step 1: Checking for duplicates..."
mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -e "
SELECT drug_name, COUNT(*) as count 
FROM drug_inventory 
GROUP BY drug_name 
HAVING count > 1 
ORDER BY count DESC 
LIMIT 10;
"

# Step 2: Count total duplicates
DUPLICATE_COUNT=$(mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -N -e "
SELECT COUNT(*) 
FROM drug_inventory di1
WHERE di1.id NOT IN (
    SELECT MAX(id) 
    FROM drug_inventory di2
    WHERE di2.drug_name = di1.drug_name
    GROUP BY di2.drug_name
);
")

echo ""
echo "Found $DUPLICATE_COUNT duplicate records to delete"
echo ""

# Step 3: Ask for confirmation
read -p "Do you want to create a backup and proceed with deletion? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Operation cancelled."
    exit 0
fi

# Step 4: Create backup
echo ""
echo "Step 2: Creating backup table..."
mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -e "
DROP TABLE IF EXISTS drug_inventory_backup_$(date +%Y%m%d);
CREATE TABLE drug_inventory_backup_$(date +%Y%m%d) AS SELECT * FROM drug_inventory;
"

BACKUP_COUNT=$(mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -N -e "
SELECT COUNT(*) FROM drug_inventory_backup_$(date +%Y%m%d);
")

echo "Backup created: drug_inventory_backup_$(date +%Y%m%d) with $BACKUP_COUNT records"

# Step 5: Delete duplicates
echo ""
echo "Step 3: Deleting duplicate records..."
mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -e "
DELETE FROM drug_inventory
WHERE id NOT IN (
    SELECT * FROM (
        SELECT MAX(id)
        FROM drug_inventory
        GROUP BY drug_name
    ) AS keeper_ids
);
"

# Step 6: Verify results
echo ""
echo "Step 4: Verification..."
mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -e "
SELECT 
    COUNT(*) as total_items,
    COUNT(DISTINCT drug_name) as unique_drugs,
    COUNT(*) - COUNT(DISTINCT drug_name) as remaining_duplicates
FROM drug_inventory;
"

# Check for any remaining duplicates
REMAINING=$(mysql -u $DB_USER -p$DB_PASS -D $DB_NAME -N -e "
SELECT COUNT(*) 
FROM (
    SELECT drug_name 
    FROM drug_inventory 
    GROUP BY drug_name 
    HAVING COUNT(*) > 1
) AS dups;
")

echo ""
if [ "$REMAINING" -eq 0 ]; then
    echo "✅ SUCCESS: All duplicates removed!"
    echo "✅ Backup saved as: drug_inventory_backup_$(date +%Y%m%d)"
else
    echo "⚠️  WARNING: $REMAINING duplicates still remain"
fi

echo ""
echo "============================================================================"
echo "Deduplication Complete"
echo "============================================================================"
