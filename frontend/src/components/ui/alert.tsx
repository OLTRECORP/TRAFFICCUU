import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("rounded-md border px-4 py-3 text-sm", {
  variants: {
    variant: {
      error: "border-red-200 bg-red-50 text-red-800",
      success: "border-emerald-200 bg-emerald-50 text-emerald-800",
      info: "border-blue-200 bg-blue-50 text-blue-800",
    },
  },
  defaultVariants: { variant: "info" },
});

export const Alert = ({ className, variant, ...p }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) => (
  <div role="alert" className={cn(alertVariants({ variant }), className)} {...p} />
);
