/**
 * Shared credentials of the read-only demo account shown on the login page.
 *
 * The demo user is a `demoClient`, so the company scope rejects its writes;
 * publishing the password is intended.
 */
export const DEMO_ACCOUNT = { email: 'u-demo@example.com', password: 'demo1234' } as const
