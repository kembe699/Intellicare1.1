import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { TEST_USERS } from '../../fixtures/test-data';

test.describe('Authentication - Simple Login Test', () => {
  let authHelper: AuthHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await authHelper.clearAuth();
  });

  test('should login with real credentials and verify', async ({ page }) => {
    // Login
    await authHelper.login(TEST_USERS.admin.email, TEST_USERS.admin.password);
    
    // Log current URL for debugging
    console.log('Current URL after login:', page.url());
    
    // Verify we're not on login page
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/login');
    
    // Verify we're authenticated
    const isAuth = await authHelper.isAuthenticated();
    console.log('Is authenticated:', isAuth);
    expect(isAuth).toBe(true);
    
    // Take a screenshot for verification
    await page.screenshot({ path: 'test-results/login-success.png', fullPage: true });
  });
});
