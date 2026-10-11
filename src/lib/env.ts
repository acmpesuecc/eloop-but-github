export const REQUIRED_ENV_VARS = [
    'ADMIN_EMAIL',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
    'NEXTAUTH_URL',
    'NEXTAUTH_SECRET',
    'QR_SECRET',
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN',
];

export function getMissingEnvVars(): string[] {
    return REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
}

export function hasMissingEnvVars(): boolean {
    return getMissingEnvVars().length > 0;
}
