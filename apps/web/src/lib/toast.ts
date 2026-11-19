import { reactive } from 'vue';
import { ApiError } from './api';

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info';
  message: string;
}

let nextId = 1;

export const toasts = reactive<Toast[]>([]);

export function pushToast(message: string, tone: Toast['tone'] = 'info'): void {
  const id = nextId++;
  toasts.push({ id, tone, message });
  setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4000);
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

export const notify = {
  success: (message: string) => pushToast(message, 'success'),
  error: (message: string) => pushToast(message, 'error'),
  info: (message: string) => pushToast(message, 'info'),
};

/** Turn any thrown value into a human sentence — validation issues included. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const details = error.details as { issues?: { path: (string | number)[]; message: string }[] } | undefined;
    const first = details?.issues?.[0];
    if (first) return `${first.path.join('.') || 'request'}: ${first.message}`;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}
