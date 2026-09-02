# Table Display Standards - System-Wide

## ✅ Core Principle: ONE DATA POINT PER COLUMN

**Every piece of data must be in its own separate column. Never stack multiple data points in the same column.**

---

## ❌ WRONG - Stacked Data

```
| Patient ID | Patient Details              | Contact    |
|------------|------------------------------|------------|
| UH-069947  | Narting Abui Joseph          | No phone   |
|            | 37 years • male              |            |
```

**Problems:**
- Name, age, and gender are stacked in one column
- Hard to scan and compare data
- Difficult to sort by age or gender
- Wastes vertical space

---

## ✅ CORRECT - Separate Columns

```
| Patient ID | Name                | Age    | Gender | Phone    | Occupation |
|------------|---------------------|--------|--------|----------|------------|
| UH-069947  | Narting Abui Joseph | 37 yrs | Male   | No phone | -          |
```

**Benefits:**
- Each data point has its own column
- Easy to scan horizontally
- Can sort by any column
- Compact, single-line rows
- Professional appearance

---

## 📋 Standard Column Structure

### For Patient Tables

| Column | Width | Sortable | Format |
|--------|-------|----------|--------|
| Patient ID | 120px | Yes | Monospace, primary color |
| Name | Auto | Yes | Bold, foreground color |
| Age | 80px | Yes | "37 yrs" format |
| Gender | 100px | Yes | Capitalized |
| Phone | 140px | No | Plain text or "-" |
| Occupation | Auto | No | Plain text or "-" |
| Registered | 120px | Yes | "Jan 15, 2024" format |
| By | 120px | No | Muted color |
| Actions | 180px | No | Buttons |

### For Clinical/Visit Tables

| Column | Width | Sortable | Format |
|--------|-------|----------|--------|
| Visit ID | 120px | Yes | Monospace |
| Patient Name | Auto | Yes | Bold |
| Age | 80px | Yes | "37 yrs" |
| Gender | 100px | Yes | Capitalized |
| Chief Complaint | Auto | No | Plain text |
| Doctor | 150px | Yes | Plain text |
| Date | 120px | Yes | "Jan 15, 2024" |
| Status | 100px | Yes | Badge/colored |
| Actions | 150px | No | Buttons |

### For Lab Tests Tables

| Column | Width | Sortable | Format |
|--------|-------|----------|--------|
| Test ID | 120px | Yes | Monospace |
| Patient Name | Auto | Yes | Bold |
| Test Name | Auto | Yes | Plain text |
| Requested By | 150px | Yes | Plain text |
| Date | 120px | Yes | "Jan 15, 2024" |
| Status | 100px | Yes | Badge |
| Priority | 100px | Yes | Badge |
| Actions | 150px | No | Buttons |

### For Pharmacy/Inventory Tables

| Column | Width | Sortable | Format |
|--------|-------|----------|--------|
| Item Code | 120px | Yes | Monospace |
| Item Name | Auto | Yes | Bold |
| Category | 150px | Yes | Plain text |
| Quantity | 100px | Yes | Number |
| Unit | 80px | No | Plain text |
| Price | 120px | Yes | Currency format |
| Expiry Date | 120px | Yes | "Jan 15, 2024" |
| Status | 100px | Yes | Badge |
| Actions | 150px | No | Buttons |

---

## 🎨 Rendering Guidelines

### 1. Text Formatting

```tsx
// IDs - Monospace, primary color
<span className="font-mono font-semibold text-primary">{value}</span>

// Names - Bold, foreground
<span className="font-semibold text-foreground">{value}</span>

// Regular data - Small, normal
<span className="text-sm">{value}</span>

// Secondary info - Small, muted
<span className="text-sm text-muted-foreground">{value}</span>

// Empty values - Always use dash
<span className="text-sm">-</span>
```

### 2. Date Formatting

```tsx
// Always use consistent date format
{new Date(value).toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})}
// Output: "Jan 15, 2024"
```

### 3. Number Formatting

```tsx
// Age
{value ? `${value} yrs` : '-'}

// Currency
{value ? `${currency}${value.toLocaleString()}` : '-'}

// Quantity
{value ? value.toLocaleString() : '0'}
```

### 4. Status/Badge Formatting

```tsx
// Use Badge component with variants
<Badge variant={status === 'active' ? 'success' : 'default'}>
  {status}
</Badge>
```

---

## 📐 Column Width Guidelines

### Fixed Widths (Use These)
- **IDs**: 120px
- **Age**: 80px
- **Gender**: 100px
- **Phone**: 140px
- **Date**: 120px
- **Status**: 100px
- **Amount**: 120px
- **Actions**: 150-180px

### Auto Widths (Flexible)
- **Name**: Auto (main identifier)
- **Description**: Auto
- **Notes**: Auto
- **Address**: Auto

---

## 🚫 Common Mistakes to Avoid

### ❌ Don't Stack Data
```tsx
// WRONG
<div>
  <div>{name}</div>
  <div>{age} years • {gender}</div>
</div>
```

### ✅ Use Separate Columns
```tsx
// CORRECT
columns = [
  { key: 'name', header: 'Name' },
  { key: 'age', header: 'Age' },
  { key: 'gender', header: 'Gender' },
]
```

### ❌ Don't Use Icons Everywhere
```tsx
// WRONG - Too cluttered
<Phone className="w-3 h-3" /> {phoneNumber}
<Mail className="w-3 h-3" /> {email}
```

### ✅ Keep It Clean
```tsx
// CORRECT - Just the data
<span>{phoneNumber}</span>
<span>{email}</span>
```

### ❌ Don't Wrap Text
```tsx
// WRONG - Creates multi-line rows
<div className="whitespace-normal">{longText}</div>
```

### ✅ Use Ellipsis
```tsx
// CORRECT - Keeps single line
<div className="truncate max-w-[200px]" title={longText}>
  {longText}
</div>
```

---

## 📊 Implementation Checklist

When creating or updating a table:

- [ ] Each data field has its own column
- [ ] All rows display on a single line
- [ ] Column widths are consistent (use COLUMN_WIDTHS)
- [ ] Text formatting is consistent (use renderFunctions)
- [ ] Empty values show "-" not blank
- [ ] Dates use standard format (Jan 15, 2024)
- [ ] IDs use monospace font
- [ ] Names are bold
- [ ] Important columns are sortable
- [ ] Actions column is right-aligned
- [ ] No unnecessary icons cluttering data
- [ ] Table is responsive on mobile

---

## 🔧 Using the Standard Configuration

Import and use the standard column configurations:

```tsx
import { COLUMN_WIDTHS, renderFunctions } from '@/config/tableColumns';

const columns = [
  {
    key: 'patientId',
    header: 'Patient ID',
    sortable: true,
    width: COLUMN_WIDTHS.patientId,
    render: renderFunctions.patientId,
  },
  {
    key: 'fullName',
    header: 'Name',
    sortable: true,
    render: renderFunctions.name,
  },
  {
    key: 'age',
    header: 'Age',
    sortable: true,
    width: COLUMN_WIDTHS.age,
    render: renderFunctions.age,
  },
  {
    key: 'gender',
    header: 'Gender',
    sortable: true,
    width: COLUMN_WIDTHS.gender,
    render: renderFunctions.gender,
  },
  // ... more columns
];
```

---

## 🎯 Summary

**Golden Rule**: **ONE DATA POINT = ONE COLUMN**

- Name → Name column
- Age → Age column  
- Gender → Gender column
- Phone → Phone column
- Occupation → Occupation column

**Never combine them!**

This ensures:
✅ Clean, scannable tables
✅ Easy sorting and filtering
✅ Professional appearance
✅ Better user experience
✅ Consistent across all pages

---

## 📁 Files to Update

Apply these standards to all table implementations:

1. `/src/pages/Patients.tsx` ✅ **DONE**
2. `/src/pages/Clinical.tsx`
3. `/src/pages/Laboratory.tsx`
4. `/src/pages/Pharmacy.tsx`
5. `/src/pages/PatientsBill.tsx`
6. `/src/pages/Receipts.tsx`
7. `/src/pages/Invoices.tsx`
8. All other pages with tables

**Use the AdvancedDataTable component with proper column configuration for all tables!**
