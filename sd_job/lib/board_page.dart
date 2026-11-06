import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import 'data_location.dart';
import 'job.dart';
import 'job_detail_page.dart';
import 'job_photo.dart';
import 'staff.dart';

class BoardPage extends StatefulWidget {
  const BoardPage({super.key, required this.staff, required this.department, this.assigneeUid});

  final Staff staff;
  final String department;
  final String? assigneeUid;

  @override
  State<BoardPage> createState() => _BoardPageState();
}

class _BoardPageState extends State<BoardPage> {
  String _search = '';

  @override
  Widget build(BuildContext context) {
    var filter = Filter.and(
      Filter.or(
        Filter('department', isEqualTo: widget.department),
        Filter('mainDepartment', isEqualTo: widget.department),
      ),
      Filter('status', whereIn: departmentViewStatuses),
    );
    final assignee = widget.assigneeUid;
    if (assignee != null && assignee.isNotEmpty) {
      filter = Filter.and(filter, Filter('assigneeUid', isEqualTo: assignee));
    }

    final query = appFirestore.collection('jobs').where(filter).orderBy('createdAt').limit(200);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
          child: TextField(
            decoration: const InputDecoration(
              hintText: 'ค้นหาชื่อ เบอร์ ทะเบียน เลขงาน',
              prefixIcon: Icon(Icons.search),
              border: OutlineInputBorder(),
              isDense: true,
            ),
            onChanged: (value) => setState(() => _search = value),
          ),
        ),
        Expanded(
          child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: query.snapshots(),
            builder: (context, snapshot) {
              if (snapshot.hasError) {
                return _Message(text: 'โหลดงานไม่สำเร็จ\n${snapshot.error}');
              }
              if (!snapshot.hasData) {
                return const Center(child: CircularProgressIndicator());
              }
              final jobs = snapshot.data!.docs.map((doc) => jobFromDoc(doc.id, doc.data())).where((job) => jobMatchesSearch(job, _search)).toList()
                ..sort((a, b) => jobAgeDays(b).compareTo(jobAgeDays(a)));
              if (jobs.isEmpty) {
                return const _Message(text: 'ยังไม่มีงานค้างในแผนกนี้');
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                itemCount: jobs.length,
                separatorBuilder: (context, index) => const SizedBox(height: 12),
                itemBuilder: (context, index) => _JobCard(staff: widget.staff, job: jobs[index]),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _JobCard extends StatelessWidget {
  const _JobCard({required this.staff, required this.job});

  final Staff staff;
  final JobRecord job;

  @override
  Widget build(BuildContext context) {
    final age = jobAgeDays(job);
    final actions = jobActions(staff, job);
    final quick = actions.where((action) => action != JobAction.skipParts && action != JobAction.moreParts).toList();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => JobDetailPage(staff: staff, jobId: job.id)));
        },
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 16 / 7,
              child: JobPhoto(
                url: job.photos.isEmpty ? null : job.photos.first,
                topLeft: age > 0 ? 'ค้าง $age วัน' : null,
                topLeftColor: age >= 15 ? Colors.red.shade700 : age >= 8 ? Colors.orange.shade800 : Colors.green.shade700,
                topRight: statusLabel(job.status),
                topRightColor: _statusColor(job.status),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(job.customerName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  const SizedBox(height: 2),
                  Text('${job.displayNo} · ${shopLabel(job.department)}', style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
                  if (job.description.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(job.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ],
                  if (quick.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: () => confirmJobAction(context, staff, job, quick.first),
                        child: Text(actionLabel(quick.first)),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

Color _statusColor(String status) {
  switch (status) {
    case 'RECEIVED':
      return Colors.amber.shade800;
    case 'IN_PROGRESS':
      return Colors.cyan.shade700;
    case 'WAITING_QUOTATION':
      return Colors.blue.shade700;
    case 'PENDING_CUSTOMER_INFORM':
      return Colors.pink.shade600;
    case 'WAITING_APPROVE':
      return Colors.orange.shade800;
    case 'PENDING_PARTS':
      return Colors.purple.shade700;
    case 'IN_REPAIR_PROCESS':
      return Colors.indigo.shade700;
    default:
      return Colors.blueGrey.shade700;
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(text, textAlign: TextAlign.center),
      ),
    );
  }
}
