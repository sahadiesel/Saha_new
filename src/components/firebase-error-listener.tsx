'use client';

import { useEffect } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';

/**
 * A central listener component that catches FirestorePermissionErrors 
 * emitted throughout the application.
 */
export function FirebaseErrorListener() {
  useEffect(() => {
    const unsubscribe = errorEmitter.on('permission-error', (error: any) => {
      // In development, we want to see the rich error overlay
      if (process.env.NODE_ENV === 'development') {
        throw error;
      } else {
        // In production, we log it to prevent crashing the entire app
        // but still allow the developer to see it in the console/logs
        console.error("Firestore Permission Error Context:", error.context);
        console.error("Firestore Permission Error Message:", error.message);
      }
    });
    
    // In our simple emitter, we don't have a direct unsubscribe mechanism yet
    // but we can at least log that the listener is active
  }, []);

  return null;
}
