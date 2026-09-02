import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { TEST_USERS } from '../../fixtures/test-data';

test.describe('Authentication - Login', () => {
  let authHelper: AuthHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await authHelper.clearAuth();
  });

  test('should login successfully with valid admin credentials', async ({ page }) => {
    await authHelper.login(TEST_USERS.admin.email, TEST_USERS.admin.password);
    
    // Verify we're on dashboard or home page
    expect(page.url()).toMatch(/\/(dashboard|home|patients|clinical)/);
    
    // Verify user is authenticated
    const isAuth = await authHelper.isAuthenticated();
    expect(isAuth).toBe(true);
  });

  test('should login successfully with valid doctor credentials', async ({ page }) => {
    await authHelper.loginAsDoctor();
    
    // Verify authentication
    const isAuth = await authHelper.isAuthenticated();
    expect(isAuth).toBe(true);
  });

  test('should login successfully with valid receptionist credentials', async ({ page }) => {
    await authHelper.loginAsReceptionist();
    
    // Verify authentication
    const isAuth = await authHelper.isAuthenticated();
    expect(isAuth).toBe(true);
  });

  test('should fail login with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    // Fill in invalid credentials
    await page.fill('input[type="email"], input[name="email"]', 'invalid@hospital.com');
    await page.fill('input[type="password"], input[name="password"]', 'WrongPassword123');
    
    // Click login button
    await page.click('button[type="submit"]');
    
    // Wait for error message
    await expect(page.locator('text=/invalid|incorrect|failed/i').first()).toBeVisible({ timeout: 5000 });
    
    // Verify still on login page
    expect(page.url()).toContain('/login');
  });

  test('should fail login with empty credentials', async ({ page }) => {
    await page.goto('/login');
    
    // Click login without filling credentials
    await page.click('button[type="submit"]');
    
    // Should show validation error or stay on login page
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/login');
  });

  test('should persist session after page refresh', async ({ page }) => {
    await authHelper.loginAsAdmin();
    
    // Refresh page
    await page.reload();
    
    // Verify still authenticated
    const isAuth = await authHelper.isAuthenticated();
    expect(isAuth).toBe(true);
  });

  test('should have auth token in storage after login', async ({ page }) => {
    await authHelper.loginAsAdmin();
    
    // Check for auth token
    const token = await authHelper.getAuthToken();
    expect(token).toBeTruthy();
  });
});
