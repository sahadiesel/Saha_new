import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import 'access.dart';
import 'data_location.dart';
import 'job_detail_page.dart';
import 'job_parse.dart';
import 'job_record.dart';
import 'staff_session.dart';

const _monthNames = <String>[
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key, required this.staff});

  final StaffSession staff;

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  final _search = TextEditingController();
  late int _year;
  int? _month;

  @override
  void initState() {
    super.initState();
    _year = DateTime.now().year;
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final years = [for (var year = DateTime.now().year; year >= 2020; year--) year];
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<int>(
                      key: ValueKey('year-$_year'),
                      initialValue: _year,
                      isExpanded: true,
                      decoration: const InputDecoration(isDense: true, labelText: 'ปี'),
                      items: [
                        for (final year in years) DropdownMenuItem(value: year, child: Text('$year')),
                      ],
                      onChanged: (value) {
                        if (value != null) setState(() => _year = value);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: DropdownButtonFormField<int?>(
                      key: ValueKey('month-$_month'),
                      initialValue: _month,
                      isExpanded: true,
                      decoration: const InputDecoration(isDense: true, labelText: 'เดือน'),
                      items: [
                        const DropdownMenuItem<int?>(value: null, child: Text('ทุกเดือน')),
                        for (var month = 1; month <= 12; month++)
                          DropdownMenuItem<int?>(value: month, child: Text(_monthNames[month - 1])),
                      ],
                      onChanged: (value) => setState(() => _month = value),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _search,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'ค้นหาชื่อ เบอร์โทร หรือทะเบียนรถ',
                  isDense: true,
                ),
                onChanged: (_) => setState(() {}),
              ),
            ],
          ),
        ),
        Expanded(
          child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
            stream: appFirestore
                .collection('jobsArchive_$_year')
                .orderBy('lastActivityAt', descending: true)
                .limit(400)
                .snapshots(),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return const Center(child: Text('โหลดประวัติงานซ่อมไม่สำเร็จ'));
              }
              final jobs = [
                for (final doc in snapshot.data?.docs ?? const []) jobFromDoc(doc.id, doc.data()),
              ].where((job) => historyVisible(job, month: _month, query: _search.text)).toList();
              if (jobs.isEmpty) {
                return const Center(child: Text('ไม่พบประวัติงานซ่อม'));
              }
              return ListView.separated(
                itemCount: jobs.length,
                separatorBuilder: (context, index) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final job = jobs[index];
                  final plate = job.detailLines.where((line) => line.$1 == 'ทะเบียน').map((line) => line.$2).join(' ');
                  return ListTile(
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => JobDetailPage(jobId: job.id, staff: widget.staff, archiveYear: _year),
                        ),
                      );
                    },
                    title: Text(job.displayNo, style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const SizedBox(height: 2),
                        Text(job.customerName),
                        if (job.phone.isNotEmpty) Text(job.phone, style: Theme.of(context).textTheme.bodySmall),
                        if (plate.isNotEmpty) Text(plate, style: Theme.of(context).textTheme.bodySmall),
                        const SizedBox(height: 6),
                        Wrap(
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            if (job.department.isNotEmpty)
                              Chip(
                                visualDensity: VisualDensity.compact,
                                label: Text(departmentLabel(job.department)),
                                backgroundColor: const Color(0xFFE2E8F0),
                                labelStyle: const TextStyle(color: Color(0xFF334155)),
                              ),
                            Chip(
                              visualDensity: VisualDensity.compact,
                              label: Text(jobStatusLabel(job.status)),
                              backgroundColor: const Color(0xFF94A3B8),
                              labelStyle: const TextStyle(color: Colors.white),
                            ),
                            if (job.updatedAt != null)
                              Text(formatJobTime(job.updatedAt), style: Theme.of(context).textTheme.bodySmall),
                          ],
                        ),
                      ],
                    ),
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
