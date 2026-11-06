import 'package:firebase_core/firebase_core.dart';

import 'data_location.dart';

/// Android app `com.sahadiesel.intake` ในโปรเจกต์ Firebase เดียวกับเว็บสหดีเซล
class DefaultFirebaseOptions {
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBMd4vo-pY80I4Nkm9uPvycTM8VE6zAyAs',
    appId: '1:556589129076:web:03e9686e0554031c912021',
    messagingSenderId: '556589129076',
    projectId: 'studio-5187516946-67996',
    authDomain: 'studio-5187516946-67996.firebaseapp.com',
    storageBucket: storageBucketName,
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyAiDwnbQ1YVZ_4FFZnG_WAwT8hfwLEWP80',
    appId: '1:556589129076:android:d32f696d88fa5029912021',
    messagingSenderId: '556589129076',
    projectId: 'studio-5187516946-67996',
    storageBucket: storageBucketName,
  );
}
