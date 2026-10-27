// Plain-text bodies of the emails the platform sends. Each link carries a single-use token.

export function invitationEmail(input: { tenantName: string; role: string; link: string; expiresAt: Date }) {
  return {
    subject: `You're invited to ${input.tenantName}`,
    text: [
      `You have been invited to join ${input.tenantName} as ${input.role}.`,
      '',
      `Choose your password to accept: ${input.link}`,
      '',
      `This link works once and expires on ${input.expiresAt.toUTCString()}.`,
      'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n'),
  };
}

export function passwordResetEmail(input: { tenantName: string; link: string }) {
  return {
    subject: `Reset your ${input.tenantName} password`,
    text: [
      `Someone asked to reset the password of your ${input.tenantName} account.`,
      '',
      `Choose a new password: ${input.link}`,
      '',
      'This link works once and expires in 1 hour.',
      'If it was not you, ignore this email: your password stays the same.',
    ].join('\n'),
  };
}
