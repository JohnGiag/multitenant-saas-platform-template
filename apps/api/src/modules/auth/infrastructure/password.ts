import { hash, verify } from '@node-rs/argon2';

// The one place passwords are hashed and checked: Argon2id with the library's defaults
// (19 MiB, 2 passes), stored as a PHC string that records its own parameters.
export const hashPassword = (password: string): Promise<string> => hash(password);
export const verifyPassword = (passwordHash: string, password: string): Promise<boolean> => verify(passwordHash, password);
