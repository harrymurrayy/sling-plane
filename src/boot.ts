import { bootNative } from './native';

// Saves have to be back in place before the game reads them
bootNative().finally(() => import('./main'));
