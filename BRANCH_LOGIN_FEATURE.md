# Branch Selection Login Feature

## Overview

Added branch selection functionality to the login page that requires users to select their assigned branch before logging in. The system validates that users only have access to branches they are authorized to use.

---

## ✨ Features Implemented

### Frontend (Login Page)

1. **Branch Dropdown**
   - Fetches all available branches on page load
   - Displays branches in a searchable dropdown
   - Shows loading state while fetching branches
   - Building icon (Building2) for visual clarity
   - Matches the teal color scheme (#3D8A97)

2. **Validation**
   - Requires branch selection before login
   - Shows error if no branch is selected
   - Validates branch access before completing login
   - Clear error messages for unauthorized access

3. **User Experience**
   - Auto-loads branches when page loads
   - Placeholder text: "Choose your branch"
   - Loading state: "Loading branches..."
   - Seamless integration with existing login flow

### Backend (API Endpoints)

1. **Branch Verification Endpoint**
   - Route: `POST /api/auth/verify-branch-access`
   - Validates user credentials
   - Checks branch access permissions
   - Returns success or error with clear messages

2. **Access Control Logic**
   - Checks `user_branches` table for explicit assignments
   - Falls back to user's default `branch_id`
   - Admin users have access to all branches
   - Graceful fallback for legacy data

---

## 🔒 Security Features

### Branch Access Validation

The system validates branch access through multiple checks:

1. **Explicit Branch Assignment**
   ```sql
   SELECT ub.branch_id 
   FROM user_branches ub
   WHERE ub.user_id = ? AND ub.branch_id = ?
   ```

2. **Default Branch Check**
   - Validates against user's `branch_id` field

3. **Admin Override**
   - Admin users can access any branch

4. **Error Handling**
   - Clear error messages for unauthorized access
   - Graceful fallback for database errors

---

## 📋 API Documentation

### Verify Branch Access

**Endpoint:** `POST /api/auth/verify-branch-access`

**Request Body:**
```json
{
  "email": "user@hospital.com",
  "password": "userpassword",
  "branchId": 1
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Branch access verified"
}
```

**Error Responses:**

- **400 Bad Request:**
  ```json
  { "error": "Email, password, and branch are required" }
  ```

- **401 Unauthorized:**
  ```json
  { "error": "Invalid credentials" }
  { "error": "Account is disabled" }
  ```

- **403 Forbidden:**
  ```json
  { 
    "error": "You do not have access to the selected branch. Please contact your administrator." 
  }
  ```

- **500 Internal Server Error:**
  ```json
  { "error": "Verification failed" }
  ```

---

## 🎨 UI Components

### Branch Select Field

```tsx
<div className="space-y-2">
  <Label htmlFor="branch" className="text-sm font-semibold text-slate-700">
    <div className="flex items-center gap-2">
      <Building2 className="w-4 h-4" />
      <span>Select Branch</span>
    </div>
  </Label>
  <Select value={selectedBranch} onValueChange={setSelectedBranch} required>
    <SelectTrigger className="h-12 text-base border-slate-300 rounded-lg">
      <SelectValue placeholder="Choose your branch" />
    </SelectTrigger>
    <SelectContent>
      {branches.map((branch) => (
        <SelectItem key={branch.id} value={String(branch.id)}>
          {branch.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

---

## 🔄 Login Flow

### Updated Login Process

1. **User enters credentials**
   - Email address
   - **Branch selection** (new)
   - Password

2. **Branch validation**
   - System calls `/api/auth/verify-branch-access`
   - Validates credentials + branch access
   - Returns success or error

3. **Login completion**
   - If validation passes, proceed with normal login
   - User is authenticated and redirected to dashboard
   - If validation fails, show error message

### Flow Diagram

```
User Input (Email + Branch + Password)
         ↓
Validate Branch Selection
         ↓
Call /api/auth/verify-branch-access
         ↓
    ┌────┴────┐
    ↓         ↓
Success    Failure
    ↓         ↓
Sign In   Show Error
    ↓
Dashboard
```

---

## 💾 Database Schema

### Required Tables

1. **branches**
   ```sql
   CREATE TABLE branches (
     id SERIAL PRIMARY KEY,
     name VARCHAR(255) NOT NULL,
     facility_id INT,
     is_active BOOLEAN DEFAULT TRUE,
     ...
   );
   ```

2. **user_branches** (for explicit assignments)
   ```sql
   CREATE TABLE user_branches (
     user_id INT,
     branch_id INT,
     is_primary BOOLEAN DEFAULT FALSE,
     ...
   );
   ```

3. **users** (fallback branch_id)
   ```sql
   ALTER TABLE users ADD COLUMN branch_id INT;
   ```

---

## 🎯 Access Control Rules

### Who Can Access Which Branch?

1. **Regular Users**
   - Can only access branches in their `user_branches` table
   - Or their default `branch_id` if set
   - Cannot access other branches

2. **Admin Users**
   - Can access **any branch**
   - No restrictions on branch selection

3. **Users Without Branch Assignment**
   - Cannot login until assigned to a branch
   - Must contact administrator

---

## 🧪 Testing

### Test Scenarios

1. **Valid Branch Access**
   - User with branch assignment
   - Should login successfully

2. **Invalid Branch Access**
   - User selecting unauthorized branch
   - Should show error: "You do not have access to the selected branch"

3. **Admin Access**
   - Admin user selecting any branch
   - Should login successfully

4. **No Branch Selected**
   - User submitting without selecting branch
   - Should show error: "Please select a branch"

5. **Branch Loading**
   - Page load should fetch all branches
   - Dropdown should populate with branch names

---

## 🚀 Deployment Notes

### Prerequisites

1. Ensure `branches` table exists
2. Ensure `user_branches` table exists (optional, for explicit assignments)
3. Assign users to branches via admin panel

### Configuration

No additional configuration required. The feature uses existing:
- `/api/facilities/branches/all` endpoint (already exists)
- `/api/auth/verify-branch-access` endpoint (newly created)

---

## 📝 User Instructions

### For End Users

1. **Login Process**
   - Enter your email address
   - **Select your branch from the dropdown**
   - Enter your password
   - Click "Sign In Securely"

2. **If You Can't See Your Branch**
   - Contact your system administrator
   - They need to assign you to the branch

3. **If You Get "Access Denied" Error**
   - You selected a branch you're not assigned to
   - Select the correct branch or contact administrator

### For Administrators

1. **Assigning Users to Branches**
   - Use the user management interface
   - Add entries to `user_branches` table
   - Or set user's `branch_id` field

2. **Creating New Branches**
   - Use facilities management
   - New branches automatically appear in login dropdown

---

## 🎨 Design Specifications

### Colors
- Primary: `#3D8A97` (Teal)
- Hover: `#2d6a75` (Darker Teal)
- Border: `#cbd5e1` (Slate-300)

### Spacing
- Field Height: `48px` (h-12)
- Field Padding: `16px` (pl-4 pr-4)
- Vertical Gap: `20px` (space-y-5)

### Icons
- Branch Icon: `Building2` from Lucide React
- Size: `16px` (w-4 h-4)

---

## 🔧 Technical Details

### State Management

```tsx
const [selectedBranch, setSelectedBranch] = useState<string>('');
const [branches, setBranches] = useState<Branch[]>([]);
const [loadingBranches, setLoadingBranches] = useState(false);
```

### API Integration

```tsx
// Fetch branches on mount
useEffect(() => {
  const fetchBranches = async () => {
    const response = await fetch('/api/facilities/branches/all');
    const data = await response.json();
    setBranches(data.branches || []);
  };
  fetchBranches();
}, []);
```

### Validation Logic

```tsx
// Validate branch before login
const verifyResponse = await fetch('/api/auth/verify-branch-access', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, branchId: parseInt(selectedBranch) })
});
```

---

## ✅ Benefits

1. **Enhanced Security**
   - Users can only access authorized branches
   - Prevents unauthorized branch access

2. **Multi-Branch Support**
   - Users can work across multiple branches
   - Clear branch selection at login

3. **Audit Trail**
   - Know which branch user logged into
   - Better tracking and reporting

4. **User Experience**
   - Clear visual indication of branch selection
   - Intuitive dropdown interface
   - Helpful error messages

---

## 🐛 Troubleshooting

### Common Issues

1. **"No branches available"**
   - No branches exist in database
   - Create branches via facilities management

2. **"You do not have access to the selected branch"**
   - User not assigned to that branch
   - Admin needs to assign user to branch

3. **Branches not loading**
   - Check `/api/facilities/branches/all` endpoint
   - Verify database connection

4. **Login fails after branch selection**
   - Check `/api/auth/verify-branch-access` endpoint
   - Verify user credentials
   - Check server logs for errors

---

## 📊 Future Enhancements

### Potential Improvements

1. **Remember Last Branch**
   - Store user's last selected branch
   - Auto-select on next login

2. **Branch Switching**
   - Allow switching branches without logout
   - Quick branch selector in header

3. **Branch-Specific Dashboards**
   - Different dashboard per branch
   - Branch-specific metrics

4. **Branch Permissions**
   - Granular permissions per branch
   - Role-based access per branch

---

**Implementation Date:** April 10, 2026  
**Status:** ✅ Complete and Production Ready  
**Version:** 1.0.0
