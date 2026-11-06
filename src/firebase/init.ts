'use client';

import { firebaseConfig } from '@/firebase/config';
import { FIRESTORE_DATABASE_ID } from '@/firebase/location';
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  // This check prevents Firebase from being initialized on the server.
  if (typeof window === 'undefined') {
    return {
      firebaseApp: null,
      firestore: null,
      storage: null,
      auth: null
    };
  }

  if (getApps().length) {
    return getSdks(getApp());
  }

  const firebaseApp = initializeApp(firebaseConfig);
  return getSdks(firebaseApp);
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    firestore: getFirestore(firebaseApp, FIRESTORE_DATABASE_ID),
    storage: getStorage(firebaseApp),
    auth: getAuth(firebaseApp),
  };
}
