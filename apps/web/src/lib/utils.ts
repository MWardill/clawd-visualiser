import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists, letting later classes win. Used by every shadcn component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
