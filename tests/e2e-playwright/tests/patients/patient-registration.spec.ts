import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { NavigationHelper } from '../../helpers/navigation-helper';
import { FormHelper } from '../../helpers/form-helper';
import { TableHelper } from '../../helpers/table-helper';
import { generateUniquePatient, TEST_PATIENTS } from '../../fixtures/test-data';

test.describe('Patient Registration', () => {
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
    await navHelper.goToPatients();
  });

  test('should register new walk-in patient successfully', async ({ page }) => {
    const patient = generateUniquePatient();
    
    // Click New Patient button
    await formHelper.clickButton('New Patient');
    
    // Wait for modal/form to appear
    await page.waitForTimeout(500);
    
    // Fill patient details
    await formHelper.fillInput('Full Name', patient.fullName);
    await formHelper.fillInput('Age', patient.age);
    await formHelper.selectOption('Gender', patient.gender);
    await formHelper.fillInput('Phone', patient.phoneNumber);
    await formHelper.fillInput('Occupation', patient.occupation);
    
    // Submit form
    await formHelper.clickButton('Register');
    
    // Wait for success message
    await formHelper.waitForSuccess();
    
    // Verify patient appears in table
    await tableHelper.searchTable(patient.fullName);
    await page.waitForTimeout(1000);
    await tableHelper.verifyTableHasData();
  });

  test('should register patient with scheme', async ({ page }) => {
    const patient = generateUniquePatient(TEST_PATIENTS.withScheme);
    
    // Click New Patient button
    await formHelper.clickButton('New Patient');
    await page.waitForTimeout(500);
    
    // Fill patient details
    await formHelper.fillInput('Full Name', patient.fullName);
    await formHelper.fillInput('Age', patient.age);
    await formHelper.selectOption('Gender', patient.gender);
    await formHelper.fillInput('Phone', patient.phoneNumber);
    
    // Select scheme
    await formHelper.selectOption('Beneficiary Type', 'NHIF');
    await formHelper.fillInput('Member Number', patient.memberNumber || 'NHIF123456');
    
    // Submit form
    await formHelper.clickButton('Register');
    
    // Wait for success
    await formHelper.waitForSuccess();
    
    // Verify patient in table
    await tableHelper.searchTable(patient.fullName);
    await page.waitForTimeout(1000);
    await tableHelper.verifyTableHasData();
  });

  test('should validate required fields', async ({ page }) => {
    // Click New Patient button
    await formHelper.clickButton('New Patient');
    await page.waitForTimeout(500);
    
    // Try to submit without filling required fields
    await formHelper.clickButton('Register');
    
    // Should show validation errors
    await page.waitForTimeout(1000);
    
    // Form should still be visible (not submitted)
    const formVisible = await page.locator('input[placeholder*="name" i], input[name*="name" i]').first().isVisible();
    expect(formVisible).toBe(true);
  });

  test('should cancel patient registration', async ({ page }) => {
    // Click New Patient button
    await formHelper.clickButton('New Patient');
    await page.waitForTimeout(500);
    
    // Fill some data
    await formHelper.fillInput('Full Name', 'Test Cancel Patient');
    
    // Click Cancel
    await formHelper.clickButton('Cancel');
    
    // Modal should close
    await page.waitForTimeout(500);
    const modalClosed = await page.locator('input[placeholder*="name" i]').first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(modalClosed).toBe(false);
  });
});
