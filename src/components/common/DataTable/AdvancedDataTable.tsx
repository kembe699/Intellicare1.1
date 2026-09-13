import React, { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown, Loader2, Download, Columns } from 'lucide-react';
import { LoadingState } from '@/components/common/LoadingState';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TablePagination } from './TablePagination';
import { TableSearch } from './TableSearch';
import { BulkActionsBar, BulkAction } from './BulkActionsBar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface Column<T> {
  key: keyof T | string;
  header: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  hidden?: boolean;
}

export interface PaginationConfig {
  enabled: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
}

export interface AdvancedDataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  loading?: boolean;
  /** Wording shown while the body loads. */
  loadingMessage?: string;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  rowClassName?: (row: T, index: number) => string;
  keyExtractor?: (row: T, index: number) => string | number;
  
  // Pagination
  pagination?: PaginationConfig;
  
  // Search
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Extra controls rendered in the toolbar next to the search box (e.g. a date-range filter). */
  toolbarExtra?: React.ReactNode;

  // Selection
  selectable?: boolean;
  onSelectionChange?: (selected: T[]) => void;
  
  // Export
  exportable?: boolean;
  exportFileName?: string;
  
  // Bulk Actions
  bulkActions?: BulkAction[];
  
  // Styling
  stickyHeader?: boolean;
  /**
   * Cap the table body's height, in rows, and scroll past it.
   *
   * Without a cap a long table simply keeps growing, and inside a card that
   * clips its overflow the rows past the edge become unreachable. Pass a row
   * count to hold the table to a fixed window instead. Implies a sticky header,
   * since a header that scrolls away leaves the columns unlabelled.
   */
  maxRows?: number;
  compact?: boolean;
}

export function AdvancedDataTable<T extends Record<string, any>>({
  data,
  columns: initialColumns,
  loading = false,
  loadingMessage = 'Loading...',
  emptyMessage = 'No data available',
  emptyIcon,
  onRowClick,
  className,
  rowClassName,
  keyExtractor = (_, index) => index,
  pagination,
  searchable = false,
  searchPlaceholder = 'Search...',
  toolbarExtra,
  selectable = false,
  onSelectionChange,
  exportable = false,
  exportFileName = 'export',
  bulkActions = [],
  stickyHeader = false,
  maxRows,
  compact = false,
}: AdvancedDataTableProps<T>) {
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(pagination?.pageSize || 20);
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const columns = useMemo(
    () => initialColumns.filter((col) => !hiddenColumns.has(col.key as string)),
    [initialColumns, hiddenColumns]
  );

  const handleSort = (columnKey: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig?.key === columnKey && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key: columnKey, direction });
  };

  const filteredData = useMemo(() => {
    if (!searchQuery) return data;

    return data.filter((row) => {
      return columns.some((column) => {
        const value = row[column.key];
        if (value === null || value === undefined) return false;
        return value.toString().toLowerCase().includes(searchQuery.toLowerCase());
      });
    });
  }, [data, searchQuery, columns]);

  const sortedData = useMemo(() => {
    if (!sortConfig) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      const comparison = aValue < bValue ? -1 : 1;
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    if (!pagination?.enabled) return sortedData;

    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize, pagination]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allKeys = paginatedData.map((row, index) => keyExtractor(row, index));
      setSelectedRows(new Set(allKeys));
    } else {
      setSelectedRows(new Set());
    }
  };

  const handleSelectRow = (key: string | number, checked: boolean) => {
    const newSelected = new Set(selectedRows);
    if (checked) {
      newSelected.add(key);
    } else {
      newSelected.delete(key);
    }
    setSelectedRows(newSelected);
  };

  const handleExport = () => {
    const csvContent = [
      columns.map((col) => col.header).join(','),
      ...sortedData.map((row) =>
        columns.map((col) => {
          const value = row[col.key];
          return typeof value === 'string' && value.includes(',')
            ? `"${value}"`
            : value;
        }).join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${exportFileName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleColumnVisibility = (columnKey: string) => {
    const newHidden = new Set(hiddenColumns);
    if (newHidden.has(columnKey)) {
      newHidden.delete(columnKey);
    } else {
      newHidden.add(columnKey);
    }
    setHiddenColumns(newHidden);
  };

  React.useEffect(() => {
    if (onSelectionChange) {
      const selected = paginatedData.filter((row, index) =>
        selectedRows.has(keyExtractor(row, index))
      );
      onSelectionChange(selected);
    }
  }, [selectedRows, paginatedData, onSelectionChange, keyExtractor]);

  // Loading no longer returns early. Replacing the whole component with a bare
  // spinner tore out the toolbar and the column headers, so the page visibly
  // reflowed the moment data arrived and the spinner appeared wherever the
  // table used to start — which is why waiting looked different from screen to
  // screen. The frame now stays put and only the body area shows the wait, at
  // the same height the empty state uses, so nothing moves.
  const isEmpty = paginatedData.length === 0;
  const emptyRowCount = pagination?.enabled ? Math.min(pageSize, 10) : 8;
  const emptyBodyHeight = (compact ? 37 : 41) * emptyRowCount;

  const allSelected = paginatedData.length > 0 && paginatedData.every((row, index) =>
    selectedRows.has(keyExtractor(row, index))
  );
  const someSelected = paginatedData.some((row, index) =>
    selectedRows.has(keyExtractor(row, index))
  );

  return (
    <div className={cn('bg-card rounded-md border border-border overflow-hidden', className)}>
      {/* Toolbar */}
      {(searchable || exportable || toolbarExtra || initialColumns.some((col) => col.hidden !== undefined)) && (
        <div className="flex items-center justify-between p-3 border-b border-border gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-0 flex-wrap">
            {searchable && (
              <div className="flex-1 min-w-[160px] max-w-2xl">
                <TableSearch
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={searchPlaceholder}
                />
              </div>
            )}
            {toolbarExtra}
          </div>
          <div className="flex items-center gap-2">
            {exportable && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="h-4 w-4 mr-2" />
                CSV
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns className="h-4 w-4 mr-2" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {initialColumns.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key as string}
                    checked={!hiddenColumns.has(col.key as string)}
                    onCheckedChange={() => toggleColumnVisibility(col.key as string)}
                  >
                    {col.header}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selectable && bulkActions.length > 0 && (
        <BulkActionsBar
          selectedCount={selectedRows.size}
          actions={bulkActions}
          onClearSelection={() => setSelectedRows(new Set())}
        />
      )}

      {/* Table */}
      <div
        className={cn('overflow-x-auto', maxRows && 'overflow-y-auto')}
        style={maxRows ? { maxHeight: `calc(${maxRows + 1} * 2.75rem)` } : undefined}
      >
        <table className="w-full border-collapse">
          <thead className={cn((stickyHeader || maxRows) && 'sticky top-0 z-10')}>
            {/* Opaque, not bg-muted/60, whenever the header is pinned: at 60%
                the rows sliding underneath read straight through it, so the
                first line of the list appeared to sit above the column names. */}
            <tr className={cn('border-b border-border', (stickyHeader || maxRows) ? 'bg-muted' : 'bg-muted/60')}>
              {selectable && (
                <th className="px-4 py-2.5 text-left w-12">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={handleSelectAll}
                    aria-label="Select all"
                  />
                </th>
              )}
              {columns.map((column, index) => (
                <th
                  key={index}
                  className={cn(
                    'px-4 text-left text-xs font-semibold text-foreground',
                    compact ? 'py-2' : 'py-2.5',
                    column.sortable && 'cursor-pointer hover:bg-muted/80 transition-colors',
                    column.align === 'center' && 'text-center',
                    column.align === 'right' && 'text-right'
                  )}
                  style={{ width: column.width }}
                  onClick={() => column.sortable && handleSort(column.key as string)}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2',
                      column.align === 'center' && 'justify-center',
                      column.align === 'right' && 'justify-end'
                    )}
                  >
                    <span>{column.header}</span>
                    {column.sortable && sortConfig?.key === column.key && (
                      sortConfig.direction === 'asc' ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="align-middle p-0"
                  style={{ height: `${emptyBodyHeight}px` }}
                >
                  <LoadingState variant="section" message={loadingMessage} className="py-0" />
                </td>
              </tr>
            ) : isEmpty ? (
              <tr>
                <td
                  colSpan={columns.length + (selectable ? 1 : 0)}
                  className="text-center align-middle"
                  style={{ height: `${emptyBodyHeight}px` }}
                >
                  {emptyIcon && <div className="mb-4 flex justify-center">{emptyIcon}</div>}
                  <p className="text-muted-foreground">{emptyMessage}</p>
                </td>
              </tr>
            ) : paginatedData.map((row, rowIndex) => {
              const rowKey = keyExtractor(row, rowIndex);
              const isSelected = selectedRows.has(rowKey);

              return (
                <tr
                  key={rowKey}
                  className={cn(
                    'border-b border-border transition-colors',
                    rowIndex % 2 === 1 && 'bg-muted/20',
                    'hover:bg-muted/50',
                    onRowClick && 'cursor-pointer',
                    isSelected && 'bg-primary/5',
                    rowClassName?.(row, rowIndex)
                  )}
                  onClick={() => onRowClick?.(row, rowIndex)}
                >
                  {selectable && (
                    <td className="px-4 py-2.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => handleSelectRow(rowKey, checked as boolean)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${rowIndex + 1}`}
                      />
                    </td>
                  )}
                  {columns.map((column, colIndex) => {
                    const value = row[column.key];
                    const content = column.render
                      ? column.render(value, row, rowIndex)
                      : value?.toString() || '-';

                    return (
                      <td
                        key={colIndex}
                        className={cn(
                          'px-4 text-sm',
                          compact ? 'py-2' : 'py-2.5',
                          column.align === 'center' && 'text-center',
                          column.align === 'right' && 'text-right'
                        )}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination?.enabled && (
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={sortedData.length}
          pageSizeOptions={pagination.pageSizeOptions}
          onPageChange={setCurrentPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}
