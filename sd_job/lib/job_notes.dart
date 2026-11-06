import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'job.dart';
import 'job_actions.dart';
import 'staff.dart';

class NotebookSection extends StatelessWidget {
  const NotebookSection({super.key, required this.job});

  final JobRecord job;

  @override
  Widget build(BuildContext context) {
    final note = job.notebook;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(child: Text('สมุดบันทึก (Notebook)', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16))),
            OutlinedButton(onPressed: () => _editNotebook(context), child: const Text('แก้ไข')),
          ],
        ),
        const SizedBox(height: 8),
        DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.blueGrey.shade50,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.blueGrey.shade200),
          ),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Text(note.isEmpty ? 'ยังไม่มีบันทึก' : note),
          ),
        ),
      ],
    );
  }

  Future<void> _editNotebook(BuildContext context) async {
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
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
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

class ProgressPhotoButton extends StatelessWidget {
  const ProgressPhotoButton({super.key, required this.staff, required this.job});

  final Staff staff;
  final JobRecord job;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton.icon(
      onPressed: () async {
        final saved = await Navigator.of(context).push<bool>(
          MaterialPageRoute(builder: (_) => ProgressPhotoPage(staff: staff, job: job)),
        );
        if (saved == true && context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('บันทึกรูปกิจกรรมแล้ว')));
        }
      },
      icon: const Icon(Icons.photo_camera_outlined),
      label: const Text('แนบรูปกิจกรรม (พร้อมคำอธิบาย)'),
    );
  }
}

class ProgressPhotoPage extends StatefulWidget {
  const ProgressPhotoPage({super.key, required this.staff, required this.job});

  final Staff staff;
  final JobRecord job;

  @override
  State<ProgressPhotoPage> createState() => _ProgressPhotoPageState();
}

class _ProgressPhotoPageState extends State<ProgressPhotoPage> {
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
      final next = <Uint8List>[];
      for (final file in files) {
        next.add(await file.readAsBytes());
      }
      if (!mounted || next.isEmpty) return;
      setState(() => _images.addAll(next.take(maxActivityPhotos - _images.length)));
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = 'เลือกรูปไม่สำเร็จ: $error');
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
          Row(
            children: [
              OutlinedButton.icon(onPressed: _busy ? null : () => _add(ImageSource.camera), icon: const Icon(Icons.photo_camera_outlined), label: const Text('ถ่ายรูป')),
              const SizedBox(width: 8),
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
                      top: 0,
                      right: 0,
                      child: IconButton(
                        visualDensity: VisualDensity.compact,
                        onPressed: _busy ? null : () => setState(() => _images.removeAt(index)),
                        icon: const Icon(Icons.close),
                      ),
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
            decoration: const InputDecoration(labelText: 'คำอธิบายรูป', hintText: 'เช่น น้ำมันมีสิ่งเจือปน', border: OutlineInputBorder()),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 12),
          FilledButton(onPressed: _busy ? null : _save, child: Text(_busy ? 'กำลังบันทึก...' : 'บันทึกรูป')),
        ],
      ),
    );
  }
}
