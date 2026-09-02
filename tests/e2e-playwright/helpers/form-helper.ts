import { Page, Locator, expect } from '@playwright/test';

/**
 * Form Helper for E2E Tests
 */
export class FormHelper {
  constructor(private page: Page) {}

  /**
   * Fill input field by label or placeholder
   */
  async fillInput(labelOrPlaceholder: string, value: string) {
    // Try by label first
    let input = this.page.locator(`label:has-text("${labelOrPlaceholder}") + input, label:has-text("${labelOrPlaceholder}") input`).first();
    
    if (!await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Try by placeholder
      input = this.page.locator(`input[placeholder*="${labelOrPlaceholder}" i]`).first();
    }
    
    if (!await input.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Try by name attribute
      input = this.page.locator(`input[name*="${labelOrPlaceholder.toLowerCase().replace(/\s+/g, '')}" i]`).first();
    }
    
    await input.fill(value);
  }

  /**
   * Fill input by exact selector
   */
  async fillInputBySelector(selector: string, value: string) {
    await this.page.fill(selector, value);
  }

  /**
   * Select option from dropdown
   */
  async selectOption(labelOrPlaceholder: string, value: string) {
    // Try to find select element by label
    let select = this.page.locator(`label:has-text("${labelOrPlaceholder}") + select, label:has-text("${labelOrPlaceholder}") select`).first();
    
    if (await select.isVisible({ timeout: 2000 }).catch(() => false)) {
      await select.selectOption({ label: value });
      return;
    }
    
    // Try custom select (Radix UI or similar)
    const trigger = this.page.locator(`button:has-text("${labelOrPlaceholder}"), [role="combobox"]:has-text("${labelOrPlaceholder}")`).first();
    if (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) {
      await trigger.click();
      await this.page.waitForTimeout(300);
      await this.page.locator(`[role="option"]:has-text("${value}"), [role="menuitem"]:has-text("${value}")`).first().click();
    }
  }

  /**
   * Click button by text
   */
  async clickButton(text: string) {
    const button = this.page.locator(`button:has-text("${text}"), a:has-text("${text}")`).first();
    await button.click();
  }

  /**
   * Click button by exact selector
   */
  async clickButtonBySelector(selector: string) {
    await this.page.click(selector);
  }

  /**
   * Submit form
   */
  async submitForm() {
    await this.page.locator('button[type="submit"]').first().click();
  }

  /**
   * Wait for success message
   */
  async waitForSuccess(message?: string) {
    if (message) {
      await expect(this.page.locator(`text=${message}`).first()).toBeVisible({ timeout: 10000 });
    } else {
      // Look for common success indicators
      await expect(
        this.page.locator('text=/success|saved|created|updated|completed/i, [role="alert"]:has-text(/success/i)').first()
      ).toBeVisible({ timeout: 10000 });
    }
  }

  /**
   * Wait for error message
   */
  async waitForError(message?: string) {
    if (message) {
      await expect(this.page.locator(`text=${message}`).first()).toBeVisible({ timeout: 10000 });
    } else {
      // Look for common error indicators
      await expect(
        this.page.locator('text=/error|failed|invalid/i, [role="alert"]:has-text(/error/i)').first()
      ).toBeVisible({ timeout: 10000 });
    }
  }

  /**
   * Check checkbox
   */
  async checkCheckbox(label: string) {
    const checkbox = this.page.locator(`label:has-text("${label}") input[type="checkbox"], input[type="checkbox"][name*="${label.toLowerCase()}"]`).first();
    await checkbox.check();
  }

  /**
   * Uncheck checkbox
   */
  async uncheckCheckbox(label: string) {
    const checkbox = this.page.locator(`label:has-text("${label}") input[type="checkbox"], input[type="checkbox"][name*="${label.toLowerCase()}"]`).first();
    await checkbox.uncheck();
  }

  /**
   * Fill textarea
   */
  async fillTextarea(labelOrPlaceholder: string, value: string) {
    const textarea = this.page.locator(`label:has-text("${labelOrPlaceholder}") + textarea, label:has-text("${labelOrPlaceholder}") textarea, textarea[placeholder*="${labelOrPlaceholder}" i]`).first();
    await textarea.fill(value);
  }

  /**
   * Upload file
   */
  async uploadFile(inputSelector: string, filePath: string) {
    await this.page.setInputFiles(inputSelector, filePath);
  }

  /**
   * Clear form
   */
  async clearForm() {
    await this.page.evaluate(() => {
      const inputs = document.querySelectorAll('input, textarea, select');
      inputs.forEach((input: any) => {
        if (input.type !== 'submit' && input.type !== 'button') {
          input.value = '';
        }
      });
    });
  }

  /**
   * Verify field has value
   */
  async verifyFieldValue(label: string, expectedValue: string) {
    const input = this.page.locator(`label:has-text("${label}") + input, label:has-text("${label}") input`).first();
    await expect(input).toHaveValue(expectedValue);
  }

  /**
   * Verify field has error
   */
  async verifyFieldError(label: string) {
    const error = this.page.locator(`label:has-text("${label}") ~ .error, label:has-text("${label}") ~ [role="alert"]`).first();
    await expect(error).toBeVisible();
  }
}
