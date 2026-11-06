import 'package:cloud_firestore/cloud_firestore.dart';

const firestoreDatabaseId = 'shddatasg';
const storageBucketName = 'shd-bucket-sg';

FirebaseFirestore get appFirestore => FirebaseFirestore.instanceFor(databaseId: firestoreDatabaseId);

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
