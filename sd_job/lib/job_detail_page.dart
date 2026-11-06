import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import 'data_location.dart';
import 'job.dart';
import 'job_actions.dart';
import 'job_notes.dart';
import 'job_photo.dart';
import 'staff.dart';

class JobDetailPage extends StatelessWidget {
  const JobDetailPage({super.key, required this.staff, required this.jobId});

  final Staff staff;
  final String jobId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sahadiesel Job Manage')),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: appFirestore.collection('jobs').doc(jobId).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(child: Text('โหลดงานไม่สำเร็จ\n${snapshot.error}', textAlign: TextAlign.center));
          }
          final doc = snapshot.data;
          if (doc == null || !doc.exists) {
            return const Center(child: CircularProgressIndicator());
          }
          final job = jobFromDoc(doc.id, doc.data() ?? const {});
          final actions = jobActions(staff, job);
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            children: [
              Text(job.customerName, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text('${job.displayNo} · ${statusLabel(job.status)}'),
              if (job.phone.isNotEmpty) Text(job.phone),
              Text(shopLabel(job.department)),
              if ((job.assigneeName ?? '').isNotEmpty) Text('ผู้รับงาน: ${job.assigneeName}'),
              if (job.description.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(job.description),
              ],
              for (final line in job.detailLines) Text('${line.$1}: ${line.$2}'),
              if (job.photos.isNotEmpty) ...[
                const SizedBox(height: 12),
                SizedBox(
                  height: 140,
                  child: ListView.separated(
                    scrollDirection: Axis.horizontal,
                    itemCount: job.photos.length,
                    separatorBuilder: (context, index) => const SizedBox(width: 8),
                    itemBuilder: (context, index) => ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: JobPhoto(url: job.photos[index], width: 180, height: 140),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 16),
              NotebookSection(job: job),
              const SizedBox(height: 12),
              const Text('แนบรูประหว่างดำเนินการ', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text('ถ่ายหรือเลือกรูป แล้วเขียนคำอธิบายว่ารูปแสดงอะไร'),
              const SizedBox(height: 8),
              ProgressPhotoButton(staff: staff, job: job),
              const SizedBox(height: 16),
              for (final action in actions) ...[
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => confirmJobAction(context, staff, job, action),
                    child: Text(actionLabel(action)),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              if (job.status == 'PENDING_PARTS' && !actions.contains(JobAction.partsReady) && !actions.contains(JobAction.skipParts))
                const Text('ขั้นจัดอะไหล่ทำใบเบิกบนเว็บก่อน แล้วกลับมากดว่าอะไหล่มาครบ'),
              const SizedBox(height: 8),
              const Text('ประวัติการดำเนินการ', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 6),
              StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                stream: appFirestore.collection('jobs').doc(jobId).collection('activities').orderBy('createdAt', descending: true).limit(40).snapshots(),
                builder: (context, activitySnap) {
                  if (!activitySnap.hasData) return const SizedBox.shrink();
                  final docs = activitySnap.data!.docs;
                  if (docs.isEmpty) return const Text('ยังไม่มีความเคลื่อนไหว');
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final item in docs) _ActivityTile(data: item.data()),
                    ],
                  );
                },
              ),
            ],
          );
        },
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final photos = photoUrls(data['photos']);
    final when = data['createdAt'];
    final time = when is Timestamp ? when.toDate() : null;
    final who = (data['userName'] ?? '').toString();
    final stamp = time == null ? '' : ' ${time.day}/${time.month}/${time.year} ${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('• ${(data['text'] ?? '').toString()}'),
          if (who.isNotEmpty || stamp.isNotEmpty) Text('$who$stamp', style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
          if (photos.isNotEmpty) ...[
            const SizedBox(height: 6),
            SizedBox(
              height: 88,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: photos.length,
                separatorBuilder: (context, index) => const SizedBox(width: 6),
                itemBuilder: (context, index) => ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: JobPhoto(url: photos[index], width: 110, height: 88),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

Future<void> confirmJobAction(BuildContext context, Staff staff, JobRecord job, JobAction action) async {
  final agreed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(actionLabel(action)),
      content: Text(actionConfirm(action)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('ยกเลิก')),
        FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('ยืนยัน')),
      ],
    ),
  );
  if (agreed != true || !context.mounted) return;
  try {
    await runJobAction(staff, job, action);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${actionLabel(action)}แล้ว')));
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('ทำรายการไม่สำเร็จ: $error')));
  }
}
