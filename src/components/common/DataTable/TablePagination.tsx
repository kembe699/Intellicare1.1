import React from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export interface TablePaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export const TablePagination: React.FC<TablePaginationProps> = ({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
}) => {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  // 10 is always offered as a page size, regardless of what each page passes
  // in — a plain, non-searchable list this short doesn't need a search box.
  const sizeOptions = Array.from(new Set([10, ...pageSizeOptions])).sort((a, b) => a - b);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Rows per page:</span>
        <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="h-8 w-[70px] px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizeOptions.map((size) => (
              <SelectItem key={size} value={size.toString()}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-6">
        <span className="text-sm text-muted-foreground">
          {startItem}-{endItem} of {totalItems}
        </span>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            className="h-8 w-8 p-0"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium px-2">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            className="h-8 w-8 p-0"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
