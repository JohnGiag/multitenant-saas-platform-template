import { removeFixtures } from './fixtures';

export default function globalTeardown(): void {
  removeFixtures();
}
