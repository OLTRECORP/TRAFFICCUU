import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const mxn = (n: number | null | undefined) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n ?? 0);

export const km = (n: number | null | undefined) =>
  `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(n ?? 0)} km`;

export const fechaMx = (iso: string) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
