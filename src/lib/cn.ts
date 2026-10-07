import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names; a later Tailwind class wins over an earlier one that sets the same thing. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
