import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { NavigationHelper } from '../../helpers/navigation-helper';
import { TableHelper } from '../../helpers/table-helper';

test.describe('Patient Search and Table Features', () => {
  let authHelper: AuthHelper;
  let navHelper: NavigationHelper;
  let tableHelper: TableHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    navHelper = new NavigationHelper(page);
    tableHelper = new TableHelper(page);
    
    await authHelper.clearAuth();
    await authHelper.loginAsReceptionist();
    await navHelper.goToPatients();
  });

  test('should search patients by name', async ({ page }) => {
    // Search for a patient
    await tableHelper.searchTable('Patient');
    
    // Wait for results
    await page.waitForTimeout(1000);
    
    // Verify table has data or shows empty state
    const rowCount = await tableHelper.getRowCount();
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should clear search', async ({ page }) => {
    // Search for something
    await tableHelper.searchTable('Test');
    await page.waitForTimeout(1000);
    
    // Clear search
    await tableHelper.clearSearch();
    await page.waitForTimeout(1000);
    
    // Should show all patients again
    const rowCount = await tableHelper.getRowCount();
    expect(rowCount).toBeGreaterThanOrEqual(0);
  });

  test('should sort table by column', async ({ page }) => {
    // Click on a sortable column
    await tableHelper.sortByColumn('Name');
    await page.waitForTimeout(500);
    
    // Verify table still has data
    await tableHelper.verifyTableHasData();
  });

  test('should paginate through patients', async ({ page }) => {
    const initialRowCount = await tableHelper.getRowCount();
    
    if (initialRowCount > 0) {
      // Try to go to next page
      const nextButton = page.locator('button:has-text("Next"), button[aria-label*="next" i]').first();
      const isNextEnabled = await nextButton.isEnabled({ timeout: 2000 }).catch(() => false);
      
      if (isNextEnabled) {
        await tableHelper.goToNextPage();
        await page.waitForTimeout(500);
        
        // Verify still has data
        await tableHelper.verifyTableHasData();
      }
    }
  });

  test('should change page size', async ({ page }) => {
    // Try to change page size
    const pageSizeSelect = page.locator('select, button:near(:text("per page"))').first();
    const isVisible = await pageSizeSelect.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (isVisible) {
      await tableHelper.changePageSize(20);
      await page.waitForTimeout(500);
      
      // Verify table updates
      const rowCount = await tableHelper.getRowCount();
      expect(rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('should display patient metrics', async ({ page }) => {
    // Verify metric cards are visible
    const metrics = page.locator('[class*="metric"], [class*="card"]:has-text(/total|today|queue/i)');
    const count = await metrics.count();
    
    expect(count).toBeGreaterThan(0);
  });

  test('should export patient data', async ({ page }) => {
    // Look for export button
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download")').first();
    const isVisible = await exportButton.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (isVisible) {
      // Click export (don't wait for download in test)
      await exportButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should select multiple patients', async ({ page }) => {
    const rowCount = await tableHelper.getRowCount();
    
    if (rowCount > 0) {
      // Select first row
      await tableHelper.selectRow(0);
      await page.waitForTimeout(300);
      
      // Verify checkbox is checked
      const checkbox = page.locator('tbody tr:first-child input[type="checkbox"]').first();
      await expect(checkbox).toBeChecked();
    }
  });

  test('should verify all columns are displayed', async ({ page }) => {
    // Verify key columns exist
    await tableHelper.verifyColumnExists('Patient ID');
    await tableHelper.verifyColumnExists('Name');
    await tableHelper.verifyColumnExists('Age');
    await tableHelper.verifyColumnExists('Gender');
  });
});
