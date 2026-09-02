-- ============================================================================
-- Script to Remove Duplicate Drug Inventory Items
-- ============================================================================
-- This script removes duplicate drugs from the drug_inventory table
-- Keeps ONE record per drug_name (the one with the highest stock or most recent)
-- 
-- SAFETY FEATURES:
-- 1. Creates a backup table before deletion
-- 2. Shows preview of what will be deleted
-- 3. Verifies results after deletion
-- ============================================================================

USE universal_hmis;

-- ============================================================================
-- STEP 1: PREVIEW - See what will be deleted (SAFE - NO CHANGES)
-- ============================================================================
SELECT 
    'PREVIEW: Records that will be DELETED' as action,
    COUNT(*) as records_to_delete
FROM drug_inventory di1
WHERE di1.id NOT IN (
    SELECT MAX(id) 
    FROM drug_inventory di2
    WHERE di2.drug_name = di1.drug_name
    GROUP BY di2.drug_name
);

-- Show details of duplicates
SELECT 
    drug_name,
    COUNT(*) as duplicate_count,
    GROUP_CONCAT(id ORDER BY date_received DESC SEPARATOR ', ') as all_ids,
    GROUP_CONCAT(current_stock ORDER BY date_received DESC SEPARATOR ', ') as all_stocks
FROM drug_inventory
GROUP BY drug_name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 20;

-- ============================================================================
-- STEP 2: CREATE BACKUP TABLE (RECOMMENDED - RUN THIS FIRST)
-- ============================================================================
DROP TABLE IF EXISTS drug_inventory_backup_before_dedup;
CREATE TABLE drug_inventory_backup_before_dedup AS SELECT * FROM drug_inventory;

SELECT 'Backup created successfully' as status, COUNT(*) as backed_up_records 
FROM drug_inventory_backup_before_dedup;

-- ============================================================================
-- STEP 3: DELETE DUPLICATES - Keep record with highest ID (most recent)
-- ============================================================================
-- This keeps only ONE record per drug_name (the one with the highest ID)

DELETE FROM drug_inventory
WHERE id NOT IN (
    SELECT * FROM (
        SELECT MAX(id)
        FROM drug_inventory
        GROUP BY drug_name
    ) AS keeper_ids
);

-- ============================================================================
-- STEP 4: VERIFY RESULTS
-- ============================================================================
SELECT 
    'VERIFICATION RESULTS' as status,
    COUNT(*) as total_items,
    COUNT(DISTINCT drug_name) as unique_drugs,
    COUNT(*) - COUNT(DISTINCT drug_name) as remaining_duplicates
FROM drug_inventory;

-- Show any remaining duplicates (should be 0)
SELECT 
    'Remaining duplicates (should be empty)' as status,
    drug_name, 
    COUNT(*) as count 
FROM drug_inventory 
GROUP BY drug_name 
HAVING COUNT(*) > 1;

-- ============================================================================
-- STEP 5: SUMMARY
-- ============================================================================
SELECT 
    (SELECT COUNT(*) FROM drug_inventory_backup_before_dedup) as original_count,
    (SELECT COUNT(*) FROM drug_inventory) as final_count,
    (SELECT COUNT(*) FROM drug_inventory_backup_before_dedup) - 
    (SELECT COUNT(*) FROM drug_inventory) as deleted_count;
