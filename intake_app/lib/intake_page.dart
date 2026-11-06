import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'access.dart';
import 'data_location.dart';

class IntakeCustomer {
  const IntakeCustomer({
    required this.id,
    required this.name,
    required this.phone,
    this.taxName,
  });

  final String id;
  final String name;
  final String phone;
  final String? taxName;

  bool matches(String query) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return true;
    return name.toLowerCase().contains(q) ||
        (taxName ?? '').toLowerCase().contains(q) ||
        phone.toLowerCase().contains(q);
  }
}

class IntakePage extends StatefulWidget {
  const IntakePage({super.key, required this.displayName});

  final String displayName;

  @override
  State<IntakePage> createState() => _IntakePageState();
}

class _IntakePageState extends State<IntakePage> {
  static const _maxPhotos = 4;

  final _description = TextEditingController();
  final _brand = TextEditingController();
  final _modelOrReg = TextEditingController();
  final _plateOrPart = TextEditingController();
  final _picker = ImagePicker();

  String? _department;
  IntakeCustomer? _customer;
  final List<XFile> _photos = [];
  bool _busy = false;
  String? _busyLabel;

  @override
  void dispose() {
    _description.dispose();
    _brand.dispose();
    _modelOrReg.dispose();
    _plateOrPart.dispose();
    super.dispose();
  }

  void _resetForm() {
    _description.clear();
    _brand.clear();
    _modelOrReg.clear();
    _plateOrPart.clear();
    setState(() {
      _department = null;
      _customer = null;
      _photos.clear();
    });
  }

  Future<void> _pick(ImageSource source) async {
    final room = _maxPhotos - _photos.length;
    if (room <= 0) return;
    if (source == ImageSource.gallery) {
      final picked = await _picker.pickMultiImage(maxWidth: 1600, imageQuality: 72);
      if (!mounted || picked.isEmpty) return;
      setState(() => _photos.addAll(picked.take(room)));
      if (picked.length > room && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('แนบรูปได้สูงสุด 4 รูป')),
        );
      }
      return;
    }
    final photo = await _picker.pickImage(
      source: ImageSource.camera,
      maxWidth: 1600,
      imageQuality: 72,
    );
    if (!mounted || photo == null) return;
    setState(() => _photos.add(photo));
  }

  String? _validate() {
    if (_customer == null) return 'กรุณาเลือกลูกค้า';
    if (_department == null) return 'กรุณาเลือกแผนก';
    if (_department == 'CAR_SERVICE' || _department == 'COMMONRAIL' || _department == 'MECHANIC') {
      if (_brand.text.trim().isEmpty) {
        return _department == 'CAR_SERVICE' ? 'กรุณาระบุยี่ห้อรถ' : 'กรุณาระบุยี่ห้อ';
      }
      if (_department == 'CAR_SERVICE' && _modelOrReg.text.trim().isEmpty) {
        return 'กรุณาระบุรุ่นรถ';
      }
      if (_department != 'CAR_SERVICE' && _modelOrReg.text.trim().isEmpty) {
        return 'กรุณาระบุเลขทะเบียนชิ้นส่วน';
      }
      if (_department == 'CAR_SERVICE' && _plateOrPart.text.trim().isEmpty) {
        return 'กรุณาระบุทะเบียนรถ';
      }
      if (_department != 'CAR_SERVICE' && _plateOrPart.text.trim().isEmpty) {
        return 'กรุณาระบุเลขอะไหล่';
      }
    }
    if (_description.text.trim().isEmpty) return 'กรุณากรอกรายละเอียดงาน';
    if (_description.text.trim().length > 1000) return 'รายละเอียดต้องไม่เกิน 1000 ตัวอักษร';
    if (_photos.isEmpty) return 'กรุณาแนบรูปภาพประกอบอย่างน้อย 1 รูป';
    return null;
  }

  Future<void> _submit() async {
    final problem = _validate();
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      return;
    }

    setState(() {
      _busy = true;
      _busyLabel = 'กำลังอัปโหลดรูป';
    });

    try {
      final urls = <String>[];
      for (var i = 0; i < _photos.length; i++) {
        final photo = _photos[i];
        final bytes = await photo.readAsBytes();
        final name = '${DateTime.now().millisecondsSinceEpoch}-$i.jpg';
        final ref = appStorage.ref('jobs/temp/$name');
        await ref.putData(
          bytes,
          SettableMetadata(contentType: photo.mimeType ?? 'image/jpeg'),
        );
        urls.add(await ref.getDownloadURL());
      }

      if (!mounted) return;
      setState(() => _busyLabel = 'กำลังสร้างใบงาน');

      final payload = <String, dynamic>{
        'customerId': _customer!.id,
        'department': _department,
        'description': _description.text.trim(),
        'photos': urls,
      };
      if (_department == 'CAR_SERVICE') {
        payload['carServiceDetails'] = {
          'brand': _brand.text.trim(),
          'model': _modelOrReg.text.trim(),
          'licensePlate': _plateOrPart.text.trim(),
        };
      } else if (_department == 'COMMONRAIL' || _department == 'MECHANIC') {
        final details = {
          'brand': _brand.text.trim(),
          'registrationNumber': _modelOrReg.text.trim(),
          'partNumber': _plateOrPart.text.trim(),
        };
        payload[_department == 'COMMONRAIL' ? 'commonrailDetails' : 'mechanicDetails'] = details;
      }

      final callable = FirebaseFunctions.instanceFor(region: 'us-central1').httpsCallable('createJob');
      final result = await callable.call(payload);
      final data = Map<Object?, Object?>.from(result.data as Map);
      final jobNo = data['jobNo']?.toString() ?? '';
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('สร้างใบงานสำเร็จ'),
          content: Text(jobNo.isEmpty ? 'บันทึกงานแล้ว' : 'เลขที่ใบงาน: $jobNo'),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('เปิดงานถัดไป'),
            ),
          ],
        ),
      );
      _resetForm();
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final msg = error.message?.trim();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text((msg == null || msg.isEmpty || msg.toLowerCase() == 'internal') ? 'สร้างงานไม่สำเร็จ' : msg)),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('สร้างงานไม่สำเร็จ: $error')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _busyLabel = null;
        });
      }
    }
  }

  Future<void> _chooseCustomer(List<IntakeCustomer> customers) async {
    final selected = await showModalBottomSheet<IntakeCustomer>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) => _CustomerSheet(customers: customers),
    );
    if (selected != null) setState(() => _customer = selected);
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: appFirestore
            .collection('customers')
            .orderBy('createdAt', descending: true)
            .limit(5000)
            .snapshots(),
        builder: (context, snapshot) {
          final customers = [
            for (final doc in snapshot.data?.docs ?? <QueryDocumentSnapshot<Map<String, dynamic>>>[])
              IntakeCustomer(
                id: doc.id,
                name: (doc.data()['name'] as String?)?.trim().isNotEmpty == true
                    ? (doc.data()['name'] as String).trim()
                    : doc.id,
                phone: (doc.data()['phone'] as String?) ?? '',
                taxName: (doc.data()['taxName'] as String?)?.trim(),
              ),
          ];
          return Stack(
            children: [
              ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  Text('ผู้เปิดงาน: ${widget.displayName}'),
                  const SizedBox(height: 16),
                  Text('ลูกค้า', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _busy || snapshot.connectionState == ConnectionState.waiting
                        ? null
                        : () => _chooseCustomer(customers),
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: snapshot.connectionState == ConnectionState.waiting
                          ? const Text('กำลังโหลดรายชื่อลูกค้า...')
                          : Text(
                              _customer == null
                                  ? 'ค้นหาชื่อ หรือเบอร์โทรลูกค้า'
                                  : '${_customer!.name}\n${_customer!.phone}',
                            ),
                    ),
                  ),
                  if (snapshot.hasError)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'โหลดลูกค้าไม่สำเร็จ',
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    key: ValueKey(_department),
                    initialValue: _department,
                    decoration: const InputDecoration(labelText: 'แผนกที่รับผิดชอบ'),
                    items: [
                      for (final item in jobDepartments)
                        DropdownMenuItem(value: item.$1, child: Text(item.$2)),
                    ],
                    onChanged: _busy
                        ? null
                        : (value) => setState(() {
                              _department = value;
                              _brand.clear();
                              _modelOrReg.clear();
                              _plateOrPart.clear();
                            }),
                  ),
                  if (_department == 'CAR_SERVICE' ||
                      _department == 'COMMONRAIL' ||
                      _department == 'MECHANIC') ...[
                    const SizedBox(height: 16),
                    Text(
                      _department == 'CAR_SERVICE' ? 'รายละเอียดรถยนต์' : 'รายละเอียดชิ้นส่วน',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _brand,
                      enabled: !_busy,
                      maxLength: 200,
                      decoration: InputDecoration(
                        labelText: _department == 'CAR_SERVICE' ? 'ยี่ห้อรถ' : 'ยี่ห้อ',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _modelOrReg,
                      enabled: !_busy,
                      maxLength: 200,
                      decoration: InputDecoration(
                        labelText: _department == 'CAR_SERVICE' ? 'รุ่นรถ' : 'เลขทะเบียนชิ้นส่วน',
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _plateOrPart,
                      enabled: !_busy,
                      maxLength: 200,
                      decoration: InputDecoration(
                        labelText: _department == 'CAR_SERVICE' ? 'ทะเบียนรถ' : 'เลขอะไหล่',
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  TextField(
                    controller: _description,
                    enabled: !_busy,
                    minLines: 4,
                    maxLines: 6,
                    maxLength: 1000,
                    decoration: const InputDecoration(
                      labelText: 'รายละเอียดงาน / อาการแจ้งซ่อม',
                      alignLabelWithHint: true,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text('รูปภาพประกอบ (สูงสุด $_maxPhotos รูป)', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy || _photos.length >= _maxPhotos ? null : () => _pick(ImageSource.camera),
                          icon: const Icon(Icons.photo_camera_outlined),
                          label: const Text('ถ่ายรูป'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _busy || _photos.length >= _maxPhotos ? null : () => _pick(ImageSource.gallery),
                          icon: const Icon(Icons.photo_library_outlined),
                          label: const Text('อัลบั้ม'),
                        ),
                      ),
                    ],
                  ),
                  if (_photos.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    SizedBox(
                      height: 104,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _photos.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          return Stack(
                            clipBehavior: Clip.none,
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: _PhotoThumb(file: _photos[index]),
                              ),
                              Positioned(
                                top: -6,
                                right: -6,
                                child: IconButton.filled(
                                  style: IconButton.styleFrom(
                                    backgroundColor: Colors.red.shade700,
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size(28, 28),
                                    padding: EdgeInsets.zero,
                                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  onPressed: _busy ? null : () => setState(() => _photos.removeAt(index)),
                                  icon: const Icon(Icons.close, size: 16),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      backgroundColor: const Color(0xFF0D9488),
                    ),
                    child: Text(_busyLabel ?? 'สร้างใบงาน'),
                  ),
                ],
              ),
            ],
          );
        },
    );
  }
}

class _PhotoThumb extends StatelessWidget {
  const _PhotoThumb({required this.file});

  final XFile file;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder(
      future: file.readAsBytes(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const SizedBox(
            width: 96,
            height: 96,
            child: ColoredBox(color: Color(0xFFE5E7EB)),
          );
        }
        return Image.memory(snapshot.data!, width: 96, height: 96, fit: BoxFit.cover);
      },
    );
  }
}

class _CustomerSheet extends StatefulWidget {
  const _CustomerSheet({required this.customers});

  final List<IntakeCustomer> customers;

  @override
  State<_CustomerSheet> createState() => _CustomerSheetState();
}

class _CustomerSheetState extends State<_CustomerSheet> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = widget.customers.where((c) => c.matches(_search.text)).take(80).toList();
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 16 + bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.7,
        child: Column(
          children: [
            TextField(
              controller: _search,
              autofocus: true,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'พิมพ์ชื่อ บริษัท หรือเบอร์โทร',
              ),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: filtered.isEmpty
                  ? const Center(child: Text('ไม่พบข้อมูลลูกค้า'))
                  : ListView.separated(
                      itemCount: filtered.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final customer = filtered[index];
                        return ListTile(
                          title: Text(customer.name),
                          subtitle: Text(
                            [
                              customer.phone,
                              if ((customer.taxName ?? '').isNotEmpty) customer.taxName!,
                            ].join(' · '),
                          ),
                          onTap: () => Navigator.pop(context, customer),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
