# IntelliCare HMIS Design System

A comprehensive design system for building consistent, accessible, and maintainable UI components.

## Table of Contents

- [Design Tokens](#design-tokens)
- [Components](#components)
- [Usage Guidelines](#usage-guidelines)
- [Best Practices](#best-practices)

## Design Tokens

Design tokens are the foundational building blocks of our design system. They ensure consistency across the application.

### Importing Tokens

```typescript
import { spacing, colors, fontSize, borderRadius } from '@/design-system/tokens';
```

### Spacing Scale

Use the spacing scale for consistent margins, padding, and gaps:

```typescript
spacing.xs   // 8px  - Tight spacing
spacing.sm   // 12px - Small spacing
spacing.md   // 16px - Base spacing
spacing.lg   // 24px - Large spacing
spacing.xl   // 32px - Extra large spacing
spacing['2xl'] // 48px - 2x large spacing
spacing['3xl'] // 64px - 3x large spacing
```

**Example:**
```tsx
<div className="p-4">        {/* 16px padding */}
<div className="gap-6">      {/* 24px gap */}
<div className="mb-8">       {/* 32px margin-bottom */}
```

### Typography

#### Font Sizes
```typescript
fontSize.xs   // 12px - Small labels, captions
fontSize.sm   // 14px - Body text, table cells
fontSize.base // 16px - Default body text
fontSize.lg   // 18px - Subheadings
fontSize.xl   // 20px - Section headings
fontSize['2xl'] // 24px - Page titles
fontSize['3xl'] // 30px - Hero text
fontSize['4xl'] // 36px - Display text
```

#### Font Weights
```typescript
fontWeight.normal   // 400 - Body text
fontWeight.medium   // 500 - Emphasized text
fontWeight.semibold // 600 - Headings
fontWeight.bold     // 700 - Strong emphasis
```

**Example:**
```tsx
<h1 className="text-2xl font-bold">Dashboard</h1>
<p className="text-sm font-medium">Subtitle</p>
```

### Colors

Use semantic color tokens instead of arbitrary colors:

```typescript
// ✅ Good - Semantic colors
<div className="text-success">Active</div>
<div className="text-warning">Pending</div>
<div className="text-destructive">Error</div>

// ❌ Bad - Arbitrary colors
<div className="text-green-600">Active</div>
<div className="text-orange-500">Pending</div>
<div className="text-red-500">Error</div>
```

#### Available Semantic Colors

- `primary` - Brand color, primary actions
- `secondary` - Secondary actions, backgrounds
- `success` - Success states, positive indicators
- `warning` - Warning states, caution indicators
- `destructive` - Error states, dangerous actions
- `info` - Informational messages
- `muted` - Subdued text, disabled states

### Border Radius

```typescript
borderRadius.sm  // 4px  - Small elements
borderRadius.md  // 6px  - Default
borderRadius.lg  // 8px  - Cards, containers
borderRadius.xl  // 12px - Large containers
borderRadius.full // 9999px - Pills, avatars
```

### Shadows

```typescript
shadows.sm  // Subtle shadow
shadows.md  // Default shadow
shadows.lg  // Elevated shadow
shadows.xl  // High elevation
```

## Components

### StatCard

Display key metrics with icons and optional trend indicators.

```tsx
import { StatCard } from '@/components/common';
import { Users } from 'lucide-react';

<StatCard
  title="Total Patients"
  value={1234}
  icon={Users}
  trend={{ value: 12, isPositive: true }}
  onClick={() => navigate('/patients')}
  iconColor="text-primary"
  iconBgColor="bg-primary/10"
/>
```

**Props:**
- `title` (string) - Card title
- `value` (string | number) - Main metric value
- `icon` (LucideIcon) - Icon component
- `trend?` (object) - Optional trend indicator
- `onClick?` (function) - Optional click handler
- `iconColor?` (string) - Icon color class (default: 'text-primary')
- `iconBgColor?` (string) - Icon background class (default: 'bg-primary/10')

### PageHeader

Consistent page headers with breadcrumbs and actions.

```tsx
import { PageHeader } from '@/components/common';
import { Button } from '@/components/ui/button';

<PageHeader
  title="Dashboard"
  subtitle="Welcome back, John Doe"
  breadcrumbs={[
    { label: 'Home', href: '/' },
    { label: 'Dashboard' }
  ]}
  actions={
    <Button>New Patient</Button>
  }
/>
```

**Props:**
- `title` (string) - Page title
- `subtitle?` (string) - Optional subtitle
- `breadcrumbs?` (Breadcrumb[]) - Optional breadcrumb navigation
- `actions?` (ReactNode) - Optional action buttons
- `className?` (string) - Additional CSS classes

### DataTable

Sortable, responsive data tables with custom rendering.

```tsx
import { DataTable } from '@/components/common';

const columns = [
  {
    key: 'name',
    header: 'Patient Name',
    sortable: true,
  },
  {
    key: 'status',
    header: 'Status',
    render: (value) => (
      <Badge variant={value === 'active' ? 'success' : 'default'}>
        {value}
      </Badge>
    ),
  },
];

<DataTable
  data={patients}
  columns={columns}
  loading={isLoading}
  emptyMessage="No patients found"
  onRowClick={(patient) => navigate(`/patients/${patient.id}`)}
/>
```

**Props:**
- `data` (T[]) - Array of data objects
- `columns` (Column<T>[]) - Column definitions
- `loading?` (boolean) - Loading state
- `emptyMessage?` (string) - Empty state message
- `onRowClick?` (function) - Row click handler
- `className?` (string) - Additional CSS classes

### LoadingState

Consistent loading indicators.

```tsx
import { LoadingState } from '@/components/common';

<LoadingState message="Loading patients..." size="md" />
```

**Props:**
- `message?` (string) - Loading message
- `size?` ('sm' | 'md' | 'lg') - Spinner size
- `className?` (string) - Additional CSS classes

## Usage Guidelines

### Component Composition

Build complex UIs by composing simple components:

```tsx
import { PageHeader, StatCard, DataTable } from '@/components/common';

function Dashboard() {
  return (
    <AppLayout>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your clinic"
      />
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard title="Patients" value={120} icon={Users} />
        <StatCard title="Visits" value={45} icon={Activity} />
        <StatCard title="Revenue" value="$12,500" icon={DollarSign} />
      </div>
      
      <DataTable
        data={recentVisits}
        columns={visitColumns}
        loading={isLoading}
      />
    </AppLayout>
  );
}
```

### Responsive Design

Use Tailwind's responsive prefixes:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {/* 1 column on mobile, 2 on tablet, 4 on desktop */}
</div>

<div className="p-4 lg:p-6">
  {/* 16px padding on mobile, 24px on desktop */}
</div>
```

### Accessibility

Always include proper ARIA labels and keyboard navigation:

```tsx
<button
  aria-label="Close modal"
  onClick={handleClose}
>
  <X className="h-4 w-4" />
</button>

<input
  aria-describedby="email-error"
  aria-invalid={!!errors.email}
/>
```

## Best Practices

### 1. Use Design Tokens

❌ **Don't:**
```tsx
<div className="p-[18px] text-[#2563eb]">
```

✅ **Do:**
```tsx
<div className="p-4 text-primary">
```

### 2. Consistent Spacing

❌ **Don't:**
```tsx
<div className="mb-3">
<div className="mb-5">
<div className="mb-7">
```

✅ **Do:**
```tsx
<div className="mb-4">  {/* 16px */}
<div className="mb-6">  {/* 24px */}
<div className="mb-8">  {/* 32px */}
```

### 3. Semantic Colors

❌ **Don't:**
```tsx
<span className="text-green-600">Success</span>
<span className="text-red-500">Error</span>
```

✅ **Do:**
```tsx
<span className="text-success">Success</span>
<span className="text-destructive">Error</span>
```

### 4. Component Reuse

❌ **Don't:**
```tsx
<div className="bg-card rounded-md border p-6">
  <h3 className="text-lg font-semibold">Title</h3>
  <p className="text-2xl font-bold">{value}</p>
</div>
```

✅ **Do:**
```tsx
<StatCard title="Title" value={value} icon={Icon} />
```

### 5. TypeScript Types

❌ **Don't:**
```tsx
function MyComponent(props: any) {
  return <div>{props.title}</div>;
}
```

✅ **Do:**
```tsx
interface MyComponentProps {
  title: string;
  value: number;
  onClick?: () => void;
}

function MyComponent({ title, value, onClick }: MyComponentProps) {
  return <div onClick={onClick}>{title}: {value}</div>;
}
```

## Migration Guide

### Updating Existing Components

1. **Replace custom headers:**
   ```tsx
   // Before
   <div className="module-header">
     <h1>Dashboard</h1>
   </div>
   
   // After
   <PageHeader title="Dashboard" />
   ```

2. **Replace custom stat cards:**
   ```tsx
   // Before
   <div className="stat-card">
     <div className="stat-title">Total Patients</div>
     <div className="stat-value">{count}</div>
   </div>
   
   // After
   <StatCard title="Total Patients" value={count} icon={Users} />
   ```

3. **Replace custom tables:**
   ```tsx
   // Before
   <table className="data-table">
     <thead>...</thead>
     <tbody>...</tbody>
   </table>
   
   // After
   <DataTable data={data} columns={columns} />
   ```

## Support

For questions or issues with the design system, please:
1. Check this documentation
2. Review component examples in `/src/components/common/`
3. Consult the design tokens in `/src/design-system/tokens.ts`
