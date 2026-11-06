import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';

import 'access.dart';
import 'data_location.dart';
import 'job_parse.dart';
import 'job_photo.dart';
import 'job_record.dart';
import 'job_updates.dart';
import 'staff_session.dart';

const _docLabels = <String, String>{
  'QUOTATION': 'ใบเสนอราคา',
  'DELIVERY_NOTE': 'ใบส่งของชั่วคราว',
  'TAX_INVOICE': 'ใบกำกับภาษี',
  'RECEIPT': 'ใบเสร็จรับเงิน',
};

const _docStatusLabels = <String, String>{
  'DRAFT': 'ฉบับร่าง',
  'FINAL': 'ฉบับจริง',
  'OFFERED': 'เสนอแล้ว',
  'PAID': 'รับเงินแล้ว',
  'CANCELLED': 'ยกเลิก',
  'APPROVED': 'ตรวจสอบแล้ว',
  'ISSUED': 'ออกเอกสารแล้ว',
  'SUBMITTED': 'ส่งแล้ว',
  'COMPLETED': 'เสร็จสมบูรณ์',
};

class JobDetailPage extends StatelessWidget {
  const JobDetailPage({super.key, required this.jobId, required this.staff, this.archiveYear});

  final String jobId;
  final StaffSession staff;
  final int? archiveYear;

  String get _collection => archiveYear == null ? 'jobs' : 'jobsArchive_$archiveYear';

  bool get _readOnly => archiveYear != null;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: appFirestore.collection(_collection).doc(jobId).snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        final data = snapshot.data?.data();
        if (snapshot.hasError || data == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('รายละเอียดงาน')),
            body: const Center(child: Text('ไม่พบใบงานนี้')),
          );
        }
        final job = jobFromDoc(jobId, data);
        final actions = intakeActions(job);
        return Scaffold(
          appBar: AppBar(title: Text(job.customerName, maxLines: 1, overflow: TextOverflow.ellipsis)),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('Job: ${job.customerName}', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 4),
              Text('เลขที่ใบงาน: ${job.displayNo}'),
              Text('รหัสอ้างอิง: ${job.id}', style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 16),
              _Section(
                title: 'รายละเอียดใบงาน',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Row(
                      label: 'ลูกค้า',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(job.customerName),
                          if (job.phone.isNotEmpty) _PhoneLink(phone: job.phone),
                        ],
                      ),
                    ),
                    _Row(label: 'แผนกที่ดูแล', value: departmentLabel(job.department)),
                    _Row(label: 'รายการแจ้งซ่อม', value: job.description.isEmpty ? '-' : job.description),
                    if ((job.assigneeName ?? '').isNotEmpty) _Row(label: 'ผู้รับผิดชอบ', value: job.assigneeName!),
                    if (job.detailLines.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text('รายละเอียดรถ/ชิ้นส่วน', style: Theme.of(context).textTheme.titleSmall),
                      const SizedBox(height: 6),
                      for (final line in job.detailLines) _Row(label: line.$1, value: line.$2),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 12),
              _NotebookSection(job: job, readOnly: _readOnly),
              const SizedBox(height: 12),
              _DocumentsSection(job: job),
              const SizedBox(height: 12),
              _Section(
                title: 'สถานะงาน',
                child: Align(alignment: Alignment.centerLeft, child: Chip(label: Text(jobStatusLabel(job.status)))),
              ),
              if (job.updatedAt != null) ...[
                const SizedBox(height: 8),
                Text('อัปเดตล่าสุด ${formatJobTime(job.updatedAt)}', style: Theme.of(context).textTheme.bodySmall),
              ],
              if (!_readOnly) ...[
              const SizedBox(height: 12),
              _Section(
                title: 'การดำเนินการ (Actions)',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (actions.isEmpty) const Text('ไม่มีปุ่มสำหรับสถานะนี้ ใบเบิกและออกบิลทำบนเว็บ'),
                    for (final action in actions) ...[
                      FilledButton(
                        onPressed: () => _confirmAction(context, job, action),
                        child: Text(intakeActionLabel(action)),
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (job.status == 'PENDING_PARTS')
                      const Text('ใบเบิกอะไหล่ตัวจริงทำบนเว็บ จากนั้นกลับมากดว่าอะไหล่มาครบ หรือเลือกไม่ต้องเบิก'),
                  ],
                ),
              ),
              ],
              if (!_readOnly) ...[
                const SizedBox(height: 12),
                _ChatSection(jobId: jobId, staff: staff, sourceCollection: _collection, readOnly: _readOnly),
              ],
              const SizedBox(height: 12),
              _Section(
                title: 'รูปประกอบ (ตอนรับงาน)',
                child: job.photos.isEmpty
                    ? const Text('ยังไม่มีรูปตอนรับงาน')
                    : SizedBox(
                        height: 120,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: job.photos.length,
                          separatorBuilder: (context, index) => const SizedBox(width: 8),
                          itemBuilder: (context, index) => _zoomable(context, job.photos[index]),
                        ),
                      ),
              ),
              if (!_readOnly) ...[
              const SizedBox(height: 12),
              _Section(
                title: 'แนบรูประหว่างดำเนินการ',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('ประวัติด้านล่างบันทึกจากแต่ละขั้นตอน ถ้าต้องการแนบรูปให้กดปุ่มแล้วเขียนคำอธิบาย'),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () async {
                        final saved = await Navigator.of(context).push<bool>(
                          MaterialPageRoute(builder: (_) => _ProgressPhotoPage(staff: staff, job: job)),
                        );
                        if (saved == true && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('บันทึกรูปกิจกรรมแล้ว')));
                        }
                      },
                      icon: const Icon(Icons.photo_camera_outlined),
                      label: const Text('แนบรูปกิจกรรม (พร้อมคำอธิบาย)'),
                    ),
                  ],
                ),
              ),
              ],
              const SizedBox(height: 12),
              _Section(
                title: 'ประวัติการดำเนินการ',
                child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  stream: appFirestore.collection(_collection).doc(jobId).collection('activities').orderBy('createdAt', descending: true).limit(40).snapshots(),
                  builder: (context, activitySnap) {
                    if (activitySnap.hasError) return Text('โหลดประวัติไม่สำเร็จ');
                    if (!activitySnap.hasData) return const Center(child: CircularProgressIndicator());
                    final docs = activitySnap.data!.docs;
                    if (docs.isEmpty) return const Text('ยังไม่มีประวัติกิจกรรม');
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        for (final item in docs) _ActivityTile(data: item.data()),
                      ],
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _zoomable(BuildContext context, String url) {
    return GestureDetector(
      onTap: () {
        showDialog<void>(
          context: context,
          builder: (context) => Dialog(child: InteractiveViewer(child: StoragePhoto(url: url, fit: BoxFit.contain))),
        );
      },
      child: ClipRRect(borderRadius: BorderRadius.circular(8), child: StoragePhoto(url: url, width: 120, height: 120)),
    );
  }

  Future<void> _confirmAction(BuildContext context, JobRecord job, IntakeAction action) async {
    final agreed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(intakeActionLabel(action)),
        content: Text(intakeActionConfirm(action)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('ยกเลิก')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('ยืนยัน')),
        ],
      ),
    );
    if (agreed != true || !context.mounted) return;
    try {
      await runIntakeAction(staff, job, action);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${intakeActionLabel(action)}แล้ว')));
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('ทำรายการไม่สำเร็จ: $error')));
    }
  }
}

class _NotebookSection extends StatelessWidget {
  const _NotebookSection({required this.job, required this.readOnly});

  final JobRecord job;
  final bool readOnly;

  @override
  Widget build(BuildContext context) {
    final note = job.notebook;
    return _Section(
      title: 'สมุดบันทึก (Notebook)',
      trailing: readOnly ? null : OutlinedButton(onPressed: () => _edit(context), child: const Text('แก้ไข')),
      child: Text(note.isEmpty ? 'ยังไม่มีบันทึก' : note),
    );
  }

  Future<void> _edit(BuildContext context) async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => _NotebookDialog(job: job),
    );
    if (saved == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('บันทึกสมุดบันทึกแล้ว')));
    }
  }
}

class _NotebookDialog extends StatefulWidget {
  const _NotebookDialog({required this.job});

  final JobRecord job;

  @override
  State<_NotebookDialog> createState() => _NotebookDialogState();
}

class _NotebookDialogState extends State<_NotebookDialog> {
  late final TextEditingController _text = TextEditingController(text: widget.job.notebook);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await saveNotebook(widget.job, _text.text);
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      setState(() => _error = 'บันทึกไม่สำเร็จ: $error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('แก้ไขสมุดบันทึก'),
      content: SingleChildScrollView(
        child: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: _text,
                maxLines: 10,
                maxLength: 5000,
                decoration: const InputDecoration(hintText: 'บันทึกรายละเอียดงาน...', border: OutlineInputBorder()),
              ),
              if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(onPressed: _busy ? null : () => Navigator.pop(context), child: const Text('ยกเลิก')),
        FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'กำลังบันทึก...' : 'บันทึก')),
      ],
    );
  }
}

class _DocumentsSection extends StatelessWidget {
  const _DocumentsSection({required this.job});

  final JobRecord job;

  @override
  Widget build(BuildContext context) {
    return _Section(
      title: 'เอกสารอ้างอิง',
      child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: appFirestore.collection('documents').where('jobId', isEqualTo: job.id).snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) return const Text('โหลดเอกสารไม่สำเร็จ');
          if (!snapshot.hasData) return const LinearProgressIndicator();
          final grouped = <String, List<QueryDocumentSnapshot<Map<String, dynamic>>>>{};
          final withdrawals = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
          for (final doc in snapshot.data!.docs) {
            final type = (doc.data()['docType'] ?? '').toString();
            if (type == 'WITHDRAWAL') {
              withdrawals.add(doc);
            } else if (_docLabels.containsKey(type)) {
              grouped.putIfAbsent(type, () => []).add(doc);
            }
          }
          return Column(
            children: [
              for (final type in _docLabels.keys) _docRow(type, _latest(grouped[type], preferId: type == 'QUOTATION' ? job.salesDocId : '')),
              _docRow('WITHDRAWAL', withdrawals.isEmpty ? null : withdrawals.first, label: 'ใบเบิกอะไหล่'),
            ],
          );
        },
      ),
    );
  }

  QueryDocumentSnapshot<Map<String, dynamic>>? _latest(List<QueryDocumentSnapshot<Map<String, dynamic>>>? docs, {String preferId = ''}) {
    if (docs == null || docs.isEmpty) return null;
    if (preferId.isNotEmpty) {
      for (final doc in docs) {
        if (doc.id == preferId) return doc;
      }
    }
    return docs.first;
  }

  Widget _docRow(String type, QueryDocumentSnapshot<Map<String, dynamic>>? doc, {String? label}) {
    final data = doc?.data();
    final number = (data?['docNo'] ?? '').toString();
    final status = (data?['status'] ?? '').toString();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(child: Text(label ?? _docLabels[type] ?? type)),
          if (doc == null)
            const Text('— ไม่มี —')
          else
            Text('${number.isEmpty ? doc.id : number}  ${_docStatusLabels[status] ?? status}'),
        ],
      ),
    );
  }
}

class _ChatSection extends StatefulWidget {
  const _ChatSection({required this.jobId, required this.staff, required this.sourceCollection, required this.readOnly});

  final String jobId;
  final StaffSession staff;
  final String sourceCollection;
  final bool readOnly;

  @override
  State<_ChatSection> createState() => _ChatSectionState();
}

class _ChatSectionState extends State<_ChatSection> {
  final _text = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    markCustomerChatRead(widget.staff.uid, widget.jobId);
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final note = _text.text.trim();
    if (note.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await sendCustomerChat(widget.staff, widget.jobId, note);
      _text.clear();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('ส่งไม่สำเร็จ: $error')));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _Section(
      title: 'แชทกับลูกค้า (พอร์ทัล)',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('ข้อความจากลูกค้าในพอร์ทัล — ตอบกลับเพื่อแจ้งลูกค้าได้ทันที'),
          const SizedBox(height: 8),
          SizedBox(
            height: 180,
            child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
              stream: appFirestore.collection(widget.sourceCollection).doc(widget.jobId).collection('customerChat').orderBy('createdAt').snapshots(),
              builder: (context, snapshot) {
                if (snapshot.hasError) return const Text('โหลดแชทไม่สำเร็จ');
                if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
                final docs = snapshot.data!.docs;
                if (docs.isEmpty) return const Center(child: Text('ยังไม่มีข้อความ'));
                return ListView(
                  children: [
                    for (final item in docs)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Text('${item.data()['userName'] ?? ''} (${item.data()['authorRole'] == 'CUSTOMER' ? 'ลูกค้า' : 'พนักงาน'}): ${item.data()['text'] ?? ''}'),
                      ),
                  ],
                );
              },
            ),
          ),
          if (!widget.readOnly) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _text,
                    decoration: const InputDecoration(hintText: 'พิมพ์ข้อความตอบลูกค้า...', isDense: true),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                IconButton(onPressed: _sending ? null : _send, icon: const Icon(Icons.send)),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.data});

  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final photos = [
      for (final item in (data['photos'] as List?) ?? const [])
        if (item is String && item.trim().isNotEmpty) item.trim(),
    ];
    final when = data['createdAt'];
    final time = when is Timestamp ? when.toDate() : null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${data['userName'] ?? ''}  ${time == null ? '' : formatJobTime(time)}'),
          Text((data['text'] ?? '').toString()),
          if (photos.isNotEmpty)
            SizedBox(
              height: 72,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: photos.length,
                separatorBuilder: (context, index) => const SizedBox(width: 6),
                itemBuilder: (context, index) => ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: StoragePhoto(url: photos[index], width: 72, height: 72),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ProgressPhotoPage extends StatefulWidget {
  const _ProgressPhotoPage({required this.staff, required this.job});

  final StaffSession staff;
  final JobRecord job;

  @override
  State<_ProgressPhotoPage> createState() => _ProgressPhotoPageState();
}

class _ProgressPhotoPageState extends State<_ProgressPhotoPage> {
  final _caption = TextEditingController();
  final _picker = ImagePicker();
  final _images = <Uint8List>[];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  Future<void> _add(ImageSource source) async {
    if (_images.length >= maxActivityPhotos) return;
    try {
      if (source == ImageSource.camera) {
        final file = await _picker.pickImage(source: source, maxWidth: 1600, imageQuality: 70);
        if (file == null) return;
        final bytes = await file.readAsBytes();
        if (!mounted) return;
        setState(() => _images.add(bytes));
        return;
      }
      final files = await _picker.pickMultiImage(maxWidth: 1600, imageQuality: 70, limit: maxActivityPhotos - _images.length);
      final next = <Uint8List>[for (final file in files) await file.readAsBytes()];
      if (!mounted || next.isEmpty) return;
      setState(() => _images.addAll(next.take(maxActivityPhotos - _images.length)));
    } catch (error) {
      if (mounted) setState(() => _error = 'เลือกรูปไม่สำเร็จ: $error');
    }
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await addProgressPhotos(staff: widget.staff, job: widget.job, caption: _caption.text, images: _images);
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      setState(() => _error = '$error'.replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('แนบรูปกิจกรรม')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('ถ่ายหรือเลือกรูป แล้วอธิบายสั้นๆ ว่ารูปนี้แสดงอะไร'),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton.icon(onPressed: _busy ? null : () => _add(ImageSource.camera), icon: const Icon(Icons.photo_camera_outlined), label: const Text('ถ่ายรูป')),
              OutlinedButton.icon(onPressed: _busy ? null : () => _add(ImageSource.gallery), icon: const Icon(Icons.photo_library_outlined), label: const Text('เลือกจากอัลบั้ม')),
            ],
          ),
          const SizedBox(height: 12),
          if (_images.isEmpty)
            const Text('ยังไม่ได้เลือกรูป')
          else
            SizedBox(
              height: 96,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _images.length,
                separatorBuilder: (context, index) => const SizedBox(width: 8),
                itemBuilder: (context, index) => Stack(
                  children: [
                    ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(_images[index], width: 96, height: 96, fit: BoxFit.cover)),
                    Positioned(
                      right: 0,
                      child: IconButton(onPressed: _busy ? null : () => setState(() => _images.removeAt(index)), icon: const Icon(Icons.close)),
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 12),
          TextField(
            controller: _caption,
            maxLines: 3,
            maxLength: 500,
            decoration: const InputDecoration(labelText: 'คำอธิบายรูป', border: OutlineInputBorder()),
          ),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'กำลังบันทึก...' : 'บันทึกรูป')),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child, this.trailing});

  final String title;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: Theme.of(context).textTheme.titleMedium)),
                ?trailing,
              ],
            ),
            const SizedBox(height: 8),
            child,
          ],
        ),
      ),
    );
  }
}

class _PhoneLink extends StatelessWidget {
  const _PhoneLink({required this.phone});

  final String phone;

  Future<void> _dial(BuildContext context) async {
    final digits = phone.replaceAll(RegExp(r'[^\d+]'), '');
    final opened = await launchUrl(Uri(scheme: 'tel', path: digits), mode: LaunchMode.externalApplication);
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('เปิดแอปโทรศัพท์ไม่สำเร็จ')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => _dial(context),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.phone, size: 16, color: Theme.of(context).colorScheme.primary),
            const SizedBox(width: 4),
            Text(
              phone,
              style: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                decoration: TextDecoration.underline,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, this.value = '', this.child});

  final String label;
  final String value;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 120, child: Text(label, style: TextStyle(color: Colors.grey.shade700))),
          Expanded(child: child ?? Text(value)),
        ],
      ),
    );
  }
}
