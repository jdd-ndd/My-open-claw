export const SHARED_CHANNEL_ID = 'myopenclaw';
export const SHARED_USER_ID = 'shared-user';

export function resolveSharedChannelId(explicitValue?: string): string {
  const value = explicitValue?.trim();
  return value || SHARED_CHANNEL_ID;
}

export function resolveSharedUserId(explicitValue?: string): string {
  const value = explicitValue?.trim();
  return value || SHARED_USER_ID;
}
