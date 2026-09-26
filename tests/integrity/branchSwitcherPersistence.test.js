/**
 * Two complaints about the TopBar branch switcher:
 * 1. Changing branch only updated context state — most pages fetch their
 *    data once on mount (plain useEffect), so nothing already on screen
 *    picked up the new branch until the user manually refreshed.
 * 2. signOut() and a failed token-verify both wiped current_branch_id from
 *    localStorage, and signIn() unconditionally reset an admin to "All
 *    Branches" — so a chosen branch never survived logging out and back in,
 *    even though the intent was for it to "stay locked" per browser.
 */
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

describe('switchBranch reloads the page so the new branch takes effect immediately', () => {
  const src = read('src/contexts/AuthContext.tsx');
  const fnSrc = src.slice(src.indexOf('const switchBranch = '), src.indexOf('const switchBranch = ') + 700);

  test('calls window.location.reload() after updating state/localStorage', () => {
    expect(fnSrc).toMatch(/window\.location\.reload\(\);/);
  });
});

describe('the chosen branch survives sign-out and a fresh sign-in', () => {
  const src = read('src/contexts/AuthContext.tsx');

  test('signOut() no longer clears current_branch_id', () => {
    const fnSrc = src.slice(src.indexOf('const signOut = async'), src.indexOf('const signOut = async') + 600);
    expect(fnSrc).not.toMatch(/localStorage\.removeItem\('current_branch_id'\)/);
    expect(fnSrc).toMatch(/localStorage\.removeItem\('auth_token'\)/);
  });

  test('a failed token verification on load no longer clears current_branch_id either', () => {
    const fnSrc = src.slice(src.indexOf('const checkExistingAuth = async'), src.indexOf('const signIn = async'));
    const catchBlock = fnSrc.slice(fnSrc.indexOf('} catch (error) {'));
    expect(catchBlock).not.toMatch(/localStorage\.removeItem\('current_branch_id'\)/);
  });

  test("signIn() restores an admin's previously-saved branch instead of always resetting to All Branches", () => {
    const fnSrc = src.slice(src.indexOf('const signIn = async'), src.indexOf('const signOut = async'));
    expect(fnSrc).toMatch(/if \(normalizedUser\.isAdmin\) \{\s*\n\s*const savedBranchId = localStorage\.getItem\('current_branch_id'\);\s*\n\s*setCurrentBranchId\(savedBranchId \? parseInt\(savedBranchId, 10\) : null\);/);
    // Must not unconditionally wipe it on every login anymore
    expect(fnSrc).not.toMatch(/if \(normalizedUser\.isAdmin\) \{\s*\n\s*localStorage\.removeItem\('current_branch_id'\);/);
  });

  test('a non-admin still always resolves to their own real assigned branch, ignoring any stale saved value', () => {
    const fnSrc = src.slice(src.indexOf('const signIn = async'), src.indexOf('const signOut = async'));
    expect(fnSrc).toMatch(/const nextBranchId = normalizedUser\.primaryBranchId \|\| normalizedUser\.branchId \|\| null;/);
  });
});
