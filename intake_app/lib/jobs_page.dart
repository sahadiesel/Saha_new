import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import 'access.dart';
import 'data_location.dart';
import 'job_detail_page.dart';
import 'job_parse.dart';
import 'job_record.dart';
import 'staff_session.dart';

class JobsPage extends StatefulWidget {
  const JobsPage({super.key, required this.staff});

  final StaffSession staff;

  @override
  State<JobsPage> createState() => _JobsPageState();
}

class _JobsPageState extends State<JobsPage> {
  final _search = TextEditingController();
  String _statusFilter = 'OPEN';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            children: [
              TextField(
                controller: _search,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'ค้นหาชื่อ เบอร์ เลขที่ใบงาน หรือทะเบียน',
                  isDense: true,
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                key: ValueKey(_statusFilter),
                initialValue: _statusFilter,
                isExpanded: true,
                decoration: const InputDecoration(isDense: true, labelText: 'สถานะ'),
                items: [
                  const DropdownMenuItem(value: 'OPEN', child: Text('งานที่ยังไม่ปิดทั้งหมด')),
                  for (final entry in jobStatusLabels.entries)
                    if (entry.key != 'CLOSED')
                      DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                  const DropdownMenuItem(value: 'CLOSED', child: Text('ปิดงาน')),
                ],
                onChanged: (value) {
                  if (value != null) setState(() => _statusFilter = value);
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: appFirestore
                .collection('jobs')
                .orderBy('lastActivityAt', descending: true)
                .limit(400)
                .snapshots(),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return const Center(child: Text('โหลดรายการงานไม่สำเร็จ'));
              }
              final jobs = [
                for (final doc in snapshot.data?.docs ?? const [])
                  jobFromDoc(doc.id, doc.data()),
              ].where((job) => jobVisible(job, _statusFilter, _search.text)).toList();
              if (jobs.isEmpty) {
                return const Center(child: Text('ไม่พบรายการงาน'));
              }
              return ListView.separated(
                itemCount: jobs.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final job = jobs[index];
                  return ListTile(
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => JobDetailPage(jobId: job.id, staff: widget.staff),
                        ),
                      );
                    },
                    title: Text(job.displayNo, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 2),
                        Text(job.customerName),
                        if (job.phone.isNotEmpty)
                          Text(job.phone, style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            if (job.department.isNotEmpty)
                              _Chip(text: departmentLabel(job.department), color: const Color(0xFFE2E8F0), foreground: const Color(0xFF334155)),
                            _Chip(
                              text: jobStatusLabel(job.status),
                              color: _statusColor(job.status),
                              foreground: Colors.white,
                            ),
                          ],
                        ),
                        if (job.description.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            job.description,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ],
                    ),
                    trailing: Text(
                      formatJobTime(job.updatedAt),
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                    isThreeLine: true,
                  );
                },
              );
            },
          ),
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.text, required this.color, required this.foreground});

  final String text;
  final Color color;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(999)),
      child: Text(text, style: TextStyle(color: foreground, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

Color _statusColor(String status) {
  switch (status) {
    case 'RECEIVED':
      return const Color(0xFFF59E0B);
    case 'IN_PROGRESS':
      return const Color(0xFF06B6D4);
    case 'WAITING_QUOTATION':
      return const Color(0xFF3B82F6);
    case 'PENDING_CUSTOMER_INFORM':
      return const Color(0xFFEC4899);
    case 'WAITING_APPROVE':
      return const Color(0xFFF97316);
    case 'PENDING_PARTS':
      return const Color(0xFFA855F7);
    case 'IN_REPAIR_PROCESS':
      return const Color(0xFF4F46E5);
    case 'DONE':
      return const Color(0xFF22C55E);
    case 'WAITING_CUSTOMER_PICKUP':
      return const Color(0xFF059669);
    case 'PICKED_UP':
      return const Color(0xFF2563EB);
    case 'CLOSED':
      return const Color(0xFF94A3B8);
    default:
      return const Color(0xFF64748B);
  }
}
