// ─── Application identity — single source of truth for version & downloads ───

export const APP_NAME = 'Personal Trading Intelligence'
export const APP_VERSION = '1.3.3'

/** The .exe inside the downloadable package */
export const INSTALLER_EXE_FILE_NAME = `PTI-Setup-${APP_VERSION}.exe`

/**
 * What the dashboard actually serves: the installer wrapped in a ZIP.
 * A .zip survives proxies/AV scanners that mangle raw .exe downloads,
 * always keeps its extension, and carries its own CRC integrity check —
 * the SHA-256 shown in Settings refers to this ZIP file.
 */
export const INSTALLER_FILE_NAME = `PTI-Setup-${APP_VERSION}.zip`

/** Local dashboard endpoint that streams the installer (resume-friendly) */
export const INSTALLER_DOWNLOAD_URL = '/api/download'

/** Fallback when the local installer file is absent (e.g. dev checkout) */
export const GITHUB_REPO = 'realmohamarezaa-netizen/personal-trading-intelligence'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`
