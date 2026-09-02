import { Page, expect } from '@playwright/test';
import { TEST_USERS } from '../fixtures/test-data';

/**
 * Authentication Helper for E2E Tests
 */
export class AuthHelper {
  constructor(private page: Page) {}

  /**
   * Login with username and password
   */
  async login(email: string, password: string) {
    await this.page.goto('/login');
    
    // Wait for login form to be visible
    await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
    
    // Fill in credentials
    await this.page.fill('input[type="email"], input[name="email"]', email);
    await this.page.fill('input[type="password"], input[name="password"]', password);
    
    // Click login button and wait for navigation
    await this.page.click('button[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    
    // Wait for navigation away from login page
    await this.page.waitForURL(url => !url.toString().includes('/login'), { timeout: 20000 });
    
    // Wait for page to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    
    // Give the app a moment to settle
    await this.page.waitForTimeout(1000);
  }

  /**
   * Login as a specific role
   */
  async loginAsRole(role: keyof typeof TEST_USERS) {
    const user = TEST_USERS[role];
    await this.login(user.email, user.password);
  }

  /**
   * Login as admin
   */
  async loginAsAdmin() {
    await this.loginAsRole('admin');
  }

  /**
   * Login as doctor
   */
  async loginAsDoctor() {
    await this.loginAsRole('doctor');
  }

  /**
   * Login as pharmacist
   */
  async loginAsPharmacist() {
    await this.loginAsRole('pharmacist');
  }

  /**
   * Login as lab technician
   */
  async loginAsLab() {
    await this.loginAsRole('lab');
  }

  /**
   * Login as receptionist
   */
  async loginAsReceptionist() {
    await this.loginAsRole('reception');
  }

  /**
   * Logout from the application
   */
  async logout() {
    try {
      // Try to find and click logout button
      const logoutButton = this.page.locator('button:has-text("Logout"), button:has-text("Sign Out"), a:has-text("Logout"), a:has-text("Sign Out")').first();
      
      if (await logoutButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await logoutButton.click();
      } else {
        // Try to find user menu and click it first
        const userMenu = this.page.locator('[aria-label*="user"], [aria-label*="profile"], button:has(svg)').last();
        if (await userMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
          await userMenu.click();
          await this.page.waitForTimeout(500);
          await this.page.locator('button:has-text("Logout"), a:has-text("Logout")').first().click();
        }
      }
      
      // Wait for redirect to login page
      await this.page.waitForURL(/\/login/, { timeout: 10000 });
    } catch (error) {
      // If logout fails, just navigate to login
      await this.page.goto('/login');
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const currentUrl = this.page.url();
      
      // If on login page, definitely not authenticated
      if (currentUrl.includes('/login')) {
        return false;
      }
      
      // Check if we have an auth token
      const token = await this.getAuthToken();
      if (token) {
        return true;
      }
      
      // Check for any navigation elements that only appear when logged in
      const navElements = await this.page.locator('nav, [role="navigation"], aside').count();
      return navElements > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensure user is authenticated, login if not
   */
  async ensureAuthenticated(role: keyof typeof TEST_USERS = 'admin') {
    const authenticated = await this.isAuthenticated();
    if (!authenticated) {
      await this.loginAsRole(role);
    }
  }

  /**
   * Get authentication token from storage
   */
  async getAuthToken(): Promise<string | null> {
    const token = await this.page.evaluate(() => {
      return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
    });
    return token;
  }

  /**
   * Set authentication token in storage
   */
  async setAuthToken(token: string) {
    await this.page.evaluate((t) => {
      localStorage.setItem('auth_token', t);
    }, token);
  }

  /**
   * Clear authentication
   */
  async clearAuth() {
    try {
      // Navigate to login page first to ensure we have access to localStorage
      await this.page.goto('/login', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      
      await this.page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      });
    } catch (error) {
      // If clearing fails, just continue - we'll login fresh anyway
      console.log('Note: Could not clear auth storage, continuing...');
    }
  }
}
