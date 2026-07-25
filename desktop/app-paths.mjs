import { join, resolve } from 'node:path'

export function resolveStaticRoot({ isPackaged, desktopDir, resourcesPath }) {
  return isPackaged
    ? join(resourcesPath, 'app')
    : resolve(desktopDir, '..')
}
