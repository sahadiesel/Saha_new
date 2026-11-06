import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'data_location.dart';

final _photoCache = <String, Uint8List>{};

class StoragePhoto extends StatefulWidget {
  const StoragePhoto({super.key, required this.url, this.width, this.height, this.fit = BoxFit.cover});

  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;

  @override
  State<StoragePhoto> createState() => _StoragePhotoState();
}

class _StoragePhotoState extends State<StoragePhoto> {
  Uint8List? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(StoragePhoto oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.url != widget.url) _load();
  }

  Future<void> _load() async {
    final cached = _photoCache[widget.url];
    if (cached != null) {
      setState(() {
        _bytes = cached;
        _failed = false;
      });
      return;
    }
    try {
      final data = await appStorage.refFromURL(storageFileUrl(widget.url)).getData(8 * 1024 * 1024);
      if (!mounted) return;
      if (data == null || data.isEmpty) {
        setState(() => _failed = true);
        return;
      }
      _photoCache[widget.url] = data;
      setState(() {
        _bytes = data;
        _failed = false;
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bytes = _bytes;
    if (bytes != null) {
      return Image.memory(bytes, width: widget.width, height: widget.height, fit: widget.fit, gaplessPlayback: true);
    }
    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: ColoredBox(
        color: Colors.blueGrey.shade100,
        child: Center(
          child: _failed
              ? Icon(Icons.broken_image_outlined, color: Colors.blueGrey.shade400)
              : const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      ),
    );
  }
}
