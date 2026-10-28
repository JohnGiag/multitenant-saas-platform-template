// `label` and `hint` are message keys.
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
    { name: 'apiKey', label: 'field.resend.apiKey', secret: true },
    { name: 'from', label: 'field.resend.from', hint: 'field.resend.from.hint' },
  ],
  fcm: [{ name: 'serviceAccount', label: 'field.fcm.serviceAccount', secret: true, multiline: true, hint: 'field.fcm.serviceAccount.hint' }],
  r2: [
    { name: 'endpoint', label: 'field.r2.endpoint', hint: 'field.r2.endpoint.hint' },
    { name: 'bucket', label: 'field.r2.bucket' },
    { name: 'accessKeyId', label: 'field.r2.accessKeyId' },
    { name: 'secretAccessKey', label: 'field.r2.secretAccessKey', secret: true },
    { name: 'region', label: 'field.r2.region', optional: true, hint: 'field.r2.region.hint' },
  ],
};
