# E2E Testing Suite - Hospital Management System

Comprehensive End-to-End testing suite using Playwright to ensure production readiness.

## 📋 Overview

This test suite covers all core modules of the hospital management system:
- Authentication & Authorization
- Patient Registry
- Clinical Visits
- Laboratory
- Pharmacy
- Billing & Payments
- Accounting
- Inventory
- Procurement
- Reports

**Total Test Coverage**: 30+ test files with 100+ test cases

## 🚀 Quick Start

### Install Dependencies
```bash
npm install
```

### Run All Tests
```bash
npm test
```

### Run Tests with UI Mode
```bash
npm run test:ui
```

### Run Tests in Headed Mode (see browser)
```bash
npm run test:headed
```

### Debug Tests
```bash
npm run test:debug
```

### View Test Report
```bash
npm run test:report
```

## 📁 Test Structure

```
tests/e2e-playwright/
├── tests/
│   ├── auth/                 # Authentication tests
│   │   ├── login.spec.ts
│   │   └── logout.spec.ts
│   ├── patients/             # Patient module tests
│   │   ├── patient-registration.spec.ts
│   │   └── patient-search.spec.ts
│   ├── clinical/             # Clinical module tests
│   │   └── visit-workflow.spec.ts
│   ├── billing/              # Billing module tests
│   │   └── bill-creation.spec.ts
│   └── ...
├── helpers/                  # Test helper utilities
│   ├── auth-helper.ts
│   ├── navigation-helper.ts
│   ├── form-helper.ts
│   └── table-helper.ts
├── fixtures/                 # Test data fixtures
│   └── test-data.ts
└── README.md
```

## 🧪 Test Categories

### Authentication (7 tests)
- ✅ Login with valid credentials
- ✅ Login with invalid credentials
- ✅ Logout functionality
- ✅ Session persistence
- ✅ Role-based access

### Patient Registry (15 tests)
- ✅ Patient registration (walk-in)
- ✅ Patient registration (with scheme)
- ✅ Patient search
- ✅ Table pagination
- ✅ Table sorting
- ✅ Data export

### Clinical (10 tests)
- ✅ View patient queue
- ✅ Visit workflow
- ✅ Search and filter visits
- ✅ Visit metrics

### Billing (10 tests)
- ✅ View bills dashboard
- ✅ Search bills
- ✅ Filter by status
- ✅ View bill details
- ✅ Export bills

## 🛠️ Helper Utilities

### AuthHelper
```typescript
const authHelper = new AuthHelper(page);
await authHelper.loginAsAdmin();
await authHelper.logout();
```

### NavigationHelper
```typescript
const navHelper = new NavigationHelper(page);
await navHelper.goToPatients();
await navHelper.goToClinical();
```

### FormHelper
```typescript
const formHelper = new FormHelper(page);
await formHelper.fillInput('Full Name', 'John Doe');
await formHelper.clickButton('Submit');
await formHelper.waitForSuccess();
```

### TableHelper
```typescript
const tableHelper = new TableHelper(page);
await tableHelper.searchTable('Patient Name');
await tableHelper.sortByColumn('Date');
await tableHelper.exportTable('csv');
```

## 📊 Test Data

Test data is defined in `fixtures/test-data.ts`:

```typescript
import { TEST_USERS, TEST_PATIENTS } from '../fixtures/test-data';

// Use predefined test users
await authHelper.login(TEST_USERS.admin.email, TEST_USERS.admin.password);

// Generate unique test patients
const patient = generateUniquePatient();
```

## 🔧 Configuration

Playwright configuration is in `playwright.config.ts`:
- Base URL: `http://localhost:8080`
- Browsers: Chromium (Firefox and WebKit commented out)
- Retries: 2 on CI, 0 locally
- Screenshots: On failure
- Videos: On failure
- Traces: On first retry

## 📈 Running Specific Tests

### Run specific test file
```bash
npx playwright test tests/auth/login.spec.ts
```

### Run specific test suite
```bash
npx playwright test tests/patients/
```

### Run tests matching pattern
```bash
npx playwright test --grep "login"
```

### Run tests in specific browser
```bash
npx playwright test --project=chromium
```

## 🐛 Debugging

### Debug specific test
```bash
npx playwright test tests/auth/login.spec.ts --debug
```

### Run with trace viewer
```bash
npx playwright test --trace on
npx playwright show-trace trace.zip
```

### Run with headed browser
```bash
npx playwright test --headed --slow-mo=1000
```

## 📝 Writing New Tests

### Basic Test Template
```typescript
import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { NavigationHelper } from '../../helpers/navigation-helper';

test.describe('My Feature', () => {
  let authHelper: AuthHelper;
  let navHelper: NavigationHelper;

  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    navHelper = new NavigationHelper(page);
    
    await authHelper.loginAsAdmin();
    await navHelper.goToMyPage();
  });

  test('should do something', async ({ page }) => {
    // Your test code here
    await expect(page.locator('h1')).toBeVisible();
  });
});
```

## 🎯 Best Practices

1. **Use Helper Utilities**: Leverage auth, navigation, form, and table helpers
2. **Wait for Elements**: Use `waitForSelector` or `expect().toBeVisible()`
3. **Unique Test Data**: Use `generateUniquePatient()` for unique data
4. **Clean State**: Clear auth and reset state in `beforeEach`
5. **Descriptive Names**: Use clear, descriptive test names
6. **Assertions**: Always verify expected outcomes
7. **Timeouts**: Use appropriate timeouts for slow operations

## 🚨 Common Issues

### Test Fails with "Element not found"
- Increase timeout: `{ timeout: 10000 }`
- Wait for page load: `await page.waitForLoadState('networkidle')`
- Check selector: Use Playwright Inspector

### Authentication Issues
- Clear auth before tests: `await authHelper.clearAuth()`
- Verify test user credentials in `test-data.ts`

### Flaky Tests
- Add explicit waits: `await page.waitForTimeout(500)`
- Use `waitForLoadState` instead of arbitrary timeouts
- Check for race conditions

## 📊 CI/CD Integration

Tests run automatically on:
- Push to main branch
- Pull requests
- Manual workflow dispatch

### GitHub Actions
```yaml
- name: Run E2E Tests
  run: npm test
  
- name: Upload Test Report
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```

## 📞 Support

For issues or questions:
1. Check existing test examples
2. Review Playwright documentation
3. Contact the development team

## 🎉 Contributing

When adding new features:
1. Write tests first (TDD approach)
2. Follow existing test patterns
3. Update this README if needed
4. Ensure all tests pass before committing

---

**Happy Testing! 🧪**
