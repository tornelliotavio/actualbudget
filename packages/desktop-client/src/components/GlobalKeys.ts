import { useEffect } from 'react';

import * as Platform from '@actual-app/core/shared/platform';

import { useDefaultRoute } from '#components/home/useDefaultRoute';
import { useNavigate } from '#hooks/useNavigate';

export function GlobalKeys() {
  const navigate = useNavigate();
  const defaultRoute = useDefaultRoute();
  useEffect(() => {
    const handleKeys = (e: KeyboardEvent) => {
      if (Platform.isBrowser) {
        return;
      }

      if (e.metaKey) {
        switch (e.key) {
          case '1':
            void navigate(defaultRoute);
            break;
          case '2':
            void navigate('/reports');
            break;
          case '3':
            void navigate('/accounts');
            break;
          case ',':
            if (Platform.OS === 'mac') {
              void navigate('/settings');
            }
            break;
          default:
        }
      }
    };

    document.addEventListener('keydown', handleKeys);

    return () => document.removeEventListener('keydown', handleKeys);
  }, [navigate, defaultRoute]);

  return null;
}
