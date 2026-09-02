-- Script to remove duplicate drug inventory items
-- Keeps the most recent record (by date_received) for each drug_name
-- Author: System Generated
-- Date: 2026-02-23

-- Step 1: First, let's see what will be deleted (DRY RUN)
-- Uncomment the following query to preview duplicates that will be deleted:

/*
SELECT di1.id, di1.drug_name, di1.date_received, di1.current_stock
FROM drug_inventory di1
WHERE di1.id NOT IN (
    SELECT id FROM (
        SELECT id
        FROM drug_inventory di2
        WHERE di2.drug_name = di1.drug_name
        ORDER BY di2.date_received DESC, di2.id DESC
        LIMIT 1
    ) AS keeper
)
ORDER BY di1.drug_name, di1.date_received DESC;
*/

-- Step 2: Create a backup table (RECOMMENDED)
CREATE TABLE IF NOT EXISTS drug_inventory_backup_20260223 AS 
SELECT * FROM drug_inventory;

-- Step 3: Delete duplicates, keeping only the most recent record for each drug_name
-- This keeps the record with the latest date_received, or the latest id if dates are the same

DELETE di1 FROM drug_inventory di1
INNER JOIN drug_inventory di2 
ON di1.drug_name = di2.drug_name
WHERE di1.id < di2.id
  OR (di1.id != di2.id AND di1.date_received < di2.date_received)
  OR (di1.id != di2.id AND di1.date_received = di2.date_received AND di1.id < di2.id);

-- Step 4: Verify the results
SELECT 
    COUNT(*) as total_items,
    COUNT(DISTINCT drug_name) as unique_drugs,
    COUNT(*) - COUNT(DISTINCT drug_name) as remaining_duplicates
FROM drug_inventory;

-- Step 5: Show any remaining duplicates (should be 0)
SELECT drug_name, COUNT(*) as count 
FROM drug_inventory 
GROUP BY drug_name 
HAVING count > 1;
