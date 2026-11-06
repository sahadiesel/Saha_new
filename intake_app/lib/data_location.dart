import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';

const firestoreDatabaseId = 'shddatasg';
const storageBucketName = 'shd-bucket-sg';

FirebaseFirestore get appFirestore => FirebaseFirestore.instanceFor(
      app: Firebase.app(),
      databaseId: firestoreDatabaseId,
    );

FirebaseStorage get appStorage => FirebaseStorage.instanceFor(
      app: Firebase.app(),
      bucket: storageBucketName,
    );

String storageFileUrl(String url) {
  const legacy = [
    'studio-5187516946-67996.firebasestorage.app',
    'studio-5187516946-67996.appspot.com',
  ];
  var out = url;
  for (final bucket in legacy) {
    out = out.replaceAll(bucket, storageBucketName);
  }
  return out;
}
