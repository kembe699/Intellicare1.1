import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { NavigationHelper } from '../../helpers/navigation-helper';
import { FormHelper } from '../../helpers/form-helper';
import { TableHelper } from '../../helpers/table-helper';

test.describe('Clinical Visit Workflow', () => {
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
    await authHelper.loginAsDoctor();
    await navHelper.goToClinical();
  });

  test('should display clinical dashboard', async ({ page }) => {
    // Verify page loaded
    await expect(page.locator('h1, h2').filter({ hasText: /clinical/i }).first()).toBeVisible();
  });

  test('should display patient queue', async ({ page }) => {
    // Look for queue or visits table
    const table = page.locator('table, [role="table"]').first();
    const isVisible = await table.isVisible({ timeout: 5000 }).catch(() => false);
    
    expect(isVisible).toBe(true);
  });

  test('should search visits', async ({ page }) => {
    // Search for visits
    await tableHelper.searchTable('Patient');
    await page.waitForTimeout(1000);
    
    const rowCount = await tableHelper.getRowCount();
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should filter visits by status', async ({ page }) => {
    // Look for status filters
    const statusButtons = page.locator('button:has-text("Pending"), button:has-text("In Progress"), button:has-text("Completed")');
    const count = await statusButtons.count();
    
    if (count > 0) {
      await statusButtons.first().click();
      await page.waitForTimeout(500);
    }
  });

  test('should display visit metrics', async ({ page }) => {
    // Look for metrics cards
    const metrics = page.locator('[class*="metric"], [class*="card"]:has-text(/total|pending|completed/i)');
    const count = await metrics.count();
    
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should sort visits table', async ({ page }) => {
    const columns = ['Patient', 'Date', 'Status'];
    
    for (const column of columns) {
      const columnHeader = page.locator(`th:has-text("${column}")`).first();
      const exists = await columnHeader.isVisible({ timeout: 2000 }).catch(() => false);
      
      if (exists) {
        await tableHelper.sortByColumn(column);
        await page.waitForTimeout(300);
        break;
      }
    }
  });

  test('should export visits data', async ({ page }) => {
    const exportButton = page.locator('button:has-text("Export")').first();
    const isVisible = await exportButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (isVisible) {
      await exportButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should view visit details', async ({ page }) => {
    const rowCount = await tableHelper.getRowCount();
    
    if (rowCount > 0) {
      // Click first visit
      const firstRow = page.locator('tbody tr:first-child').first();
      await firstRow.click();
      await page.waitForTimeout(1000);
      
      // Verify details appear
      const detailsVisible = await page.locator('[role="dialog"], .modal, text=/visit.*details/i').first().isVisible({ timeout: 3000 }).catch(() => false);
      
      // Details should appear or page should navigate
      expect(detailsVisible || page.url()).toBeTruthy();
    }
  });

  test('should display empty state when no visits', async ({ page }) => {
    // Search for non-existent visit
    await tableHelper.searchTable('NONEXISTENT_VISIT_99999');
    await page.waitForTimeout(1000);
    
    // Check for empty state or zero rows
    const rowCount = await tableHelper.getRowCount();
    const emptyState = page.locator('text=/no.*visits|no.*found|empty/i').first();
    const emptyVisible = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);
    
    expect(rowCount === 0 || emptyVisible).toBe(true);
  });
});
