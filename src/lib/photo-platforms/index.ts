// src/lib/photo-platforms/index.ts
//
// Registry of available platform adapters. The rest of the app gets
// adapters from `getAdapter(platformId, env)` and never imports a
// specific implementation directly.
//
// Adding a new platform = write a new adapter file, add a row in the
// switch below + the SUPPORTED_PLATFORMS list. Nothing else changes.

import type { PhotoPlatformAdapter } from './adapter';
import { DropboxAdapter } from './dropbox';
import { SmugMugAdapter } from './smugmug';

export interface PlatformEnv {
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  SMUGMUG_CONSUMER_KEY?: string;
  SMUGMUG_CONSUMER_SECRET?: string;
}

export interface SupportedPlatform {
  id: 'dropbox' | 'smugmug';
  displayName: string;
  /** Whether the env vars are configured. UI uses this to grey out
   *  "Connect" buttons when we haven't filled in credentials yet. */
  configured: boolean;
}

export function listSupportedPlatforms(env: PlatformEnv): SupportedPlatform[] {
  return [
    {
      id: 'dropbox',
      displayName: 'Dropbox',
      configured: !!(env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET),
    },
    {
      id: 'smugmug',
      displayName: 'SmugMug',
      configured: !!(env.SMUGMUG_CONSUMER_KEY && env.SMUGMUG_CONSUMER_SECRET),
    },
  ];
}

/**
 * Returns null if the platform isn't supported OR if its credentials
 * aren't configured. Callers should surface this as
 * "platform not configured" to the user.
 */
export function getAdapter(
  platformId: string,
  env: PlatformEnv,
): PhotoPlatformAdapter | null {
  switch (platformId) {
    case 'dropbox':
      if (!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET) return null;
      return new DropboxAdapter({
        appKey: env.DROPBOX_APP_KEY,
        appSecret: env.DROPBOX_APP_SECRET,
      });
    case 'smugmug':
      if (!env.SMUGMUG_CONSUMER_KEY || !env.SMUGMUG_CONSUMER_SECRET) return null;
      return new SmugMugAdapter({
        consumerKey: env.SMUGMUG_CONSUMER_KEY,
        consumerSecret: env.SMUGMUG_CONSUMER_SECRET,
      });
    default:
      return null;
  }
}

export type {
  PhotoPlatformAdapter,
  PlatformToken,
  PlatformAccountInfo,
  PlatformGallery,
  PlatformPhoto,
  DownloadedPhoto,
  PlatformErrorCode,
} from './adapter';
export { PlatformError } from './adapter';
