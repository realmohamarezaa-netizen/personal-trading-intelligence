// ─── Application identity — single source of truth for version & downloads ───

export const APP_NAME = 'Personal Trading Intelligence'
export const APP_VERSION = '1.2.0'

/** Windows installer file name shipped in /public */
export const INSTALLER_FILE_NAME = `PTI-Setup-${APP_VERSION}.exe`

/** Local dashboard endpoint that streams the installer (resume-friendly) */
export const INSTALLER_DOWNLOAD_URL = '/api/download'

/** Fallback when the local installer file is absent (e.g. dev checkout) */
export const GITHUB_REPO = 'realmohamarezaa-netizen/personal-trading-intelligence'
export const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases/latest`
