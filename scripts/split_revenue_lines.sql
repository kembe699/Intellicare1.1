-- Separate revenue by service line, so the income statement shows where the
-- money came from instead of one "Patient Services Revenue" total.
--
-- Three parts, per tenant:
--   1. create the two accounts the chart was missing (consultation, inpatient)
--   2. activate every service-line revenue account
--   3. point each catalogue service at the account its category belongs to
--
-- Historical postings are not touched here — see reclassify_revenue.sql.
DO $$
DECLARE
  s text; cid integer;
  new_codes text[][] := ARRAY[
    ARRAY['4105','Consultation Revenue','Doctor and clinic consultation fees'],
    ARRAY['4150','Inpatient Revenue','Admissions, bed charges and ward services']
  ];
  c text[];
BEGIN
  FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\_%' ORDER BY 1 LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=s AND tablename='chart_of_accounts') THEN CONTINUE; END IF;

    -- The clinic this tenant's accounts are filed under.
    EXECUTE format('SELECT clinic_id FROM %I.chart_of_accounts GROUP BY clinic_id ORDER BY count(*) DESC LIMIT 1', s) INTO cid;
    IF cid IS NULL THEN cid := 1; END IF;

    FOREACH c SLICE 1 IN ARRAY new_codes LOOP
      EXECUTE format($f$
        INSERT INTO %I.chart_of_accounts
          (id, clinic_id, account_code, account_name, account_type, sub_account_type,
           balance_type, opening_balance, is_active, description, created_at, updated_at)
        SELECT gen_random_uuid()::text, $1, $2, $3, 'revenue', 'operating_revenue',
               'credit', 0, TRUE, $4, NOW(), NOW()
        WHERE NOT EXISTS (SELECT 1 FROM %I.chart_of_accounts WHERE account_code = $2 AND clinic_id = $1)
      $f$, s, s) USING cid, c[1], c[2], c[3];
    END LOOP;

    EXECUTE format(
      'UPDATE %I.chart_of_accounts SET is_active = TRUE
        WHERE account_code IN (''4100'',''4105'',''4110'',''4120'',''4130'',''4140'',''4150'',''4900'')', s);

    -- Point each service at the account matching its category. Mirrors
    -- utils/resolveRevenueAccount.js; keep the two in step.
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=s AND tablename='services') THEN
      EXECUTE format($f$
        UPDATE %I.services sv
           SET revenue_account_id = coa.id
          FROM %I.chart_of_accounts coa
         -- services has no clinic_id: the catalogue is per-schema, so the
         -- tenant's own clinic is passed in rather than joined on.
         WHERE coa.clinic_id = $1
           AND coa.account_code = CASE
             WHEN lower(coalesce(sv.category, sv.service_category, '')) ~ 'lab|laboratory|diagnostic|patholog|haemat|hemat' THEN '4110'
             WHEN lower(coalesce(sv.category, sv.service_category, '')) ~ 'pharma|drug|medic|dispens'                        THEN '4120'
             WHEN lower(coalesce(sv.category, sv.service_category, '')) ~ 'radio|imaging|xray|x-ray|scan|ultrasound'         THEN '4130'
             WHEN lower(coalesce(sv.category, sv.service_category, '')) ~ 'proced|surgery|theater|theatre|operation'         THEN '4140'
             WHEN lower(coalesce(sv.category, sv.service_category, '')) ~ 'inpatient|admission|bed|ward'                     THEN '4150'
             WHEN lower(coalesce(sv.category, sv.service_category, '')) ~ 'consult|opd|outpatient|review'                    THEN '4105'
             ELSE '4100' END
      $f$, s, s) USING cid;
    END IF;

    RAISE NOTICE '% : revenue lines split', s;
  END LOOP;
END $$;
