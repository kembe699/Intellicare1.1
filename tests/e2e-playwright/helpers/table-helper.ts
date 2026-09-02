import { Page, Locator, expect } from '@playwright/test';

/**
 * Table Helper for E2E Tests
 * Works with AdvancedDataTable and standard HTML tables
 */
export class TableHelper {
  constructor(private page: Page) {}

  /**
   * Search table using search input
   */
  async searchTable(query: string) {
    const searchInput = this.page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    await searchInput.fill(query);
    await this.page.waitForTimeout(500); // Wait for debounce
  }

  /**
   * Clear table search
   */
  async clearSearch() {
    const searchInput = this.page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    await searchInput.clear();
    await this.page.waitForTimeout(500);
  }

  /**
   * Sort table by column
   */
  async sortByColumn(columnName: string) {
    const columnHeader = this.page.locator(`th:has-text("${columnName}"), [role="columnheader"]:has-text("${columnName}")`).first();
    await columnHeader.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Get row count
   */
  async getRowCount(): Promise<number> {
    const rows = await this.page.locator('tbody tr, [role="row"]:not([role="columnheader"])').count();
    return rows;
  }

  /**
   * Get cell value
   */
  async getCellValue(rowIndex: number, columnIndex: number): Promise<string> {
    const cell = this.page.locator(`tbody tr:nth-child(${rowIndex + 1}) td:nth-child(${columnIndex + 1})`).first();
    return await cell.textContent() || '';
  }

  /**
   * Click row by index
   */
  async clickRow(rowIndex: number) {
    const row = this.page.locator(`tbody tr:nth-child(${rowIndex + 1})`).first();
    await row.click();
  }

  /**
   * Select row checkbox
   */
  async selectRow(rowIndex: number) {
    const checkbox = this.page.locator(`tbody tr:nth-child(${rowIndex + 1}) input[type="checkbox"]`).first();
    await checkbox.check();
  }

  /**
   * Select all rows
   */
  async selectAllRows() {
    const selectAllCheckbox = this.page.locator('thead input[type="checkbox"], th input[type="checkbox"]').first();
    await selectAllCheckbox.check();
  }

  /**
   * Deselect all rows
   */
  async deselectAllRows() {
    const selectAllCheckbox = this.page.locator('thead input[type="checkbox"], th input[type="checkbox"]').first();
    await selectAllCheckbox.uncheck();
  }

  /**
   * Change page size
   */
  async changePageSize(size: number) {
    const pageSizeSelect = this.page.locator('select:has(option:has-text("per page")), [role="combobox"]:near(:text("per page"))').first();
    
    if (await pageSizeSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pageSizeSelect.selectOption(size.toString());
    } else {
      // Try custom select
      const trigger = this.page.locator('button:near(:text("per page"))').first();
      await trigger.click();
      await this.page.waitForTimeout(300);
      await this.page.locator(`[role="option"]:has-text("${size}")`).first().click();
    }
    
    await this.page.waitForTimeout(500);
  }

  /**
   * Go to next page
   */
  async goToNextPage() {
    const nextButton = this.page.locator('button:has-text("Next"), button[aria-label*="next" i]').first();
    await nextButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Go to previous page
   */
  async goToPreviousPage() {
    const prevButton = this.page.locator('button:has-text("Previous"), button:has-text("Prev"), button[aria-label*="previous" i]').first();
    await prevButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Go to specific page
   */
  async goToPage(pageNumber: number) {
    const pageButton = this.page.locator(`button:has-text("${pageNumber}")`).first();
    await pageButton.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Export table
   */
  async exportTable(format: 'csv' | 'excel' | 'pdf' = 'csv') {
    const exportButton = this.page.locator(`button:has-text("Export"), button:has-text("Download")`).first();
    
    // Start waiting for download before clicking
    const downloadPromise = this.page.waitForEvent('download');
    await exportButton.click();
    
    // If there's a format selector
    const formatOption = this.page.locator(`[role="menuitem"]:has-text("${format}"), button:has-text("${format}")`).first();
    if (await formatOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await formatOption.click();
    }
    
    const download = await downloadPromise;
    return download;
  }

  /**
   * Filter table
   */
  async filterTable(filterName: string, value: string) {
    const filterButton = this.page.locator('button:has-text("Filter"), button:has-text("Filters")').first();
    await filterButton.click();
    await this.page.waitForTimeout(300);
    
    // Find and fill filter input
    const filterInput = this.page.locator(`input[name*="${filterName}" i], label:has-text("${filterName}") + input`).first();
    await filterInput.fill(value);
    
    await this.page.waitForTimeout(500);
  }

  /**
   * Verify table has data
   */
  async verifyTableHasData() {
    const rowCount = await this.getRowCount();
    expect(rowCount).toBeGreaterThan(0);
  }

  /**
   * Verify table is empty
   */
  async verifyTableIsEmpty() {
    const emptyState = this.page.locator('text=/no.*found|no.*data|empty/i, [role="status"]:has-text(/no.*found/i)').first();
    await expect(emptyState).toBeVisible({ timeout: 5000 });
  }

  /**
   * Verify row contains text
   */
  async verifyRowContainsText(rowIndex: number, text: string) {
    const row = this.page.locator(`tbody tr:nth-child(${rowIndex + 1})`).first();
    await expect(row).toContainText(text);
  }

  /**
   * Find row by text
   */
  async findRowByText(text: string): Promise<number> {
    const rows = await this.page.locator('tbody tr').all();
    for (let i = 0; i < rows.length; i++) {
      const rowText = await rows[i].textContent();
      if (rowText?.includes(text)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Click action button in row
   */
  async clickRowAction(rowIndex: number, actionText: string) {
    const actionButton = this.page.locator(`tbody tr:nth-child(${rowIndex + 1}) button:has-text("${actionText}"), tbody tr:nth-child(${rowIndex + 1}) a:has-text("${actionText}")`).first();
    await actionButton.click();
  }

  /**
   * Verify column exists
   */
  async verifyColumnExists(columnName: string) {
    const column = this.page.locator(`th:has-text("${columnName}"), [role="columnheader"]:has-text("${columnName}")`).first();
    await expect(column).toBeVisible();
  }

  /**
   * Get column values
   */
  async getColumnValues(columnIndex: number): Promise<string[]> {
    const cells = await this.page.locator(`tbody tr td:nth-child(${columnIndex + 1})`).allTextContents();
    return cells;
  }
}
