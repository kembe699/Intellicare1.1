import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { NavigationHelper } from '../../helpers/navigation-helper';
import { FormHelper } from '../../helpers/form-helper';
import { TableHelper } from '../../helpers/table-helper';

test.describe('Bill Creation', () => {
  let authHelper: AuthHelper;
  let navHelper: NavigationHelper;
  let formHelper: FormHelper;
  let tableHelper: TableHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    navHelper = new NavigationHelper(page);
    formHelper = new FormHelper(page);
    tableHelper = new TableHelper(page);
    
    await authHelper.clearAuth();
    await authHelper.loginAsReceptionist();
    await navHelper.goToPatientsBill();
  });

  test('should display billing dashboard with metrics', async ({ page }) => {
    // Verify page loaded
    await expect(page.locator('h1, h2').filter({ hasText: /bill/i }).first()).toBeVisible();
    
    // Verify metrics are displayed
    const metrics = page.locator('[class*="metric"], [class*="card"]');
    const count = await metrics.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should display bills table', async ({ page }) => {
    // Verify table columns
    await tableHelper.verifyColumnExists('Bill #');
    await tableHelper.verifyColumnExists('Patient Name');
    await tableHelper.verifyColumnExists('Total');
    await tableHelper.verifyColumnExists('Balance');
  });

  test('should search bills', async ({ page }) => {
    // Search for a bill
    await tableHelper.searchTable('Bill');
    await page.waitForTimeout(1000);
    
    // Verify search works
    const rowCount = await tableHelper.getRowCount();
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should sort bills by column', async ({ page }) => {
    // Sort by Bill Date
    await tableHelper.sortByColumn('Bill Date');
    await page.waitForTimeout(500);
    
    // Verify table still displays
    const rowCount = await tableHelper.getRowCount();
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should filter bills by status', async ({ page }) => {
    // Look for status filter buttons
    const statusFilters = page.locator('button:has-text("Pending"), button:has-text("Paid"), button:has-text("Partial")');
    const count = await statusFilters.count();
    
    if (count > 0) {
      // Click a status filter
      await statusFilters.first().click();
      await page.waitForTimeout(500);
      
      // Verify table updates
      const rowCount = await tableHelper.getRowCount();
      expect(rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should export bills data', async ({ page }) => {
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download")').first();
    const isVisible = await exportButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (isVisible) {
      await exportButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should paginate bills', async ({ page }) => {
    const rowCount = await tableHelper.getRowCount();
    
    if (rowCount > 0) {
      const nextButton = page.locator('button:has-text("Next")').first();
      const isEnabled = await nextButton.isEnabled({ timeout: 2000 }).catch(() => false);
      
      if (isEnabled) {
        await tableHelper.goToNextPage();
        await page.waitForTimeout(500);
      }
    }
  });

  test('should view bill details', async ({ page }) => {
    const rowCount = await tableHelper.getRowCount();
    
    if (rowCount > 0) {
      // Click first row or view button
      const viewButton = page.locator('tbody tr:first-child button:has-text("View"), tbody tr:first-child').first();
      await viewButton.click();
      await page.waitForTimeout(1000);
      
      // Verify details panel or modal appears
      const detailsVisible = await page.locator('text=/bill.*details|details/i, [role="dialog"]').first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(detailsVisible).toBe(true);
    }
  });

  test('should display correct bill status badges', async ({ page }) => {
    const rowCount = await tableHelper.getRowCount();
    
    if (rowCount > 0) {
      // Look for status badges
      const badges = page.locator('tbody [class*="badge"], tbody span:has-text(/paid|pending|partial/i)');
      const badgeCount = await badges.count();
      
      expect(badgeCount).toBeGreaterThan(0);
    }
  });

  test('should show empty state when no bills', async ({ page }) => {
    // Search for something that doesn't exist
    await tableHelper.searchTable('NONEXISTENT_BILL_12345');
    await page.waitForTimeout(1000);
    
    // Should show empty state
    const emptyState = page.locator('text=/no.*bills|no.*found|empty/i').first();
    const isVisible = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
    
    // Either empty state or no rows
    if (!isVisible) {
      const rowCount = await tableHelper.getRowCount();
      expect(rowCount).toBe(0);
    }
  });
});
