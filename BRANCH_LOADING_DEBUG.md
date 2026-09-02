# Branch Loading Debugging Guide

## Issue
Branches exist in database but login page shows "No branches available"

---

## 🔍 Debugging Steps

### Step 1: Check Browser Console

Open the login page and check the browser console (F12 → Console tab). You should see:

```
Fetching branches from: /api/facilities/branches/all
Response status: 200
Branches API response: { success: true, data: [...] }
Extracted branches: [...]
Number of branches: X
✅ Loaded X branch(es)
```

**If you see errors instead:**
- Note the exact error message
- Check the response status code
- Look for network errors

---

### Step 2: Test API Endpoint Directly

Open a new browser tab and navigate to:
```
http://localhost:8080/api/facilities/branches/all
```

**Expected Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Main Branch",
      "facility_id": 1,
      "is_main_branch": true,
      "is_active": true,
      ...
    }
  ]
}
```

**If you get an error:**
- Check if server is running
- Check authentication (you may need to be logged in)
- Check server logs for errors

---

### Step 3: Check Server Logs

Look at your server console for:
```
✅ Branch ID columns ensured on all key tables
Server running on port 3002
```

**Look for errors like:**
- Database connection errors
- Table not found errors
- Query errors

---

### Step 4: Verify Database

Connect to your database and run:

```sql
-- Check if branches table exists
SELECT * FROM branches;

-- Check if Main Branch exists
SELECT * FROM branches WHERE name = 'Main Branch';

-- Count branches
SELECT COUNT(*) as branch_count FROM branches;
```

**Expected Result:**
- At least one branch should exist
- Main Branch should be visible

---

### Step 5: Check Authentication

The `/api/facilities/branches/all` endpoint is behind authentication middleware.

**Two options:**

1. **Make endpoint public** (for login page):
   ```javascript
   // In src/server/index.js, move this BEFORE authenticateToken:
   const facilitiesRouter = require('./routes/facilities');
   app.use('/api/facilities/branches/all', facilitiesRouter);
   ```

2. **Or modify the route to be public**:
   ```javascript
   // In src/server/routes/facilities.js
   // This route is already defined, just ensure it's accessible
   ```

---

## 🔧 Common Solutions

### Solution 1: Make Branches Endpoint Public

Since users need to see branches BEFORE logging in, the endpoint should be public.

**Edit `/src/server/index.js`:**

Find this section:
```javascript
// Authentication middleware scoped to /api only
const { authenticateToken } = require('./middleware/auth');
app.use('/api', authenticateToken);
```

**Add BEFORE the authentication middleware:**
```javascript
// Public routes (no authentication required)
const facilitiesRouter = require('./routes/facilities');
app.get('/api/facilities/branches/all', facilitiesRouter);

// Then apply auth to other routes
const { authenticateToken } = require('./middleware/auth');
app.use('/api', authenticateToken);
```

---

### Solution 2: Create Branches if None Exist

```sql
-- Insert a test branch
INSERT INTO branches (
  name, 
  is_main_branch, 
  is_active,
  phone,
  email,
  address,
  city,
  country
) VALUES (
  'Main Branch',
  true,
  true,
  '+211-XXX-XXXX',
  'main@hospital.com',
  'Main Street',
  'Juba',
  'South Sudan'
);
```

---

### Solution 3: Check CORS Settings

If you see CORS errors in console:

**Edit `/src/server/index.js`:**
```javascript
const corsOptions = {
  origin: (origin, callback) => {
    // Add your frontend URL
    const allowedOrigins = [
      'http://localhost:8080',
      'http://localhost:5173',
      // Add more as needed
    ];
    // ... rest of CORS config
  }
};
```

---

## 📋 Checklist

- [ ] Server is running on correct port
- [ ] Database connection is working
- [ ] Branches table exists
- [ ] At least one branch exists in database
- [ ] API endpoint returns data when accessed directly
- [ ] Browser console shows fetch attempt
- [ ] No CORS errors in browser console
- [ ] No authentication errors (401/403)
- [ ] Frontend is making request to correct URL

---

## 🐛 Error Messages & Solutions

### "No branches available - Contact admin"
**Cause:** API returned empty array  
**Solution:** Add branches to database

### "Failed to load branches. Please refresh the page."
**Cause:** API returned error status (4xx/5xx)  
**Solution:** Check server logs, verify endpoint works

### "Network error loading branches"
**Cause:** Fetch failed completely  
**Solution:** Check if server is running, check network connection

### 401 Unauthorized
**Cause:** Endpoint requires authentication  
**Solution:** Make endpoint public (see Solution 1)

### 404 Not Found
**Cause:** Endpoint doesn't exist or route not registered  
**Solution:** Verify route is registered in server/index.js

---

## 🔍 Advanced Debugging

### Enable Detailed Logging

**In `/src/server/routes/facilities.js`:**
```javascript
router.get('/branches/all', async (req, res) => {
  try {
    console.log('📍 Fetching all branches...');
    const [branches] = await sequelize.query(`
      SELECT * FROM branches ORDER BY is_main_branch DESC, name ASC
    `);
    console.log(`📍 Found ${branches.length} branches:`, branches);
    res.json({ success: true, data: branches });
  } catch (error) {
    console.error('❌ Error fetching branches:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch branches' });
  }
});
```

### Test with cURL

```bash
# Test from command line
curl http://localhost:8080/api/facilities/branches/all

# With authentication token
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:8080/api/facilities/branches/all
```

---

## 📞 Still Not Working?

1. **Restart the server**
   ```bash
   npm run server
   ```

2. **Clear browser cache**
   - Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)

3. **Check all files are saved**
   - Ensure changes to Login.tsx are saved
   - Ensure server files are saved

4. **Verify database connection**
   ```bash
   # Check if database is accessible
   psql -U your_user -d your_database -c "SELECT COUNT(*) FROM branches;"
   ```

---

## ✅ Success Indicators

When everything works, you should see:

**Browser Console:**
```
Fetching branches from: /api/facilities/branches/all
Response status: 200
Branches API response: {success: true, data: Array(1)}
Extracted branches: [{id: 1, name: "Main Branch", ...}]
Number of branches: 1
✅ Loaded 1 branch(es)
```

**Login Page:**
- Branch dropdown shows "Main Branch"
- Can select the branch
- No error messages

---

**Last Updated:** April 10, 2026  
**Status:** Debugging Guide
