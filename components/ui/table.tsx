import * as React from "react"

import { cn } from "@/lib/utils"

/*
 * Table — native table markup (unchanged exports) with Untitled UI React table styling
 * (`components/application/table/table.tsx`, MIT): tinted sentence-case header, quiet rows,
 * hover tint, tabular numbers. Wrap in <TableCard> when the table stands alone on the canvas;
 * inside a Panel use the bare <Table>.
 */

function TableCard({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary", className)} data-slot="table-card" {...props} />
}

function Table({ className, containerClassName, ...props }: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div className={cn("relative w-full overflow-x-auto", containerClassName)} data-slot="table-container">
      <table className={cn("w-full caption-bottom text-sm tabular-nums", className)} data-slot="table" {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-secondary [&_tr]:border-b [&_tr]:border-secondary [&_tr]:hover:bg-transparent", className)} data-slot="table-header" {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} data-slot="table-body" {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot className={cn("border-t border-secondary bg-secondary font-medium [&>tr]:last:border-b-0", className)} data-slot="table-footer" {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-secondary transition-colors duration-100 hover:bg-primary_hover has-aria-expanded:bg-active aria-selected:bg-active data-[state=selected]:bg-active",
        className,
      )}
      data-slot="table-row"
      {...props}
    />
  )
}

type CellAlign = { /** Right-align with tabular figures (counts, ms, scores). */ numeric?: boolean }

function TableHead({ className, numeric, ...props }: React.ComponentProps<"th"> & CellAlign) {
  return (
    <th
      className={cn(
        "h-10 px-4 text-left align-middle text-xs font-medium whitespace-nowrap text-quaternary [&:has([role=checkbox])]:pr-0",
        numeric && "text-right",
        className,
      )}
      data-slot="table-head"
      {...props}
    />
  )
}

function TableCell({ className, numeric, ...props }: React.ComponentProps<"td"> & CellAlign) {
  return (
    <td
      className={cn("px-4 py-3 align-middle whitespace-nowrap text-secondary [&:has([role=checkbox])]:pr-0", numeric && "text-right tabular-nums", className)}
      data-slot="table-cell"
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption className={cn("mt-4 text-sm text-tertiary", className)} data-slot="table-caption" {...props} />
}

export { Table, TableBody, TableCaption, TableCard, TableCell, TableFooter, TableHead, TableHeader, TableRow }
