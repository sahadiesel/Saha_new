'use client';

import React, { useMemo, type ReactNode } from 'react';
import { initializeFirebase } from '@/firebase/init';
import { FirebaseProvider } from './provider';
import { FirebaseErrorListener } from '@/components/firebase-error-listener';

export function FirebaseClientProvider({ children }: { children: ReactNode }) {
  const services = useMemo(() => {
    return initializeFirebase();
  }, []);

  // During SSR, services might contain nulls. 
  // We still render children to avoid total blank screen, 
  // hooks inside will handle null Firebase instances gracefully.
  return (
    <FirebaseProvider 
      firebaseApp={services.firebaseApp} 
      firestore={services.firestore} 
      auth={services.auth}
      storage={services.storage}
    >
      <FirebaseErrorListener />
      {children}
    </FirebaseProvider>
  );
}