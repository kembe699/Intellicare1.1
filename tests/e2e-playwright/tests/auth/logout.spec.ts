import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';

test.describe('Authentication - Logout', () => {
  let authHelper: AuthHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await authHelper.clearAuth();
    await authHelper.loginAsAdmin();
  });

  test('should logout successfully', async ({ page }) => {
    // Perform logout
    await authHelper.logout();
    
    // Verify redirected to login page
    expect(page.url()).toContain('/login');
    
    // Verify not authenticated
    const isAuth = await authHelper.isAuthenticated();
    expect(isAuth).toBe(false);
  });

  test('should clear auth token on logout', async ({ page }) => {
    // Verify token exists before logout
    let token = await authHelper.getAuthToken();
    expect(token).toBeTruthy();
    
    // Logout
    await authHelper.logout();
    
    // Verify token is cleared
    token = await authHelper.getAuthToken();
    expect(token).toBeFalsy();
  });

  test('should redirect to login when accessing protected page after logout', async ({ page }) => {
    // Logout
    await authHelper.logout();
    
    // Try to access protected page
    await page.goto('/patients');
    
    // Should redirect to login
    await page.waitForURL(/\/login/, { timeout: 5000 });
    expect(page.url()).toContain('/login');
  });
});
