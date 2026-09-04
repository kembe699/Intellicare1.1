-- A branch row that exists should be usable unless someone deactivates it.
--
-- branches.is_active defaulted to FALSE, and provisionTenant created the main
-- branch without naming it, so every freshly-provisioned tenant's only branch
-- was inactive. Everything that looks up "an active branch" then found none:
-- new users were created with branch_id NULL, passed login, and were refused by
-- every screen with "your account has not been assigned to a branch".
--
-- The default is flipped so the failure cannot recur, and any tenant left with
-- no active branch has its main branch (or its first) switched on. A branch that
-- was deliberately deactivated alongside another active one is left alone.

ALTER TABLE branches ALTER COLUMN is_active SET DEFAULT TRUE;

UPDATE branches SET is_active = TRUE
 WHERE id = (
   SELECT id FROM branches
    ORDER BY is_main_branch DESC NULLS LAST, id ASC
    LIMIT 1
 )
 AND NOT EXISTS (SELECT 1 FROM branches WHERE is_active IS TRUE);
