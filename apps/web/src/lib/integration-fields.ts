export interface IntegrationField {
  name: string;
  label: string;
  secret?: boolean;
  multiline?: boolean;
  optional?: boolean;
  hint?: string;
}

// Config forms for the integrations of the bundled optional modules (apps/api/src/optional/*). A provider not
// listed here, from a module added later, gets a raw JSON editor, so installing a module needs no dashboard change.
export const INTEGRATION_FIELDS: Record<string, IntegrationField[]> = {
  resend: [
    { name: 'apiKey', label: 'API key', secret: true },
    { name: 'from', label: 'Sender', hint: 'e.g. Acme <no-reply@acme.com>, on a domain verified in Resend.' },
  ],
  fcm: [{ name: 'serviceAccount', label: 'Service account JSON', secret: true, multiline: true, hint: 'The key file from Firebase → Project settings → Service accounts.' }],
  r2: [
    { name: 'endpoint', label: 'Endpoint', hint: 'e.g. https://<account-id>.r2.cloudflarestorage.com' },
    { name: 'bucket', label: 'Bucket' },
    { name: 'accessKeyId', label: 'Access key ID' },
    { name: 'secretAccessKey', label: 'Secret access key', secret: true },
    { name: 'region', label: 'Region', optional: true, hint: 'Leave empty for R2 ("auto").' },
  ],
};
