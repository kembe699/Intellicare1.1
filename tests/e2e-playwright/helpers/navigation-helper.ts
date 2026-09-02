import { Page, expect } from '@playwright/test';

/**
 * Navigation Helper for E2E Tests
 */
export class NavigationHelper {
  constructor(private page: Page) {}

  /**
   * Navigate to Dashboard
   */
  async goToDashboard() {
    await this.page.goto('/dashboard');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /dashboard/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Patients page
   */
  async goToPatients() {
    await this.page.goto('/patients');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /patient/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Clinical page
   */
  async goToClinical() {
    await this.page.goto('/clinical');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /clinical/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Laboratory page
   */
  async goToLaboratory() {
    await this.page.goto('/laboratory');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /lab/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Pharmacy page
   */
  async goToPharmacy() {
    await this.page.goto('/pharmacy-dashboard');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /pharmacy/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Patients Bill page
   */
  async goToPatientsBill() {
    await this.page.goto('/patients-bill');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /bill/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Receipts page
   */
  async goToReceipts() {
    await this.page.goto('/receipts');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /receipt/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Invoices page
   */
  async goToInvoices() {
    await this.page.goto('/invoices');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /invoice/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Accounting page
   */
  async goToAccounting() {
    await this.page.goto('/accounting');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /accounting/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Inventory page
   */
  async goToInventory() {
    await this.page.goto('/inventory');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /inventory/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Procurement page
   */
  async goToProcurement() {
    await this.page.goto('/procurement');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /procurement/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate to Reports page
   */
  async goToReports() {
    await this.page.goto('/reports');
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.locator('h1, h2').filter({ hasText: /report/i }).first()).toBeVisible({ timeout: 10000 });
  }

  /**
   * Navigate using sidebar menu
   */
  async navigateViaSidebar(menuText: string) {
    const menuItem = this.page.locator(`nav a:has-text("${menuText}"), nav button:has-text("${menuText}")`).first();
    await menuItem.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for page to load completely
   */
  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Check if on specific page
   */
  async isOnPage(urlPattern: string | RegExp): Promise<boolean> {
    const currentUrl = this.page.url();
    if (typeof urlPattern === 'string') {
      return currentUrl.includes(urlPattern);
    }
    return urlPattern.test(currentUrl);
  }
}
